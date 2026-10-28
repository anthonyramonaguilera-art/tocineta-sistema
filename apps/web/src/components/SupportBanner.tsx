import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wrench, ShieldAlert, X, Clock, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

interface SupportStatus {
  active: boolean;
  sessionId?: string | null;
  startedByUserId?: string | null;
  startedByName?: string | null;
  startedAtMs?: number | null;
  expiresAtMs?: number | null;
  remainingSeconds: number;
  quickAssistLaunched: boolean;
  bannerText: string;
}

export const SupportBanner: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [isStopping, setIsStopping] = useState(false);

  // Consultar estado de Modo Soporte
  const { data: supportData } = useQuery<{ success: boolean; support: SupportStatus }>({
    queryKey: ['supportStatus'],
    queryFn: async () => {
      const res = await fetch('/api/support/status');
      if (!res.ok) return { success: false, support: { active: false, remainingSeconds: 0, quickAssistLaunched: false, bannerText: '' } };
      return res.json();
    },
    refetchInterval: 5000,
    staleTime: 3000
  });

  const support = supportData?.support;
  if (!support?.active) {
    return null;
  }

  const handleStopSupport = async () => {
    setIsStopping(true);
    try {
      const res = await fetch('/api/support/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['supportStatus'] });
      }
    } catch (err) {
      console.error('Error al detener modo soporte:', err);
    } finally {
      setIsStopping(false);
    }
  };

  const formatRemainingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 text-white shadow-lg border-b-2 border-amber-300/40 px-4 py-2 flex flex-wrap items-center justify-between gap-3 animate-pulse z-50">
      <div className="flex items-center gap-3">
        <div className="p-1.5 bg-black/20 rounded-lg">
          <Wrench className="w-5 h-5 text-amber-200" />
        </div>
        <div>
          <div className="text-xs sm:text-sm font-black tracking-wide uppercase flex items-center gap-2">
            <span>MODO SOPORTE TÉCNICO ACTIVO — SESIÓN AUDITADA</span>
            {support.quickAssistLaunched && (
              <span className="hidden md:inline-flex items-center gap-1 text-[10px] bg-black/30 px-2 py-0.5 rounded-full font-mono text-emerald-200">
                <CheckCircle2 className="w-3 h-3" /> Quick Assist
              </span>
            )}
          </div>
          <div className="text-[11px] text-amber-100 flex items-center gap-3">
            <span>Autorizado por: <strong>{support.startedByName || 'Administrador'}</strong></span>
            <span>•</span>
            <span className="flex items-center gap-1 font-mono font-bold">
              <Clock className="w-3 h-3" /> Expira en: {formatRemainingTime(support.remainingSeconds)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {(user?.role === 'admin' || user?.role === 'supervisor') && (
          <button
            type="button"
            disabled={isStopping}
            onClick={handleStopSupport}
            className="px-3 py-1 bg-black/40 hover:bg-black/60 active:scale-95 text-white border border-white/30 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            <span>{isStopping ? 'Cerrando...' : 'Finalizar Soporte'}</span>
          </button>
        )}
      </div>
    </div>
  );
};

interface StartSupportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StartSupportModal: React.FC<StartSupportModalProps> = ({ isOpen, onClose }) => {
  const queryClient = useQueryClient();
  const [adminPin, setAdminPin] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fallbackRequired, setFallbackRequired] = useState(false);
  const [fallbackOptions, setFallbackOptions] = useState<string[]>([]);

  if (!isOpen) return null;

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPin.length !== 6) {
      setErrorMsg('El PIN de Administrador debe tener 6 dígitos');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/support/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPin, notes })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'PIN de Administrador inválido');
      }

      queryClient.invalidateQueries({ queryKey: ['supportStatus'] });

      if (data.support?.launchStatus === 'FALLBACK_OPTIONS_REQUIRED' && data.support?.fallbackOptions?.length) {
        setFallbackRequired(true);
        setFallbackOptions(data.support.fallbackOptions);
        return;
      }

      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al iniciar modo soporte');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectFallback = async (option: string) => {
    try {
      await fetch('/api/support/fallback-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedOption: option })
      });
    } catch (err) {
      console.error('Error al registrar fallback:', err);
    }
    queryClient.invalidateQueries({ queryKey: ['supportStatus'] });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in">
      <div className="bg-tocineta-card border border-amber-500/40 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-tocineta-border pb-3">
          <div className="flex items-center gap-2">
            <Wrench className="w-6 h-6 text-amber-400 shrink-0" />
            <div>
              <h3 className="font-black text-sm text-white uppercase tracking-tight">
                Iniciar Asistencia Técnica Remota
              </h3>
              <p className="text-[11px] text-tocineta-muted">
                Sesión temporal de 2 horas con Asistencia Rápida nativa de Windows 11
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-tocineta-bg text-tocineta-muted hover:text-white flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-2xl bg-red-500/15 border border-red-500/40 text-red-300 text-xs font-bold flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {fallbackRequired ? (
          <div className="space-y-3 py-2 animate-in fade-in">
            <div className="p-3 bg-amber-500/15 border border-amber-500/40 rounded-2xl text-amber-200 text-xs font-semibold">
              <p className="font-bold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                Quick Assist no se inició automáticamente.
              </p>
              <p className="text-[11px] mt-1 text-amber-300/80">Seleccione una de las alternativas autorizadas por Soporte Técnico:</p>
            </div>
            <div className="space-y-2">
              {fallbackOptions.map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleSelectFallback(opt)}
                  className="w-full text-left p-3 rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-amber-400 text-xs font-bold text-white transition-all flex items-center justify-between group hover:bg-amber-500/10"
                >
                  <span>{opt}</span>
                  <span className="text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity">➔</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[40px] rounded-xl bg-tocineta-bg border border-tocineta-border text-tocineta-muted hover:text-white font-bold text-xs mt-2"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <form onSubmit={handleStart} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-tocineta-muted block">
                PIN de Administrador (6 dígitos):
              </label>
              <input
                type="password"
                maxLength={6}
                autoFocus
                value={adminPin}
                onChange={e => setAdminPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••"
                className="w-full min-h-[48px] bg-tocineta-bg border border-tocineta-border rounded-xl px-4 text-center font-mono font-black text-xl text-amber-400 tracking-widest outline-none focus:border-amber-400"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-tocineta-muted block">
                Motivo o Notas de Asistencia (Opcional):
              </label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Ej: Mantenimiento preventivo, revisión de impresoras..."
                className="w-full min-h-[44px] bg-tocineta-bg border border-tocineta-border rounded-xl px-3 text-xs text-white outline-none focus:border-amber-400"
              />
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 min-h-[46px] rounded-xl bg-tocineta-bg border border-tocineta-border text-tocineta-muted hover:text-white font-bold text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting || adminPin.length !== 6}
                className="flex-1 min-h-[46px] rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-black text-xs active:scale-95 transition-all disabled:opacity-40"
              >
                {isSubmitting ? 'Iniciando...' : 'Iniciar Modo Soporte'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
