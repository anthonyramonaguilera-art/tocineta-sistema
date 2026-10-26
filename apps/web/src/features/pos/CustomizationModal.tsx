import React, { useState, useMemo } from 'react';
import type { PosProduct } from '../../types/menu.js';
import type { CustomizationModifier } from './types.js';

interface CustomizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: PosProduct;
  initialModifiers?: CustomizationModifier[];
  initialInstructions?: string;
  barraLibreList?: Array<{ id: string; name: string }>;
  paidExtrasList?: Array<{ id: string; name: string; priceUsdCents: number; priceBsCents?: number }>;
  onSave: (modifiers: CustomizationModifier[], customInstructions: string, extraPriceUsdCents: number) => void;
}

export const CustomizationModal: React.FC<CustomizationModalProps> = ({
  isOpen,
  onClose,
  product,
  initialModifiers = [],
  initialInstructions = '',
  barraLibreList = [],
  paidExtrasList = [],
  onSave
}) => {
  if (!isOpen) return null;

  // Determinar ingredientes base del producto (asegurar pan y salsas si aplican)
  const baseIngredients = useMemo(() => {
    const list = [...(product.baseIngredients || [])];
    const isBurger = product.station === 'hamburguesas';
    const isDog = product.station === 'hot_dogs';

    const hasPan = list.some(i => i.name.toLowerCase().includes('pan'));
    if (!hasPan && (isBurger || isDog)) {
      list.unshift({
        id: isBurger ? 'ing_base_pan_brioche' : 'ing_base_pan_perro',
        name: isBurger ? 'Pan Brioche' : 'Pan de Perro',
        isRemovable: true,
        defaultState: 'normal'
      });
    }

    const hasSalsa = list.some(i => i.name.toLowerCase().includes('salsa'));
    if (!hasSalsa && (isBurger || isDog)) {
      list.push({
        id: 'ing_base_salsas',
        name: 'Salsas Tradicionales',
        isRemovable: true,
        defaultState: 'normal'
      });
    }

    return list;
  }, [product]);

  // Estado local para ingredientes base: map de id -> 'normal' | 'poco' | 'sin'
  const [baseStates, setBaseStates] = useState<Record<string, 'normal' | 'poco' | 'sin'>>(() => {
    const states: Record<string, 'normal' | 'poco' | 'sin'> = {};
    for (const b of baseIngredients) {
      states[b.id] = 'normal';
    }
    for (const m of initialModifiers) {
      if (m.ingredientId && states[m.ingredientId] !== undefined) {
        if (m.modifierType === 'SIN_INGREDIENTE') states[m.ingredientId] = 'sin';
        if (m.modifierType === 'POCO_INGREDIENTE') states[m.ingredientId] = 'poco';
      }
    }
    return states;
  });

  // Estado local de Barra Libre seleccionados
  const [selectedBarraLibre, setSelectedBarraLibre] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const m of initialModifiers) {
      if (m.modifierType === 'BARRA_LIBRE' && m.ingredientId) {
        set.add(m.ingredientId);
      }
    }
    return set;
  });

  // Estado local de Extras Pagos: map de extraId -> cantidad (0, 1, 2)
  const [paidExtrasCount, setPaidExtrasCount] = useState<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const extra of paidExtrasList) counts[extra.id] = 0;
    for (const m of initialModifiers) {
      if (m.modifierType === 'EXTRA_INGREDIENTE' && m.ingredientId && counts[m.ingredientId] !== undefined) {
        counts[m.ingredientId] = (counts[m.ingredientId] || 0) + 1;
      }
    }
    return counts;
  });

  // Instrucciones especiales (ej: "Envuelta en Lechuga")
  const [instructions, setInstructions] = useState<string>(initialInstructions);
  const [lettuceWrapped, setLettuceWrapped] = useState<boolean>(() => {
    return initialInstructions.toLowerCase().includes('envuelta en lechuga');
  });

  // --------------------------------------------------------------------------
  // BOTONES RÁPIDOS GLOBALES
  // --------------------------------------------------------------------------
  const handleQuickSinPan = () => {
    const nextStates = { ...baseStates };
    for (const b of baseIngredients) {
      if (b.name.toLowerCase().includes('pan')) {
        nextStates[b.id] = 'sin';
      }
    }
    setBaseStates(nextStates);
    setLettuceWrapped(true);
    if (!instructions.toLowerCase().includes('envuelta en lechuga')) {
      setInstructions(prev => (prev ? `${prev}, Envuelta en lechuga` : 'Envuelta en lechuga'));
    }
  };

  const handleQuickPocaSalsa = () => {
    const nextStates = { ...baseStates };
    for (const b of baseIngredients) {
      if (b.name.toLowerCase().includes('salsa')) {
        nextStates[b.id] = 'poco';
      }
    }
    setBaseStates(nextStates);
  };

  const handleQuickSinSalsas = () => {
    const nextStates = { ...baseStates };
    for (const b of baseIngredients) {
      if (b.name.toLowerCase().includes('salsa')) {
        nextStates[b.id] = 'sin';
      }
    }
    setBaseStates(nextStates);
  };

  const handleQuickReset = () => {
    const nextStates: Record<string, 'normal' | 'poco' | 'sin'> = {};
    for (const b of baseIngredients) {
      nextStates[b.id] = 'normal';
    }
    setBaseStates(nextStates);
    setLettuceWrapped(false);
    setSelectedBarraLibre(new Set());
    const clearedExtras: Record<string, number> = {};
    for (const extra of paidExtrasList) clearedExtras[extra.id] = 0;
    setPaidExtrasCount(clearedExtras);
    setInstructions('');
  };

  // Cambiar estado individual de ingrediente
  const setIngredientState = (id: string, state: 'normal' | 'poco' | 'sin') => {
    setBaseStates(prev => ({ ...prev, [id]: state }));
    // Si vuelve a normal o poco el pan, quitar toggle de lechuga
    const ing = baseIngredients.find(b => b.id === id);
    if (ing?.name.toLowerCase().includes('pan') && state !== 'sin') {
      setLettuceWrapped(false);
    }
  };

  // Toggle Barra Libre
  const toggleBarraLibre = (id: string) => {
    setSelectedBarraLibre(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Modificar cantidad de Extra Pago
  const changeExtraCount = (extraId: string, delta: number) => {
    setPaidExtrasCount(prev => {
      const current = prev[extraId] || 0;
      const next = Math.max(0, Math.min(3, current + delta));
      return { ...prev, [extraId]: next };
    });
  };

  // --------------------------------------------------------------------------
  // CÁLCULO DE RESUMEN Y TOTALES
  // --------------------------------------------------------------------------
  const { summaryTags, totalExtraCents } = useMemo(() => {
    const tags: Array<{ label: string; type: 'sin' | 'poco' | 'barra' | 'extra' }> = [];
    let extraCents = 0;

    // Ingredientes Base modificados
    for (const b of baseIngredients) {
      const state = baseStates[b.id] || 'normal';
      if (state === 'sin') {
        if (b.name.toLowerCase().includes('pan') && lettuceWrapped) {
          tags.push({ label: 'Sin Pan / Envuelta en Lechuga', type: 'sin' });
        } else {
          tags.push({ label: `Sin ${b.name}`, type: 'sin' });
        }
      } else if (state === 'poco') {
        tags.push({ label: `Poca ${b.name}`, type: 'poco' });
      }
    }

    // Barra libre
    for (const blId of selectedBarraLibre) {
      const item = barraLibreList.find(b => b.id === blId);
      if (item) {
        tags.push({ label: `+ ${item.name} ($0.00)`, type: 'barra' });
      }
    }

    // Extras Pagos
    for (const extra of paidExtrasList) {
      const qty = paidExtrasCount[extra.id] || 0;
      if (qty > 0) {
        extraCents += extra.priceUsdCents * qty;
        tags.push({
          label: `+ ${qty > 1 ? `${qty}x ` : ''}${extra.name} (+$${((extra.priceUsdCents * qty) / 100).toFixed(2)})`,
          type: 'extra'
        });
      }
    }

    return { summaryTags: tags, totalExtraCents: extraCents };
  }, [baseIngredients, baseStates, lettuceWrapped, selectedBarraLibre, paidExtrasCount, barraLibreList, paidExtrasList]);

  // Guardar y cerrar modal
  const handleSave = () => {
    const finalModifiers: CustomizationModifier[] = [];

    // Modificadores de ingredientes base
    for (const b of baseIngredients) {
      const state = baseStates[b.id] || 'normal';
      if (state === 'sin') {
        finalModifiers.push({
          ingredientId: b.id,
          ingredientName: b.name,
          modifierType: 'SIN_INGREDIENTE',
          extraPriceUsdCents: 0
        });
      } else if (state === 'poco') {
        finalModifiers.push({
          ingredientId: b.id,
          ingredientName: b.name,
          modifierType: 'POCO_INGREDIENTE',
          extraPriceUsdCents: 0
        });
      }
    }

    // Modificadores de Barra Libre
    for (const blId of selectedBarraLibre) {
      const item = barraLibreList.find(b => b.id === blId);
      if (item) {
        finalModifiers.push({
          ingredientId: item.id,
          ingredientName: item.name,
          modifierType: 'BARRA_LIBRE',
          extraPriceUsdCents: 0
        });
      }
    }

    // Modificadores Extras Pagados
    for (const extra of paidExtrasList) {
      const qty = paidExtrasCount[extra.id] || 0;
      for (let i = 0; i < qty; i++) {
        finalModifiers.push({
          ingredientId: extra.id,
          ingredientName: extra.name,
          modifierType: 'EXTRA_INGREDIENTE',
          extraPriceUsdCents: extra.priceUsdCents
        });
      }
    }

    onSave(finalModifiers, instructions.trim(), totalExtraCents);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-tocineta-card border border-tocineta-border rounded-3xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Cabecera del Modal */}
        <div className="px-6 py-4 bg-tocineta-bg border-b border-tocineta-border flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🍔</span>
              <h2 className="text-lg font-black text-tocineta-text">{product.name}</h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-tocineta-border text-tocineta-yellow font-mono font-bold">
                ${(product.priceUsdCents / 100).toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-tocineta-muted mt-0.5">
              Personaliza ingredientes, salsas, barra libre y extras
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-12 h-12 flex items-center justify-center rounded-2xl bg-tocineta-card hover:bg-tocineta-border text-tocineta-muted hover:text-white transition-all text-xl font-bold"
            aria-label="Cerrar modal"
          >
            ✕
          </button>
        </div>

        {/* Contenido con Scroll */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          
          {/* BOTONES RÁPIDOS GLOBALES (Mínimo 48px de alto táctil) */}
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-tocineta-muted block mb-2">
              ⚡ Acciones Rápidas de 1 Toque:
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={handleQuickSinPan}
                className="min-h-[48px] px-3 py-2 rounded-xl text-xs font-bold bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 active:scale-95 transition-all text-center flex items-center justify-center"
              >
                🥬 Sin Pan / Envuelta en Lechuga
              </button>
              <button
                type="button"
                onClick={handleQuickPocaSalsa}
                className="min-h-[48px] px-3 py-2 rounded-xl text-xs font-bold bg-blue-500/15 border border-blue-500/40 text-blue-300 hover:bg-blue-500/25 active:scale-95 transition-all text-center flex items-center justify-center"
              >
                🥫 Poca Salsa
              </button>
              <button
                type="button"
                onClick={handleQuickSinSalsas}
                className="min-h-[48px] px-3 py-2 rounded-xl text-xs font-bold bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 active:scale-95 transition-all text-center flex items-center justify-center"
              >
                🚫 Sin Salsas
              </button>
              <button
                type="button"
                onClick={handleQuickReset}
                className="min-h-[48px] px-3 py-2 rounded-xl text-xs font-bold bg-tocineta-border/60 border border-tocineta-border text-tocineta-muted hover:text-white active:scale-95 transition-all text-center flex items-center justify-center"
              >
                🔄 Normalizar Todo
              </button>
            </div>
          </div>

          {/* INGREDIENTES BASE (INCLUIDO EL PAN) */}
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-tocineta-muted block mb-2">
              🥖 Ingredientes Base del Plato:
            </span>
            <div className="space-y-2">
              {baseIngredients.map(ing => {
                const state = baseStates[ing.id] || 'normal';
                return (
                  <div
                    key={ing.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-tocineta-bg border border-tocineta-border rounded-2xl"
                  >
                    <span className="text-sm font-bold text-white px-2">
                      {ing.name}
                    </span>
                    <div className="grid grid-cols-3 gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setIngredientState(ing.id, 'normal')}
                        className={`min-h-[48px] px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center ${
                          state === 'normal'
                            ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                            : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white'
                        }`}
                      >
                        Normal
                      </button>
                      <button
                        type="button"
                        onClick={() => setIngredientState(ing.id, 'poco')}
                        className={`min-h-[48px] px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center ${
                          state === 'poco'
                            ? 'bg-blue-500 text-white shadow-md'
                            : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white'
                        }`}
                      >
                        Poco
                      </button>
                      <button
                        type="button"
                        onClick={() => setIngredientState(ing.id, 'sin')}
                        className={`min-h-[48px] px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center ${
                          state === 'sin'
                            ? 'bg-red-600 text-white shadow-md'
                            : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white'
                        }`}
                      >
                        Sin
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* BARRA LIBRE ($0.00 VENTA) */}
          {barraLibreList.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                  🥗 Barra Libre ($0.00 Venta):
                </span>
                <span className="text-[10px] text-tocineta-muted">Incluidos sin costo</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {barraLibreList.map(bl => {
                  const isChecked = selectedBarraLibre.has(bl.id);
                  return (
                    <button
                      key={bl.id}
                      type="button"
                      onClick={() => toggleBarraLibre(bl.id)}
                      className={`min-h-[48px] px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between border ${
                        isChecked
                          ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-md'
                          : 'bg-tocineta-bg border-tocineta-border text-tocineta-muted hover:text-white'
                      }`}
                    >
                      <span>+ {bl.name}</span>
                      <span>{isChecked ? '✓' : '+'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* EXTRAS PAGOS DINÁMICOS */}
          {paidExtrasList.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-tocineta-yellow">
                  🥓 Extras Pagados:
                </span>
                <span className="text-[10px] text-tocineta-muted">Se suman al precio del plato</span>
              </div>
              <div className="space-y-2">
                {paidExtrasList.map(extra => {
                const count = paidExtrasCount[extra.id] || 0;
                return (
                  <div
                    key={extra.id}
                    className="flex items-center justify-between p-2.5 bg-tocineta-bg border border-tocineta-border rounded-2xl"
                  >
                    <div>
                      <span className="text-sm font-bold text-white block">
                        {extra.name}
                      </span>
                      <span className="text-xs text-tocineta-yellow font-mono font-bold">
                        +${(extra.priceUsdCents / 100).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => changeExtraCount(extra.id, -1)}
                        disabled={count === 0}
                        className="w-12 h-12 rounded-xl bg-tocineta-card border border-tocineta-border text-white font-black text-lg disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center hover:bg-tocineta-border active:scale-95"
                      >
                        -
                      </button>
                      <span className="w-8 text-center font-mono font-black text-base text-white">
                        {count}
                      </span>
                      <button
                        type="button"
                        onClick={() => changeExtraCount(extra.id, 1)}
                        className="w-12 h-12 rounded-xl bg-tocineta-yellow text-tocineta-bg font-black text-lg flex items-center justify-center hover:bg-tocineta-yellow-hover active:scale-95 shadow-md"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          )}

          {/* INSTRUCCIÓN PERSONALIZADA */}
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-tocineta-muted block mb-1.5">
              📝 Nota Adicional para Cocina:
            </span>
            <input
              type="text"
              placeholder="Ej: Bien tostada, servir salsa aparte..."
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-4 py-3 text-sm text-white placeholder-tocineta-muted focus:border-tocineta-yellow outline-none min-h-[48px]"
            />
          </div>

        </div>

        {/* Pie con Resumen Visual y Botón Guardar */}
        <div className="p-4 bg-tocineta-bg border-t border-tocineta-border space-y-3">
          {/* Tags de Resumen */}
          {summaryTags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
              {summaryTags.map((t, idx) => (
                <span
                  key={idx}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border ${
                    t.type === 'sin'
                      ? 'bg-red-500/15 border-red-500/40 text-red-300'
                      : t.type === 'poco'
                      ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                      : t.type === 'barra'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : 'bg-tocineta-yellow/15 border-tocineta-yellow/40 text-tocineta-yellow'
                  }`}
                >
                  {t.label}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-tocineta-muted italic">
              Receta estándar sin modificaciones
            </span>
          )}

          {/* Botón de Confirmación Táctil Grande */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="w-1/3 min-h-[52px] rounded-2xl bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white font-bold text-sm transition-all flex items-center justify-center active:scale-95"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="w-2/3 min-h-[52px] rounded-2xl bg-tocineta-yellow text-tocineta-bg font-black text-base transition-all flex items-center justify-center gap-2 hover:bg-tocineta-yellow-hover active:scale-95 shadow-xl"
            >
              <span>Guardar Personalización</span>
              {totalExtraCents > 0 && (
                <span className="px-2 py-0.5 rounded-lg bg-black/20 text-xs font-mono">
                  +${(totalExtraCents / 100).toFixed(2)}
                </span>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
