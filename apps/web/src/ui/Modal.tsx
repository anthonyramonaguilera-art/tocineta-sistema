import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | 'express';
  showCloseButton?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 'md',
  showCloseButton = true
}) => {
  useEffect(() => {
    if (!isOpen) return;

    // Bloqueo de scroll del fondo (evita que el fondo se mueva al hacer scroll en móvil)
    const originalOverflow = document.body.style.overflow;
    const originalTouchAction = document.body.style.touchAction;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.touchAction = originalTouchAction;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthClasses = {
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-md',
    lg: 'sm:max-w-lg',
    xl: 'sm:max-w-xl',
    express: 'sm:max-w-[560px]'
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center overscroll-contain"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/60 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal / BottomSheet Container */}
      <div
        className={`relative z-10 w-full bg-surface text-ink rounded-t-2xl sm:rounded-2xl border border-border shadow-2xl flex flex-col max-h-[90vh] sm:max-h-[85vh] ${maxWidthClasses[maxWidth]} overflow-hidden animate-in fade-in slide-in-from-bottom duration-200 overscroll-contain`}
      >
        {/* Mobile drag handle indicator */}
        <div className="w-12 h-1.5 bg-border rounded-full mx-auto mt-2.5 sm:hidden" />

        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
            <div>
              {title && typeof title === 'string' ? (
                <h2 className="text-lg font-bold text-ink leading-tight">{title}</h2>
              ) : (
                title
              )}
              {description && (
                <p className="text-xs text-ink-muted mt-0.5">{description}</p>
              )}
            </div>
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors"
                aria-label="Cerrar modal"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* Scrollable Content */}
        <div className="p-5 overflow-y-auto flex-1">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="p-4 border-t border-border bg-surface-alt flex items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
