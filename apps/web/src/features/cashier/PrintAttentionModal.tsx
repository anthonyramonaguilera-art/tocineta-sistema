import React from 'react';
import { useQuery } from '@tanstack/react-query';

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

export const PrintAttentionModal: React.FC<PrintAttentionModalProps> = ({ onOpenTicketPreview }) => {
  // Consultar periódicamente si hay trabajos que requieran atención
  const { data, refetch } = useQuery<{ data: AttentionPrintJob[] }>({
    queryKey: ['attentionPrintJobs'],
    queryFn: async () => {
      const res = await fetch('/api/print-jobs?status=requiere_atencion');
      if (!res.ok) return { data: [] };
      return res.json();
    },
    refetchInterval: 3000
  });

  const attentionJobs = data?.data || [];
  if (attentionJobs.length === 0) return null;

  const currentJob = attentionJobs[0];

  const handleResolve = async (action: 'mark_printed' | 'retry_now') => {
    try {
      const res = await fetch(`/api/print-jobs/${currentJob.id}/resolve`, {
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
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-[#12141A] border-2 border-red-500 rounded-3xl p-6 max-w-lg w-full space-y-5 shadow-2xl shadow-red-950/50">
        
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-red-500/20 text-red-500 flex items-center justify-center text-2xl font-black shrink-0 animate-pulse">
            🖨️
          </div>
          <div>
            <span className="text-[10px] uppercase font-black tracking-widest text-red-400 block">
              Alerta de Hardware Térmico
            </span>
            <h2 className="text-lg font-black text-white">
              Impresora Requiere Atención
            </h2>
          </div>
        </div>

        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 space-y-2 text-xs">
          <div className="flex justify-between items-center text-tocineta-muted">
            <span>Impresora:</span>
            <span className="font-bold text-white">{currentJob.printer_name}</span>
          </div>
          <div className="flex justify-between items-center text-tocineta-muted">
            <span>Tipo de Ticket:</span>
            <span className="font-bold text-white uppercase">{currentJob.job_type}</span>
          </div>
          {currentJob.order_number && (
            <div className="flex justify-between items-center text-tocineta-muted">
              <span>Orden Afectada:</span>
              <span className="font-bold text-tocineta-yellow">#{currentJob.order_number}</span>
            </div>
          )}
          <div className="pt-2 border-t border-red-500/20 text-red-200">
            <strong>Motivo:</strong> {currentJob.error_message || 'Timeout o fallo al comunicar con la impresora térmica tras 3 reintentos.'}
          </div>
        </div>

        <p className="text-sm font-bold text-white text-center">
          ¿Salió el ticket físico por la impresora?
        </p>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleResolve('mark_printed')}
            className="min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all shadow-md active:scale-95 flex items-center justify-center gap-2"
          >
            <span>✓</span> Sí, marcar impreso
          </button>

          <button
            type="button"
            onClick={() => handleResolve('retry_now')}
            className="min-h-[48px] rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition-all shadow-md active:scale-95 flex items-center justify-center gap-2"
          >
            <span>🔄</span> No, reintentar ahora
          </button>
        </div>

        {onOpenTicketPreview && (
          <div className="pt-2">
            <button
              type="button"
              onClick={() => onOpenTicketPreview(currentJob.id)}
              className="w-full min-h-[44px] rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-semibold text-tocineta-muted hover:text-white transition-all flex items-center justify-center gap-2"
            >
              <span>👁️</span> Ver Vista Previa del Ticket en Pantalla
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
