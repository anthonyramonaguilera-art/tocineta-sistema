import React, { useState } from 'react';
import { Card, Button, Icon } from '../../ui/index.js';
import { useRegisterPartnerTransaction } from './usePartnersData.js';
import type { BusinessPartner } from './types.js';

interface PartnerTransactionModalProps {
  partner: BusinessPartner | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const PartnerTransactionModal: React.FC<PartnerTransactionModalProps> = ({
  partner,
  onClose,
  onSuccess
}) => {
  const transactionMutation = useRegisterPartnerTransaction();

  const [type, setType] = useState<'APORTE' | 'RETIRO_UTILIDADES'>('APORTE');
  const [amountUsd, setAmountUsd] = useState(100);
  const [paymentMethod, setPaymentMethod] = useState('EFECTIVO_USD');
  const [notes, setNotes] = useState('');

  if (!partner) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amountUsd <= 0) {
      alert('El monto debe ser mayor a 0');
      return;
    }

    try {
      await transactionMutation.mutateAsync({
        partnerId: partner.id,
        type,
        amountUsdCents: Math.round(amountUsd * 100),
        paymentMethod,
        notes: notes.trim() || undefined
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      alert(err.message || 'Error al registrar transacción');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-xs select-none animate-in fade-in duration-200">
      <Card variant="surface" className="w-full max-w-md shadow-2xl border-2 border-border">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${type === 'APORTE' ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'}`}>
              <Icon name={type === 'APORTE' ? 'ArrowDownLeft' : 'ArrowUpRight'} size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-ink">Movimiento de Capital</h3>
              <p className="text-xs text-ink-muted">Socio: <strong className="text-ink">{partner.name}</strong> ({partner.share_percentage}%)</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-alt flex items-center justify-center text-ink-muted hover:text-ink">
            <Icon name="X" size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          {/* Tipo de Operación */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-surface-alt rounded-xl border border-border">
            <button
              type="button"
              onClick={() => setType('APORTE')}
              className={`min-h-[44px] rounded-lg font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                type === 'APORTE' ? 'bg-success text-white shadow-xs' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Icon name="PlusCircle" size={15} /> Aporte Capital
            </button>
            <button
              type="button"
              onClick={() => setType('RETIRO_UTILIDADES')}
              className={`min-h-[44px] rounded-lg font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                type === 'RETIRO_UTILIDADES' ? 'bg-primary text-ink shadow-xs' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Icon name="MinusCircle" size={15} /> Retiro Utilidad
            </button>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-ink-muted mb-1">Monto en Dólares (USD) *</label>
            <div className="relative">
              <span className="absolute left-3 top-3 font-extrabold text-ink text-base">$</span>
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={amountUsd}
                onChange={(e) => setAmountUsd(parseFloat(e.target.value) || 0)}
                className="w-full min-h-[48px] rounded-xl border border-border bg-surface pl-8 pr-3 text-base text-ink outline-none focus:border-primary font-black"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-ink-muted mb-1">Método de Pago / Cuenta</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-bold"
            >
              <option value="EFECTIVO_USD">Efectivo USD ($)</option>
              <option value="PAGO_MOVIL">Pago Móvil (Bs)</option>
              <option value="TRANSFER_BS">Transferencia Bancaria (Bs)</option>
              <option value="ZELLE">Zelle</option>
              <option value="OTRO">Otro / Compensación</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-ink-muted mb-1">Motivo / Referencia</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. Aporte para adquisición de freidora / Retiro quincenal"
              className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary"
            />
          </div>

          <div className="pt-2 border-t border-border flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" size="md" onClick={onClose} className="min-h-[48px]">
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={transactionMutation.isPending}
              className="min-h-[48px] px-5 font-black"
              leftIcon={<Icon name="Check" size={18} />}
            >
              {transactionMutation.isPending ? 'Procesando...' : 'Confirmar Movimiento'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
