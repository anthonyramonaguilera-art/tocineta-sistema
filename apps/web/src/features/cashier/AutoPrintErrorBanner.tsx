import React from 'react';
import { Button, Icon } from '../../ui/index.js';

interface AutoPrintErrorBannerProps {
  errorMessage: string | null;
  onRetry: () => void;
  onReroute: () => void;
  onClose?: () => void;
}

export const AutoPrintErrorBanner: React.FC<AutoPrintErrorBannerProps> = ({
  errorMessage,
  onRetry,
  onReroute,
  onClose
}) => {
  if (!errorMessage) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 p-4 bg-surface border border-danger/40 rounded-2xl shadow-2xl max-w-sm space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Icon name="AlertTriangle" className="w-5 h-5 text-danger shrink-0 mt-0.5" />
          <p className="text-xs font-bold text-ink">{errorMessage}</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-ink-muted hover:text-ink p-1 cursor-pointer"
            aria-label="Cerrar aviso"
          >
            <Icon name="X" size={16} />
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="min-h-[48px] flex-1 text-xs font-bold"
          onClick={onRetry}
        >
          Reintentar
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="min-h-[48px] flex-1 text-xs font-bold"
          onClick={onReroute}
        >
          Imprimir en la laptop
        </Button>
      </div>
    </div>
  );
};
