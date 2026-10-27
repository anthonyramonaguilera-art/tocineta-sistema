import React from 'react';
import { Card, Button, Badge, Money, Icon } from '../../ui/index.js';
import type { EventQuotation } from './types.js';

interface ReserveShoppingModalProps {
  quotation: EventQuotation | null;
  onClose: () => void;
}

export const ReserveShoppingModal: React.FC<ReserveShoppingModalProps> = ({
  quotation,
  onClose
}) => {
  if (!quotation) return null;

  const items = quotation.items || [];
  const shoppingList = quotation.shoppingList || [];
  const totalCost = quotation.shoppingListTotalCostUsdCents || 0;

  const copyToClipboard = () => {
    let text = `LISTA DE COMPRAS PARA EVENTO — ${quotation.quotation_number}\n`;
    text += `Cliente: ${quotation.customer_name}\n`;
    text += `Fecha: ${quotation.event_date_ms ? new Date(quotation.event_date_ms).toLocaleDateString('es-VE') : 'Por definir'}\n`;
    text += `------------------------------------\n`;
    for (const ing of shoppingList) {
      text += `[ ] ${ing.ingredientName}: ${ing.requiredCount} porciones (~$${(ing.totalCostUsdCents / 100).toFixed(2)})\n`;
    }
    text += `------------------------------------\n`;
    text += `Inversión estimada en insumos: $${(totalCost / 100).toFixed(2)}\n`;
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-xs select-none animate-in fade-in duration-200">
      <Card variant="surface" className="w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl border-2 border-border">
        {/* Encabezado */}
        <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <Icon name="ShoppingCart" size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-ink">
                  Lista Consolidada de Compras
                </h3>
                <Badge variant="primary">{quotation.quotation_number}</Badge>
              </div>
              <p className="text-xs text-ink-muted">
                Insumos requeridos calculados automáticamente según las recetas de los platos cotizados.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-surface-alt border border-border flex items-center justify-center text-ink-muted hover:text-ink transition-colors"
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        {/* Resumen de Platos y Evento */}
        <div className="p-4 bg-surface-alt/50 border-b border-border grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-ink-muted block text-[11px] font-bold">Cliente</span>
            <span className="font-extrabold text-ink truncate block">{quotation.customer_name}</span>
          </div>
          <div>
            <span className="text-ink-muted block text-[11px] font-bold">Invitados</span>
            <span className="font-extrabold text-ink">{quotation.guest_count} personas</span>
          </div>
          <div>
            <span className="text-ink-muted block text-[11px] font-bold">Total Platos</span>
            <span className="font-extrabold text-ink">
              {items.reduce((sum, it) => sum + it.quantity, 0)} unidades
            </span>
          </div>
          <div>
            <span className="text-ink-muted block text-[11px] font-bold">Costo Insumos</span>
            <span className="font-extrabold text-success">
              <Money cents={totalCost} />
            </span>
          </div>
        </div>

        {/* Tabla de Insumos */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2">
          {shoppingList.length === 0 ? (
            <div className="text-center py-8 text-ink-muted text-xs">
              No hay ingredientes asignados a los platos de esta cotización.
            </div>
          ) : (
            <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
              <div className="bg-surface-alt px-3 py-2 text-[11px] font-bold text-ink-muted grid grid-cols-12 gap-2 uppercase tracking-wider">
                <span className="col-span-6">Ingrediente / Insumo</span>
                <span className="col-span-3 text-right">Cantidad</span>
                <span className="col-span-3 text-right">Costo Est.</span>
              </div>
              {shoppingList.map((ing) => (
                <div key={ing.ingredientId} className="px-3 py-2.5 text-xs grid grid-cols-12 gap-2 items-center bg-surface hover:bg-surface-alt/40 transition-colors">
                  <div className="col-span-6 flex items-center gap-2">
                    <Icon name="CheckSquare" size={14} className="text-ink-muted" />
                    <span className="font-bold text-ink">{ing.ingredientName}</span>
                  </div>
                  <div className="col-span-3 text-right font-extrabold text-ink">
                    {ing.requiredCount} <span className="text-[10px] text-ink-muted font-normal">porciones</span>
                  </div>
                  <div className="col-span-3 text-right font-bold text-ink">
                    <Money cents={ing.totalCostUsdCents} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3 bg-surface-alt/30">
          <div className="text-xs text-ink-muted text-center sm:text-left">
            Total inversión estimada: <strong className="text-ink"><Money cents={totalCost} /></strong>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="flex-1 sm:flex-initial min-h-[48px]"
              onClick={copyToClipboard}
              leftIcon={<Icon name="Copy" size={16} />}
            >
              Copiar Checklist
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              className="flex-1 sm:flex-initial min-h-[48px]"
              onClick={onClose}
            >
              Entendido
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};
