import { useState, useEffect } from 'react';

export interface UseLoadStateOptions {
  isLoading: boolean;
  isError?: boolean;
  error?: Error | unknown;
  timeoutMs?: number;
  onTimeout?: () => void;
}

export interface UseLoadStateReturn {
  isLoading: boolean;
  isError: boolean;
  hasTimedOut: boolean;
  errorMessage: string;
}

/**
 * Hook para gestionar estados de carga con tiempo máximo (8 segundos por defecto).
 * Si la carga excede el tiempo límite, conmuta a estado de error con mensaje accionable.
 */
export function useLoadState({
  isLoading,
  isError = false,
  error = null,
  timeoutMs = 8000,
  onTimeout
}: UseLoadStateOptions): UseLoadStateReturn {
  const [hasTimedOut, setHasTimedOut] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setHasTimedOut(false);
      return;
    }

    const timer = setTimeout(() => {
      setHasTimedOut(true);
      onTimeout?.();
    }, timeoutMs);

    return () => clearTimeout(timer);
  }, [isLoading, timeoutMs, onTimeout]);

  const effectiveError = isError || hasTimedOut;
  const errorMessage = hasTimedOut
    ? 'Tiempo de espera agotado al conectar con el servidor (máximo 8 segundos).'
    : error instanceof Error
    ? error.message
    : typeof error === 'string'
    ? error
    : 'Error al consultar los datos del sistema';

  return {
    isLoading: isLoading && !hasTimedOut,
    isError: effectiveError,
    hasTimedOut,
    errorMessage
  };
}
