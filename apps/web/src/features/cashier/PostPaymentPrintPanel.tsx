import React, { useState } from 'react';
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
  const [isBulkPrinting, setIsBulkPrinting] = useState<boolean>(false);

  const { data: jobsRes, isLoading } = useQuery<{ data: PrintJobItem[] }>({
    queryKey: ['pendingPrintJobs', orderId],
    queryFn: async () => {
      const res = await fetch(`/api/print-jobs?orderId=${orderId}&limit=20`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error('Error al cargar trabajos de impresion');
      return res.json();
    },
    refetchInterval: (query) => {
      const jobs = query.state.data?.data || [];
      const hasActive = jobs.some(j => j.status === 'en_cola' || j.status === 'imprimiendo');
      return hasActive ? 1000 : 3000;
    }
  });

  const jobs = jobsRes?.data || [];

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <span className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
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
        throw new Error(errData.message || errData.error || 'Error al liberar trabajo de impresion');
      }
      setPrintingStatus(prev => ({ ...prev, [jobId]: 'printed' }));
      queryClient.invalidateQueries({ queryKey: ['pendingPrintJobs', orderId] });
      queryClient.invalidateQueries({ queryKey: ['printJobs'] });
    } catch (err: any) {
      setActionError(err.message || 'Error al imprimir');
      setPrintingStatus(prev => ({ ...prev, [jobId]: 'idle' }));
    }
  };

  const handlePrintAll = async () => {
    const pendingJobs = jobs.filter(j => j.status === 'pending' && printingStatus[j.id] !== 'printed');
    if (pendingJobs.length === 0) return;

    setIsBulkPrinting(true);
    setActionError(null);

    for (const job of pendingJobs) {
      await handleReleaseJob(job.id);
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    setIsBulkPrinting(false);
  };

  const getJobButtonLabel = (job: PrintJobItem) => {
    if (job.job_type === 'NOTA_ENTREGA') {
      return 'Imprimir nota de entrega';
    }
    const station = (job.station || '').toLowerCase();
    if (station.includes('hot') || station.includes('perro')) {
      return 'Imprimir comanda Hot Dogs';
    }
    if (station.includes('hamburguesa') || station.includes('burguer')) {
      return 'Imprimir comanda Hamburguesas';
    }
    return 'Imprimir comanda';
  };

  const hasPending = jobs.some(j => j.status === 'pending');

  return (
    <Card variant="surface" className="p-6 border border-border space-y-4 max-w-md mx-auto my-4 shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="Printer" className="w-5 h-5 text-primary" />
          <h3 className="text-base font-bold text-ink">Impresion — Orden #{orderNumber}</h3>
        </div>
      </div>

      {actionError && (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger">
          {actionError}
        </div>
      )}

      <div className="space-y-3">
        {jobs.map(job => {
          const localStatus = printingStatus[job.id] || 'idle';
          const isPrinted = job.status === 'impreso' || localStatus === 'printed';
          const isPrinting = job.status === 'en_cola' || job.status === 'imprimiendo' || localStatus === 'printing';
          const isRequiresAttention = job.status === 'requiere_atencion';
          const label = isRequiresAttention
            ? 'Revisar impresora'
            : isPrinted
            ? 'Impreso'
            : isPrinting
            ? 'Imprimiendo...'
            : getJobButtonLabel(job);

          return (
            <Button
              key={job.id}
              variant={isPrinted ? 'ghost' : 'primary'}
              size="lg"
              className="w-full justify-between min-h-[48px]"
              onClick={() => handleReleaseJob(job.id)}
              disabled={isPrinting || isPrinted || isRequiresAttention}
              leftIcon={isPrinted ? 'Check' : isRequiresAttention ? 'AlertTriangle' : 'Printer'}
            >
              <span>{label}</span>
            </Button>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border">
        {hasPending ? (
          <Button
            variant="secondary"
            size="md"
            className="min-h-[48px]"
            onClick={handlePrintAll}
            disabled={isBulkPrinting}
            leftIcon="Printer"
          >
            {isBulkPrinting ? 'Imprimiendo todo...' : 'Imprimir todo'}
          </Button>
        ) : <div />}
        <Button variant="ghost" size="md" className="min-h-[48px]" onClick={onClose}>
          Listo
        </Button>
      </div>
    </Card>
  );
};
