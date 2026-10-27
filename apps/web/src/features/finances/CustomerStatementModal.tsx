import React from 'react';
import { Modal, Button, Badge, Icon } from '../../ui/index.js';

interface StatementData {
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  totalOwedUsdCents: number;
  totalPaidUsdCents: number;
  currentBalanceUsdCents: number;
  accounts: Array<{
    id: string;
    concept: string;
    totalUsdCents: number;
    balanceUsdCents: number;
    dueDateMs: number;
    status: string;
    createdAtMs: number;
  }>;
  payments: Array<{
    id: string;
    amountUsdCents: number;
    paymentMethod: string;
    referenceCode: string | null;
    createdAtMs: number;
  }>;
}

interface CustomerStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  statement: StatementData | null;
  onSendWhatsApp: (account: any) => void;
}

export const CustomerStatementModal: React.FC<CustomerStatementModalProps> = ({
  isOpen,
  onClose,
  statement,
  onSendWhatsApp
}) => {
  if (!statement) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Estado de Cuenta — ${statement.customerName}`}
      maxWidth="lg"
    >
      <div className="space-y-4">
        {/* Resumen Superior */}
        <div className="grid grid-cols-3 gap-2 p-3 bg-surface-alt rounded-2xl border border-border text-center">
          <div>
            <span className="text-[10px] font-bold text-ink-muted uppercase block">Total Deuda</span>
            <span className="text-base font-black text-ink">
              ${(statement.totalOwedUsdCents / 100).toFixed(2)}
            </span>
          </div>
          <div>
            <span className="text-[10px] font-bold text-ink-muted uppercase block">Total Abonado</span>
            <span className="text-base font-black text-success">
              ${(statement.totalPaidUsdCents / 100).toFixed(2)}
            </span>
          </div>
          <div>
            <span className="text-[10px] font-bold text-ink-muted uppercase block">Saldo Actual</span>
            <span className="text-base font-black text-danger">
              ${(statement.currentBalanceUsdCents / 100).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Cuentas por Cobrar */}
        <div>
          <h4 className="text-xs font-black text-ink uppercase tracking-wider mb-2">
            Cuentas / Consumos a Crédito
          </h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {statement.accounts.map((acc) => (
              <div
                key={acc.id}
                className="p-3 bg-surface border border-border rounded-xl flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-bold text-ink">{acc.concept}</div>
                  <div className="text-[11px] text-ink-muted">
                    Vencimiento: {new Date(acc.dueDateMs).toLocaleDateString('es-VE')}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="font-black text-ink block">
                      ${(acc.totalUsdCents / 100).toFixed(2)}
                    </span>
                    <Badge
                      variant={acc.status === 'PAGADA' ? 'success' : acc.status === 'VENCIDA' ? 'danger' : 'warning'}
                      className="text-[9px]"
                    >
                      {acc.status}
                    </Badge>
                  </div>
                  {acc.balanceUsdCents > 0 && (
                    <button
                      type="button"
                      onClick={() => onSendWhatsApp(acc)}
                      className="p-2 rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors"
                      title="Enviar recordatorio WhatsApp"
                    >
                      <Icon name="Send" size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Historial de Abonos */}
        <div>
          <h4 className="text-xs font-black text-ink uppercase tracking-wider mb-2">
            Historial de Abonos Realizados
          </h4>
          {statement.payments.length === 0 ? (
            <div className="p-3 text-center text-xs text-ink-muted bg-surface-alt rounded-xl">
              No se han registrado abonos aún
            </div>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {statement.payments.map((p) => (
                <div
                  key={p.id}
                  className="p-2 bg-surface-alt rounded-lg flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-semibold text-ink">{p.paymentMethod.replace('_', ' ')}</span>
                    {p.referenceCode && (
                      <span className="text-[11px] text-ink-muted block">Ref: {p.referenceCode}</span>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-success">+${(p.amountUsdCents / 100).toFixed(2)}</span>
                    <span className="text-[10px] text-ink-muted block">
                      {new Date(p.createdAtMs).toLocaleDateString('es-VE')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-border flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  );
};
