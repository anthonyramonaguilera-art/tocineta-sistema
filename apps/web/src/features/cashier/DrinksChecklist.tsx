import React, { useState } from 'react';
import type { CashierOrderLine } from './types.js';

interface DrinksChecklistProps {
  lines: CashierOrderLine[];
}

export const DrinksChecklist: React.FC<DrinksChecklistProps> = ({ lines }) => {
  // Identificar líneas que sean bebidas entregadas en caja
  const drinkLines = lines.filter(l => {
    const isStationDrink = l.station === 'caja_bebidas';
    const nameLower = l.product_name.toLowerCase();
    const isDrinkName =
      nameLower.includes('malta') ||
      nameLower.includes('refresco') ||
      nameLower.includes('agua') ||
      nameLower.includes('nestea') ||
      nameLower.includes('pepsi');
    return isStationDrink || isDrinkName;
  });

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  if (drinkLines.length === 0) return null;

  const toggleCheck = (lineId: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };

  const allDelivered = drinkLines.every(l => checkedIds.has(l.id));

  return (
    <div className="bg-blue-500/10 border-2 border-blue-500/30 rounded-3xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🧊</span>
          <div>
            <h4 className="text-sm font-black text-white">Despacho de Bebidas Frías (Nevera Caja)</h4>
            <p className="text-[11px] text-blue-200/80">
              Entrega inmediata por la cajera mientras cocina prepara los platos
            </p>
          </div>
        </div>
        {allDelivered && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500 text-white font-bold animate-pulse">
            ✓ Bebidas Entregadas
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {drinkLines.map(drink => {
          const isDone = checkedIds.has(drink.id);
          return (
            <button
              key={drink.id}
              type="button"
              onClick={() => toggleCheck(drink.id)}
              className={`min-h-[52px] p-3 rounded-2xl border text-left transition-all flex items-center justify-between gap-3 active:scale-98 ${
                isDone
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                  : 'bg-tocineta-bg border-tocineta-border hover:border-blue-400 text-white shadow'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm ${
                  isDone ? 'bg-emerald-500 text-white' : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted'
                }`}>
                  {isDone ? '✓' : ''}
                </span>
                <div>
                  <span className={`text-xs font-bold block ${isDone ? 'line-through opacity-70' : ''}`}>
                    {drink.quantity}x {drink.product_name}
                  </span>
                  {drink.flavor_choice && (
                    <span className="text-[10px] text-tocineta-yellow font-semibold">
                      Sabor: {drink.flavor_choice}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-[10px] text-tocineta-muted font-mono uppercase shrink-0">
                {isDone ? 'Listo' : 'Pendiente'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
