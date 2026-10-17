import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useEventStream } from '../hooks/useEventStream.js';

interface AppLayoutProps {
  currentTab: 'pos' | 'menu-admin' | 'health';
  onTabChange: (tab: 'pos' | 'menu-admin' | 'health') => void;
  formattedRate?: string;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  currentTab,
  onTabChange,
  formattedRate = '40,00',
  children
}) => {
  const { user, logout, currency, setCurrency, isSensitiveLocked, unlockSensitive } = useAuth();
  const { isConnected, latestSeq } = useEventStream();

  const [unlockPin, setUnlockPin] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);

  const handleUnlock = async () => {
    if (!unlockPin) return;
    setIsUnlocking(true);
    setUnlockError(null);

    const res = await unlockSensitive(unlockPin);
    setIsUnlocking(false);

    if (!res.success) {
      setUnlockError(res.error || 'PIN incorrecto');
      setUnlockPin('');
    } else {
      setUnlockPin('');
    }
  };

  const isAdminOrSupervisor = user?.role === 'admin' || user?.role === 'supervisor';

  return (
    <div className="min-h-screen bg-tocineta-bg text-white flex flex-col font-sans select-none">
      {/* Barra Superior de Estado y Navegación */}
      <header className="bg-tocineta-card border-b border-tocineta-border sticky top-0 z-40 px-4 py-2.5 sm:px-6 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Logo y Nombre */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-tocineta-yellow/10 border border-tocineta-yellow/30 flex items-center justify-center text-2xl shadow-inner">
              🥓
            </div>
            <div>
              <div className="font-extrabold text-base tracking-wide flex items-center gap-2">
                <span>TOCINETA SONRÍE</span>
                <span className="text-[10px] bg-tocineta-border text-tocineta-yellow font-mono px-1.5 py-0.5 rounded">
                  POS
                </span>
              </div>
              <div className="text-xs text-tocineta-muted flex items-center gap-2">
                <span>Food Truck Puerto Ordaz</span>
                <span className="text-[11px] text-tocineta-border">•</span>
                {/* Indicador WebSocket LAN */}
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isConnected ? 'bg-tocineta-green animate-pulse' : 'bg-red-500'
                    }`}
                  />
                  <span className={`text-[11px] font-mono ${isConnected ? 'text-tocineta-green' : 'text-red-400'}`}>
                    {isConnected ? `LAN Online (Seq #${latestSeq})` : 'Reconectando LAN...'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Selector de Moneda y Tasa BCV */}
          <div className="flex items-center gap-3">
            {/* Tasa BCV Oficial */}
            <div className="hidden sm:flex items-center gap-1.5 bg-tocineta-bg px-3 py-1.5 rounded-lg border border-tocineta-border text-xs">
              <span className="text-tocineta-muted">BCV:</span>
              <span className="font-bold text-white font-mono">{formattedRate} Bs/$</span>
            </div>

            {/* Conmutador USD / Bs */}
            <div className="flex items-center bg-tocineta-bg p-1 rounded-xl border border-tocineta-border">
              <button
                onClick={() => setCurrency('USD')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                  currency === 'USD'
                    ? 'bg-tocineta-yellow text-tocineta-bg shadow-sm'
                    : 'text-tocineta-muted hover:text-white'
                }`}
              >
                USD ($)
              </button>
              <button
                onClick={() => setCurrency('BS')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                  currency === 'BS'
                    ? 'bg-tocineta-yellow text-tocineta-bg shadow-sm'
                    : 'text-tocineta-muted hover:text-white'
                }`}
              >
                Bs (VES)
              </button>
            </div>

            {/* Usuario Actual y Salir */}
            {user && (
              <div className="flex items-center gap-2 pl-2 border-l border-tocineta-border">
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-bold text-white leading-tight">{user.name}</div>
                  <div className="text-[10px] text-tocineta-yellow uppercase tracking-wider font-semibold">
                    {user.role}
                  </div>
                </div>
                <button
                  onClick={logout}
                  title="Cerrar Sesión"
                  className="p-2 rounded-lg bg-tocineta-bg border border-tocineta-border hover:border-red-500/50 text-tocineta-muted hover:text-red-400 transition-colors"
                >
                  <span className="text-sm">🚪</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Pestañas de Navegación Operativa */}
        <div className="max-w-7xl mx-auto flex items-center gap-2 mt-3 pt-2 border-t border-tocineta-border/60 overflow-x-auto">
          <button
            onClick={() => onTabChange('pos')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
              currentTab === 'pos'
                ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                : 'text-tocineta-muted hover:text-white hover:bg-tocineta-bg'
            }`}
          >
            <span>🍔</span>
            <span>Comandero / POS</span>
          </button>

          {isAdminOrSupervisor && (
            <button
              onClick={() => onTabChange('menu-admin')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
                currentTab === 'menu-admin'
                  ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                  : 'text-tocineta-muted hover:text-white hover:bg-tocineta-bg'
              }`}
            >
              <span>⚙️</span>
              <span>Gestor de Menú (Admin)</span>
            </button>
          )}

          <button
            onClick={() => onTabChange('health')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
              currentTab === 'health'
                ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                : 'text-tocineta-muted hover:text-white hover:bg-tocineta-bg'
            }`}
          >
            <span>🩺</span>
            <span>Diagnóstico del Sistema</span>
          </button>
        </div>
      </header>

      {/* Contenido Principal */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {children}
      </main>

      {/* Modal de Auto-Lock por Inactividad (2 Minutos en Vistas Sensibles) */}
      {isSensitiveLocked && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-tocineta-card border border-tocineta-border rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto text-2xl mb-3">
              🔒
            </div>
            <h3 className="text-lg font-bold text-white">Sesión Bloqueada por Inactividad</h3>
            <p className="text-xs text-tocineta-muted mt-1">
              Han transcurrido 2 minutos sin actividad en el panel sensible. Ingrese su PIN de {user?.name} para continuar.
            </p>

            <div className="my-4">
              <input
                type="password"
                maxLength={6}
                value={unlockPin}
                onChange={e => setUnlockPin(e.target.value.replace(/\D/g, ''))}
                placeholder="PIN de acceso"
                className="w-full text-center text-2xl font-mono tracking-widest bg-tocineta-bg border border-tocineta-border focus:border-tocineta-yellow rounded-xl py-3 text-white outline-none"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleUnlock()}
              />
              {unlockError && <p className="text-xs text-red-400 mt-2 font-medium">{unlockError}</p>}
            </div>

            <div className="flex gap-2">
              <button
                onClick={logout}
                className="flex-1 py-2.5 rounded-xl border border-tocineta-border text-xs font-bold text-tocineta-muted hover:text-white hover:bg-tocineta-bg transition-all"
              >
                Cerrar Sesión
              </button>
              <button
                onClick={handleUnlock}
                disabled={isUnlocking || !unlockPin}
                className="flex-1 py-2.5 rounded-xl bg-tocineta-yellow text-tocineta-bg text-xs font-bold hover:bg-tocineta-yellow/90 transition-all disabled:opacity-50"
              >
                {isUnlocking ? 'Verificando...' : 'Desbloquear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
