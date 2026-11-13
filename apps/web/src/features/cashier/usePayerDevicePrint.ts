import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../../api/client.js';
import { getTerminalId } from '../../lib/terminal-identity.js';
import { printJobsOnDevice, printJobOnDevice } from '../../lib/mobile-print-bridge.js';
import type { OrderPrintJob } from './useOrderPrintJobs.js';

export interface UsePayerDevicePrintState {
  status: 'idle' | 'querying' | 'printing' | 'printed' | 'error';
  errorMessage: string | null;
  failedJobId: string | null;
  isPrinting: boolean;
  isPrinted: boolean;
  retry: () => Promise<void>;
  rerouteToServer: (jobId?: string) => Promise<void>;
  clearError: () => void;
}

export function usePayerDevicePrint(
  orderId: string | null | undefined,
  token?: string | null
): UsePayerDevicePrintState {
  const [status, setStatus] = useState<'idle' | 'querying' | 'printing' | 'printed' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failedJobId, setFailedJobId] = useState<string | null>(null);
  const processedOrderRef = useRef<string | null>(null);

  const executePrint = useCallback(async (targetOrderId: string) => {
    setStatus('querying');
    setErrorMessage(null);
    setFailedJobId(null);

    const thisTerminalId = getTerminalId();
    let jobs: OrderPrintJob[] = [];

    // Reintenta hasta 3 veces cada 1 s
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await apiFetch(`/api/print-jobs?orderId=${encodeURIComponent(targetOrderId)}&limit=50`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (res.ok) {
          const body = await res.json();
          const list = (body?.data || []) as OrderPrintJob[];
          const clientJobs = list.filter(
            (j) => j.target === 'client' && j.status === 'en_cola' && j.target_terminal_id === thisTerminalId
          );
          if (clientJobs.length > 0) {
            jobs = clientJobs;
            break;
          }
        }
      } catch {
        // Reintentar en siguiente ciclo
      }

      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (jobs.length === 0) {
      setStatus('idle');
      return;
    }

    // Orden: comandas primero y nota al final
    const sorted = [...jobs].sort((a, b) => {
      const aIsKitchen = a.job_type === 'TICKET_COCINA';
      const bIsKitchen = b.job_type === 'TICKET_COCINA';
      if (aIsKitchen && !bIsKitchen) return -1;
      if (!aIsKitchen && bIsKitchen) return 1;
      return a.created_at_ms - b.created_at_ms;
    });

    setStatus('printing');
    const results = await printJobsOnDevice(sorted.map((j) => j.id));
    const firstFail = results.find((r) => !r.ok);

    if (firstFail) {
      setStatus('error');
      setFailedJobId(firstFail.jobId);
      setErrorMessage(
        `No se pudo imprimir en la impresora Bluetooth: ${firstFail.error || 'Error de comunicación'}`
      );
    } else {
      setStatus('printed');
    }
  }, [token]);

  useEffect(() => {
    if (!orderId) {
      setStatus('idle');
      setErrorMessage(null);
      setFailedJobId(null);
      return;
    }

    if (processedOrderRef.current === orderId) {
      return;
    }

    processedOrderRef.current = orderId;
    void executePrint(orderId);
  }, [orderId, executePrint]);

  const retry = useCallback(async () => {
    if (!failedJobId && !orderId) return;
    setStatus('printing');
    setErrorMessage(null);

    if (failedJobId) {
      const res = await printJobOnDevice(failedJobId, { appendLineFeeds: 3 });
      if (res.ok) {
        setStatus('printed');
        setFailedJobId(null);
      } else {
        setStatus('error');
        setErrorMessage(
          `No se pudo imprimir en la impresora Bluetooth: ${res.error || 'Error de comunicación'}`
        );
      }
    } else if (orderId) {
      await executePrint(orderId);
    }
  }, [failedJobId, orderId, executePrint]);

  const rerouteToServer = useCallback(async (jobId?: string) => {
    const targetJobId = jobId || failedJobId;
    if (!targetJobId) return;

    try {
      const res = await apiFetch(`/api/print-jobs/${encodeURIComponent(targetJobId)}/reroute`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({ to: 'server' })
      });

      if (res.status === 409) {
        setStatus('error');
        setErrorMessage('No hay una impresora fija disponible');
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatus('error');
        setErrorMessage(body.message || 'Error al re-enrutar a la laptop');
        return;
      }

      setStatus('printed');
      setErrorMessage(null);
      setFailedJobId(null);
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err.message || 'Error de red al re-enrutar');
    }
  }, [failedJobId, token]);

  const clearError = useCallback(() => {
    setErrorMessage(null);
    setFailedJobId(null);
    setStatus('idle');
  }, []);

  return {
    status,
    errorMessage,
    failedJobId,
    isPrinting: status === 'printing' || status === 'querying',
    isPrinted: status === 'printed',
    retry,
    rerouteToServer,
    clearError
  };
}
