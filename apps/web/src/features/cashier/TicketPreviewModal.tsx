import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../../ui/Icon.js';
import { apiFetch } from '../../api/client.js';

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
      const res = await apiFetch(`/api/print-jobs/${jobId}/preview`);
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
      const res = await apiFetch(`/api/print-jobs/${jobId}/reprint`, {
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
    <div className="fixed inset-0 z-50 bg-ink/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-surface border border-border rounded-3xl max-w-md w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* HEADER MODAL */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-surface-alt">
          <div className="flex items-center gap-2">
            <Icon name="Receipt" size={20} />
            <div>
              <h3 className="text-sm font-black text-ink">Vista Previa de Ticket Térmico</h3>
              <p className="text-[10px] text-tocineta-muted">Representación idéntica al cabezal 58mm</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface hover:bg-surface-hover text-ink flex items-center justify-center text-sm font-bold transition-all border border-border"
          >
            ✕
          </button>
        </div>

        {/* CONTENIDO DEL TICKET */}
        <div className="p-4 overflow-y-auto flex-1 bg-surface-alt flex items-center justify-center">
          {isLoading ? (
            <div className="p-8 text-center text-tocineta-muted text-xs">Cargando ticket...</div>
          ) : data?.html ? (
            <div
              className="ticket-html-wrapper bg-surface text-ink p-4 rounded-xl border border-border shadow-md"
              dangerouslySetInnerHTML={{ __html: data.html }}
            />
          ) : (
            <div className="p-8 text-center text-danger text-xs">No se encontró contenido para este ticket.</div>
          )}
        </div>

        {/* FORMULARIO DE REIMPRESIÓN O BOTONES */}
        <div className="p-4 border-t border-border bg-surface-alt space-y-3">
          {actionMessage && (
            <div className={`p-2.5 rounded-xl text-xs font-bold text-center ${
              actionMessage.startsWith('✓') ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger'
            }`}>
              {actionMessage}
            </div>
          )}

          {showReprintForm ? (
            <form onSubmit={handleReprint} className="space-y-3 animate-in fade-in">
              <div className="text-xs font-bold text-ink">Autorizar Reimpresión Manual</div>
              
              <input
                type="password"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="PIN Cajera o Supervisor (4-6 dígitos)"
                className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs text-ink placeholder-ink-muted outline-none focus:border-primary font-mono"
                required
              />

              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Motivo (ej. Atasco de papel, cliente solicita copia)"
                className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs text-ink placeholder-ink-muted outline-none focus:border-primary"
                required
              />

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 min-h-[44px] rounded-xl bg-tocineta-yellow text-primary-ink font-black text-xs hover:bg-tocineta-yellow-hover active:scale-95 transition-all shadow-md disabled:opacity-50"
                >
                  {isSubmitting ? 'Encolando...' : 'Confirmar Reimpresión'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowReprintForm(false)}
                  className="px-4 rounded-xl bg-surface hover:bg-surface-hover text-ink font-bold text-xs transition-all border border-border"
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
                className="flex-1 min-h-[44px] rounded-xl bg-tocineta-yellow text-primary-ink font-black text-xs hover:bg-tocineta-yellow-hover active:scale-95 transition-all shadow-md flex items-center justify-center gap-2"
              >
                <Icon name="Printer" size={16} /> Solicitar Reimpresión
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-5 rounded-xl bg-surface hover:bg-surface-hover text-ink font-bold text-xs transition-all border border-border"
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
