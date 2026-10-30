import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Icon } from '../../ui/index.js';

interface PrintJobItem {
  id: string;
  job_type: string;
  station: string | null;
  status: string;
}

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
  const [printingStatus, setPrintingStatus] = useState<Record<string, 'idle' | 'printing' | 'printed'>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: jobsRes, isLoading } = useQuery<{ data: PrintJobItem[] }>({
    queryKey: ['pendingPrintJobs', orderId],
    queryFn: async () => {
      const res = await fetch(`/api/print-jobs?orderId=${orderId}&status=pending`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error('Error al cargar trabajos pendientes');
      return res.json();
    },
    refetchInterval: 2000
  });

  const jobs = jobsRes?.data || [];

  useEffect(() => {
    if (!isLoading && jobs.length === 0) {
      onClose();
    }
  }, [isLoading, jobs.length, onClose]);

  if (isLoading || jobs.length === 0) {
    return null;
  }

  const handleReleaseJob = async (jobId: string) => {
    setPrintingStatus(prev => ({ ...prev, [jobId]: 'printing' }));
    setActionError(null);
    try {
      const res = await fetch(`/api/print-jobs/${jobId}/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Error al liberar trabajo de impresión');
      }
      setPrintingStatus(prev => ({ ...prev, [jobId]: 'printed' }));
      queryClient.invalidateQueries({ queryKey: ['pendingPrintJobs', orderId] });
      queryClient.invalidateQueries({ queryKey: ['printJobs'] });
    } catch (err: any) {
      setActionError(err.message || 'Error al imprimir');
      setPrintingStatus(prev => ({ ...prev, [jobId]: 'idle' }));
    }
  };

  const getJobButtonLabel = (job: PrintJobItem) => {
    if (job.job_type === 'NOTA_ENTREGA') {
      return 'Imprimir nota de entrega';
    }
    const station = (job.station || '').toLowerCase();
    if (station.includes('hot') || station.includes('perro')) {
      return 'Imprimir comanda Hot Dogs';
    }
    return 'Imprimir comanda Hamburguesas';
  };

  return (
    <Card variant="surface" className="p-6 border border-border space-y-4 max-w-md mx-auto my-4 shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="Printer" className="w-5 h-5 text-primary" />
          <h3 className="text-base font-bold text-ink">Impresión Pendiente — Orden #{orderNumber}</h3>
        </div>
      </div>

      {actionError && (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger">
          {actionError}
        </div>
      )}

      <div className="space-y-3">
        {jobs.map(job => {
          const status = printingStatus[job.id] || 'idle';
          const label = getJobButtonLabel(job);
          const isPrinted = status === 'printed';
          const isPrinting = status === 'printing';

          return (
            <Button
              key={job.id}
              variant={isPrinted ? 'ghost' : 'primary'}
              size="lg"
              className="w-full justify-between"
              onClick={() => handleReleaseJob(job.id)}
              disabled={isPrinting || isPrinted}
              leftIcon={isPrinted ? 'Check' : 'Printer'}
            >
              <span>{isPrinting ? 'Imprimiendo...' : isPrinted ? 'Impreso' : label}</span>
            </Button>
          );
        })}
      </div>

      <div className="flex justify-end pt-2">
        <Button variant="ghost" size="md" onClick={onClose}>
          Listo
        </Button>
      </div>
    </Card>
  );
};
