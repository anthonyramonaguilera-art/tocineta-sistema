import React, { useState } from 'react';
import { Modal, Button, Input, Select, Field, Icon } from '../../ui/index.js';

interface ReceivablePaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  receivable: {
    id: string;
    customerName: string;
    concept: string;
    totalUsdCents: number;
    balanceUsdCents: number;
  } | null;
  onSavePayment: (data: any) => Promise<void>;
  userId: string;
}

const PAYMENT_METHODS = [
  { value: 'EFECTIVO_USD', label: 'Efectivo USD ($)' },
  { value: 'PAGO_MOVIL', label: 'Pago Móvil (Bs)' },
  { value: 'TRANSFERENCIA_BS', label: 'Transferencia Bancaria (Bs)' },
  { value: 'ZELLE', label: 'Zelle (USD)' },
  { value: 'PUNTO_VENTA', label: 'Punto de Venta / Tarjeta (Bs)' },
  { value: 'EFECTIVO_BS', label: 'Efectivo Bolívares (Bs)' },
  { value: 'BINANCE', label: 'Binance Pay / USDT' }
];

export const ReceivablePaymentModal: React.FC<ReceivablePaymentModalProps> = ({
  isOpen,
  onClose,
  receivable,
  onSavePayment,
  userId
}) => {
  if (!receivable) return null;

  const maxBalanceUsd = receivable.balanceUsdCents / 100;
  const [amountStr, setAmountStr] = useState(maxBalanceUsd.toFixed(2));
  const [paymentMethod, setPaymentMethod] = useState('EFECTIVO_USD');
  const [referenceCode, setReferenceCode] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const setPercentage = (pct: number) => {
    const calculated = (maxBalanceUsd * pct).toFixed(2);
    setAmountStr(calculated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountVal = parseFloat(amountStr.replace(',', '.'));
    if (isNaN(amountVal) || amountVal <= 0) {
      setErrorMsg('Ingrese un monto de abono válido mayor a 0');
      return;
    }

    if (amountVal > maxBalanceUsd) {
      setErrorMsg(`El abono ($${amountVal.toFixed(2)}) supera el saldo pendiente ($${maxBalanceUsd.toFixed(2)})`);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      await onSavePayment({
        receivableId: receivable.id,
        amountUsdCents: Math.round(amountVal * 100),
        paymentMethod,
        referenceCode: referenceCode.trim() || undefined,
        notes: notes.trim() || undefined,
        receivedBy: userId
      });

      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al procesar el abono');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Registrar Abono a Cuenta por Cobrar" maxWidth="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Info del Cliente y Saldo */}
        <div className="p-3 bg-surface-alt rounded-xl border border-border flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-ink uppercase block">{receivable.customerName}</span>
            <span className="text-[11px] text-ink-muted">{receivable.concept}</span>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-ink-muted uppercase font-bold block">Saldo Pendiente</span>
            <span className="text-lg font-black text-danger">${maxBalanceUsd.toFixed(2)}</span>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl flex items-center gap-2 text-danger text-xs font-semibold">
            <Icon name="AlertCircle" size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Monto de Abono */}
        <div>
          <label className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-1">
            Monto del Abono (USD $)
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-ink-muted">
              $
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0.00"
              autoFocus
              className="w-full pl-9 pr-4 py-3 text-2xl font-black text-ink bg-surface border-2 border-border focus:border-primary rounded-xl outline-hidden transition-all min-h-[54px]"
            />
          </div>

          {/* Atajos de porcentajes */}
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => setPercentage(0.25)}
              className="flex-1 py-1.5 text-xs font-bold bg-surface-alt border border-border hover:bg-surface rounded-lg text-ink"
            >
              25%
            </button>
            <button
              type="button"
              onClick={() => setPercentage(0.5)}
              className="flex-1 py-1.5 text-xs font-bold bg-surface-alt border border-border hover:bg-surface rounded-lg text-ink"
            >
              50%
            </button>
            <button
              type="button"
              onClick={() => setPercentage(1.0)}
              className="flex-1 py-1.5 text-xs font-bold bg-primary text-primary-ink hover:opacity-90 rounded-lg"
            >
              Total (100%)
            </button>
          </div>
        </div>

        {/* Método de Pago */}
        <Field label="Método de Pago Recibido">
          <Select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            options={PAYMENT_METHODS}
          />
        </Field>

        {/* Referencia */}
        <Field label="Código de Referencia / N° Recibo (Opcional)">
          <Input
            placeholder="Ej. REF-983210"
            value={referenceCode}
            onChange={(e) => setReferenceCode(e.target.value)}
          />
        </Field>

        {/* Notas */}
        <Field label="Notas">
          <Input
            placeholder="Comentarios adicionales del abono"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        {/* Botones */}
        <div className="pt-2 border-t border-border flex items-center justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={isSubmitting}
            className="min-h-[48px] px-6 text-sm font-bold"
          >
            Confirmar Abono
          </Button>
        </div>
      </form>
    </Modal>
  );
};
