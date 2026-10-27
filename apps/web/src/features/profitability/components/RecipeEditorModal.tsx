import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input, Field, Icon, Badge } from '../../../ui/index.js';
import { RecipeModifiersSection, type ModifierRow } from './RecipeModifiersSection.js';

interface IngredientRow {
  supplyItemId?: string;
  subRecipeId?: string;
  itemType: 'SUPPLY' | 'SUB_RECIPE';
  grossQuantity: number;
  shrinkagePercent: number;
  unit: string;
}

interface RecipeEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipe: any;
  supplies: any[];
  subRecipes: any[];
}

export const RecipeEditorModal: React.FC<RecipeEditorModalProps> = ({
  isOpen,
  onClose,
  recipe,
  supplies,
  subRecipes
}) => {
  const queryClient = useQueryClient();
  const [recipeMode, setRecipeMode] = useState<'UNITS' | 'GRAMMAGE' | 'FINISHED_PRODUCT'>('UNITS');
  const [targetMarginPercent, setTargetMarginPercent] = useState('65');
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [modifiers, setModifiers] = useState<ModifierRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (recipe) {
      setRecipeMode(recipe.recipeMode || 'UNITS');
      setTargetMarginPercent(((recipe.targetMarginBps || 6500) / 100).toString());
      setIngredients(recipe.items || recipe.ingredients || []);
      setModifiers(recipe.modifiers || []);
      setErrorMsg(null);
    }
  }, [recipe]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const targetMarginBps = Math.round(parseFloat(targetMarginPercent) * 100);
      const res = await fetch(`/api/fase3/recipes/${recipe.productId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipeMode,
          targetMarginBps,
          items: ingredients,
          modifiers
        })
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['fase3Recipes'] });
        onClose();
      } else {
        setErrorMsg(data.error || 'Error al guardar la receta');
      }
    },
    onError: () => {
      setErrorMsg('Error de red al guardar la receta');
    }
  });

  const addIngredientRow = () => {
    setIngredients([
      ...ingredients,
      {
        itemType: 'SUPPLY',
        supplyItemId: supplies[0]?.id || '',
        grossQuantity: 1,
        shrinkagePercent: 0,
        unit: supplies[0]?.usageUnit || 'und'
      }
    ]);
  };

  const removeIngredientRow = (idx: number) => {
    setIngredients(ingredients.filter((_, i) => i !== idx));
  };

  const updateIngredientRow = (idx: number, field: string, val: any) => {
    const next = [...ingredients];
    const row = { ...next[idx], [field]: val } as IngredientRow;
    if (field === 'supplyItemId') {
      const s = supplies.find((sup) => sup.id === val);
      if (s) row.unit = s.usageUnit;
    }
    next[idx] = row;
    setIngredients(next);
  };

  // Cálculo de Costo en Vivo
  let liveCostCents = 0;
  if (recipeMode === 'FINISHED_PRODUCT') {
    // Si es plato terminado, el costo es el costo base o estimado
    liveCostCents = recipe.priceUsdCents ? Math.round(recipe.priceUsdCents * 0.4) : 0;
  } else {
    for (const item of ingredients) {
      if (item.itemType === 'SUPPLY' && item.supplyItemId) {
        const s = supplies.find((sup) => sup.id === item.supplyItemId);
        const unitCost = s?.effective_cost_cents || s?.weightedAvgCostUsdCents || 0;
        const grossQty = item.grossQuantity || 0;
        liveCostCents += Math.round(grossQty * unitCost);
      } else if (item.itemType === 'SUB_RECIPE' && item.subRecipeId) {
        const sr = subRecipes.find((sub) => sub.id === item.subRecipeId);
        const costPerYieldUnit = (sr?.costUsdCents || 0) / (sr?.yieldQuantity || 1);
        liveCostCents += Math.round((item.grossQuantity || 0) * costPerYieldUnit);
      }
    }
  }

  const currentPriceCents = recipe?.priceUsdCents || 0;
  const currentMarginBps =
    currentPriceCents > 0
      ? Math.round(((currentPriceCents - liveCostCents) / currentPriceCents) * 10000)
      : 0;

  const targetBps = Math.round(parseFloat(targetMarginPercent || '65') * 100);
  const targetMarginFrac = targetBps / 10000;
  const suggestedPriceCents =
    targetMarginFrac < 1 && targetMarginFrac > 0
      ? Math.round(liveCostCents / (1 - targetMarginFrac))
      : liveCostCents;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Ficha Técnica y Escandallo: ${recipe?.productName || ''}`}
      maxWidth="lg"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
        className="space-y-4"
      >
        {errorMsg && (
          <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold">
            {errorMsg}
          </div>
        )}

        {/* Selector de Modo de Receta (3 Modos F3) */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-ink uppercase tracking-wider block">
            Modo de Descuento de Receta
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'UNITS', title: 'Por Unidades', desc: 'Descuenta piezas fijas' },
              { id: 'GRAMMAGE', title: 'Por Gramaje', desc: 'Con % de merma cocción' },
              { id: 'FINISHED_PRODUCT', title: 'Plato Terminado', desc: 'Descuenta stock directo' }
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setRecipeMode(m.id as any)}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  recipeMode === m.id
                    ? 'border-primary bg-primary/10 shadow-xs'
                    : 'border-border bg-surface hover:bg-surface-alt'
                }`}
              >
                <div className="text-xs font-bold text-ink">{m.title}</div>
                <div className="text-[10px] text-ink-muted leading-tight mt-0.5">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Margen Objetivo */}
        <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-surface-alt border border-border">
          <Field label="Margen Bruto Objetivo (%)" required>
            <Input
              type="number"
              step="1"
              value={targetMarginPercent}
              onChange={(e) => setTargetMarginPercent(e.target.value)}
              placeholder="65"
              required
            />
          </Field>

          <div>
            <span className="text-[10px] font-bold text-ink-muted uppercase block">
              Precio Sugerido en Vivo
            </span>
            <div className="text-lg font-black text-primary font-mono mt-1">
              ${(suggestedPriceCents / 100).toFixed(2)} USD
            </div>
            <span className="text-[10px] text-ink-muted block">
              Precio Actual: ${(currentPriceCents / 100).toFixed(2)} USD (Margen: {(currentMarginBps / 100).toFixed(1)}%)
            </span>
          </div>
        </div>

        {/* Insumos de la Receta */}
        {recipeMode !== 'FINISHED_PRODUCT' && (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-ink uppercase tracking-wider">
                Ingredientes y Sub-Recetas
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addIngredientRow}
                leftIcon={<Icon name="Plus" size={14} />}
              >
                Agregar Componente
              </Button>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {ingredients.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 bg-surface-alt p-2 rounded-xl border border-border text-xs"
                >
                  <select
                    value={item.itemType}
                    onChange={(e) => updateIngredientRow(idx, 'itemType', e.target.value)}
                    className="h-9 px-2 rounded-lg bg-surface border border-border text-ink text-xs font-bold"
                  >
                    <option value="SUPPLY">Insumo</option>
                    <option value="SUB_RECIPE">Sub-Receta</option>
                  </select>

                  <div className="flex-1">
                    {item.itemType === 'SUPPLY' ? (
                      <select
                        value={item.supplyItemId || ''}
                        onChange={(e) => updateIngredientRow(idx, 'supplyItemId', e.target.value)}
                        className="w-full h-9 px-2 rounded-lg bg-surface border border-border text-ink text-xs font-bold"
                      >
                        {supplies.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.usageUnit})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select
                        value={item.subRecipeId || ''}
                        onChange={(e) => updateIngredientRow(idx, 'subRecipeId', e.target.value)}
                        className="w-full h-9 px-2 rounded-lg bg-surface border border-border text-ink text-xs font-bold"
                      >
                        <option value="">-- Selecciona Sub-Receta --</option>
                        {subRecipes.map((sr) => (
                          <option key={sr.id} value={sr.id}>
                            {sr.name} ({sr.yieldQuantity} {sr.yieldUnit})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="w-20">
                    <Input
                      type="number"
                      step="any"
                      value={item.grossQuantity?.toString() || ''}
                      onChange={(e) =>
                        updateIngredientRow(idx, 'grossQuantity', parseFloat(e.target.value) || 0)
                      }
                      placeholder="Cant."
                    />
                  </div>

                  {recipeMode === 'GRAMMAGE' && (
                    <div className="w-20">
                      <Input
                        type="number"
                        step="any"
                        value={item.shrinkagePercent?.toString() || '0'}
                        onChange={(e) =>
                          updateIngredientRow(idx, 'shrinkagePercent', parseFloat(e.target.value) || 0)
                        }
                        placeholder="% Merma"
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => removeIngredientRow(idx)}
                    className="p-2 text-danger hover:bg-danger/10 rounded-lg"
                  >
                    <Icon name="Trash2" size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Modificadores (Sin pan, Extra carne, Sin cebolla) */}
        <RecipeModifiersSection
          modifiers={modifiers}
          supplies={supplies}
          onChange={setModifiers}
        />

        {/* Resumen de Costo y Acciones */}
        <div className="p-3 rounded-xl bg-surface border border-border flex justify-between items-center text-xs">
          <div>
            <span className="text-ink-muted">Costo Directo por Plato:</span>
            <div className="text-base font-bold text-ink font-mono">
              ${(liveCostCents / 100).toFixed(2)} USD
            </div>
          </div>
          <div>
            <span className="text-ink-muted">Margen Estimado:</span>
            <div className="text-base font-bold text-ink">
              <Badge variant={currentMarginBps >= targetBps ? 'neutral' : 'warning'}>
                {(currentMarginBps / 100).toFixed(1)}%
              </Badge>
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
            Guardar Ficha Técnica
          </Button>
        </div>
      </form>
    </Modal>
  );
};
