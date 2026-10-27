import React, { useState } from 'react';
import { Card, Button, Input, Select, Badge, Icon, EmptyState } from '../../ui/index.js';

export interface ReceivableItem {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  customerIsPartner: number;
  locationId: string;
  locationName: string;
  concept: string;
  totalUsdCents: number;
  balanceUsdCents: number;
  paidUsdCents: number;
  dueDateMs: number;
  status: 'PENDIENTE' | 'PARCIAL' | 'PAGADA' | 'VENCIDA';
  isOverdue: boolean;
  notes: string | null;
  createdAtMs: number;
}

interface ReceivablesTabProps {
  receivables: ReceivableItem[];
  onOpenNewReceivable: () => void;
  onOpenPayment: (item: ReceivableItem) => void;
  onOpenStatement: (customerId: string) => void;
  onSendWhatsApp: (receivableId: string) => void;
  isLoading?: boolean;
}

export const ReceivablesTab: React.FC<ReceivablesTabProps> = ({
  receivables,
  onOpenNewReceivable,
  onOpenPayment,
  onOpenStatement,
  onSendWhatsApp,
  isLoading
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  const filtered = receivables.filter((r) => {
    const matchesSearch =
      r.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.concept.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.customerPhone && r.customerPhone.includes(searchTerm));
    const matchesStatus = selectedStatus === 'ALL' || r.status === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  const totalBalanceUsdCents = filtered.reduce((acc, r) => acc + r.balanceUsdCents, 0);

  return (
    <div className="space-y-4">
      {/* Banner de Saldo estilo Treinta */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-surface rounded-2xl border border-border shadow-xs">
        <div>
          <span className="text-xs font-bold text-ink-muted uppercase tracking-wider block">
            Total Saldo por Cobrar
          </span>
          <div className="text-3xl font-black text-warning tracking-tight">
            ${(totalBalanceUsdCents / 100).toFixed(2)}
          </div>
          <span className="text-[11px] text-ink-muted">
            {filtered.filter((r) => r.balanceUsdCents > 0).length} clientes con deuda activa
          </span>
        </div>

        <Button
          variant="primary"
          onClick={onOpenNewReceivable}
          className="min-h-[50px] px-6 text-sm font-bold shadow-sm"
        >
          <Icon name="UserPlus" size={18} className="mr-2" />
          Nuevo Crédito / Fiado
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder="Buscar por cliente, teléfono o concepto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-56">
          <Select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            options={[
              { value: 'ALL', label: 'Todos los estados' },
              { value: 'PENDIENTE', label: 'Pendientes (Sin abono)' },
              { value: 'PARCIAL', label: 'Con abonos parciales' },
              { value: 'VENCIDA', label: 'Vencidas' },
              { value: 'PAGADA', label: 'Pagadas (Completas)' }
            ]}
          />
        </div>
      </div>

      {/* Lista de Cuentas */}
      {isLoading ? (
        <div className="p-8 text-center text-xs font-bold text-ink-muted animate-pulse">
          Cargando cuentas por cobrar...
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No hay cuentas por cobrar"
          description="Registra clientes con crédito (fiado, eventos o socios) para hacer seguimiento a sus pagos."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((r) => {
            const isSettled = r.balanceUsdCents === 0;
            const badgeVariant = isSettled ? 'success' : r.isOverdue ? 'danger' : r.paidUsdCents > 0 ? 'warning' : 'neutral';

            return (
              <Card key={r.id} className="p-4 flex flex-col justify-between hover:shadow-md transition-shadow">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="font-black text-sm text-ink">{r.customerName}</span>
                        {r.customerIsPartner === 1 && (
                          <Badge variant="primary" className="text-[9px]">
                            SOCIO
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-ink-muted block font-medium">{r.concept}</span>
                    </div>

                    <div className="text-right shrink-0">
                      <span className={`text-xl font-black ${isSettled ? 'text-success' : 'text-danger'}`}>
                        ${(r.balanceUsdCents / 100).toFixed(2)}
                      </span>
                      <span className="block text-[11px] text-ink-muted">
                        Total: ${(r.totalUsdCents / 100).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Barra de progreso de pago */}
                  <div>
                    <div className="flex justify-between text-[11px] text-ink-muted mb-1 font-semibold">
                      <span>Abonado: ${(r.paidUsdCents / 100).toFixed(2)}</span>
                      <span>
                        Vence: {new Date(r.dueDateMs).toLocaleDateString('es-VE')}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-surface-alt rounded-full overflow-hidden border border-border">
                      <div
                        className={`h-full ${isSettled ? 'bg-success' : 'bg-primary'}`}
                        style={{
                          width: `${Math.min(100, Math.round((r.paidUsdCents / r.totalUsdCents) * 100))}%`
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Acciones Rápidas */}
                <div className="pt-3 mt-3 border-t border-border flex items-center justify-between gap-2">
                  <Badge variant={badgeVariant} className="text-[10px] font-bold">
                    {r.status}
                  </Badge>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenStatement(r.customerId)}
                      className="px-2.5 py-1.5 rounded-lg border border-border hover:bg-surface-alt text-xs font-bold text-ink flex items-center gap-1 transition-colors min-h-[36px]"
                      title="Ver Estado de Cuenta"
                    >
                      <Icon name="FileText" size={14} />
                      <span>Cuenta</span>
                    </button>

                    {!isSettled && (
                      <>
                        <button
                          type="button"
                          onClick={() => onSendWhatsApp(r.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-success/10 border border-success/30 hover:bg-success/20 text-xs font-bold text-success flex items-center gap-1 transition-colors min-h-[36px]"
                          title="Recordatorio por WhatsApp"
                        >
                          <Icon name="Send" size={14} />
                          <span>WhatsApp</span>
                        </button>

                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => onOpenPayment(r)}
                          className="min-h-[36px] font-bold"
                        >
                          <Icon name="DollarSign" size={14} className="mr-1" />
                          Abonar
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
