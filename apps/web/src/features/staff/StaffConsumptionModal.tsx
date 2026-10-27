import React, { useState } from 'react';
import { Modal } from '../../ui/Modal.js';
import { Button } from '../../ui/Button.js';
import { Input } from '../../ui/Input.js';
import { Select } from '../../ui/Select.js';
import { Field } from '../../ui/Field.js';
import type { StaffUser } from './types.js';

interface StaffConsumptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffList: StaffUser[];
  fixedDinnerCostUsdCents?: number;
  onSubmit: (data: {
    userId: string;
    itemDescription: string;
    amountUsdCents: number;
    isFixedDinner: boolean;
  }) => Promise<void>;
}

export const StaffConsumptionModal: React.FC<StaffConsumptionModalProps> = ({
  isOpen,
  onClose,
  staffList,
  fixedDinnerCostUsdCents = 250,
  onSubmit
}) => {
  const [userId, setUserId] = useState('');
  const [isFixedDinner, setIsFixedDinner] = useState(false);
  const [description, setDescription] = useState('');
  const [amountUsd, setAmountUsd] = useState('3.50');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeEmployees = staffList.filter((s) => s.isActive !== false);

  const handleToggleDinner = (val: boolean) => {
    setIsFixedDinner(val);
    if (val) {
      setDescription('Cena fija del turno de trabajo');
      setAmountUsd((fixedDinnerCostUsdCents / 100).toFixed(2));
    } else {
      setDescription('');
      setAmountUsd('3.50');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const targetUserId = userId || activeEmployees[0]?.id;
    if (!targetUserId) {
      setError('Debe seleccionar un trabajador');
      return;
    }

    const cents = isFixedDinner ? fixedDinnerCostUsdCents : Math.round((parseFloat(amountUsd) || 0) * 100);
    const cleanDesc = description.trim() || (isFixedDinner ? 'Cena del turno' : 'Consumo adicional');

    try {
      setIsSubmitting(true);
      await onSubmit({
        userId: targetUserId,
        itemDescription: cleanDesc,
        amountUsdCents: cents,
        isFixedDinner
      });
      setDescription('');
      setIsFixedDinner(false);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al registrar consumo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Registrar Consumo o Cena del Personal"
      description="Los consumos se cargan a la cuenta del trabajador; las cenas fijas son asumidas por el local"
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

        {/* Checkbox de Cena Fija del Turno */}
        <div
          onClick={() => handleToggleDinner(!isFixedDinner)}
          className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer select-none transition-colors ${
            isFixedDinner
              ? 'bg-primary/5 border-primary text-ink'
              : 'bg-surface-alt border-border text-ink-muted'
          }`}
        >
          <div>
            <p className="font-bold text-sm text-ink">¿Es Cena Fija del Turno?</p>
            <p className="text-xs text-ink-muted">
              Beneficio institucional: gasto del local, no se descuenta del salario
            </p>
          </div>
          <input
            type="checkbox"
            checked={isFixedDinner}
            onChange={(e) => handleToggleDinner(e.target.checked)}
            className="w-5 h-5 accent-primary cursor-pointer"
          />
        </div>

        <Field label="Descripción del Alimento o Bebida" required>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={isFixedDinner ? 'Cena del turno' : 'Ej: 1 Hamburguesa Clásica + Refresco'}
            disabled={isFixedDinner}
          />
        </Field>

        <Field
          label="Monto Estimado (USD)"
          hint={isFixedDinner ? 'Costo estándar cubierto por TOCINETA' : 'Se revisará al momento de liquidar'}
        >
          <Input
            type="number"
            step="0.01"
            min="0"
            value={amountUsd}
            onChange={(e) => setAmountUsd(e.target.value)}
            disabled={isFixedDinner}
          />
        </Field>

        <div className="flex gap-2 justify-end pt-3 border-t border-border">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            Registrar Consumo
          </Button>
        </div>
      </form>
    </Modal>
  );
};
