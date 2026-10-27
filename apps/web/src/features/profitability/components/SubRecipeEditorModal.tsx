import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input, Field, Icon } from '../../../ui/index.js';

interface SubRecipeEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  supplies: any[];
}

export const SubRecipeEditorModal: React.FC<SubRecipeEditorModalProps> = ({
  isOpen,
  onClose,
  supplies
}) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [yieldQuantity, setYieldQuantity] = useState('2');
  const [yieldUnit, setYieldUnit] = useState('litro');
  const [items, setItems] = useState<Array<{ supplyItemId: string; quantity: number }>>([
    { supplyItemId: supplies[0]?.id || '', quantity: 1 }
  ]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/fase3/sub-recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          yieldQuantity: parseFloat(yieldQuantity),
          yieldUnit,
          items
        })
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['fase3SubRecipes'] });
        queryClient.invalidateQueries({ queryKey: ['fase3Recipes'] });
        onClose();
        setName('');
        setErrorMsg(null);
      } else {
        setErrorMsg(data.error || 'Error al guardar la sub-receta');
      }
    },
    onError: () => {
      setErrorMsg('Error de red al guardar sub-receta');
    }
  });

  const addItemRow = () => {
    setItems([...items, { supplyItemId: supplies[0]?.id || '', quantity: 1 }]);
  };

  const removeItemRow = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  const updateItemRow = (idx: number, field: string, val: any) => {
    const next = [...items];
    (next[idx] as any)[field] = val;
    setItems(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('El nombre de la sub-receta es obligatorio');
      return;
    }
    const yQty = parseFloat(yieldQuantity);
    if (isNaN(yQty) || yQty <= 0) {
      setErrorMsg('El rendimiento debe ser un número positivo');
      return;
    }
    saveMutation.mutate();
  };

  // Costo total de la preparación
  const totalCostCents = items.reduce((acc, it) => {
    const s = supplies.find((sup) => sup.id === it.supplyItemId);
    const unitCost = s?.effective_cost_cents || s?.weightedAvgCostUsdCents || 0;
    return acc + Math.round((it.quantity || 0) * unitCost);
  }, 0);

  const yQty = parseFloat(yieldQuantity) || 1;
  const costPerUnit = (totalCostCents / yQty / 100).toFixed(2);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Crear Sub-Receta / Preparación Base">
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold">
            {errorMsg}
          </div>
        )}

        <Field label="Nombre de la Preparación" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Salsa Especial Tocinetera"
            required
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Rendimiento del Batch" required>
            <Input
              type="number"
              step="any"
              value={yieldQuantity}
              onChange={(e) => setYieldQuantity(e.target.value)}
              placeholder="Ej: 2"
              required
            />
          </Field>

          <Field label="Unidad de Rendimiento" required>
            <select
              value={yieldUnit}
              onChange={(e) => setYieldUnit(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
            >
              <option value="litro">Litros (l)</option>
              <option value="kg">Kilogramos (kg)</option>
              <option value="porciones">Porciones</option>
              <option value="unidades">Unidades</option>
            </select>
          </Field>
        </div>

        {/* Componentes */}
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-ink uppercase tracking-wider">
              Insumos Componentes del Batch
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addItemRow}
              leftIcon={<Icon name="Plus" size={14} />}
            >
              Agregar Insumo
            </Button>
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {items.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 bg-surface-alt p-2 rounded-xl border border-border text-xs"
              >
                <div className="flex-1">
                  <select
                    value={item.supplyItemId}
                    onChange={(e) => updateItemRow(idx, 'supplyItemId', e.target.value)}
                    className="w-full h-9 px-2 rounded-lg bg-surface border border-border text-ink text-xs font-bold"
                  >
                    {supplies.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.usageUnit})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="w-24">
                  <Input
                    type="number"
                    step="any"
                    value={item.quantity?.toString() || ''}
                    onChange={(e) =>
                      updateItemRow(idx, 'quantity', parseFloat(e.target.value) || 0)
                    }
                    placeholder="Cantidad"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => removeItemRow(idx)}
                  disabled={items.length === 1}
                  className="p-2 text-danger hover:bg-danger/10 rounded-lg disabled:opacity-30"
                >
                  <Icon name="Trash2" size={16} />
                </button>
              </div>
            ))}
          </div>

          <div className="p-2.5 rounded-xl bg-surface border border-border flex justify-between items-center text-xs">
            <div>
              <span className="text-ink-muted">Costo Total del Batch:</span>
              <strong className="text-ink ml-1 font-mono">${(totalCostCents / 100).toFixed(2)}</strong>
            </div>
            <div>
              <span className="text-ink-muted">Costo por {yieldUnit}:</span>
              <strong className="text-primary ml-1 font-mono">${costPerUnit} USD</strong>
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="ghost" className="flex-1" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            type="submit"
            loading={saveMutation.isPending}
          >
            Guardar Sub-Receta
          </Button>
        </div>
      </form>
    </Modal>
  );
};
