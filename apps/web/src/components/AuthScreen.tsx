import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.js';

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

  const { data, refetch } = useQuery<{ success: boolean; users: PublicUser[] }>({
    queryKey: ['publicUsers'],
    queryFn: async () => {
      const res = await fetch('/api/auth/users-public');
      return res.json();
    },
    refetchInterval: 10000
  });

  const users = data?.users || [];

  // Reset PIN cuando se selecciona otro usuario
  useEffect(() => {
    setPin('');
    setErrorMessage(null);
  }, [selectedUser]);

  // Teclado físico
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedUser || isLoading) return;
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
  }, [selectedUser, pin, isLoading]);

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
      refetch(); // Actualizar si quedó bloqueado
    }
  };

  return (
    <div className="min-h-screen bg-tocineta-bg text-white flex flex-col items-center justify-center p-4 sm:p-6 select-none">
      {/* Encabezado Principal */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-3 bg-tocineta-card px-5 py-2.5 rounded-full border border-tocineta-border shadow-lg mb-3">
          <span className="text-2xl">🍔</span>
          <span className="font-bold text-lg tracking-wider text-tocineta-yellow">TOCINETA SONRÍE</span>
          <span className="bg-tocineta-border px-2 py-0.5 rounded text-xs text-tocineta-muted font-mono">LAN POS</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white">Inicio de Sesión Operativo</h1>
        <p className="text-sm text-tocineta-muted mt-1">Selecciona tu usuario e ingresa tu PIN de acceso</p>
      </div>

      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Columna Izquierda: Tarjetas de Usuarios */}
        <div className="bg-tocineta-card border border-tocineta-border rounded-2xl p-5 shadow-xl">
          <h2 className="text-sm font-bold uppercase tracking-wider text-tocineta-muted mb-4 flex items-center justify-between">
            <span>Usuarios del Turno</span>
            <span className="text-xs text-tocineta-yellow font-normal">Toca para seleccionar</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 gap-3 max-h-[480px] overflow-y-auto pr-1">
            {users.map(u => {
              const isSelected = selectedUser?.id === u.id;
              const badge = roleBadgeColors[u.role] || roleBadgeColors.mesonero;

              return (
                <button
                  key={u.id}
                  onClick={() => !u.isLocked && setSelectedUser(u)}
                  disabled={u.isLocked}
                  className={`flex items-center justify-between p-3.5 rounded-xl border text-left transition-all min-h-[56px] ${
                    u.isLocked
                      ? 'opacity-40 border-red-900/40 bg-red-950/20 cursor-not-allowed'
                      : isSelected
                      ? 'border-tocineta-yellow bg-tocineta-yellow/10 ring-2 ring-tocineta-yellow/30 shadow-md'
                      : 'border-tocineta-border hover:border-tocineta-border-light bg-tocineta-bg/60 hover:bg-tocineta-bg'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-tocineta-border flex items-center justify-center font-bold text-white text-base">
                      {u.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-semibold text-white text-base leading-tight">{u.name}</div>
                      <span className={`inline-block text-[11px] font-medium border px-2 py-0.5 rounded-full mt-1 ${badge.bg} ${badge.text}`}>
                        {badge.label}
                      </span>
                    </div>
                  </div>

                  {u.isLocked ? (
                    <span className="text-xs text-red-400 font-medium bg-red-950/80 px-2.5 py-1 rounded-md border border-red-800">
                      🔒 Bloqueado
                    </span>
                  ) : (
                    <span className="text-xs text-tocineta-muted font-mono">
                      PIN {u.pinLength} dígitos
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Columna Derecha: Teclado Numérico Táctil */}
        <div className="bg-tocineta-card border border-tocineta-border rounded-2xl p-5 shadow-xl flex flex-col items-center">
          {selectedUser ? (
            <div className="w-full flex flex-col items-center">
              <div className="text-center mb-4">
                <span className="text-xs text-tocineta-muted uppercase tracking-wider">Usuario Seleccionado</span>
                <div className="text-xl font-bold text-white mt-0.5">{selectedUser.name}</div>
                <div className="text-xs text-tocineta-yellow">Ingresa PIN de {selectedUser.pinLength} dígitos</div>
              </div>

              {/* Indicador de dígitos ingresados */}
              <div className="flex items-center justify-center gap-3 my-3 h-10">
                {Array.from({ length: selectedUser.pinLength }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`w-5 h-5 rounded-full border-2 transition-all ${
                      idx < pin.length
                        ? 'bg-tocineta-yellow border-tocineta-yellow scale-110 shadow-[0_0_12px_rgba(255,230,0,0.4)]'
                        : 'border-tocineta-muted/40 bg-tocineta-bg/50'
                    }`}
                  />
                ))}
              </div>

              {/* Mensaje de Error */}
              {errorMessage && (
                <div className="w-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs text-center py-2 px-3 rounded-lg my-2 font-medium">
                  {errorMessage}
                </div>
              )}

              {/* Botonera Numérica Táctil */}
              <div className="grid grid-cols-3 gap-2.5 w-full max-w-[280px] mt-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                  <button
                    key={num}
                    onClick={() => appendDigit(num)}
                    disabled={isLoading}
                    className="min-h-[56px] text-2xl font-bold rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow active:bg-tocineta-yellow/20 active:scale-95 text-white transition-all shadow flex items-center justify-center"
                  >
                    {num}
                  </button>
                ))}

                {/* Fila Inferior: C, 0, Backspace */}
                <button
                  onClick={clearPin}
                  disabled={isLoading}
                  className="min-h-[56px] text-sm font-bold uppercase rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-red-500/50 text-tocineta-muted hover:text-red-400 active:scale-95 transition-all flex items-center justify-center"
                >
                  Limpiar
                </button>

                <button
                  onClick={() => appendDigit('0')}
                  disabled={isLoading}
                  className="min-h-[56px] text-2xl font-bold rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow active:bg-tocineta-yellow/20 active:scale-95 text-white transition-all shadow flex items-center justify-center"
                >
                  0
                </button>

                <button
                  onClick={deleteDigit}
                  disabled={isLoading}
                  className="min-h-[56px] text-lg font-bold rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-amber-500/50 text-tocineta-muted hover:text-amber-400 active:scale-95 transition-all flex items-center justify-center"
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
    </div>
  );
};
