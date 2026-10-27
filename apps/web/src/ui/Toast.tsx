import React from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

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
  const icons: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle2 className="w-5 h-5 text-success shrink-0" />,
    error: <AlertCircle className="w-5 h-5 text-danger shrink-0" />,
    warning: <AlertTriangle className="w-5 h-5 text-warning shrink-0" />,
    info: <Info className="w-5 h-5 text-ink shrink-0" />
  };

  const borderClasses: Record<ToastType, string> = {
    success: 'border-success/40 bg-surface text-ink',
    error: 'border-danger/40 bg-surface text-ink',
    warning: 'border-warning/40 bg-surface text-ink',
    info: 'border-border bg-surface text-ink'
  };

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 p-3.5 rounded-xl border shadow-lg max-w-sm w-full ${borderClasses[type]} ${className}`.trim()}
    >
      <div className="mt-0.5">{icons[type]}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-ink leading-tight">{message}</p>
        {description && (
          <p className="text-xs text-ink-muted mt-1">{description}</p>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="text-ink-muted hover:text-ink p-1 rounded-md transition-colors"
          aria-label="Cerrar notificación"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

export default Toast;
