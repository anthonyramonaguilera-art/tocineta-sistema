import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input, Field, Icon } from '../../../ui/index.js';
import type { RecipeImpact } from './CostVariationModal.js';
import { NewSupplyModal } from './NewSupplyModal.js';

interface NewPurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  supplies: any[];
  onPurchaseComplete: (recipeImpacts: RecipeImpact[]) => void;
}

export const NewPurchaseModal: React.FC<NewPurchaseModalProps> = ({
  isOpen,
  onClose,
  supplies,
  onPurchaseComplete
}) => {
  const queryClient = useQueryClient();
  const [destinationLocation, setDestinationLocation] = useState('loc_alta_vista');
  const [supplierName, setSupplierName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [paymentCondition, setPaymentCondition] = useState<'CONTADO' | 'CREDITO'>('CONTADO');
  const [dueDateDays, setDueDateDays] = useState('15');
  const [notes, setNotes] = useState('');
  const [purchaseItems, setPurchaseItems] = useState<
    Array<{ supplyId: string; purchaseQuantity: number; unitCostUsdCents: number }>
  >([{ supplyId: supplies[0]?.id || '', purchaseQuantity: 10, unitCostUsdCents: 100 }]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isNewSupplyModalOpen, setIsNewSupplyModalOpen] = useState(false);
  const [activeSupplyIndex, setActiveSupplyIndex] = useState<number | null>(null);

  const handleNewSupplyClose = async () => {
    setIsNewSupplyModalOpen(false);
    queryClient.invalidateQueries({ queryKey: ['fase3Supplies'] });
    if (activeSupplyIndex !== null) {
      try {
        const res = await fetch('/api/fase3/supplies?locationId=ALL');
        const data = await res.json();
        if (data && data.success && data.supplies && data.supplies.length > 0) {
          const lastSupply = data.supplies[data.supplies.length - 1];
          if (lastSupply && lastSupply.id) {
            updateItemRow(activeSupplyIndex, 'supplyId', lastSupply.id);
            console.info('Insumo nuevo creado seleccionado automáticamente:', lastSupply.id, lastSupply.name);
          }
        }
      } catch (err) {
        console.error('Error al reconsultar la lista de insumos:', err);
      }
    }
    setActiveSupplyIndex(null);
  };

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      const dueDateMs =
        paymentCondition === 'CREDITO'
          ? Date.now() + parseInt(dueDateDays, 10) * 86400000
          : null;

      const res = await fetch('/api/fase3/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: destinationLocation,
          supplierName,
          invoiceNumber,
          paymentCondition,
          dueDateMs,
          notes,
          items: purchaseItems
        })
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['fase3Purchases'] });
        queryClient.invalidateQueries({ queryKey: ['fase3Supplies'] });
        onClose();
        setErrorMsg(null);
        if (data.impactedRecipes && data.impactedRecipes.length > 0) {
          onPurchaseComplete(data.impactedRecipes);
        }
      } else {
        setErrorMsg(data.error || 'Error al registrar la compra');
      }
    },
    onError: () => {
      setErrorMsg('Error de conexión al guardar la compra');
    }
  });

  const addItemRow = () => {
    setPurchaseItems([
      ...purchaseItems,
      { supplyId: supplies[0]?.id || '', purchaseQuantity: 1, unitCostUsdCents: 100 }
    ]);
  };

  const removeItemRow = (idx: number) => {
    setPurchaseItems(purchaseItems.filter((_, i) => i !== idx));
  };

  const updateItemRow = (idx: number, field: string, val: any) => {
    const updated = [...purchaseItems];
    (updated[idx] as any)[field] = val;
    setPurchaseItems(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!supplierName.trim()) {
      setErrorMsg('Ingresa el nombre del proveedor');
      return;
    }
    if (purchaseItems.length === 0) {
      setErrorMsg('Agrega al menos un ítem a la compra');
      return;
    }
    purchaseMutation.mutate();
  };

  const totalCents = purchaseItems.reduce(
    (acc, it) => acc + (it.purchaseQuantity || 0) * (it.unitCostUsdCents || 0),
    0
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Registrar Factura de Compra" maxWidth="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Sede Destino" required>
            <select
              value={destinationLocation}
              onChange={(e) => setDestinationLocation(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
            >
              <option value="loc_alta_vista">Sede B: Alta Vista</option>
              <option value="loc_los_olivos">Sede A: Los Olivos</option>
            </select>
          </Field>

          <Field label="Proveedor" required>
            <Input
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="Ej: Distribuidora Central"
              required
            />
          </Field>

          <Field label="N° Factura / Control">
            <Input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="Ej: FAC-9821"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Condición de Pago" required>
            <select
              value={paymentCondition}
              onChange={(e) => setPaymentCondition(e.target.value as any)}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
            >
              <option value="CONTADO">Contado (Pagado)</option>
              <option value="CREDITO">Crédito por Pagar</option>
            </select>
          </Field>

          {paymentCondition === 'CREDITO' && (
            <Field label="Días de Crédito (Vencimiento)" required>
              <Input
                type="number"
                value={dueDateDays}
                onChange={(e) => setDueDateDays(e.target.value)}
                placeholder="15"
                required
              />
            </Field>
          )}
        </div>

        {/* Detalle de Insumos */}
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-ink uppercase tracking-wider">
              Ítems en Unidad de Compra
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addItemRow}
              leftIcon={<Icon name="Plus" size={14} />}
            >
              Agregar Ítem
            </Button>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {purchaseItems.map((item, idx) => {
              const qty = item.purchaseQuantity || 0;
              const unitCost = (item.unitCostUsdCents || 0) / 100;
              const rowTotal = qty * unitCost;
              return (
                <div
                  key={idx}
                  className="bg-surface-alt p-3 rounded-xl border border-border text-xs space-y-2"
                >
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <span className="text-sm font-semibold text-ink flex items-center justify-between">
                        <span>Insumo (Unidad de Compra)</span>
                      </span>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={item.supplyId}
                          onChange={(e) => updateItemRow(idx, 'supplyId', e.target.value)}
                          className="flex-1 h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold"
                        >
                          {supplies.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.purchaseUnit || 'u'})
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setActiveSupplyIndex(idx);
                            setIsNewSupplyModalOpen(true);
                          }}
                          leftIcon={<Icon name="Plus" size={12} />}
                          className="h-11 px-3 text-xs whitespace-nowrap shrink-0"
                          title="Crear insumo nuevo"
                        >
                          Crear insumo nuevo
                        </Button>
                      </div>
                    </div>

                    <div className="w-36">
                      <Field label="Cantidad comprada (en unidad de compra)" required>
                        <Input
                          type="number"
                          step="any"
                          value={item.purchaseQuantity.toString()}
                          onChange={(e) =>
                            updateItemRow(idx, 'purchaseQuantity', parseFloat(e.target.value) || 0)
                          }
                          placeholder="0"
                        />
                      </Field>
                    </div>

                    <div className="w-36">
                      <Field label="Precio pagado por cada unidad de compra ($)" required>
                        <Input
                          type="number"
                          step="0.01"
                          value={(item.unitCostUsdCents / 100).toFixed(2)}
                          onChange={(e) =>
                            updateItemRow(
                              idx,
                              'unitCostUsdCents',
                              Math.round((parseFloat(e.target.value) || 0) * 100)
                            )
                          }
                          placeholder="0.00"
                        />
                      </Field>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeItemRow(idx)}
                      disabled={purchaseItems.length === 1}
                      className="p-2.5 text-danger hover:bg-danger/10 rounded-xl disabled:opacity-30 self-end mb-0.5"
                      title="Eliminar ítem"
                    >
                      <Icon name="Trash2" size={18} />
                    </button>
                  </div>

                  <div className="text-xs text-ink-muted font-medium pt-1 border-t border-border/50">
                    {qty} unidades de compra × ${unitCost.toFixed(2)} = ${rowTotal.toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-right text-xs font-bold text-ink pt-1">
            Total Factura Estimado:{' '}
            <strong className="text-sm text-primary">
              ${(totalCents / 100).toFixed(2)} USD
            </strong>
          </div>
        </div>

        <Field label="Notas o Guía de Recepción">
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: Factura de reposición semanal"
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
            loading={purchaseMutation.isPending}
          >
            Registrar Factura
          </Button>
        </div>
      </form>
      <NewSupplyModal
        isOpen={isNewSupplyModalOpen}
        onClose={handleNewSupplyClose}
      />
    </Modal>
  );
};
