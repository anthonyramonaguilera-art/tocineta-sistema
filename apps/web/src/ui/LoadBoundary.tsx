import React from 'react';
import { Icon, type IconName } from './Icon.js';
import { Button } from './Button.js';
import { EmptyState } from './EmptyState.js';
import { useLoadState } from './useLoadState.js';

export interface LoadBoundaryProps {
  isLoading: boolean;
  isError?: boolean;
  error?: Error | unknown;
  isEmpty?: boolean;
  loadingMessage?: string;
  errorMessage?: string;
  emptyMessage?: string;
  emptyDescription?: string;
  emptyIcon?: IconName;
  onRetry?: () => void;
  timeoutMs?: number;
  children: React.ReactNode;
}

export const LoadBoundary: React.FC<LoadBoundaryProps> = ({
  isLoading,
  isError = false,
  error = null,
  isEmpty = false,
  loadingMessage = 'Cargando datos...',
  errorMessage,
  emptyMessage = 'No hay registros disponibles',
  emptyDescription = 'Cuando se agreguen datos al sistema, aparecerán aquí.',
  emptyIcon = 'Inbox',
  onRetry,
  timeoutMs = 8000,
  children
}) => {
  const state = useLoadState({
    isLoading,
    isError,
    error,
    timeoutMs
  });

  if (state.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 gap-3 text-center">
        <Icon name="RefreshCw" size={32} className="animate-spin text-primary" />
        <p className="text-sm font-bold text-ink">{loadingMessage}</p>
        <span className="text-[11px] text-ink-muted">Conectando con el servidor local...</span>
      </div>
    );
  }

  if (state.isError) {
    return (
      <div className="p-6 my-6 max-w-lg mx-auto bg-surface border border-danger/40 rounded-2xl text-center space-y-3 shadow-sm">
        <div className="w-12 h-12 mx-auto rounded-full bg-danger/10 text-danger flex items-center justify-center">
          <Icon name="AlertTriangle" size={24} />
        </div>
        <h3 className="text-base font-black text-ink">Error de Conexión</h3>
        <p className="text-xs text-ink-muted max-w-sm mx-auto">
          {errorMessage || state.errorMessage}
        </p>
        {onRetry && (
          <div className="pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onRetry}
              leftIcon={<Icon name="RotateCcw" size={14} />}
            >
              Reintentar
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="py-8 px-4 text-center">
        <EmptyState
          icon={emptyIcon}
          title={emptyMessage}
          description={emptyDescription}
          action={
            onRetry ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Actualizar
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return <>{children}</>;
};

export default LoadBoundary;
