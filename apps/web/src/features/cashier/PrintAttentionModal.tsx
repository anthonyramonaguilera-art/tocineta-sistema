import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../../ui/Icon.js';
import { apiFetch } from '../../api/client.js';

interface AttentionPrintJob {
  id: string;
  printer_id: string;
  printer_name: string;
  order_id: string | null;
  order_number?: number | null;
  job_type: string;
  error_message: string | null;
  attempts: number;
}

interface PrintAttentionModalProps {
  onOpenTicketPreview?: (jobId: string) => void;
}

const FAST_POLL_INTERVAL_MS = 3000;
const SLOW_POLL_INTERVAL_MS = 30000;

export const PrintAttentionModal: React.FC<PrintAttentionModalProps> = ({ onOpenTicketPreview }) => {
  const [isDocumentVisible, setIsDocumentVisible] = React.useState(
    () => typeof document === 'undefined' || !document.hidden
  );

  React.useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Consultar periódicamente si hay trabajos que requieran atención:
  // - Polling rápido (3 s) SOLO si el modal está abierto o el último resultado tiene trabajos pendientes
  // - En reposo, polling lento de 30 s
  // - Pausa si document.hidden
  const { data, refetch } = useQuery<{ data: AttentionPrintJob[] }>({
    queryKey: ['attentionPrintJobs'],
    queryFn: async () => {
      const res = await apiFetch('/api/print-jobs?status=requiere_atencion');
      if (!res.ok) return { data: [] };
      return res.json();
    },
    refetchInterval: (query) => {
      if (typeof document !== 'undefined' && document.hidden) {
        return false;
      }
      if (!isDocumentVisible) {
        return false;
      }
      const jobs = query.state.data?.data;
      const hasPendingJobs = Array.isArray(jobs) && jobs.length > 0;
      return hasPendingJobs ? FAST_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: false
  });

  const attentionJobs = data?.data || [];
  if (attentionJobs.length === 0) return null;

  const currentJob = attentionJobs[0];

  const handleResolve = async (action: 'mark_printed' | 'retry_now') => {
    try {
      const res = await apiFetch(`/api/print-jobs/${currentJob.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (res.ok) {
        refetch();
      }
    } catch (err) {
      console.error('Error al resolver alerta de impresión:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-surface border-2 border-danger rounded-3xl p-6 max-w-lg w-full space-y-5 shadow-2xl">
        
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-danger-subtle text-danger flex items-center justify-center shrink-0 animate-pulse">
            <Icon name="Printer" size={24} />
          </div>
          <div>
            <span className="text-[10px] uppercase font-black tracking-widest text-danger block">
              Alerta de Hardware Térmico
            </span>
            <h2 className="text-lg font-black text-ink">
              Impresora Requiere Atención
            </h2>
          </div>
        </div>

        <div className="bg-danger-subtle border border-danger/30 rounded-2xl p-4 space-y-2 text-xs">
          <div className="flex justify-between items-center text-tocineta-muted">
            <span>Impresora:</span>
            <span className="font-bold text-ink">{currentJob.printer_name}</span>
          </div>
          <div className="flex justify-between items-center text-tocineta-muted">
            <span>Tipo de Ticket:</span>
            <span className="font-bold text-ink uppercase">{currentJob.job_type}</span>
          </div>
          {currentJob.order_number && (
            <div className="flex justify-between items-center text-tocineta-muted">
              <span>Orden Afectada:</span>
              <span className="font-bold text-tocineta-yellow">#{currentJob.order_number}</span>
            </div>
          )}
          <div className="pt-2 border-t border-danger/20 text-danger">
            <strong>Motivo:</strong> {currentJob.error_message || 'Timeout o fallo al comunicar con la impresora térmica tras 3 reintentos.'}
          </div>
        </div>

        <p className="text-sm font-bold text-ink text-center">
          ¿Salió el ticket físico por la impresora?
        </p>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleResolve('mark_printed')}
            className="min-h-[48px] rounded-xl bg-success hover:opacity-90 text-success-ink font-bold text-xs transition-all shadow-md active:scale-95 flex items-center justify-center gap-2"
          >
            <span>✓</span> Sí, marcar impreso
          </button>

          <button
            type="button"
            onClick={() => handleResolve('retry_now')}
            className="min-h-[48px] rounded-xl bg-warning hover:opacity-90 text-warning-ink font-bold text-xs transition-all shadow-md active:scale-95 flex items-center justify-center gap-2"
          >
            <Icon name="RefreshCw" size={14} /> No, reintentar ahora
          </button>
        </div>

        {onOpenTicketPreview && (
          <div className="pt-2">
            <button
              type="button"
              onClick={() => onOpenTicketPreview(currentJob.id)}
              className="w-full min-h-[44px] rounded-xl bg-surface-alt border border-border hover:bg-surface-hover text-xs font-semibold text-ink-muted hover:text-ink transition-all flex items-center justify-center gap-2"
            >
              <Icon name="Eye" size={14} /> Ver Vista Previa del Ticket en Pantalla
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
