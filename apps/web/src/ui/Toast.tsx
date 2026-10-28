import React from 'react';
import { Icon, type IconName } from './Icon.js';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastProps {
  type?: ToastType;
  message: string;
  description?: string;
  onClose?: () => void;
  className?: string;
}

export const Toast: React.FC<ToastProps> = ({
  type = 'info',
  message,
  description,
  onClose,
  className = ''
}) => {
  const iconNames: Record<ToastType, IconName> = {
    success: 'CheckCircle2',
    error: 'AlertCircle',
    warning: 'AlertTriangle',
    info: 'Info'
  };

  const borderClasses: Record<ToastType, string> = {
    success: 'border-success/40 bg-surface text-ink',
    error: 'border-danger/40 bg-surface text-ink',
    warning: 'border-warning/40 bg-surface text-ink',
    info: 'border-border bg-surface text-ink'
  };

  const iconColors: Record<ToastType, string> = {
    success: 'text-success',
    error: 'text-danger',
    warning: 'text-warning',
    info: 'text-ink'
  };

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 p-3.5 rounded-xl border shadow-lg max-w-sm w-full select-none ${borderClasses[type]} ${className}`.trim()}
    >
      <div className="mt-0.5 shrink-0">
        <Icon name={iconNames[type]} size={20} className={iconColors[type]} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-ink leading-tight">{message}</p>
        {description && (
          <p className="text-xs text-ink-muted mt-1 leading-normal">{description}</p>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="text-ink-muted hover:text-ink p-1 rounded-md transition-colors shrink-0 cursor-pointer"
          aria-label="Cerrar notificación"
        >
          <Icon name="X" size={16} />
        </button>
      )}
    </div>
  );
};

export interface ToastContainerProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Contenedor estándar para Toasts.
 * Se ubica exactamente por debajo de la cabecera (56px + safe-area) y a la derecha,
 * impidiendo que solape el botón del menú de navegación lateral.
 */
export const ToastContainer: React.FC<ToastContainerProps> = ({ children, className = '' }) => {
  return (
    <aside
      aria-live="polite"
      className={`fixed top-[calc(56px+env(safe-area-inset-top,0px)+8px)] right-3 left-3 sm:left-auto sm:right-4 z-40 max-w-sm pointer-events-auto flex flex-col gap-2 animate-in slide-in-from-top duration-200 ${className}`.trim()}
    >
      {children}
    </aside>
  );
};

export default Toast;
