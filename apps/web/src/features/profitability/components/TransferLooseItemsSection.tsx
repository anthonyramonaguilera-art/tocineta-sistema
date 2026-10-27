import React, { useState } from 'react';
import { Button, Input, Icon } from '../../../ui/index.js';

interface TransferLooseItemsSectionProps {
  supplies: Array<{ id: string; name: string; usageUnit: string }>;
  items: Array<{ supplyId: string; name: string; unit: string; quantity: number }>;
  onAddItem: (item: { supplyId: string; name: string; unit: string; quantity: number }) => void;
  onRemoveItem: (index: number) => void;
  onClearAll: () => void;
}

export const TransferLooseItemsSection: React.FC<TransferLooseItemsSectionProps> = ({
  supplies,
  items,
  onAddItem,
  onRemoveItem,
  onClearAll
}) => {
  const [looseSupplyId, setLooseSupplyId] = useState('');
  const [looseQty, setLooseQty] = useState('');

  const handleAdd = () => {
    if (!looseSupplyId || parseFloat(looseQty) <= 0) return;
    const sup = supplies.find(s => s.id === looseSupplyId);
    if (!sup) return;
    onAddItem({
      supplyId: sup.id,
      name: sup.name,
      unit: sup.usageUnit,
      quantity: parseFloat(looseQty)
    });
    setLooseQty('');
  };

  return (
    <div className="space-y-3">
      {/* Selector de Insumo Suelto */}
      <div className="p-3 rounded-2xl bg-surface-alt border border-border space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="sm:col-span-2">
            <select
              value={looseSupplyId}
              onChange={(e) => setLooseSupplyId(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold"
            >
              <option value="">-- Selecciona Insumo --</option>
              {supplies.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.usageUnit})
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Input
              type="number"
              step="any"
              value={looseQty}
              onChange={(e) => setLooseQty(e.target.value)}
              placeholder="Cantidad"
            />
            <Button variant="secondary" size="md" onClick={handleAdd}>
              Agregar
            </Button>
          </div>
        </div>
      </div>

      {/* Lista actual de Insumos */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-black text-ink uppercase tracking-wider">
          <span>Insumos a Despachar ({items.length}):</span>
          {items.length > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="text-danger hover:underline text-[11px] font-normal"
            >
              Limpiar todo
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="p-4 text-center rounded-xl bg-surface-alt border border-border text-xs text-ink-muted">
            No has agregado insumos al despacho aún.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {items.map((it, idx) => (
              <div
                key={it.supplyId}
                className="p-2.5 rounded-xl bg-surface border border-border flex items-center justify-between text-xs shadow-xs"
              >
                <span className="font-bold text-ink">{it.name}</span>
                <div className="flex items-center gap-3">
                  <span className="font-black text-ink">{it.quantity} {it.unit}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveItem(idx)}
                    className="text-danger hover:bg-danger/10 w-6 h-6 rounded-md flex items-center justify-center font-bold"
                    aria-label="Quitar insumo"
                  >
                    <Icon name="X" size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
