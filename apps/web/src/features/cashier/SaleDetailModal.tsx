import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button } from '../../ui/index.js';
import { TicketPreviewModal } from './TicketPreviewModal.js';
import { fetchOrderPrintJobs, pickOriginalJobs } from './useOrderPrintJobs.js';
import { formatSaleDateTime } from './sale-format.js';

interface SaleDetailModalProps {
  sale: {
    orderId: string;
    orderNumber: number | string;
    customerName?: string | null;
    totalUsdCents: number;
    paidAtMs: number;
  };
  onClose: () => void;
  onReprint: () => void;
}

export const SaleDetailModal: React.FC<SaleDetailModalProps> = ({ sale, onClose, onReprint }) => {
  const { data: jobs, isLoading, isError } = useQuery({
    queryKey: ['order-print-jobs', sale.orderId],
    queryFn: () => fetchOrderPrintJobs(sale.orderId)
  });

  if (!isLoading && !isError && jobs) {
    const { nota } = pickOriginalJobs(jobs);
    if (nota) {
      return <TicketPreviewModal jobId={nota.id} onClose={onClose} />;
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={`Venta #${sale.orderNumber}`}>
      <div className="space-y-4">
        {isLoading && <p className="text-sm text-ink-muted">Cargando detalle de la venta...</p>}
        {isError && <p className="text-sm text-danger">No se pudo cargar el comprobante digital.</p>}
        {!isLoading && (
          <div className="space-y-2 rounded-xl border border-border bg-surface p-4 text-sm text-ink">
            <p><span className="font-semibold">Cliente:</span> {sale.customerName || 'Cliente Mostrador'}</p>
            <p><span className="font-semibold">Fecha:</span> {formatSaleDateTime(sale.paidAtMs)}</p>
            <p><span className="font-semibold">Total USD:</span> ${(sale.totalUsdCents / 100).toFixed(2)}</p>
            <p className="text-xs text-ink-muted pt-2">Esta venta no genero nota de entrega impresa. Los items estan en la comanda de cocina.</p>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          <Button variant="primary" onClick={onReprint}>Reimprimir</Button>
        </div>
      </div>
    </Modal>
  );
};
