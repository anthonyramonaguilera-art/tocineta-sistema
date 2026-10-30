import React, { useState } from 'react';
import type { CashierOrder, CashierOrderLine } from './types.js';
import { Card, Button, Badge, EmptyState, Modal, Input, Field } from '../../ui/index.js';
import { PaymentWizard } from './PaymentWizard.js';
import { PostPaymentPrintModal } from './PostPaymentPrintModal.js';
import { hasPendingPrintJobs } from './fetchPendingPrintJobs.js';
import { formatTableLabel } from '../../lib/format.js';

interface CashierOrdersTabProps {
  orders: CashierOrder[];
  rateMicroBs: number;
  onRefresh: () => void;
  userRole?: string;
  token?: string | null;
}

export const CashierOrdersTab: React.FC<CashierOrdersTabProps> = ({
  orders,
  rateMicroBs,
  onRefresh,
  userRole = 'cajera',
  token
}) => {
  const [selectedOrder, setSelectedOrder] = useState<CashierOrder | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [paidOrderForPrint, setPaidOrderForPrint] = useState<{ id: string; orderNumber: number } | null>(null);

  // Estados para cancelar comanda
  const [cancelingOrder, setCancelingOrder] = useState<CashierOrder | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('Cliente se arrepintió');
  const [isCanceling, setIsCanceling] = useState<boolean>(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const toggleAccordion = (orderId: string) => {
    setExpandedOrderId(prev => (prev === orderId ? null : orderId));
  };

  const handleExecuteCancel = async () => {
    if (!cancelingOrder) return;
    setIsCanceling(true);
    setCancelError(null);

    try {
      const res = await fetch(`/api/orders/${cancelingOrder.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason.trim() })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al cancelar orden');
      }

      setCancelingOrder(null);
      if (selectedOrder?.id === cancelingOrder.id) setSelectedOrder(null);
      onRefresh();
    } catch (err: any) {
      setCancelError(err?.message || 'Fallo de conexión al anular comanda');
    } finally {
      setIsCanceling(false);
    }
  };

  const renderLineDetails = (line: CashierOrderLine) => {
    const qty = line.qty || line.quantity || 1;
    const comboKids = line.comboChildren || line.combo_children || [];
    const mods = (line.modifiers || []).map((m: any) => m.ingredient_name || m.name || '').filter(Boolean);

    return (
      <div key={line.id} className="py-1 text-xs border-b border-border/40 last:border-0">
        <div className="flex justify-between font-bold text-ink">
          <span>{qty}x {line.product_name}</span>
          <span className="font-mono">${(line.subtotal_usd_cents / 100).toFixed(2)}</span>
        </div>
        {mods.length > 0 && (
          <p className="text-[11px] text-ink-muted">Modificadores: {mods.join(', ')}</p>
        )}
        {comboKids.length > 0 && (
          <p className="text-[11px] text-primary-ink/80 bg-primary/10 p-1 rounded mt-0.5">
            Combo: {comboKids.map(k => k.product_name).join(' + ')}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {orders.length === 0 ? (
        <EmptyState
          title="No hay órdenes por cobrar"
          description="Todas las comandas de salón, para llevar y delivery están al día y pagadas."
          icon="CheckCircle"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {orders.map(o => {
            const isSelected = selectedOrder?.id === o.id;
            const isAccordionOpen = expandedOrderId === o.id;
            const itemsCount = o.itemsCount || o.lines.reduce((acc, l) => acc + (l.qty || l.quantity || 1), 0);

            return (
              <Card
                key={o.id}
                variant={isSelected ? 'alt' : 'surface'}
                className={`p-4 space-y-3 border transition ${
                  isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-black text-ink">#{o.order_number}</span>
                      <Badge variant="primary">{o.table_number ? formatTableLabel(o.table_number) : o.fulfillment_type}</Badge>
                      <Badge variant="neutral">{itemsCount} platos</Badge>
                    </div>
                    <p className="text-xs font-bold text-ink-muted mt-0.5">
                      Cliente: {o.customer_name || 'Mostrador'}
                    </p>
                  </div>
                  <div className="text-right">
                    {(() => {
                      const totalCents = o.total_to_collect_usd_cents ?? (o as any).total_usd_cents ?? (o as any).totalCents ?? 0;
                      const effectiveRate = o.rate_micro_bs || rateMicroBs || 40000000;
                      return (
                        <>
                          <span className="text-xl font-black text-primary font-mono block">
                            ${(totalCents / 100).toFixed(2)}
                          </span>
                          <span className="text-[11px] text-ink-muted font-mono block">
                            {((totalCents * effectiveRate) / 100000000).toFixed(2)} Bs
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Desglose de platos (Detalle de ítems 100% VISIBLE SIEMPRE POR DEFECTO) */}
                <div className="p-2.5 bg-surface-alt/70 border border-border/60 rounded-xl space-y-1">
                  <div className="flex justify-between items-center text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                    <span>Detalle de ítems (100% VISIBLE SIEMPRE POR DEFECTO)</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleAccordion(o.id)}
                      leftIcon={isAccordionOpen ? 'ChevronUp' : 'ChevronDown'}
                    >
                      {isAccordionOpen ? 'Plegar desglose' : 'Expandir desglose'}
                    </Button>
                  </div>
                  <div className="max-h-36 overflow-y-auto pr-1">
                    {o.lines.map(line => renderLineDetails(line))}
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => setSelectedOrder(o)}
                    leftIcon="CreditCard"
                    className="flex-1"
                  >
                    Cobrar Orden
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    onClick={() => setCancelingOrder(o)}
                    leftIcon="Trash2"
                  >
                    Anular
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal de Cobro con PaymentWizard */}
      {selectedOrder && (
        <Modal
          isOpen={Boolean(selectedOrder)}
          onClose={() => setSelectedOrder(null)}
          title={`Cobro de Orden #${selectedOrder.order_number}`}
        >
          <PaymentWizard
            order={selectedOrder}
            rateMicroBs={rateMicroBs}
            onPaymentSuccess={async () => {
              const paid = selectedOrder;
              setSelectedOrder(null);
              if (paid) {
                const hasPending = await hasPendingPrintJobs(paid.id, token);
                if (hasPending) {
                  setPaidOrderForPrint({ id: paid.id, orderNumber: paid.order_number });
                }
              }
              onRefresh();
            }}
            onCancel={() => setSelectedOrder(null)}
            userRole={userRole}
          />
        </Modal>
      )}

      <PostPaymentPrintModal
        order={paidOrderForPrint}
        token={token}
        onClose={() => setPaidOrderForPrint(null)}
      />

      {/* Modal de Cancelación de Comanda */}
      {cancelingOrder && (
        <Modal
          isOpen={Boolean(cancelingOrder)}
          onClose={() => setCancelingOrder(null)}
          title={`Anular Comanda #${cancelingOrder.order_number}`}
        >
          <div className="space-y-4">
            {cancelError && (
              <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger">
                {cancelError}
              </div>
            )}
            <p className="text-sm text-ink">
              ¿Seguro que deseas anular la comanda #{cancelingOrder.order_number} de {cancelingOrder.customer_name || 'Mostrador'}?
            </p>
            <Field label="Motivo de la anulación" required>
              <Input
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Ej. Cliente se arrepintió, error de digitación..."
              />
            </Field>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" size="md" onClick={() => setCancelingOrder(null)} disabled={isCanceling}>
                Volver
              </Button>
              <Button variant="danger" size="md" onClick={handleExecuteCancel} loading={isCanceling} leftIcon="Trash2">
                Confirmar Anulación
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
