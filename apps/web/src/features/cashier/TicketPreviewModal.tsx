import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../../ui/Icon.js';

interface TicketPreviewModalProps {
  jobId: string;
  onClose: () => void;
}

export const TicketPreviewModal: React.FC<TicketPreviewModalProps> = ({ jobId, onClose }) => {
  const [showReprintForm, setShowReprintForm] = useState(false);
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Consultar vista previa HTML del ticket
  const { data, isLoading } = useQuery<{ html: string; id: string; jobType: string }>({
    queryKey: ['ticketPreview', jobId],
    queryFn: async () => {
      const res = await fetch(`/api/print-jobs/${jobId}/preview`);
      if (!res.ok) throw new Error('No se pudo cargar la vista previa del ticket');
      return res.json();
    }
  });

  const handleReprint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || !reason) return;

    setIsSubmitting(true);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/print-jobs/${jobId}/reprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, reason })
      });

      const resData = await res.json();
      if (res.ok) {
        setActionMessage('✓ Trabajo de reimpresión encolado exitosamente.');
        setShowReprintForm(false);
        setPin('');
        setReason('');
      } else {
        setActionMessage(`Error: ${resData.message || 'No autorizado'}`);
      }
    } catch (err: any) {
      setActionMessage(`Error de conexión: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-[#12141A] border border-tocineta-border rounded-3xl max-w-md w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* HEADER MODAL */}
        <div className="p-4 border-b border-tocineta-border flex items-center justify-between bg-black/40">
          <div className="flex items-center gap-2">
            <Icon name="Receipt" size={20} />
            <div>
              <h3 className="text-sm font-black text-white">Vista Previa de Ticket Térmico</h3>
              <p className="text-[10px] text-tocineta-muted">Representación idéntica al cabezal 58mm</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm font-bold transition-all"
          >
            ✕
          </button>
        </div>

        {/* CONTENIDO DEL TICKET */}
        <div className="p-4 overflow-y-auto flex-1 bg-[#1a1d24] flex items-center justify-center">
          {isLoading ? (
            <div className="p-8 text-center text-tocineta-muted text-xs">Cargando ticket...</div>
          ) : data?.html ? (
            <div
              className="ticket-html-wrapper"
              dangerouslySetInnerHTML={{ __html: data.html }}
            />
          ) : (
            <div className="p-8 text-center text-red-400 text-xs">No se encontró contenido para este ticket.</div>
          )}
        </div>

        {/* FORMULARIO DE REIMPRESIÓN O BOTONES */}
        <div className="p-4 border-t border-tocineta-border bg-black/40 space-y-3">
          {actionMessage && (
            <div className={`p-2.5 rounded-xl text-xs font-bold text-center ${
              actionMessage.startsWith('✓') ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
            }`}>
              {actionMessage}
            </div>
          )}

          {showReprintForm ? (
            <form onSubmit={handleReprint} className="space-y-3 animate-in fade-in">
              <div className="text-xs font-bold text-white">Autorizar Reimpresión Manual</div>
              
              <input
                type="password"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="PIN Cajera o Supervisor (4-6 dígitos)"
                className="w-full bg-black/60 border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none focus:border-tocineta-yellow font-mono"
                required
              />

              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Motivo (ej. Atasco de papel, cliente solicita copia)"
                className="w-full bg-black/60 border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none focus:border-tocineta-yellow"
                required
              />

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 min-h-[44px] rounded-xl bg-tocineta-yellow text-tocineta-bg font-black text-xs hover:bg-tocineta-yellow-hover active:scale-95 transition-all shadow-md disabled:opacity-50"
                >
                  {isSubmitting ? 'Encolando...' : 'Confirmar Reimpresión'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowReprintForm(false)}
                  className="px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowReprintForm(true)}
                className="flex-1 min-h-[44px] rounded-xl bg-tocineta-yellow text-tocineta-bg font-black text-xs hover:bg-tocineta-yellow-hover active:scale-95 transition-all shadow-md flex items-center justify-center gap-2"
              >
                <Icon name="Printer" size={16} /> Solicitar Reimpresión
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all"
              >
                Cerrar
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
