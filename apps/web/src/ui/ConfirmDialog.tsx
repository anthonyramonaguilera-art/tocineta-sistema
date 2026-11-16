import React from 'react';
import { Modal } from './Modal.js';
import { Button } from './Button.js';
import { Icon } from './Icon.js';

export type ConfirmDialogVariant = 'primary' | 'danger';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'danger',
  isLoading = false,
  onConfirm,
  onCancel
}) => {
  const iconClasses =
    variant === 'danger' ? 'bg-danger/10 text-danger' : 'bg-primary/10 text-primary';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      maxWidth="sm"
      showCloseButton={false}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} autoFocus disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={isLoading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <span
          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconClasses}`}
        >
          <Icon name={variant === 'danger' ? 'AlertTriangle' : 'Info'} size={20} />
        </span>
        <p className="text-sm text-ink leading-relaxed">{message}</p>
      </div>
    </Modal>
  );
};

export default ConfirmDialog;
