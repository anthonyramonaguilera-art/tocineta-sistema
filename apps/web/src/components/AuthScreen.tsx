import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.js';
import { FaithBanner } from './FaithBanner.js';
import { UserPlus, ArrowLeft, Lock } from 'lucide-react';

interface PublicUser {
  id: string;
  name: string;
  role: 'admin' | 'supervisor' | 'cajera' | 'mesonero' | 'cocinero' | 'despachador';
  pinLength: number;
  isLocked: boolean;
  lockoutRemainingMs: number;
}

const roleBadgeColors: Record<string, { bg: string; text: string; label: string }> = {
  admin: { bg: 'bg-red-500/20 border-red-500/40', text: 'text-red-400', label: 'Dueña / Admin' },
  supervisor: { bg: 'bg-purple-500/20 border-purple-500/40', text: 'text-purple-400', label: 'Supervisor' },
  cajera: { bg: 'bg-emerald-500/20 border-emerald-500/40', text: 'text-emerald-400', label: 'Cajera' },
  mesonero: { bg: 'bg-amber-500/20 border-amber-500/40', text: 'text-amber-400', label: 'Comandero / Mesonero' },
  cocinero: { bg: 'bg-blue-500/20 border-blue-500/40', text: 'text-blue-400', label: 'Cocina' },
  despachador: { bg: 'bg-cyan-500/20 border-cyan-500/40', text: 'text-cyan-400', label: 'Despacho' }
};

