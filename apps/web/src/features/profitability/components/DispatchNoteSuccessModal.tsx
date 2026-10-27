import React from 'react';
import { Modal, Button, Badge, Icon } from '../../../ui/index.js';

export interface DispatchNoteInfo {
  id: string;
  dispatchNoteCode: string;
  fromLocationId: string;
  toLocationId: string;
  status: string;
  items: Array<{
    supplyId: string;
    supplyName: string;
    quantity: number;
    unit: string;
  }>;
  totalCostUsdCents: number;
  forcedWithPin?: boolean;
  notes?: string;
}

interface DispatchNoteSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  note: DispatchNoteInfo | null;
}

export const DispatchNoteSuccessModal: React.FC<DispatchNoteSuccessModalProps> = ({
  isOpen,
  onClose,
  note
}) => {
  if (!isOpen || !note) return null;

  const handleDownloadPdf = () => {
    window.open(`/api/fase4/transfers/${note.id}/pdf`, '_blank');
  };

  const handlePrint58mm = async () => {
    try {
      const res = await fetch(`/api/fase4/transfers/${note.id}/ticket-ir`);
      const data = await res.json();
      if (data.ticketIr) {
        // Enviar a cola de impresión local
        await fetch('/api/printing/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticketIr: data.ticketIr,
            station: 'caja',
            reason: `Nota Despacho ${note.dispatchNoteCode}`
          })
        });
        alert(`Comprobante ${note.dispatchNoteCode} enviado a impresora térmica.`);
      }
    } catch {
      alert('No se pudo enviar la impresión.');
    }
  };

  const handleShareWhatsApp = async () => {
    try {
      const res = await fetch(`/api/fase4/transfers/${note.id}/whatsapp-text`);
      const data = await res.json();
      if (data.text) {
        const encoded = encodeURIComponent(data.text);
        window.open(`https://wa.me/?text=${encoded}`, '_blank');
      }
    } catch {
      // fallback
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nota de Despacho Generada" maxWidth="md">
      <div className="space-y-4 text-center">
        <div className="w-12 h-12 rounded-2xl bg-success/10 border border-success/30 text-success flex items-center justify-center mx-auto">
          <Icon name="CheckCircle" size={28} />
        </div>

        <div>
          <Badge variant="success" size="md">
            {note.dispatchNoteCode}
          </Badge>
          <h3 className="font-black text-base text-ink mt-2">
            Despacho Registrado Exitosamente
          </h3>
          <p className="text-xs text-ink-muted">
            {note.status === 'EN_TRANSITO'
              ? 'En tránsito. Requiere confirmación de recepción en sede destino.'
              : 'Transferencia atómica completada de inmediato.'}
          </p>
        </div>

        {/* Resumen de items */}
        <div className="p-3 rounded-2xl bg-surface-alt border border-border text-left text-xs space-y-1.5 max-h-40 overflow-y-auto">
          <div className="font-black text-[10px] text-ink-muted uppercase tracking-wider">
            Insumos Despachados ({note.items.length}):
          </div>
          {note.items.map(itm => (
            <div key={itm.supplyId} className="flex justify-between items-center text-ink">
              <span>{itm.supplyName}</span>
              <span className="font-bold">{itm.quantity} {itm.unit}</span>
            </div>
          ))}
        </div>

        {/* Botones de acción 1 toque */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
          <Button variant="secondary" size="md" onClick={handlePrint58mm}>
            <Icon name="Printer" size={16} />
            <span>Imprimir 58mm</span>
          </Button>

          <Button variant="secondary" size="md" onClick={handleDownloadPdf}>
            <Icon name="FileText" size={16} />
            <span>Descargar PDF</span>
          </Button>

          <Button variant="primary" size="md" onClick={handleShareWhatsApp}>
            <Icon name="Share2" size={16} />
            <span>WhatsApp</span>
          </Button>
        </div>

        <div className="flex justify-center pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  );
};
