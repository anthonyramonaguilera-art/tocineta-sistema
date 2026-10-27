import React, { useState } from 'react';
import { Modal } from '../../ui/Modal.js';
import { Button } from '../../ui/Button.js';
import { Input } from '../../ui/Input.js';
import { Select } from '../../ui/Select.js';
import { Field } from '../../ui/Field.js';
import type { StaffUser } from './types.js';

interface PayrollAdjustmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffList: StaffUser[];
  onSubmit: (data: {
    userId: string;
    adjustmentType: 'BONO' | 'ADELANTO';
    amountUsdCents: number;
    reason: string;
  }) => Promise<void>;
}

export const PayrollAdjustmentModal: React.FC<PayrollAdjustmentModalProps> = ({
  isOpen,
  onClose,
  staffList,
  onSubmit
}) => {
  const [userId, setUserId] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<'BONO' | 'ADELANTO'>('BONO');
  const [amountUsd, setAmountUsd] = useState('10.00');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeEmployees = staffList.filter((s) => s.isActive !== false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const targetUserId = userId || activeEmployees[0]?.id;
    if (!targetUserId) {
      setError('Debe seleccionar un trabajador');
      return;
    }

    const cents = Math.round((parseFloat(amountUsd) || 0) * 100);
    if (cents <= 0) {
      setError('El monto debe ser mayor a cero');
      return;
    }

    if (!reason.trim()) {
      setError('Debe especificar el motivo o concepto');
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        userId: targetUserId,
        adjustmentType,
        amountUsdCents: cents,
        reason: reason.trim()
      });
      setReason('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al registrar ajuste');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={adjustmentType === 'BONO' ? 'Registrar Bono o Gratificación' : 'Registrar Adelanto o Vale'}
      description="Este monto se computará automáticamente en la próxima liquidación del empleado"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger">
            {error}
          </div>
        )}

        <Field label="Trabajador" required>
          <Select
            value={userId || activeEmployees[0]?.id || ''}
            onChange={(e) => setUserId(e.target.value)}
            options={activeEmployees.map((s) => ({
              value: s.id,
              label: `${s.name} (${s.role.toUpperCase()})`
            }))}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Tipo de Ajuste" required>
            <Select
              value={adjustmentType}
              onChange={(e) => setAdjustmentType(e.target.value as any)}
              options={[
                { value: 'BONO', label: 'Bono (+ Suma al Neto)' },
                { value: 'ADELANTO', label: 'Adelanto (- Resta del Neto)' }
              ]}
            />
          </Field>

          <Field label="Monto en USD ($)" required>
            <Input
              type="number"
              step="0.01"
              min="0.5"
              value={amountUsd}
              onChange={(e) => setAmountUsd(e.target.value)}
              placeholder="10.00"
            />
          </Field>
        </div>

        <Field label="Motivo o Concepto" required hint="Ej: Puntualidad, horas extra, vale de emergencia">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: Bono por meta del fin de semana"
          />
        </Field>

        <div className="flex gap-2 justify-end pt-3 border-t border-border">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            Guardar Ajuste
          </Button>
        </div>
      </form>
    </Modal>
  );
};
