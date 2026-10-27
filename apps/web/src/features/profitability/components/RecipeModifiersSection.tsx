import React from 'react';
import { Button, Input, Icon } from '../../../ui/index.js';

export interface ModifierRow {
  modifierName: string;
  action: 'ADD' | 'REMOVE';
  supplyItemId: string;
  quantityDelta: number;
  unit: string;
}

interface RecipeModifiersSectionProps {
  modifiers: ModifierRow[];
  supplies: any[];
  onChange: (mods: ModifierRow[]) => void;
}

export const RecipeModifiersSection: React.FC<RecipeModifiersSectionProps> = ({
  modifiers,
  supplies,
  onChange
}) => {
  const addModifierRow = () => {
    onChange([
      ...modifiers,
      {
        modifierName: 'Extra Carne',
        action: 'ADD',
        supplyItemId: supplies[0]?.id || '',
        quantityDelta: 1,
        unit: 'und'
      }
    ]);
  };

  const removeModifierRow = (idx: number) => {
    onChange(modifiers.filter((_, i) => i !== idx));
  };

  const updateModifierRow = (idx: number, field: keyof ModifierRow, val: any) => {
    const next = [...modifiers];
    next[idx] = { ...next[idx], [field]: val };
    onChange(next);
  };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex justify-between items-center">
        <span className="text-xs font-bold text-ink uppercase tracking-wider">
          Modificadores de Comanda (Suman / Restan)
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={addModifierRow}
          leftIcon={<Icon name="Plus" size={14} />}
        >
          Agregar Modificador
        </Button>
      </div>

      <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
        {modifiers.map((mod, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 bg-surface-alt p-2 rounded-xl border border-border text-xs"
          >
            <div className="w-32">
              <Input
                value={mod.modifierName}
                onChange={(e) => updateModifierRow(idx, 'modifierName', e.target.value)}
                placeholder="Ej: Sin Cebolla"
              />
            </div>

            <select
              value={mod.action}
              onChange={(e) => updateModifierRow(idx, 'action', e.target.value as any)}
              className="h-9 px-2 rounded-lg bg-surface border border-border text-ink text-xs font-bold"
            >
              <option value="REMOVE">Resta (-)</option>
              <option value="ADD">Suma (+)</option>
            </select>

            <div className="flex-1">
              <select
                value={mod.supplyItemId}
                onChange={(e) => updateModifierRow(idx, 'supplyItemId', e.target.value)}
                className="w-full h-9 px-2 rounded-lg bg-surface border border-border text-ink text-xs font-bold"
              >
                {supplies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.usageUnit})
                  </option>
                ))}
              </select>
            </div>

            <div className="w-16">
              <Input
                type="number"
                step="any"
                value={mod.quantityDelta.toString()}
                onChange={(e) =>
                  updateModifierRow(idx, 'quantityDelta', parseFloat(e.target.value) || 0)
                }
                placeholder="Delta"
              />
            </div>

            <button
              type="button"
              onClick={() => removeModifierRow(idx)}
              className="p-2 text-danger hover:bg-danger/10 rounded-lg"
            >
              <Icon name="Trash2" size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