export const AuthScreen: React.FC = () => {
  const { login } = useAuth();
  const [selectedUser, setSelectedUser] = useState<PublicUser | null>(null);
  const [pin, setPin] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [isRegistering, setIsRegistering] = useState(false);
  const [registeredSuccess, setRegisteredSuccess] = useState(false);
  const [regName, setRegName] = useState('');
  const [regCedula, setRegCedula] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  const { data, refetch } = useQuery<{ success: boolean; users: PublicUser[] }>({
    queryKey: ['publicUsers'],
    queryFn: async () => {
      const res = await fetch('/api/auth/users-public');
      return res.json();
    },
    refetchInterval: 10000
  });

  const users = data?.users || [];

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regCedula.trim() || !regPassword.trim()) {
      setRegError('Por favor complete su nombre, cédula y contraseña / PIN.');
      return;
    }
    setRegLoading(true);
    setRegError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName.trim(),
          cedula: regCedula.trim(),
          phone: regPhone.trim(),
          password: regPassword.trim(),
          pin: regPassword.trim().slice(0, 4)
        })
      });
      const resData = await res.json();
      if (!res.ok || !resData.success) {
        setRegError(resData.message || resData.error || 'Error al procesar el registro');
        return;
      }
      setRegisteredSuccess(true);
    } catch {
      setRegError('Error de conexión LAN con el Food Truck');
    } finally {
      setRegLoading(false);
    }
  };

  useEffect(() => {
    setPin('');
    setErrorMessage(null);
  }, [selectedUser]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedUser || isLoading || isRegistering) return;
      if (/^[0-9]$/.test(e.key)) {
        appendDigit(e.key);
      } else if (e.key === 'Backspace') {
        deleteDigit();
      } else if (e.key === 'Escape') {
        clearPin();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedUser, pin, isLoading, isRegistering]);

  const appendDigit = (digit: string) => {
    if (!selectedUser) return;
    if (pin.length < selectedUser.pinLength) {
      const nextPin = pin + digit;
      setPin(nextPin);
      setErrorMessage(null);
      if (nextPin.length === selectedUser.pinLength) {
        submitLogin(selectedUser.id, nextPin);
      }
    }
  };

  const deleteDigit = () => {
    setPin(prev => prev.slice(0, -1));
    setErrorMessage(null);
  };

  const clearPin = () => {
    setPin('');
    setErrorMessage(null);
  };

  const submitLogin = async (userId: string, pinToSubmit: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    const result = await login(userId, pinToSubmit);
    setIsLoading(false);
    if (!result.success) {
      setErrorMessage(result.error || 'PIN incorrecto');
      setPin('');
      refetch();
    }
  };

  return (
    <div className="min-h-screen bg-tocineta-bg text-white flex flex-col select-none">
      <FaithBanner />
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2.5 bg-gradient-to-r from-[#14171F] to-[#181C26] px-5 py-2.5 rounded-full border border-neutral-700/80 shadow-xl shadow-black/50 mb-3">
            <div className="w-6 h-6 rounded-lg bg-[#FFE600]/15 border border-[#FFE600]/30 flex items-center justify-center text-[#FFE600]">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 11a8 8 0 0 1 16 0H4z" />
                <path d="M4 14h16" />
                <rect x="4" y="18" width="16" height="3" rx="1.5" />
              </svg>
            </div>
            <span className="font-black text-sm tracking-widest text-[#FFE600]">TOCINETA SONRÍE</span>
            <span className="bg-neutral-800/90 border border-neutral-700/60 px-2.5 py-0.5 rounded-full text-[10px] text-neutral-300 font-mono font-bold">LAN POS</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
            {isRegistering ? 'Registro de Nuevo Trabajador' : 'Inicio de Sesión Operativo'}
          </h1>
          <p className="text-sm text-tocineta-muted mt-1">
            {isRegistering
              ? 'Ingresa tus datos para solicitar acceso al equipo del Food Truck'
              : 'Selecciona tu usuario e ingresa tu PIN de acceso'}
          </p>
          {!isRegistering ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => {
                  setIsRegistering(true);
                  setRegisteredSuccess(false);
                  setRegError(null);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold transition shadow-sm"
              >
                <UserPlus className="w-4 h-4" />
                <span>¿Eres nuevo en el equipo? Regístrate aquí</span>
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => {
                  setIsRegistering(false);
                  setRegisteredSuccess(false);
                  setRegError(null);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 text-xs font-bold transition"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Volver al Inicio de Sesión</span>
              </button>
            </div>
          )}
        </div>

        {isRegistering ? (
          <div className="w-full max-w-md bg-tocineta-card border border-tocineta-border rounded-2xl p-6 shadow-2xl">
            {registeredSuccess ? (
              <div className="text-center py-6 space-y-4">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center text-3xl mx-auto">
                  ✓
                </div>
                <h3 className="text-lg font-bold text-white">¡Solicitud Enviada con Éxito!</h3>
                <p className="text-xs text-tocineta-muted leading-relaxed">
                  Tu cuenta está en espera de aprobación. La Sra. Olinelcys recibirá la notificación en su pantalla.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setIsRegistering(false);
                    setRegisteredSuccess(false);
                    refetch();
                  }}
                  className="w-full min-h-[44px] bg-tocineta-yellow hover:bg-tocineta-yellow/90 text-black font-bold rounded-xl text-xs transition"
                >
                  Volver a Pantalla de Acceso
                </button>
              </div>
            ) : (
              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-neutral-300 block mb-1">Nombre Completo *</label>
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={e => setRegName(e.target.value)}
                    placeholder="Ej: Anthony Aguilera"
                    className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-tocineta-yellow outline-none min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-neutral-300 block mb-1">Cédula de Identidad *</label>
                  <input
                    type="text"
                    required
                    value={regCedula}
                    onChange={e => setRegCedula(e.target.value)}
                    placeholder="Ej: V-28123456"
                    className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-tocineta-yellow outline-none min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-neutral-300 block mb-1">Teléfono / WhatsApp (Opcional)</label>
                  <input
                    type="tel"
                    value={regPhone}
                    onChange={e => setRegPhone(e.target.value)}
                    placeholder="Ej: 0414-1234567"
                    className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-tocineta-yellow outline-none min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-neutral-300 block mb-1">Contraseña o PIN de 4 dígitos *</label>
                  <input
                    type="password"
                    required
                    value={regPassword}
                    onChange={e => setRegPassword(e.target.value)}
                    placeholder="Contraseña o PIN numérico"
                    className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-tocineta-yellow outline-none min-h-[44px]"
                  />
                </div>
                {regError && (
                  <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-medium">
                    {regError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={regLoading}
                  className="w-full min-h-[48px] bg-amber-500 hover:bg-amber-400 text-black font-extrabold rounded-xl text-xs uppercase tracking-wider transition shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
                >
                  {regLoading ? 'Enviando solicitud...' : 'Enviar Solicitud de Registro'}
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <div className="bg-[#12151D] border border-neutral-800 rounded-3xl p-6 shadow-2xl shadow-black/50">
              <h2 className="text-xs font-black uppercase tracking-wider text-neutral-400 mb-4 flex items-center justify-between">
                <span>Usuarios del Turno</span>
                <span className="text-xs text-[#FFE600] font-bold">Toca para seleccionar</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 gap-2.5 max-h-[480px] overflow-y-auto pr-1">
                {users.map(u => {
                  const isSelected = selectedUser?.id === u.id;
                  const badge = roleBadgeColors[u.role] || roleBadgeColors.mesonero;
                  return (
                    <button
                      key={u.id}
                      onClick={() => !u.isLocked && setSelectedUser(u)}
                      disabled={u.isLocked}
                      className={`flex items-center justify-between p-3.5 rounded-2xl border text-left transition-all min-h-[60px] ${u.isLocked
                          ? 'opacity-40 border-red-900/40 bg-red-950/20 cursor-not-allowed'
                          : isSelected
                            ? 'border-[#FFE600] bg-[#FFE600]/10 ring-2 ring-[#FFE600]/30 shadow-lg shadow-[#FFE600]/5'
                            : 'border-neutral-800 hover:border-neutral-700 bg-neutral-900/60 hover:bg-neutral-900'
                        }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-neutral-800 to-neutral-900 border border-neutral-700/60 flex items-center justify-center font-black text-[#FFE600] text-base shadow-inner">
                          {u.name.charAt(0)}
                        </div>
                        <div>
                          <div className="font-extrabold text-white text-base leading-tight">{u.name}</div>
                          <span className={`inline-block text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded mt-1 border ${badge.bg} ${badge.text}`}>
                            {badge.label}
                          </span>
                        </div>
                      </div>
                      {u.isLocked ? (
                        <span className="text-xs text-rose-400 font-bold bg-rose-950/80 px-2.5 py-1 rounded-xl border border-rose-800 flex items-center gap-1">
                          <Lock className="w-3 h-3" /> Bloqueado
                        </span>
                      ) : (
                        <span className="text-[11px] text-neutral-400 font-mono font-medium">PIN {u.pinLength} dígitos</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-[#12151D] border border-neutral-800 rounded-3xl p-6 shadow-2xl shadow-black/50 flex flex-col items-center">
              {selectedUser ? (
                <div className="w-full flex flex-col items-center">
                  <div className="text-center mb-3">
                    <span className="text-[11px] text-neutral-400 uppercase tracking-widest font-black">Operador Seleccionado</span>
                    <div className="text-xl font-black text-white mt-0.5 tracking-tight">{selectedUser.name}</div>
                    <div className="text-xs text-[#FFE600] font-bold mt-0.5">Ingresa PIN de {selectedUser.pinLength} dígitos</div>
                  </div>

                  <div className="flex items-center justify-center gap-3 my-3 h-10">
                    {Array.from({ length: selectedUser.pinLength }).map((_, idx) => (
                      <div
                        key={idx}
                        className={`w-4 h-4 rounded-full border-2 transition-all ${idx < pin.length
                            ? 'bg-[#FFE600] border-[#FFE600] scale-125 shadow-[0_0_12px_rgba(255,230,0,0.5)]'
                            : 'border-neutral-700 bg-neutral-900'
                          }`}
                      />
                    ))}
                  </div>

                  {errorMessage && (
                    <div className="w-full bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs text-center py-2.5 px-3 rounded-xl my-2 font-bold shadow">
                      {errorMessage}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2.5 w-full max-w-[280px] mt-2">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => appendDigit(num)}
                        disabled={isLoading}
                        className="min-h-[58px] text-2xl font-mono font-black rounded-2xl bg-[#161A23] border border-neutral-800 hover:border-[#FFE600]/60 hover:bg-neutral-800/80 active:scale-95 text-white transition-all shadow-md flex items-center justify-center"
                      >
                        {num}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={clearPin}
                      disabled={isLoading}
                      className="min-h-[58px] text-xs font-black uppercase tracking-wider rounded-2xl bg-[#161A23] border border-neutral-800 hover:border-rose-500/50 text-neutral-400 hover:text-rose-400 active:scale-95 transition-all flex items-center justify-center"
                    >
                      Limpiar
                    </button>
                    <button
                      type="button"
                      onClick={() => appendDigit('0')}
                      disabled={isLoading}
                      className="min-h-[58px] text-2xl font-mono font-black rounded-2xl bg-[#161A23] border border-neutral-800 hover:border-[#FFE600]/60 hover:bg-neutral-800/80 active:scale-95 text-white transition-all shadow-md flex items-center justify-center"
                    >
                      0
                    </button>
                    <button
                      type="button"
                      onClick={deleteDigit}
                      disabled={isLoading}
                      className="min-h-[58px] text-xl font-bold rounded-2xl bg-[#161A23] border border-neutral-800 hover:border-amber-500/50 text-neutral-400 hover:text-amber-400 active:scale-95 transition-all flex items-center justify-center"
                    >
                      ⌫
                    </button>
                  </div>

                  {isLoading && (
                    <div className="text-xs text-tocineta-yellow mt-4 flex items-center gap-2">
                      <span className="animate-spin">⏳</span> Verificando credenciales...
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-20 text-center text-tocineta-muted flex flex-col items-center justify-center">
                  <span className="text-4xl mb-3 opacity-60">👆</span>
                  <p className="text-sm font-medium">Selecciona un usuario de la lista</p>
                  <p className="text-xs text-tocineta-muted/70 mt-1">El teclado táctil se activará automáticamente</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};