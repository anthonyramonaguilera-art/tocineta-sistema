import React from 'react';
import type { CashierTender, CashierPaymentMethod } from './types.js';
import { Button, Input, NumberPad } from '../../ui/index.js';
import { paymentLabels, getPaymentMethodHumanLabel } from './payment-labels.js';

const QUICK_USD_BILLS = [100, 500, 1000, 2000, 5000, 10000];

interface PaymentWizardStep2Props {
  selectedMethod: CashierPaymentMethod;
  onSelectMethod: (m: CashierPaymentMethod) => void;
  remainingUsdCents: number;
  remainingBsCents: number;
  onExactUsd: () => void;
  onExactBs: () => void;
  onQuickBill: (cents: number) => void;
  referenceInput: string;
  onChangeReference: (val: string) => void;
  amountInput: string;
  onChangeAmount: (val: string) => void;
  onAddTender: () => void;
  tenders: CashierTender[];
  onRemoveTender: (id: string) => void;
}

export const PaymentWizardStep2: React.FC<PaymentWizardStep2Props> = ({
  selectedMethod,
  onSelectMethod,
  remainingUsdCents,
  remainingBsCents,
  onExactUsd,
  onExactBs,
  onQuickBill,
  referenceInput,
  onChangeReference,
  amountInput,
  onChangeAmount,
  onAddTender,
  tenders,
  onRemoveTender
}) => {
  return (
    <div className="space-y-4">
      {/* Tarjetas grandes de método de pago */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {(['cash_usd', 'cash_bs', 'pago_movil', 'ubii', 'binance', 'credit'] as CashierPaymentMethod[]).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => onSelectMethod(m)}
            className={`min-h-[48px] p-3 rounded-xl border text-left flex flex-col justify-between transition ${
              selectedMethod === m
                ? 'border-primary bg-primary/10 text-ink ring-2 ring-primary/30'
                : 'border-border bg-surface hover:border-primary/50 text-ink-muted'
            }`}
          >
            <span className="text-xs font-bold leading-tight">{paymentLabels[m]}</span>
          </button>
        ))}
      </div>

      {/* Falta por cobrar y equivalencias para smoke check */}
      <div className="p-3 bg-surface-alt border border-border rounded-xl flex items-center justify-between text-xs font-mono">
        <div>
          <span className="font-bold text-ink-muted">Falta por cobrar: </span>
          <span className="text-base font-black text-danger">${(remainingUsdCents / 100).toFixed(2)}</span>
          <span className="text-ink-muted"> ⇄ Equiv {(remainingBsCents / 100).toFixed(2)} Bs (Equivale a Bs oficial)</span>
        </div>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={onExactUsd}>
            Exacto USD
          </Button>
          <Button variant="ghost" size="sm" onClick={onExactBs}>
            Exacto Bs.
          </Button>
        </div>
      </div>

      {/* Billetes rápidos USD */}
      <div className="flex flex-wrap gap-1.5 justify-center">
        {QUICK_USD_BILLS.map(cents => (
          <Button
            key={cents}
            variant="secondary"
            size="sm"
            onClick={() => onQuickBill(cents)}
            className="font-mono font-bold"
          >
            ${cents / 100}
          </Button>
        ))}
      </div>

      {/* Referencia si aplica */}
      {selectedMethod === 'pago_movil' && (
        <Input
          placeholder="Últimos 4 dígitos del comprobante *"
          value={referenceInput}
          onChange={e => onChangeReference(e.target.value)}
          maxLength={12}
        />
      )}

      {/* Teclado numérico táctil */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            placeholder="Monto a ingresar..."
            value={amountInput}
            onChange={e => onChangeAmount(e.target.value)}
            className="text-lg font-mono font-bold"
          />
          <Button variant="primary" size="md" onClick={onAddTender} leftIcon="Plus">
            Agregar
          </Button>
        </div>
        <NumberPad
          value={amountInput}
          onChange={onChangeAmount}
          onEnter={onAddTender}
          showDecimal
        />
      </div>

      {/* Lista de tenders aplicados */}
      {tenders.length > 0 && (
        <div className="space-y-1.5 pt-2">
          <span className="text-xs font-bold uppercase tracking-wider text-ink-muted">Pagos aplicados:</span>
          {tenders.map(t => (
            <div key={t.id} className="flex justify-between items-center p-2.5 bg-surface border border-border rounded-xl text-xs">
              <div>
                <span className="font-bold text-ink">{getPaymentMethodHumanLabel(t.method)}</span>
                {t.referenceCode && <span className="text-ink-muted font-mono ml-2">Ref: {t.referenceCode}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono font-bold text-ink">
                  {t.currency === 'USD' ? `$${(t.amountCents / 100).toFixed(2)}` : `${(t.amountCents / 100).toFixed(2)} Bs`}
                </span>
                <Button variant="ghost" size="sm" onClick={() => onRemoveTender(t.id)} leftIcon="Trash2" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
