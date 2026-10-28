import React from 'react';
import type { CartItem } from './types.js';
import { Card, Button, Input, Money, Icon, Badge } from '../../ui/index.js';
import { formatTableLabel } from '../../lib/format.js';

interface Step3ReviewProps {
  cart: CartItem[];
  customerName: string;
  fulfillmentType: 'salon' | 'para_llevar' | 'delivery';
  tableNumber: string;
  deliveryAddress?: string;
  deliverySede?: string;
  notes: string;
  setNotes: (notes: string) => void;
  couponCode: string;
  setCouponCode: (coupon: string) => void;
  subtotalUsdCents: number;
  deliveryFeeUsdCents: number;
  totalUsdCents: number;
  formattedRate: string;
  onUpdateQuantity: (clientLineId: string, quantity: number) => void;
  onRemoveItem: (clientLineId: string) => void;
  onSubmitOrder: () => void;
  onExpressCheckout?: () => void;
  canPay: boolean;
  isSubmitting: boolean;
  onBackToCatalog: () => void;
  askTableOnOrder?: boolean;
}

export const Step3Review: React.FC<Step3ReviewProps> = ({
  cart,
  customerName,
  fulfillmentType,
  tableNumber,
  deliveryAddress,
  deliverySede,
  notes,
  setNotes,
  couponCode,
  setCouponCode,
  subtotalUsdCents,
  deliveryFeeUsdCents,
  totalUsdCents,
  formattedRate,
  onUpdateQuantity,
  onRemoveItem,
  onSubmitOrder,
  onExpressCheckout,
  canPay,
  isSubmitting,
  onBackToCatalog,
  askTableOnOrder = false
}) => {
  return (
    <div className="space-y-4 max-w-2xl mx-auto pb-12">
      {/* 1. Barra Superior Fija con Total y Botones Principales de Acción */}
      <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur-md border border-border p-3.5 rounded-2xl shadow-md space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-black uppercase tracking-wider text-ink-muted block">
              Total a Pagar
            </span>
            <span className="text-xs font-medium text-ink-muted">
              {cart.reduce((sum, i) => sum + i.quantity, 0)} productos
            </span>
          </div>
          <div className="text-right">
            <Money cents={totalUsdCents} rate={formattedRate} size="lg" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {canPay && onExpressCheckout && (
            <Button
              variant="primary"
              size="md"
              loading={isSubmitting}
              onClick={onExpressCheckout}
              leftIcon={<Icon name="DollarSign" size={18} />}
              className="min-h-[48px] font-black text-xs shadow-xs"
            >
              Cobrar ahora
            </Button>
          )}

          <Button
            variant={canPay ? 'secondary' : 'primary'}
            size="md"
            loading={isSubmitting}
            onClick={onSubmitOrder}
            leftIcon={<Icon name="Send" size={18} />}
            className="min-h-[48px] font-black text-xs"
          >
            Enviar a cocina
          </Button>
        </div>
      </div>

      {/* 2. Resumen del Cliente y Canal */}
      <Card variant="alt" className="p-3.5 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-black text-sm text-ink truncate">{customerName}</h3>
            <Badge variant="primary">
              {fulfillmentType === 'salon'
                ? askTableOnOrder && tableNumber
                  ? formatTableLabel(tableNumber)
                  : 'Comer aquí'
                : fulfillmentType === 'para_llevar'
                ? 'Para Llevar'
                : 'Delivery'}
            </Badge>
            {fulfillmentType === 'delivery' && deliverySede && (
              <span className="text-[10px] text-ink-muted font-bold">({deliverySede})</span>
            )}
          </div>
          {fulfillmentType === 'delivery' && deliveryAddress && (
            <p className="text-xs text-ink-muted mt-0.5 flex items-center gap-1">
              <Icon name="MapPin" size={12} />
              <span className="truncate">{deliveryAddress}</span>
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onBackToCatalog}>
          Modificar
        </Button>
      </Card>

      {/* 3. Lista Editable de Productos */}
      <Card variant="surface" className="p-4 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <h2 className="text-xs font-black text-ink-muted uppercase tracking-wider">
            Detalle de Productos
          </h2>
          <Button variant="ghost" size="sm" onClick={onBackToCatalog} leftIcon={<Icon name="Plus" size={14} />}>
            Agregar más
          </Button>
        </div>

        <div className="divide-y divide-border">
          {cart.map((item) => {
            const modifiersCost = (item.modifiers || []).reduce((sum, m) => sum + (m.extraPriceUsdCents || 0), 0);
            const lineTotalCents = (item.unitPriceUsdCents + modifiersCost) * item.quantity;

            return (
              <div key={item.clientLineId} className="py-3 flex items-start justify-between gap-3 first:pt-0 last:pb-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-black text-xs sm:text-sm text-ink">
                      {item.productName}
                    </span>
                    {item.isCombo && <Badge variant="neutral">Combo</Badge>}
                  </div>

                  {item.modifiers && item.modifiers.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.modifiers.map((m, idx) => (
                        <span
                          key={idx}
                          className="px-1.5 py-0.5 rounded-md bg-surface-alt border border-border text-[10px] font-bold text-ink-muted"
                        >
                          {m.modifierType === 'SIN_INGREDIENTE' && `Sin ${m.ingredientName}`}
                          {m.modifierType === 'EXTRA_INGREDIENTE' && `Extra ${m.ingredientName} (+$${(m.extraPriceUsdCents / 100).toFixed(2)})`}
                          {m.modifierType === 'BARRA_LIBRE' && `+ ${m.ingredientName}`}
                        </span>
                      ))}
                    </div>
                  )}

                  {item.customInstructions && (
                    <p className="text-[11px] text-ink-muted italic mt-1">
                      "{item.customInstructions}"
                    </p>
                  )}

                  <div className="mt-1">
                    <Money cents={lineTotalCents} rate={formattedRate} size="sm" />
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 bg-surface-alt rounded-xl border border-border p-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      item.quantity === 1
                        ? onRemoveItem(item.clientLineId)
                        : onUpdateQuantity(item.clientLineId, item.quantity - 1)
                    }
                    className="w-7 h-7 rounded-lg bg-surface flex items-center justify-center text-ink hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                  >
                    <Icon name={item.quantity === 1 ? 'Trash2' : 'Minus'} size={13} />
                  </button>
                  <span className="w-6 text-center text-xs font-black font-mono text-ink">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateQuantity(item.clientLineId, item.quantity + 1)}
                    className="w-7 h-7 rounded-lg bg-surface flex items-center justify-center text-ink hover:bg-surface-alt transition-colors cursor-pointer"
                  >
                    <Icon name="Plus" size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* 4. Notas para Cocina */}
      <Card variant="surface" className="p-3.5 space-y-1.5">
        <label className="text-[11px] font-black text-ink-muted uppercase tracking-wider block">
          Notas para Cocina o Empaque
        </label>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ej: Empacar salsas aparte, carne bien cocida..."
          leftIcon={<Icon name="FileText" size={16} />}
        />
      </Card>

      {/* 5. Cupón de Descuento */}
      <Card variant="surface" className="p-3.5 space-y-1.5">
        <label className="text-[11px] font-black text-ink-muted uppercase tracking-wider block">
          Cupón de Descuento o Cortesía
        </label>
        <Input
          value={couponCode}
          onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
          placeholder="CÓDIGO DE CUPÓN"
          leftIcon={<Icon name="Ticket" size={16} />}
          className="font-mono uppercase"
        />
      </Card>

      {/* 6. Desglose de Totales */}
      <Card variant="alt" className="p-3.5 space-y-2">
        <div className="flex justify-between text-xs font-medium text-ink-muted">
          <span>Subtotal de platos:</span>
          <span className="font-mono font-bold text-ink">${(subtotalUsdCents / 100).toFixed(2)}</span>
        </div>

        {deliveryFeeUsdCents > 0 && (
          <div className="flex justify-between text-xs font-medium text-ink-muted">
            <span>Servicio de Delivery:</span>
            <span className="font-mono font-bold text-ink">${(deliveryFeeUsdCents / 100).toFixed(2)}</span>
          </div>
        )}

        <div className="pt-2 border-t border-border flex items-end justify-between">
          <span className="text-sm font-black text-ink uppercase">Total a Pagar</span>
          <div className="text-right">
            <Money cents={totalUsdCents} rate={formattedRate} size="lg" />
          </div>
        </div>
      </Card>
    </div>
  );
};

export default Step3Review;
