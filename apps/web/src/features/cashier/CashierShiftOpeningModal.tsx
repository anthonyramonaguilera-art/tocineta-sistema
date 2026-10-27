import React, { useState } from 'react';
import { Modal, Button, Input, Field, Icon } from '../../ui/index.js';

interface CashierShiftOpeningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const CashierShiftOpeningModal: React.FC<CashierShiftOpeningModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [openingCashUsd, setOpeningCashUsd] = useState<string>('0.00');
  const [openingCashBs, setOpeningCashBs] = useState<string>('0.00');
  const [notes, setNotes] = useState<string>('Apertura de turno');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    const usdCents = Math.round(parseFloat(openingCashUsd || '0') * 100);
    const bsCents = Math.round(parseFloat(openingCashBs || '0') * 100);

    try {
      const res = await fetch('/api/cash-sessions/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openingCashUsdCents: usdCents,
          openingCashBsCents: bsCents,
          notes: notes.trim()
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al abrir turno de caja');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Fallo de conexión al registrar apertura');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Apertura de Turno de Caja">
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMessage && (
          <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger flex items-center gap-2">
            <Icon name="AlertTriangle" className="w-4 h-4 shrink-0 text-danger" />
            <span>{errorMessage}</span>
          </div>
        )}

        <p className="text-xs text-ink-muted">
          Registra el fondo de caja inicial para dar inicio a las operaciones del punto de venta.
        </p>

        <Field label="Fondo Inicial USD ($)" required>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={openingCashUsd}
            onChange={e => setOpeningCashUsd(e.target.value)}
            className="font-mono text-base font-bold"
          />
        </Field>

        <Field label="Fondo Inicial Bs" required>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={openingCashBs}
            onChange={e => setOpeningCashBs(e.target.value)}
            className="font-mono text-base font-bold"
          />
        </Field>

        <Field label="Observaciones de apertura">
          <Input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Ej. Cambio para vuelto..."
          />
        </Field>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" size="md" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button variant="primary" size="md" type="submit" loading={isSubmitting} leftIcon="Lock">
            Confirmar Apertura
          </Button>
        </div>
      </form>
    </Modal>
  );
};
