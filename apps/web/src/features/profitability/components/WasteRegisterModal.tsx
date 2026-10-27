import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input, Field, Icon } from '../../../ui/index.js';

interface WasteRegisterModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeLocationId: string;
  supplies: any[];
  products: any[];
}

export const WasteRegisterModal: React.FC<WasteRegisterModalProps> = ({
  isOpen,
  onClose,
  activeLocationId,
  supplies,
  products
}) => {
  const queryClient = useQueryClient();
  const [wasteType, setWasteType] = useState<'SUPPLY' | 'DISH'>('SUPPLY');
  const [selectedLocation, setSelectedLocation] = useState(
    activeLocationId === 'ALL' ? 'loc_alta_vista' : activeLocationId
  );
  const [supplyId, setSupplyId] = useState(supplies[0]?.id || '');
  const [productId, setProductId] = useState(products[0]?.id || '');
  const [quantity, setQuantity] = useState('1');
  const [manualCostUsd, setManualCostUsd] = useState('');
  const [reason, setReason] = useState('MERMA_COCCION');
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Auto-calcular costo
  const selectedSupply = supplies.find((s) => s.id === supplyId);
  const selectedProduct = products.find((p) => p.id === productId);

  const defaultUnitCostCents =
    wasteType === 'SUPPLY'
      ? selectedSupply?.effective_cost_cents || selectedSupply?.weightedAvgCostUsdCents || 0
      : selectedProduct?.priceUsdCents
      ? Math.round(selectedProduct.priceUsdCents * 0.4)
      : 150;

  const unitCostCents = manualCostUsd
    ? Math.round(parseFloat(manualCostUsd) * 100)
    : defaultUnitCostCents;

  const qty = parseFloat(quantity) || 0;
  const totalLossCents = Math.round(qty * unitCostCents);

  const wasteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/fase3/waste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: selectedLocation,
          supplyId: wasteType === 'SUPPLY' ? supplyId : null,
          productId: wasteType === 'DISH' ? productId : null,
          quantity: qty,
          unitCostUsdCents: unitCostCents,
          reason,
          notes
        })
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['fase3Waste'] });
        queryClient.invalidateQueries({ queryKey: ['fase3Supplies'] });
        onClose();
        setQuantity('1');
        setManualCostUsd('');
        setNotes('');
        setErrorMsg(null);
      } else {
        setErrorMsg(data.error || 'Error al registrar merma');
      }
    },
    onError: () => {
      setErrorMsg('Error de red al guardar la merma');
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (qty <= 0) {
      setErrorMsg('Ingresa una cantidad mayor a cero');
      return;
    }
    wasteMutation.mutate();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Registrar Merma / Desecho Operativo">
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo de Merma" required>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-surface-alt rounded-xl border border-border">
              <button
                type="button"
                onClick={() => setWasteType('SUPPLY')}
                className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                  wasteType === 'SUPPLY'
                    ? 'bg-primary text-primary-ink shadow-xs'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                Insumo
              </button>
              <button
                type="button"
                onClick={() => setWasteType('DISH')}
                className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                  wasteType === 'DISH'
                    ? 'bg-primary text-primary-ink shadow-xs'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                Plato Preparado
              </button>
            </div>
          </Field>

          <Field label="Sede del Evento" required>
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
            >
              <option value="loc_alta_vista">Sede B: Alta Vista</option>
              <option value="loc_los_olivos">Sede A: Los Olivos</option>
            </select>
          </Field>
        </div>

        {wasteType === 'SUPPLY' ? (
          <Field label="Insumo Afectado" required>
            <select
              value={supplyId}
              onChange={(e) => {
                setSupplyId(e.target.value);
                setManualCostUsd('');
              }}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
            >
              {supplies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.usageUnit}) - Costo Ponderado: ${(s.weightedAvgCostUsdCents / 100).toFixed(2)}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Plato Terminado Afectado" required>
            <select
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                setManualCostUsd('');
              }}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (${(p.priceUsdCents / 100).toFixed(2)})
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={`Cantidad (${wasteType === 'SUPPLY' ? selectedSupply?.usageUnit || 'und' : 'porciones'})`}
            required
          >
            <Input
              type="number"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </Field>

          <Field label="Costo Unitario USD (Editable)">
            <Input
              type="number"
              step="0.01"
              value={manualCostUsd || (defaultUnitCostCents / 100).toFixed(2)}
              onChange={(e) => setManualCostUsd(e.target.value)}
              placeholder="Auto-calculado"
            />
          </Field>
        </div>

        <Field label="Motivo de la Merma" required>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
          >
            <option value="MERMA_COCCION">Merma de Cocción / Sobrecalentado</option>
            <option value="VENCIMIENTO">Vencimiento / Descomposición</option>
            <option value="ACCIDENTE_CAIDA">Accidente / Caída al piso</option>
            <option value="ERROR_PREPARACION">Error en Comanda / Rechazado</option>
            <option value="DANO_EMPAQUE">Empaque Roto / Contaminado</option>
            <option value="CONTROL_CALIDAD">Pruebas de Calidad / Muestra</option>
          </select>
        </Field>

        <Field label="Observación / Detalle">
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: Se cayó la bandeja al sacar de refrigeración"
          />
        </Field>

        {/* Resumen del Impacto Financiero */}
        <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 flex justify-between items-center text-xs">
          <div className="flex items-center gap-2">
            <Icon name="TrendingDown" size={18} className="text-danger" />
            <span className="font-bold text-danger">Pérdida Neta que resta a Utilidad:</span>
          </div>
          <span className="text-base font-black text-danger font-mono">
            -${(totalLossCents / 100).toFixed(2)} USD
          </span>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="ghost" className="flex-1" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            type="submit"
            loading={wasteMutation.isPending}
          >
            Registrar Pérdida
          </Button>
        </div>
      </form>
    </Modal>
  );
};
