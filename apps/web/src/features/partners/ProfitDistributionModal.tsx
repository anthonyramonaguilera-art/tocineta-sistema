import React, { useState } from 'react';
import { Card, Button, Money, Icon } from '../../ui/index.js';
import { useDistributeProfits } from './usePartnersData.js';
import type { BusinessPartner } from './types.js';

interface ProfitDistributionModalProps {
  isOpen: boolean;
  partners: BusinessPartner[];
  onClose: () => void;
  onSuccess: () => void;
}

export const ProfitDistributionModal: React.FC<ProfitDistributionModalProps> = ({
  isOpen,
  partners,
  onClose,
  onSuccess
}) => {
  const distributeMutation = useDistributeProfits();
  const [totalDividendUsd, setTotalDividendUsd] = useState(500);
  const [notes, setNotes] = useState('Reparto de utilidades del mes');

  if (!isOpen) return null;

  const totalCents = Math.round(totalDividendUsd * 100);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalDividendUsd <= 0) {
      alert('El monto a repartir debe ser mayor a 0');
      return;
    }
    if (partners.length === 0) {
      alert('No hay socios registrados para el reparto');
      return;
    }

    try {
      await distributeMutation.mutateAsync({
        totalDividendUsdCents: totalCents,
        notes: notes.trim() || undefined
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      alert(err.message || 'Error al procesar reparto de dividendos');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-xs select-none animate-in fade-in duration-200">
      <Card variant="surface" className="w-full max-w-lg shadow-2xl border-2 border-border">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-success/10 flex items-center justify-center text-success">
              <Icon name="PieChart" size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-ink">Reparto de Utilidades por Porcentaje</h3>
              <p className="text-xs text-ink-muted">Distribución equitativa según cuota de participación.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-alt flex items-center justify-center text-ink-muted hover:text-ink">
            <Icon name="X" size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 text-xs">
          <div>
            <label className="block text-[11px] font-bold text-ink-muted mb-1">Monto Total de Utilidades a Repartir (USD) *</label>
            <div className="relative">
              <span className="absolute left-3 top-3 font-extrabold text-ink text-base">$</span>
              <input
                type="number"
                min="1"
                step="1"
                required
                value={totalDividendUsd}
                onChange={(e) => setTotalDividendUsd(parseFloat(e.target.value) || 0)}
                className="w-full min-h-[48px] rounded-xl border border-border bg-surface pl-8 pr-3 text-base text-ink outline-none focus:border-primary font-black"
              />
            </div>
          </div>

          {/* Desglose en vivo de dividendos */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">
              Desglose Proporcional para {partners.length} Socios
            </span>
            <div className="border border-border rounded-xl divide-y divide-border overflow-hidden bg-surface-alt/30">
              {partners.map((p) => {
                const partnerShareCents = Math.round((totalCents * p.share_percentage) / 100);
                return (
                  <div key={p.id} className="p-2.5 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-extrabold text-ink block">{p.name}</span>
                      <span className="text-[10px] text-ink-muted font-bold">{p.share_percentage}% participación</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-black text-success block">
                        <Money cents={partnerShareCents} />
                      </span>
                      <span className="text-[10px] text-ink-muted">Abono a cuenta</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-ink-muted mb-1">Concepto / Nota de Liquidación</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. Distribución utilidades Octubre 2026"
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
              disabled={distributeMutation.isPending}
              className="min-h-[48px] px-5 font-black bg-success hover:bg-success/90"
              leftIcon={<Icon name="CheckCircle" size={18} />}
            >
              {distributeMutation.isPending ? 'Distribuyendo...' : 'Acreditar Dividendos'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
