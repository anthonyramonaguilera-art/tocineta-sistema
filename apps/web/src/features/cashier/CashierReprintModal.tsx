import React from 'react';
import { Modal } from '../../ui/Modal.js';
import { Field } from '../../ui/Field.js';
import { Input } from '../../ui/Input.js';
import { Select } from '../../ui/Select.js';
import { Button } from '../../ui/Button.js';

interface PaidSale {
  orderId: string;
  orderNumber: number;
  customerName?: string | null;
  [key: string]: any;
}

interface CashierReprintModalProps {
  reprintingSale: PaidSale | null;
  onClose: () => void;
  reprintError: string | null;
  reprintReason: string;
  setReprintReason: (reason: string) => void;
  reprintPin: string;
  setReprintPin: (pin: string) => void;
  isReprinting: boolean;
  onConfirm: () => void;
}

export const CashierReprintModal: React.FC<CashierReprintModalProps> = ({
  reprintingSale,
  onClose,
  reprintError,
  reprintReason,
  setReprintReason,
  reprintPin,
  setReprintPin,
  isReprinting,
  onConfirm
}) => {
  if (!reprintingSale) return null;

  return (
    <Modal
      isOpen={Boolean(reprintingSale)}
      onClose={onClose}
      title={`Reimprimir Comprobante #${reprintingSale.orderNumber}`}
    >
      <div className="space-y-4">
        {reprintError && (
          <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger">
            {reprintError}
          </div>
        )}
        <p className="text-sm font-bold text-ink">
          ¿Deseas reimprimir el ticket para la venta #{reprintingSale.orderNumber} ({reprintingSale.customerName || 'Mostrador'})?
        </p>
        <p className="text-xs text-ink-muted">
          Esta acción requiere PIN de autorización y un motivo de reimpresión.
        </p>

        <Field label="Motivo de reimpresión" required>
          <Select
            value={reprintReason}
            onChange={e => setReprintReason(e.target.value)}
            options={[
              { value: 'CLIENTE_SOLICITA_COPIA', label: 'Cliente solicita copia adicional' },
              { value: 'ATASCO_PAPEL_IMPRESORA', label: 'Atasco o error de papel en impresora' },
              { value: 'TICKET_ILEGIBLE', label: 'Ticket anterior ilegible' },
              { value: 'OTRO_MOTIVO', label: 'Otro motivo operativo' }
            ]}
          />
        </Field>

        <Field label="PIN de Autorización (Cajera/Supervisor)" required>
          <Input
            type="password"
            maxLength={6}
            value={reprintPin}
            onChange={e => setReprintPin(e.target.value)}
            placeholder="Ingresa PIN..."
            className="font-mono text-center tracking-widest text-lg font-bold"
          />
        </Field>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" size="md" onClick={onClose} disabled={isReprinting}>
            Cancelar
          </Button>
          <Button variant="primary" size="md" onClick={onConfirm} loading={isReprinting} leftIcon="Printer">
            Confirmar Reimpresión
          </Button>
        </div>
      </div>
    </Modal>
  );
};
