import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { Modal, Button, Input, Field } from '../../ui/index.js';
import { getRequiredPinLength, sanitizePinInput, validatePinChange } from './pin-utils.js';

interface ChangePinModalProps {
  isOpen: boolean;
  initialCurrentPin?: string;
  onSuccess?: () => void;
}

export const ChangePinModal: React.FC<ChangePinModalProps> = ({
  isOpen,
  initialCurrentPin = '',
  onSuccess
}) => {
  const { user, changePin } = useAuth();
  const requiredPinLength = getRequiredPinLength(user);
  const isAdminOrSupervisor = user?.role === 'admin' || user?.role === 'supervisor';

  const [currentPin, setCurrentPin] = useState(initialCurrentPin);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [changePinError, setChangePinError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialCurrentPin) {
      setCurrentPin(initialCurrentPin);
    }
  }, [initialCurrentPin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePinError(null);

    const cleanCurrent = sanitizePinInput(currentPin);
    const cleanNew = sanitizePinInput(newPin, requiredPinLength);
    const cleanConfirm = sanitizePinInput(confirmPin, requiredPinLength);

    if (!cleanCurrent) {
      setChangePinError('Ingresa tu PIN actual o inicial.');
      return;
    }

    const validation = validatePinChange(
      cleanNew,
      cleanConfirm,
      requiredPinLength,
      isAdminOrSupervisor
    );

    if (!validation.valid) {
      setChangePinError(validation.error || 'PIN no válido');
      return;
    }

    setIsSubmitting(true);
    const result = await changePin(cleanCurrent, cleanNew);
    setIsSubmitting(false);

    if (result.success) {
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setChangePinError(null);
      onSuccess?.();
    } else {
      setChangePinError(result.error || 'Error al actualizar PIN');
    }
  };

  const handleCurrentPinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentPin(sanitizePinInput(e.target.value, 6));
    setChangePinError(null);
  };

  const handleNewPinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewPin(sanitizePinInput(e.target.value, requiredPinLength));
    setChangePinError(null);
  };

  const handleConfirmPinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setConfirmPin(sanitizePinInput(e.target.value, requiredPinLength));
    setChangePinError(null);
  };

  const handlePasteDigitsOnly = (
    e: React.ClipboardEvent<HTMLInputElement>,
    setter: (val: string) => void,
    maxLen?: number
  ) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    setter(sanitizePinInput(pasted, maxLen));
    setChangePinError(null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {}}
      showCloseButton={false}
      closeOnEscape={false}
      closeOnBackdropClick={false}
      title={`Cambio Obligatorio de PIN (${requiredPinLength} dígitos)`}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-ink-muted">
          Por seguridad y auditoría de la sede, debes establecer tu nuevo PIN numérico de {requiredPinLength} dígitos antes de continuar.
        </p>

        <Field label="PIN Actual" required>
          <Input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={currentPin}
            onChange={handleCurrentPinChange}
            onPaste={(e) => handlePasteDigitsOnly(e, setCurrentPin, 6)}
            placeholder="PIN actual o semilla"
            autoFocus={!initialCurrentPin}
            required
          />
        </Field>

        <Field label={`Nuevo PIN (${requiredPinLength} dígitos)`} required>
          <Input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={requiredPinLength}
            value={newPin}
            onChange={handleNewPinChange}
            onPaste={(e) => handlePasteDigitsOnly(e, setNewPin, requiredPinLength)}
            placeholder={`${requiredPinLength} dígitos`}
            autoFocus={Boolean(initialCurrentPin)}
            required
          />
        </Field>

        <Field label="Confirmar Nuevo PIN" required>
          <Input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={requiredPinLength}
            value={confirmPin}
            onChange={handleConfirmPinChange}
            onPaste={(e) => handlePasteDigitsOnly(e, setConfirmPin, requiredPinLength)}
            placeholder="Repite el nuevo PIN"
            required
          />
        </Field>

        {changePinError && (
          <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold text-center">
            {changePinError}
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={isSubmitting}
          className="min-h-[48px]"
        >
          Actualizar PIN y Entrar
        </Button>
      </form>
    </Modal>
  );
};
