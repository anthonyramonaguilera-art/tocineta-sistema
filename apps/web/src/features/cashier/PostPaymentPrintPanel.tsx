import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Icon } from '../../ui/index.js';
import { apiFetch } from '../../api/client.js';
import { getTerminalId } from '../../lib/terminal-identity.js';
import { printJobOnDevice, printJobsOnDevice } from '../../lib/mobile-print-bridge.js';
import type { OrderPrintJob } from './useOrderPrintJobs.js';
import { getDeviceName } from './postPaymentPrintHelpers.js';
import { PostPaymentKitchenSection } from './PostPaymentKitchenSection.js';

interface PostPaymentPrintPanelProps {
  orderId: string;
  orderNumber: number;
  token?: string | null;
  onClose: () => void;
}

export const PostPaymentPrintPanel: React.FC<PostPaymentPrintPanelProps> = ({
  orderId,
  orderNumber,
  token,
  onClose
}) => {
  const queryClient = useQueryClient();
  const thisTerminalId = getTerminalId();

  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<{ message: string; jobId: string } | null>(null);

  const { data: jobsRes, isLoading } = useQuery<{ data: OrderPrintJob[] }>({
    queryKey: ['pendingPrintJobs', orderId],
    queryFn: async () => {
      const res = await apiFetch(`/api/print-jobs?orderId=${encodeURIComponent(orderId)}&limit=50`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error('Error al cargar trabajos de impresion');
      return res.json();
    },
    refetchInterval: (query) => {
      const jobs = query.state.data?.data || [];
      const hasActive = jobs.some((j) => j.status === 'en_cola' || j.status === 'imprimiendo');
      return hasActive ? 1000 : 3000;
    }
  });

  const jobs = jobsRes?.data || [];
  const notaJob = jobs.find((j) => j.job_type === 'NOTA_ENTREGA') || null;
  const kitchenJobs = jobs.filter((j) => j.job_type === 'TICKET_COCINA');

  const releaseJob = async (jobId: string) => {
    const res = await apiFetch(`/api/print-jobs/${encodeURIComponent(jobId)}/release`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.error || 'Error al liberar trabajo de impresion');
    }
  };

  const handlePrintNota = async () => {
    if (!notaJob) return;
    setIsPrinting(true);
    setActionError(null);

    try {
      if (notaJob.target === 'client') {
        if (notaJob.target_terminal_id === thisTerminalId) {
          await releaseJob(notaJob.id);
          const printRes = await printJobOnDevice(notaJob.id, { appendLineFeeds: 3 });
          if (!printRes.ok) {
            setActionError({
              message: `No se pudo imprimir en la impresora Bluetooth: ${printRes.error || 'Error de comunicación'}`,
              jobId: notaJob.id
            });
          }
        } else {
          await releaseJob(notaJob.id);
        }
      } else {
        await releaseJob(notaJob.id);
      }
      queryClient.invalidateQueries({ queryKey: ['pendingPrintJobs', orderId] });
      queryClient.invalidateQueries({ queryKey: ['printJobs'] });
    } catch (err: any) {
      setActionError({
        message: err.message || 'Error al procesar nota de entrega',
        jobId: notaJob.id
      });
    } finally {
      setIsPrinting(false);
    }
  };

  const handlePrintKitchen = async () => {
    const pendingKitchen = kitchenJobs.filter((j) => j.status === 'pending');
    if (pendingKitchen.length === 0) return;

    setIsPrinting(true);
    setActionError(null);

    try {
      for (const kj of pendingKitchen) {
        await releaseJob(kj.id);
      }

      const thisDeviceJobs = pendingKitchen.filter(
        (j) => j.target === 'client' && j.target_terminal_id === thisTerminalId
      );

      if (thisDeviceJobs.length > 0) {
        const results = await printJobsOnDevice(thisDeviceJobs.map((j) => j.id));
        const firstFail = results.find((r) => !r.ok);
        if (firstFail) {
          setActionError({
            message: `No se pudo imprimir en la impresora Bluetooth: ${firstFail.error || 'Error de comunicación'}`,
            jobId: firstFail.jobId
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ['pendingPrintJobs', orderId] });
      queryClient.invalidateQueries({ queryKey: ['printJobs'] });
    } catch (err: any) {
      setActionError({
        message: err.message || 'Error al liberar comandas de cocina',
        jobId: pendingKitchen[0]?.id || ''
      });
    } finally {
      setIsPrinting(false);
    }
  };

  const handlePrintAll = async () => {
    const pendingJobs = jobs.filter((j) => j.status === 'pending');
    if (pendingJobs.length === 0) return;

    setIsPrinting(true);
    setActionError(null);

    try {
      for (const j of pendingJobs) {
        await releaseJob(j.id);
      }

      const thisDeviceJobs = pendingJobs.filter(
        (j) => j.target === 'client' && j.target_terminal_id === thisTerminalId
      );

      // Comandas primero y nota al final
      const sorted = [...thisDeviceJobs].sort((a, b) => {
        const aIsKitchen = a.job_type === 'TICKET_COCINA';
        const bIsKitchen = b.job_type === 'TICKET_COCINA';
        if (aIsKitchen && !bIsKitchen) return -1;
        if (!aIsKitchen && bIsKitchen) return 1;
        return a.created_at_ms - b.created_at_ms;
      });

      if (sorted.length > 0) {
        const results = await printJobsOnDevice(sorted.map((j) => j.id));
        const firstFail = results.find((r) => !r.ok);
        if (firstFail) {
          setActionError({
            message: `No se pudo imprimir en la impresora Bluetooth: ${firstFail.error || 'Error de comunicación'}`,
            jobId: firstFail.jobId
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ['pendingPrintJobs', orderId] });
      queryClient.invalidateQueries({ queryKey: ['printJobs'] });
    } catch (err: any) {
      setActionError({
        message: err.message || 'Error al imprimir todo',
        jobId: pendingJobs[0]?.id || ''
      });
    } finally {
      setIsPrinting(false);
    }
  };

  const handleRetry = async () => {
    if (!actionError?.jobId) return;
    const retryJobId = actionError.jobId;
    setIsPrinting(true);
    setActionError(null);

    try {
      const res = await printJobOnDevice(retryJobId, { appendLineFeeds: 3 });
      if (!res.ok) {
        setActionError({
          message: `No se pudo imprimir en la impresora Bluetooth: ${res.error || 'Error de comunicación'}`,
          jobId: retryJobId
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ['pendingPrintJobs', orderId] });
        queryClient.invalidateQueries({ queryKey: ['printJobs'] });
      }
    } catch (err: any) {
      setActionError({
        message: err.message || 'Error durante el reintento',
        jobId: retryJobId
      });
    } finally {
      setIsPrinting(false);
    }
  };

  const handleRerouteToLaptop = async () => {
    if (!actionError?.jobId) return;
    const targetJobId = actionError.jobId;
    setIsPrinting(true);

    try {
      const res = await apiFetch(`/api/print-jobs/${encodeURIComponent(targetJobId)}/reroute`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({ to: 'server' })
      });

      if (res.status === 409) {
        setActionError({
          message: 'No hay una impresora fija disponible',
          jobId: targetJobId
        });
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError({
          message: body.message || 'Error al re-enrutar a la laptop',
          jobId: targetJobId
        });
        return;
      }

      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['pendingPrintJobs', orderId] });
      queryClient.invalidateQueries({ queryKey: ['printJobs'] });
    } catch (err: any) {
      setActionError({
        message: err.message || 'Error de conexión al re-enrutar',
        jobId: targetJobId
      });
    } finally {
      setIsPrinting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <span className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Estado del botón de nota
  const isNotaPrinted = notaJob?.status === 'impreso';
  const isNotaRequiresAttention = notaJob?.status === 'requiere_atencion';
  const isNotaOtherDevice =
    notaJob?.target === 'client' &&
    notaJob.target_terminal_id !== thisTerminalId &&
    notaJob.status !== 'pending';

  let notaLabel = 'Imprimir nota de entrega';
  if (isNotaRequiresAttention) {
    notaLabel = 'Revisar impresora';
  } else if (isNotaPrinted) {
    notaLabel = 'Impreso';
  } else if (isNotaOtherDevice && notaJob) {
    notaLabel = `Se imprimirá en ${getDeviceName(notaJob.target_terminal_id, notaJob.printer_name)}`;
  } else if (notaJob?.status === 'en_cola' || notaJob?.status === 'imprimiendo') {
    notaLabel = 'Imprimiendo...';
  }

  const hasAnyPending = jobs.some((j) => j.status === 'pending');

  return (
    <Card variant="surface" className="p-6 border border-border space-y-4 max-w-md mx-auto my-4 shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="Printer" className="w-5 h-5 text-primary" />
          <h3 className="text-base font-bold text-ink">Impresion — Orden #{orderNumber}</h3>
        </div>
      </div>

      {actionError && (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl space-y-2">
          <p className="text-xs font-bold text-danger">{actionError.message}</p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="min-h-[48px] flex-1 text-xs"
              onClick={handleRetry}
              disabled={isPrinting}
            >
              Reintentar
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="min-h-[48px] flex-1 text-xs"
              onClick={handleRerouteToLaptop}
              disabled={isPrinting}
            >
              Imprimir en la laptop
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Botón Nota de Entrega */}
        {notaJob && (
          <Button
            variant={isNotaPrinted ? 'ghost' : 'primary'}
            size="lg"
            className="w-full justify-between min-h-[48px]"
            onClick={handlePrintNota}
            disabled={isPrinting || isNotaPrinted || isNotaRequiresAttention || isNotaOtherDevice}
            leftIcon={isNotaPrinted ? 'Check' : isNotaRequiresAttention ? 'AlertTriangle' : 'Printer'}
          >
            <span>{notaLabel}</span>
          </Button>
        )}

        {/* Botón Único de Comanda en Cocina */}
        <PostPaymentKitchenSection
          kitchenJobs={kitchenJobs}
          isPrinting={isPrinting}
          thisTerminalId={thisTerminalId}
          actionErrorJobId={actionError?.jobId}
          onPrintKitchen={handlePrintKitchen}
        />
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border">
        {hasAnyPending ? (
          <Button
            variant="secondary"
            size="md"
            className="min-h-[48px]"
            onClick={handlePrintAll}
            disabled={isPrinting}
            leftIcon="Printer"
          >
            {isPrinting ? 'Imprimiendo todo...' : 'Imprimir todo'}
          </Button>
        ) : (
          <div />
        )}
        <Button variant="ghost" size="md" className="min-h-[48px]" onClick={onClose}>
          Listo
        </Button>
      </div>
    </Card>
  );
};
