import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input, Field } from '../../../ui/index.js';

interface NewSupplyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewSupplyModal: React.FC<NewSupplyModalProps> = ({ isOpen, onClose }) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [purchaseUnit, setPurchaseUnit] = useState('paquete');
  const [usageUnit, setUsageUnit] = useState('und');
  const [factor, setFactor] = useState('1');
  const [category, setCategory] = useState('general');
  const [minStock, setMinStock] = useState('10');
  const [costUsd, setCostUsd] = useState('1.00');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/fase3/supplies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          purchaseUnit,
          usageUnit,
          conversionFactor: parseFloat(factor),
          category,
          minStock: parseFloat(minStock),
          costPerUnitUsdCents: Math.round(parseFloat(costUsd) * 100)
        })
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['fase3Supplies'] });
        onClose();
        setName('');
        setFactor('1');
        setCostUsd('1.00');
        setErrorMsg(null);
      } else {
        setErrorMsg(data.error || 'Error al crear insumo');
      }
    },
    onError: () => {
      setErrorMsg('Error de red al crear el insumo');
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('El nombre es obligatorio');
      return;
    }
    const conv = parseFloat(factor);
    if (isNaN(conv) || conv <= 0) {
      setErrorMsg('El factor de conversión debe ser mayor a cero');
      return;
    }
    createMutation.mutate();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nuevo Insumo Maestro">
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold">
            {errorMsg}
          </div>
        )}

        <Field label="Nombre del Insumo" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Tocineta Ahumada"
            required
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoría" required>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
            >
              <option value="carnes">Carnes y Embutidos</option>
              <option value="panaderia">Panadería</option>
              <option value="vegetales">Vegetales y Frescos</option>
              <option value="salsas">Salsas y Condimentos</option>
              <option value="lacteos">Lácteos y Quesos</option>
              <option value="empaques">Empaques y Desechables</option>
              <option value="bebidas">Bebidas</option>
              <option value="general">General</option>
            </select>
          </Field>

          <Field label="Stock Mínimo (Alerta)" required>
            <Input
              type="number"
              step="any"
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Unidad Compra" required>
            <select
              value={purchaseUnit}
              onChange={(e) => setPurchaseUnit(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
            >
              <option value="paquete">Paquete</option>
              <option value="caja">Caja</option>
              <option value="kg">Kilogramo (kg)</option>
              <option value="litro">Litro (l)</option>
              <option value="lata">Lata</option>
              <option value="und">Unidad</option>
            </select>
          </Field>

          <Field label="Unidad Uso" required>
            <select
              value={usageUnit}
              onChange={(e) => setUsageUnit(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
            >
              <option value="und">Unidad (und)</option>
              <option value="g">Gramo (g)</option>
              <option value="ml">Mililitro (ml)</option>
              <option value="porcion">Porción</option>
            </select>
          </Field>

          <Field label="Factor Conversión" required>
            <Input
              type="number"
              step="any"
              value={factor}
              onChange={(e) => setFactor(e.target.value)}
              required
            />
          </Field>
        </div>

        <div className="p-3 rounded-xl bg-surface-alt border border-border text-[11px] text-ink-muted leading-relaxed">
          <strong>Regla de Conversión:</strong> 1 {purchaseUnit} = {factor} {usageUnit}.
        </div>

        <Field label="Costo Estimado Inicial (USD por Unidad Compra)" required>
          <Input
            type="number"
            step="0.01"
            value={costUsd}
            onChange={(e) => setCostUsd(e.target.value)}
            required
          />
        </Field>

        <div className="flex gap-2 pt-2">
          <Button variant="ghost" className="flex-1" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            type="submit"
            loading={createMutation.isPending}
          >
            Guardar Insumo
          </Button>
        </div>
      </form>
    </Modal>
  );
};
