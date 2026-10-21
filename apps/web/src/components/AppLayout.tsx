import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.js';
import { useEventStream } from '../hooks/useEventStream.js';
import { SupportBanner, StartSupportModal } from './SupportBanner.js';

interface AppLayoutProps {
  currentTab: 'pos' | 'cashier' | 'kds' | 'menu-admin' | 'health' | 'emergency' | 'profitability';
  onTabChange: (tab: 'pos' | 'cashier' | 'kds' | 'menu-admin' | 'health' | 'emergency' | 'profitability') => void;
  formattedRate?: string;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  currentTab,
  onTabChange,
  formattedRate = '40,00',
  children
}) => {
  const { user, logout, currency, setCurrency, isSensitiveLocked, unlockSensitive, changePin } = useAuth();
  const { isConnected, latestSeq } = useEventStream();

  const [unlockPin, setUnlockPin] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);

  // Estado para modal obligatorio de cambio de PIN (B.4)
  const [currentPinInput, setCurrentPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [activePinField, setActivePinField] = useState<'current' | 'new' | 'confirm'>('current');
  const [changePinError, setChangePinError] = useState<string | null>(null);
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);

  const requiredPinLength = (user?.role === 'admin' || user?.role === 'supervisor') ? 6 : 4;

  const { data: profitSettings } = useQuery<{ profitabilityProEnabled: boolean }>({
    queryKey: ['profitabilitySettings'],
    queryFn: async () => {
      const res = await fetch('/api/profitability/settings');
      return res.json();
    },
    staleTime: 10000
  });

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

  const handleChangePin = async () => {
    if (!currentPinInput) {
      setChangePinError('Debe ingresar su PIN actual');
      return;
    }
    if (newPinInput.length !== requiredPinLength) {
      setChangePinError(`El nuevo PIN debe tener exactamente ${requiredPinLength} dígitos`);
      return;
    }
    if (newPinInput !== confirmPinInput) {
      setChangePinError('La confirmación del PIN no coincide');
      return;
    }
    setIsChangingPin(true);
    setChangePinError(null);
    const res = await changePin(currentPinInput, newPinInput);
    setIsChangingPin(false);
    if (!res.success) {
      setChangePinError(res.error || 'Error al cambiar PIN');
    }
  };

  const isAdminOrSupervisor = user?.role === 'admin' || user?.role === 'supervisor';

  return (
    <div className="min-h-screen bg-tocineta-bg text-white flex flex-col font-sans select-none">
      {/* Banner inconfundible de Modo Soporte Varons Media */}
      <SupportBanner />

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
                {user.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => setIsSupportModalOpen(true)}
                    title="Modo Soporte Auditado Varons Media"
                    className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-400 hover:bg-amber-500/20 transition-all text-xs font-bold flex items-center gap-1"
                  >
                    <span>🛠️</span>
                    <span className="hidden lg:inline text-[11px]">Soporte</span>
                  </button>
                )}
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

          <button
            onClick={() => onTabChange('kds')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
              currentTab === 'kds'
                ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                : 'text-tocineta-muted hover:text-white hover:bg-tocineta-bg'
            }`}
          >
            <span>🍳</span>
            <span>KDS / Cocina</span>
          </button>

          {(user?.role === 'cajera' || isAdminOrSupervisor) && (
            <button
              onClick={() => onTabChange('cashier')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
                currentTab === 'cashier'
                  ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                  : 'text-tocineta-muted hover:text-white hover:bg-tocineta-bg'
              }`}
            >
              <span>💵</span>
              <span>Caja y Cobro</span>
            </button>
          )}

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

          {isAdminOrSupervisor && (
            <button
              onClick={() => onTabChange('profitability')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
                currentTab === 'profitability'
                  ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                  : 'text-tocineta-muted hover:text-white hover:bg-tocineta-bg'
              }`}
            >
              <span>📊</span>
              <span>Rentabilidad Pro</span>
              {!profitSettings?.profitabilityProEnabled && (
                <span className="text-[9px] bg-zinc-800 text-zinc-400 px-1 py-0.2 rounded font-mono">
                  Off
                </span>
              )}
            </button>
          )}

          {(user?.role === 'cajera' || isAdminOrSupervisor) && (
            <button
              onClick={() => onTabChange('emergency')}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 ${
                currentTab === 'emergency'
                  ? 'bg-amber-500 text-tocineta-bg shadow-md'
                  : 'text-amber-400/80 hover:text-amber-300 hover:bg-tocineta-bg border border-amber-500/30'
              }`}
            >
              <span>📋</span>
              <span>Modo Emergencia Papel</span>
            </button>
          )}
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

            <div className="my-3">
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={requiredPinLength}
                value={unlockPin}
                onChange={e => setUnlockPin(e.target.value.replace(/\D/g, ''))}
                placeholder={`PIN (${requiredPinLength} dígitos)`}
                className="w-full text-center text-2xl font-mono tracking-widest bg-tocineta-bg border border-tocineta-border focus:border-tocineta-yellow rounded-xl py-2.5 text-white outline-none"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleUnlock()}
              />
              {unlockError && <p className="text-xs text-red-400 mt-2 font-medium">{unlockError}</p>}
            </div>

            {/* Teclado Numérico Táctil Auto-Lock */}
            <div className="grid grid-cols-3 gap-2 w-full max-w-[260px] mx-auto my-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                <button
                  key={num}
                  type="button"
                  onClick={() => {
                    if (unlockPin.length < requiredPinLength) setUnlockPin(prev => prev + num);
                  }}
                  className="min-h-[48px] text-xl font-bold rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow active:bg-tocineta-yellow/20 active:scale-95 text-white transition-all shadow flex items-center justify-center"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setUnlockPin('')}
                className="min-h-[48px] text-xs font-bold uppercase rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-red-500/50 text-tocineta-muted hover:text-red-400 active:scale-95 transition-all flex items-center justify-center"
              >
                Limpiar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (unlockPin.length < requiredPinLength) setUnlockPin(prev => prev + '0');
                }}
                className="min-h-[48px] text-xl font-bold rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow active:bg-tocineta-yellow/20 active:scale-95 text-white transition-all shadow flex items-center justify-center"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => setUnlockPin(prev => prev.slice(0, -1))}
                className="min-h-[48px] text-base font-bold rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-amber-500/50 text-tocineta-muted hover:text-amber-400 active:scale-95 transition-all flex items-center justify-center"
              >
                ⌫
              </button>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={logout}
                className="flex-1 min-h-[48px] py-2.5 rounded-xl border border-tocineta-border text-xs font-bold text-tocineta-muted hover:text-white hover:bg-tocineta-bg transition-all flex items-center justify-center"
              >
                Cerrar Sesión
              </button>
              <button
                type="button"
                onClick={handleUnlock}
                disabled={isUnlocking || !unlockPin}
                className="flex-1 min-h-[48px] py-2.5 rounded-xl bg-tocineta-yellow text-tocineta-bg text-xs font-bold hover:bg-tocineta-yellow/90 transition-all disabled:opacity-50 flex items-center justify-center"
              >
                {isUnlocking ? 'Verificando...' : 'Desbloquear'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Obligatorio de Cambio de PIN (B.4 / F4) */}
      {user?.mustChangePin && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-tocineta-card border border-amber-500/40 rounded-3xl p-5 max-w-md w-full shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center mx-auto text-2xl mb-2 shadow-inner">
              🔑
            </div>
            <h3 className="text-lg font-black text-white text-center">Cambio Obligatorio de PIN</h3>
            <p className="text-xs text-tocineta-muted mt-0.5 text-center">
              Hola, <span className="text-white font-bold">{user.name}</span>. Por seguridad física y auditoría, debe establecer su PIN de {requiredPinLength} dígitos antes de continuar.
            </p>

            <div className="space-y-2.5 my-3">
              <div>
                <label className="text-[11px] font-bold text-tocineta-muted uppercase tracking-wider block mb-1">
                  PIN Actual:
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={currentPinInput}
                  onFocus={() => setActivePinField('current')}
                  onChange={e => setCurrentPinInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="Ingrese PIN actual"
                  className={`w-full text-center text-lg font-mono bg-tocineta-bg border rounded-xl py-2 text-white outline-none transition-all ${
                    activePinField === 'current' ? 'border-tocineta-yellow ring-1 ring-tocineta-yellow/40' : 'border-tocineta-border'
                  }`}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-tocineta-muted uppercase tracking-wider block">
                    {`Nuevo PIN (${requiredPinLength} dígitos):`}
                  </label>
                  {/* Indicadores visuales de longitud de PIN */}
                  <div className="flex items-center gap-1.5">
                    {Array.from({ length: requiredPinLength }).map((_, idx) => (
                      <span
                        key={idx}
                        className={`inline-block w-2.5 h-2.5 rounded-full transition-all ${
                          idx < newPinInput.length ? 'bg-tocineta-yellow scale-110 shadow-sm' : 'bg-zinc-700'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={requiredPinLength}
                  value={newPinInput}
                  onFocus={() => setActivePinField('new')}
                  onChange={e => setNewPinInput(e.target.value.replace(/\D/g, ''))}
                  placeholder={`Nuevo PIN (${requiredPinLength} dígitos)`}
                  className={`w-full text-center text-lg font-mono tracking-widest bg-tocineta-bg border rounded-xl py-2 text-white outline-none transition-all ${
                    activePinField === 'new' ? 'border-tocineta-yellow ring-1 ring-tocineta-yellow/40' : 'border-tocineta-border'
                  }`}
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-tocineta-muted uppercase tracking-wider block mb-1">
                  Confirmar Nuevo PIN:
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={requiredPinLength}
                  value={confirmPinInput}
                  onFocus={() => setActivePinField('confirm')}
                  onChange={e => setConfirmPinInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="Repita nuevo PIN"
                  className={`w-full text-center text-lg font-mono tracking-widest bg-tocineta-bg border rounded-xl py-2 text-white outline-none transition-all ${
                    activePinField === 'confirm' ? 'border-tocineta-yellow ring-1 ring-tocineta-yellow/40' : 'border-tocineta-border'
                  }`}
                />
              </div>

              {changePinError && (
                <div className="p-2 bg-red-500/20 border border-red-500/40 rounded-xl text-xs text-red-300 text-center font-medium">
                  {changePinError}
                </div>
              )}
            </div>

            {/* Teclado Numérico Táctil Cambio de PIN */}
            <div className="grid grid-cols-3 gap-1.5 w-full max-w-[260px] mx-auto my-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                <button
                  key={num}
                  type="button"
                  onClick={() => {
                    if (activePinField === 'current' && currentPinInput.length < 6) {
                      setCurrentPinInput(prev => prev + num);
                    } else if (activePinField === 'new' && newPinInput.length < requiredPinLength) {
                      setNewPinInput(prev => prev + num);
                    } else if (activePinField === 'confirm' && confirmPinInput.length < requiredPinLength) {
                      setConfirmPinInput(prev => prev + num);
                    }
                  }}
                  className="min-h-[48px] text-lg font-bold rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow active:bg-tocineta-yellow/20 active:scale-95 text-white transition-all shadow flex items-center justify-center"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  if (activePinField === 'current') setCurrentPinInput('');
                  else if (activePinField === 'new') setNewPinInput('');
                  else if (activePinField === 'confirm') setConfirmPinInput('');
                }}
                className="min-h-[48px] text-xs font-bold uppercase rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-red-500/50 text-tocineta-muted hover:text-red-400 active:scale-95 transition-all flex items-center justify-center"
              >
                Limpiar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (activePinField === 'current' && currentPinInput.length < 6) {
                    setCurrentPinInput(prev => prev + '0');
                  } else if (activePinField === 'new' && newPinInput.length < requiredPinLength) {
                    setNewPinInput(prev => prev + '0');
                  } else if (activePinField === 'confirm' && confirmPinInput.length < requiredPinLength) {
                    setConfirmPinInput(prev => prev + '0');
                  }
                }}
                className="min-h-[48px] text-lg font-bold rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow active:bg-tocineta-yellow/20 active:scale-95 text-white transition-all shadow flex items-center justify-center"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => {
                  if (activePinField === 'current') setCurrentPinInput(prev => prev.slice(0, -1));
                  else if (activePinField === 'new') setNewPinInput(prev => prev.slice(0, -1));
                  else if (activePinField === 'confirm') setConfirmPinInput(prev => prev.slice(0, -1));
                }}
                className="min-h-[48px] text-base font-bold rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-amber-500/50 text-tocineta-muted hover:text-amber-400 active:scale-95 transition-all flex items-center justify-center"
              >
                ⌫
              </button>
            </div>

            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={logout}
                className="flex-1 min-h-[48px] py-2.5 rounded-xl border border-tocineta-border text-xs font-bold text-tocineta-muted hover:text-white hover:bg-tocineta-bg transition-all flex items-center justify-center"
              >
                Cerrar Sesión
              </button>
              <button
                type="button"
                onClick={handleChangePin}
                disabled={isChangingPin || !currentPinInput || newPinInput.length !== requiredPinLength || confirmPinInput.length !== requiredPinLength}
                className="flex-1 min-h-[48px] py-2.5 rounded-xl bg-tocineta-yellow text-tocineta-bg text-xs font-black uppercase tracking-wider hover:bg-tocineta-yellow-hover active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center"
              >
                {isChangingPin ? 'Guardando...' : 'Establecer PIN'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para Iniciar Modo Soporte (Exclusivo Admin) */}
      <StartSupportModal
        isOpen={isSupportModalOpen}
        onClose={() => setIsSupportModalOpen(false)}
      />
    </div>
  );
};
