import React, { useState } from 'react';
import { Card, Button, Input, Select, Badge, Icon, EmptyState } from '../../ui/index.js';

export interface PayableItem {
  id: string;
  locationId: string;
  locationName: string;
  supplierId: string | null;
  supplierName: string;
  supplierRifPhone: string | null;
  invoiceNumber: string | null;
  paymentCondition: 'CONTADO' | 'CREDITO';
  status: 'PENDIENTE' | 'POR_VENCER' | 'VENCIDA' | 'PAGADA';
  totalUsdCents: number;
  totalBsCents: number;
  balanceOwedUsdCents: number;
  paidUsdCents: number;
  dueDateMs: number | null;
  isOverdue: boolean;
  isUpcomingDue: boolean;
  daysUntilDue: number | null;
  notes: string | null;
  createdAtMs: number;
}

interface PayablesTabProps {
  payables: PayableItem[];
  onOpenPayment: (item: PayableItem) => void;
  isLoading?: boolean;
}

export const PayablesTab: React.FC<PayablesTabProps> = ({
  payables,
  onOpenPayment,
  isLoading
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  const filtered = payables.filter((p) => {
    const matchesSearch =
      p.supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.invoiceNumber && p.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (p.notes && p.notes.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus =
      selectedStatus === 'ALL'
        ? true
        : selectedStatus === 'POR_VENCER'
        ? p.isUpcomingDue
        : selectedStatus === 'VENCIDA'
        ? p.isOverdue
        : p.status === selectedStatus;

    return matchesSearch && matchesStatus;
  });

  const totalOwedUsdCents = filtered.reduce((acc, p) => acc + p.balanceOwedUsdCents, 0);
  const overdueCount = payables.filter((p) => p.isOverdue).length;
  const upcomingCount = payables.filter((p) => p.isUpcomingDue).length;

  return (
    <div className="space-y-4">
      {/* Banner Superior */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-surface rounded-2xl border border-border shadow-xs">
        <div>
          <span className="text-xs font-bold text-ink-muted uppercase tracking-wider block">
            Total Deuda a Proveedores
          </span>
          <div className="text-3xl font-black text-danger tracking-tight">
            ${(totalOwedUsdCents / 100).toFixed(2)}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {overdueCount > 0 && (
              <Badge variant="danger" className="text-[10px] font-black">
                {overdueCount} FACTURAS VENCIDAS
              </Badge>
            )}
            {upcomingCount > 0 && (
              <Badge variant="warning" className="text-[10px] font-black">
                {upcomingCount} POR VENCER (2 DÍAS)
              </Badge>
            )}
          </div>
        </div>

        <div className="text-right text-xs text-ink-muted hidden sm:block">
          <span className="block font-bold uppercase tracking-wider">Control de Créditos</span>
          <span>Alertas automáticas a 2 días y facturas vencidas</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder="Buscar por proveedor, N° de factura o notas..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-60">
          <Select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            options={[
              { value: 'ALL', label: 'Todas las facturas' },
              { value: 'POR_VENCER', label: 'Por Vencer (≤ 2 días)' },
              { value: 'VENCIDA', label: 'Vencidas' },
              { value: 'PENDIENTE', label: 'Pendientes' },
              { value: 'PAGADA', label: 'Pagadas (Completas)' }
            ]}
          />
        </div>
      </div>

      {/* Lista de Facturas */}
      {isLoading ? (
        <div className="p-8 text-center text-xs font-bold text-ink-muted animate-pulse">
          Cargando cuentas por pagar...
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No hay facturas registradas"
          description="Las facturas de compra registradas a crédito en la recepción de insumos aparecerán aquí."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((p) => {
            const isSettled = p.balanceOwedUsdCents === 0;

            return (
              <Card
                key={p.id}
                className={`p-4 flex flex-col justify-between hover:shadow-md transition-shadow border-l-4 ${
                  p.isOverdue
                    ? 'border-l-danger bg-danger/5'
                    : p.isUpcomingDue
                    ? 'border-l-warning bg-warning/5'
                    : isSettled
                    ? 'border-l-success'
                    : 'border-l-border'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="font-black text-sm text-ink">{p.supplierName}</span>
                        {p.isOverdue && (
                          <Badge variant="danger" className="text-[9px] font-black">
                            VENCIDA
                          </Badge>
                        )}
                        {p.isUpcomingDue && (
                          <Badge variant="warning" className="text-[9px] font-black">
                            VENCE PRONTO
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-ink-muted block font-medium">
                        Factura: {p.invoiceNumber || 'Sin número'}
                      </span>
                    </div>

                    <div className="text-right shrink-0">
                      <span className={`text-xl font-black ${isSettled ? 'text-success' : 'text-danger'}`}>
                        ${(p.balanceOwedUsdCents / 100).toFixed(2)}
                      </span>
                      <span className="block text-[11px] text-ink-muted">
                        Total: ${(p.totalUsdCents / 100).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Vencimiento y progreso */}
                  <div>
                    <div className="flex justify-between text-[11px] text-ink-muted mb-1 font-semibold">
                      <span>Abonado: ${(p.paidUsdCents / 100).toFixed(2)}</span>
                      <span>
                        Vence: {p.dueDateMs ? new Date(p.dueDateMs).toLocaleDateString('es-VE') : 'N/A'}
                        {p.daysUntilDue !== null && ` (${p.daysUntilDue >= 0 ? `en ${p.daysUntilDue}d` : `hace ${Math.abs(p.daysUntilDue)}d`})`}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-surface-alt rounded-full overflow-hidden border border-border">
                      <div
                        className={`h-full ${isSettled ? 'bg-success' : 'bg-primary'}`}
                        style={{
                          width: `${Math.min(100, Math.round((p.paidUsdCents / p.totalUsdCents) * 100))}%`
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Acciones */}
                <div className="pt-3 mt-3 border-t border-border flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-ink-muted">
                    {p.locationName}
                  </span>

                  {!isSettled && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onOpenPayment(p)}
                      className="min-h-[38px] px-4 font-bold"
                    >
                      <Icon name="CreditCard" size={14} className="mr-1" />
                      Pagar / Abonar
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
