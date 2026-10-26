import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { canUserProcessPayments } from '@tocineta/shared';
import { useAuth } from '../context/AuthContext.js';
import { useEventStream } from '../hooks/useEventStream.js';
import { SupportBanner, StartSupportModal } from './SupportBanner.js';
import { FaithBanner } from './FaithBanner.js';
import { queryClient, ALLOWED_TABS_BY_ROLE, DEFAULT_TAB_BY_ROLE, type TabType } from '../App.js';
import {
  Flame,
  Crown,
  LogOut,
  ShoppingCart,
  ChefHat,
  ClipboardList,
  Users,
  TrendingUp,
  Printer,
  Receipt,
  Utensils,
  Wrench,
  RefreshCw,
  RotateCw,
  Menu,
  X,
  Sun,
  Moon
} from 'lucide-react';

interface AppLayoutProps {
  currentTab: TabType;
  onTabChange: (tab: TabType) => void;
  formattedRate?: string;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  currentTab,
  onTabChange,
  formattedRate = '40,00',
  children
}) => {
  const { user, token, logout, currency, setCurrency, changePin } = useAuth();
  const { isConnected } = useEventStream();
  const [isSyncingBcv, setIsSyncingBcv] = useState(false);
  const [isBcvModalOpen, setIsBcvModalOpen] = useState(false);
  const [manualBcvInput, setManualBcvInput] = useState('');
  const [bcvModalMsg, setBcvModalMsg] = useState<string | null>(null);
  const [isSavingBcv, setIsSavingBcv] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Tema Base Blanco Minimalista por defecto con persistencia
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('tocineta_theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {}
    return 'light';
  });

  useEffect(() => {
    try {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      localStorage.setItem('tocineta_theme', theme);
    } catch {}
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  const [uiMode, setUiMode] = useState<'turno' | 'duena'>(() => {
    try {
      const saved = localStorage.getItem('tocineta_ui_mode');
      if (saved === 'duena' || saved === 'turno') return saved;
    } catch {}
    return 'turno';
  });

  const handleToggleUiMode = (newMode: 'turno' | 'duena') => {
    setUiMode(newMode);
    try {
      localStorage.setItem('tocineta_ui_mode', newMode);
    } catch {}
    if (newMode === 'turno') {
      const adminTabs: TabType[] = ['menu-admin', 'staff', 'profitability', 'health', 'emergency'];
      if (adminTabs.includes(currentTab)) {
        onTabChange('pos');
      }
    }
  };

  const handleSyncBcv = async () => {
    setIsSyncingBcv(true);
    try {
      const res = await fetch('/api/menu/exchange-rate/sync-now', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.updated) {
        queryClient.invalidateQueries({ queryKey: ['posMenu'] });
        queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
      }
    } catch {
      // Ignorar fallo de conexión
    } finally {
      setIsSyncingBcv(false);
    }
  };

  const handleOpenBcvModal = () => {
    setManualBcvInput(formattedRate.replace(',', '.'));
    setBcvModalMsg(null);
    setIsBcvModalOpen(true);
  };

  const handleSaveManualBcv = async () => {
    const parsed = parseFloat(manualBcvInput.replace(',', '.'));
    if (isNaN(parsed) || parsed <= 0) {
      setBcvModalMsg('Ingresa una tasa numérica válida');
      return;
    }
    setIsSavingBcv(true);
    try {
      const rateMicroBs = Math.round(parsed * 1_000_000);
      const res = await fetch('/api/menu/exchange-rate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ rateMicroBs })
      });
      const data = await res.json();
      if (res.ok) {
        setBcvModalMsg(`✓ Tasa guardada: ${data.formattedRate} Bs/$`);
        queryClient.invalidateQueries({ queryKey: ['posMenu'] });
        queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
        setTimeout(() => setIsBcvModalOpen(false), 1200);
      } else {
        setBcvModalMsg(data.error || 'Error al guardar tasa');
      }
    } catch {
      setBcvModalMsg('Error de conexión al servidor');
    } finally {
      setIsSavingBcv(false);
    }
  };

  const handleLogout = async () => {
    queryClient.clear();
    onTabChange('pos');
    await logout();
  };

  const canPay = canUserProcessPayments(user);
  const baseAllowed: TabType[] = user?.role ? (ALLOWED_TABS_BY_ROLE[user.role] || ['pos']) : ['pos'];
  const allowedTabs: TabType[] = [...baseAllowed];
  if (canPay && !allowedTabs.includes('cashier')) {
    allowedTabs.push('cashier');
  }

  const handleTabClick = (tab: TabType) => {
    if (tab === 'pos') {
      onTabChange('pos');
      return;
    }
    if (tab === 'cashier' && !canPay) {
      onTabChange(user?.role === 'cocinero' ? 'kds' : 'pos');
      return;
    }
    if (!allowedTabs.includes(tab)) {
      onTabChange(DEFAULT_TAB_BY_ROLE[user?.role || 'mesonero'] || 'pos');
      return;
    }
    onTabChange(tab);
  };

  const handleDrawerNav = (tab: TabType, subtab?: string) => {
    setIsDrawerOpen(false);
    if (subtab) {
      try {
        localStorage.setItem('tocineta_profit_subtab', subtab);
        window.dispatchEvent(new CustomEvent('switch-profitability-subtab', { detail: subtab }));
      } catch {}
    }
    handleTabClick(tab);
  };

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

  const { data: adminUsersData } = useQuery<{ users?: Array<{ approval_status?: string; approvalStatus?: string }> }>({
    queryKey: ['adminUsersBadge'],
    queryFn: async () => {
      const res = await fetch('/api/admin/users', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) return { users: [] };
      return res.json();
    },
    enabled: Boolean(token && (user?.role === 'admin' || user?.role === 'supervisor')),
    refetchInterval: 15000
  });

  const pendingApprovalsCount = (adminUsersData?.users || []).filter(
    u => u.approval_status === 'PENDING' || u.approvalStatus === 'PENDING'
  ).length;

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
    <div className="min-h-screen bg-tocineta-bg text-tocineta-text flex flex-col font-sans select-none">
      {/* Franja de Fe y Honra a Dios */}
      <FaithBanner />

      {/* Banner inconfundible de Modo Soporte Varons Media */}
      <SupportBanner />

      {/* Menú Lateral Deslizable (Drawer) estilo RePOS / Treinta */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setIsDrawerOpen(false)}
          />

          <aside className="relative w-80 max-w-[85vw] h-full bg-white dark:bg-[#121620] text-slate-900 dark:text-white border-r border-slate-200 dark:border-neutral-800 shadow-2xl flex flex-col z-10 overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-neutral-800 flex items-center justify-between bg-slate-50 dark:bg-[#0c0f17]">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">🥓</span>
                <div>
                  <h3 className="font-extrabold text-sm tracking-wide text-slate-900 dark:text-white">TOCINETA SONRÍE</h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">Sistema Integral RePOS / Treinta</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-neutral-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-5">
              <div>
                <div className="px-2 pb-1.5 text-[11px] font-black uppercase tracking-wider text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                  <span>🏪</span>
                  <span>MENÚS DE CAJA</span>
                </div>
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => handleDrawerNav('pos')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                      currentTab === 'pos'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span>⏱️</span>
                      <span>Pedido Rápido</span>
                    </div>
                    <span className="text-[10px] opacity-70">POS</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDrawerNav('pos')}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60 transition-all"
                  >
                    <div className="flex items-center gap-2.5">
                      <span>🍽️</span>
                      <span>Órdenes de Mesa</span>
                    </div>
                    <span className="text-[10px] opacity-70">Salón</span>
                  </button>

                  {(allowedTabs.includes('cashier') || canPay) && (
                    <button
                      type="button"
                      onClick={() => handleDrawerNav('cashier')}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                        currentTab === 'cashier'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span>📋</span>
                        <span>Caja y Cobros</span>
                      </div>
                      <span className="text-[10px] opacity-70">Turno</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDrawerNav('pos')}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60 transition-all"
                  >
                    <div className="flex items-center gap-2.5">
                      <span>🛵</span>
                      <span>Delivery</span>
                    </div>
                    <span className="text-[10px] opacity-70">Rutas</span>
                  </button>

                  {allowedTabs.includes('kds') && (
                    <button
                      type="button"
                      onClick={() => handleDrawerNav('kds')}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                        currentTab === 'kds'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span>👨🍳</span>
                        <span>Cocina (KDS)</span>
                      </div>
                      <span className="text-[10px] opacity-70">Comandas</span>
                    </button>
                  )}

                  {allowedTabs.includes('profitability') && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleDrawerNav('profitability', 'inventory')}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60 transition-all"
                      >
                        <div className="flex items-center gap-2.5">
                          <span>📦</span>
                          <span>Estado de Inventario</span>
                        </div>
                        <span className="text-[10px] opacity-70">Stock</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDrawerNav('profitability', 'expenses')}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60 transition-all"
                      >
                        <div className="flex items-center gap-2.5">
                          <span>🪙</span>
                          <span>Gastos y Salidas</span>
                        </div>
                        <span className="text-[10px] opacity-70">Caja Chica</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDrawerNav('profitability', 'receivables')}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60 transition-all"
                      >
                        <div className="flex items-center gap-2.5">
                          <span>👤</span>
                          <span>Clientes y Por Cobrar</span>
                        </div>
                        <span className="text-[10px] opacity-70">Cuentas</span>
                      </button>
                    </>
                  )}

                  {(allowedTabs.includes('cashier') || canPay) && (
                    <button
                      type="button"
                      onClick={() => handleDrawerNav('cashier')}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60 transition-all"
                    >
                      <div className="flex items-center gap-2.5">
                        <span>🏁</span>
                        <span>Cierre del Día</span>
                      </div>
                      <span className="text-[10px] opacity-70">Z Report</span>
                    </button>
                  )}
                </div>
              </div>

              {isAdminOrSupervisor && (
                <div className="pt-2 border-t border-slate-200 dark:border-neutral-800">
                  <div className="px-2 pb-1.5 text-[11px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <span>⚙️</span>
                    <span>MENÚS DE ADMINISTRACIÓN</span>
                  </div>
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => handleDrawerNav('profitability', 'net-profit')}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                        currentTab === 'profitability'
                          ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span>📊</span>
                        <span>Balance y Rentabilidad</span>
                      </div>
                      <span className="text-[10px] font-mono">Treinta/Valery</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDrawerNav('menu-admin')}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                        currentTab === 'menu-admin'
                          ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span>🍔</span>
                        <span>Productos, Recetas y Precios Sugeridos</span>
                      </div>
                      <span className="text-[10px] font-mono">Margen</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDrawerNav('profitability', 'purchases')}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60 transition-all"
                    >
                      <div className="flex items-center gap-2.5">
                        <span>🛒</span>
                        <span>Compras, Materia Prima y Proveedores</span>
                      </div>
                      <span className="text-[10px] font-mono">Stock</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDrawerNav('profitability', 'mermas')}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60 transition-all"
                    >
                      <div className="flex items-center gap-2.5">
                        <span>📉</span>
                        <span>Mermas y Facturas de Reposición (Socios)</span>
                      </div>
                      <span className="text-[10px] font-mono">Reposición</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDrawerNav('profitability', 'payroll')}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60 transition-all"
                    >
                      <div className="flex items-center gap-2.5">
                        <span>💼</span>
                        <span>Nómina y Pagos a Personal</span>
                      </div>
                      <span className="text-[10px] font-mono">Vales/Sueldo</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDrawerNav('qr-menu')}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                        currentTab === 'qr-menu'
                          ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span>📱</span>
                        <span>Menú Digital QR (A5) y Sitio Web</span>
                      </div>
                      <span className="text-[10px] font-mono">Online</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDrawerNav('staff')}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                        currentTab === 'staff'
                          ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span>👥</span>
                        <span>Usuarios y Permisos</span>
                      </div>
                      {pendingApprovalsCount > 0 && (
                        <span className="px-1.5 py-0.2 text-[9px] bg-red-600 text-white rounded-full font-black animate-pulse">
                          {pendingApprovalsCount}
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDrawerNav('health')}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                        currentTab === 'health'
                          ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span>⚙️</span>
                        <span>Configuración General</span>
                      </div>
                      <span className="text-[10px] font-mono">Impresoras</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 border-t border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-[#0c0f17] flex items-center justify-between">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                <div>BCV Día Siguiente:</div>
                <div className="font-mono font-bold text-slate-900 dark:text-white">{formattedRate} Bs/$</div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 text-xs font-bold flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Salir</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Barra Superior de Estado y Navegación */}
      <header className="bg-tocineta-card border-b border-tocineta-border sticky top-0 z-40 px-3 py-2 sm:px-6 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2.5">
          {/* Botón Hamburger + Logo y Nombre */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setIsDrawerOpen(true)}
              className="p-2 rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow text-tocineta-text transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
              title="Abrir Menú Lateral RePOS / Treinta"
            >
              <Menu className="w-5 h-5 text-tocineta-yellow" />
              <span className="text-xs font-black hidden md:inline">MENÚ</span>
            </button>

            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-tocineta-yellow/10 border border-tocineta-yellow/30 flex items-center justify-center text-xl sm:text-2xl shadow-inner">
              🥓
            </div>
            <div>
              <div className="font-extrabold text-sm sm:text-base tracking-wide flex items-center gap-2">
                <span>TOCINETA SONRÍE</span>
                <span className="text-[10px] bg-tocineta-border text-tocineta-yellow font-mono px-1.5 py-0.5 rounded">
                  POS
                </span>
              </div>
              <div className="text-[11px] text-tocineta-muted flex items-center gap-2">
                <span>Food Truck Puerto Ordaz</span>
                <span className="text-[11px] text-tocineta-border">•</span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isConnected ? 'bg-tocineta-green animate-pulse' : 'bg-red-500'
                    }`}
                  />
                  <span className={`text-[11px] font-bold ${isConnected ? 'text-tocineta-green' : 'text-red-400'}`}>
                    {isConnected ? '🟢 Sistema Conectado' : 'Reconectando...'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Selector de Moneda, Conmutador Dual, Tema y Usuario */}
          <div className="flex items-center flex-wrap gap-2 sm:gap-3">
            {/* Conmutador [☀️ Claro / 🌙 Oscuro] */}
            <button
              type="button"
              onClick={handleToggleTheme}
              className="px-2.5 py-1.5 rounded-xl border border-tocineta-border bg-tocineta-bg hover:border-tocineta-yellow/60 text-xs font-bold text-tocineta-text flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
              title="Alternar Modo Claro / Oscuro"
            >
              {theme === 'light' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-500 fill-amber-400" />
                  <span className="hidden sm:inline">Claro</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-blue-400 fill-blue-400" />
                  <span className="hidden sm:inline">Oscuro</span>
                </>
              )}
            </button>

            {/* Conmutador Prominente: [🔥 MODO TURNO] vs [👑 MODO DUEÑA] */}
            {isAdminOrSupervisor && (
              <div className="flex items-center bg-neutral-900/90 dark:bg-neutral-900 p-0.5 sm:p-1 rounded-2xl border border-neutral-700/80 shadow-inner min-h-[38px] sm:min-h-[44px]">
                <button
                  type="button"
                  onClick={() => handleToggleUiMode('turno')}
                  className={`min-h-[34px] sm:min-h-[40px] px-2.5 sm:px-4 py-1 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                    uiMode === 'turno'
                      ? 'bg-amber-500 text-black shadow-md scale-[1.02]'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="text-[11px] sm:text-xs">TURNO</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleUiMode('duena')}
                  className={`min-h-[34px] sm:min-h-[40px] px-2.5 sm:px-4 py-1 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                    uiMode === 'duena'
                      ? 'bg-amber-400 text-black shadow-md scale-[1.02]'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
                  }`}
                >
                  <Crown className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="text-[11px] sm:text-xs">DUEÑA</span>
                </button>
              </div>
            )}

            {/* Tasa BCV Oficial / Día Siguiente */}
            <div
              onClick={() => {
                if (isAdminOrSupervisor) handleOpenBcvModal();
              }}
              className={`hidden sm:flex items-center gap-1.5 bg-tocineta-bg px-2.5 py-1.5 rounded-lg border border-tocineta-border text-xs ${
                isAdminOrSupervisor ? 'cursor-pointer hover:border-tocineta-yellow/60 transition-all' : ''
              }`}
              title={isAdminOrSupervisor ? 'Clic para cambiar o sincronizar tasa BCV' : 'Tasa BCV Oficial'}
            >
              <span className="text-tocineta-muted hidden lg:inline">Tasa BCV Vigente / Día Siguiente:</span>
              <span className="text-tocineta-muted lg:hidden">BCV:</span>
              <span className="font-bold text-tocineta-text font-mono">{formattedRate} Bs/$</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSyncBcv();
                }}
                disabled={isSyncingBcv}
                title="Tomar Tasa BCV Día Siguiente"
                className="ml-1 p-0.5 hover:bg-tocineta-card rounded text-xs text-tocineta-yellow hover:text-tocineta-text transition-all disabled:opacity-40"
              >
                {isSyncingBcv ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Conmutador USD / Bs */}
            <div className="flex items-center bg-tocineta-bg p-0.5 sm:p-1 rounded-xl border border-tocineta-border">
              <button
                onClick={() => setCurrency('USD')}
                className={`px-2.5 sm:px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                  currency === 'USD'
                    ? 'bg-tocineta-yellow text-tocineta-bg shadow-sm'
                    : 'text-tocineta-muted hover:text-tocineta-text'
                }`}
              >
                USD ($)
              </button>
              <button
                onClick={() => setCurrency('BS')}
                className={`px-2.5 sm:px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                  currency === 'BS'
                    ? 'bg-tocineta-yellow text-tocineta-bg shadow-sm'
                    : 'text-tocineta-muted hover:text-tocineta-text'
                }`}
              >
                Bs (VES)
              </button>
            </div>

            {/* Usuario Actual y Salir */}
            {user && (
              <div className="flex items-center gap-2 pl-2 border-l border-tocineta-border">
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-bold text-tocineta-text leading-tight">{user.name}</div>
                  <div className="text-[10px] text-tocineta-yellow uppercase tracking-wider font-semibold">
                    {user.role}
                  </div>
                </div>
                {user.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => setIsSupportModalOpen(true)}
                    title="Modo Soporte Auditado Varons Media"
                    className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-500 hover:bg-amber-500/20 transition-all text-xs font-bold flex items-center gap-1"
                  >
                    <Wrench className="w-4 h-4" />
                    <span className="hidden lg:inline text-[11px]">Soporte</span>
                  </button>
                )}
                <button
                  onClick={handleLogout}
                  title="Cerrar Sesión"
                  className="p-2 rounded-lg bg-tocineta-bg border border-tocineta-border hover:border-red-500/50 text-tocineta-muted hover:text-red-400 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Pestañas de Navegación Operativa (Cero Jerga Técnica) */}
        <div className="max-w-7xl mx-auto flex items-center gap-2 mt-3 pt-2 border-t border-tocineta-border/60 overflow-x-auto">
          {/* Tomar Pedido (pos) */}
          {allowedTabs.includes('pos') && (
            <button
              type="button"
              onClick={() => onTabChange('pos')}
              className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 cursor-pointer ${
                currentTab === 'pos'
                  ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                  : 'text-tocineta-muted hover:text-white hover:bg-tocineta-bg'
              }`}
            >
              <Utensils className="w-4 h-4" />
              <span>Tomar Pedido</span>
            </button>
          )}

          {/* Caja y Cobros (cashier) */}
          {(allowedTabs.includes('cashier') || canPay) && (
            <button
              type="button"
              onClick={() => handleTabClick('cashier')}
              className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 cursor-pointer ${
                currentTab === 'cashier'
                  ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                  : 'text-tocineta-muted hover:text-white hover:bg-tocineta-bg'
              }`}
            >
              <ShoppingCart className="w-4 h-4" />
              <span>Caja y Cobros</span>
            </button>
          )}

          {/* Cocina y Plancha (kds) */}
          {allowedTabs.includes('kds') && (
            <button
              type="button"
              onClick={() => handleTabClick('kds')}
              className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 cursor-pointer ${
                currentTab === 'kds'
                  ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                  : 'text-tocineta-muted hover:text-white hover:bg-tocineta-bg'
              }`}
            >
              <ChefHat className="w-4 h-4" />
              <span>Cocina y Plancha</span>
            </button>
          )}

          {/* Pestañas exclusivas de MODO DUEÑA (Ocultas en MODO TURNO) */}
          {isAdminOrSupervisor && uiMode === 'duena' && (
            <>
              {/* Carta, Precios y Cupones */}
              <button
                type="button"
                onClick={() => handleTabClick('menu-admin')}
                className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 cursor-pointer ${
                  currentTab === 'menu-admin'
                    ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                    : 'text-tocineta-muted hover:text-white hover:bg-tocineta-bg'
                }`}
              >
                <ClipboardList className="w-4 h-4" />
                <span>Carta, Precios y Cupones</span>
              </button>

              {/* Mi Equipo y Permisos */}
              <button
                type="button"
                onClick={() => handleTabClick('staff')}
                className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 cursor-pointer ${
                  currentTab === 'staff'
                    ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                    : 'text-tocineta-muted hover:text-white hover:bg-tocineta-bg'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Mi Equipo y Permisos</span>
                {pendingApprovalsCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-red-600 text-white rounded-full font-black animate-pulse shadow">
                    {pendingApprovalsCount}
                  </span>
                )}
              </button>

              {/* Mis Ganancias e Inventario */}
              <button
                type="button"
                onClick={() => handleTabClick('profitability')}
                className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 cursor-pointer ${
                  currentTab === 'profitability'
                    ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                    : 'text-tocineta-muted hover:text-white hover:bg-tocineta-bg'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
                <span>Mis Ganancias e Inventario</span>
                {!profitSettings?.profitabilityProEnabled && (
                  <span className="text-[9px] bg-zinc-800 text-zinc-400 px-1 py-0.2 rounded font-mono">
                    Off
                  </span>
                )}
              </button>

              {/* Impresoras y Respaldos */}
              <button
                type="button"
                onClick={() => handleTabClick('health')}
                className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 cursor-pointer ${
                  currentTab === 'health'
                    ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                    : 'text-tocineta-muted hover:text-white hover:bg-tocineta-bg'
                }`}
              >
                <Printer className="w-4 h-4" />
                <span>Impresoras y Respaldos</span>
              </button>

              {/* Ventas en Talonario */}
              <button
                type="button"
                onClick={() => handleTabClick('emergency')}
                className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 cursor-pointer ${
                  currentTab === 'emergency'
                    ? 'bg-amber-500 text-tocineta-bg shadow-md'
                    : 'text-amber-400/80 hover:text-amber-300 hover:bg-tocineta-bg border border-amber-500/30'
                }`}
              >
                <Receipt className="w-4 h-4" />
                <span>Ventas en Talonario</span>
              </button>
            </>
          )}

          {/* Si el usuario NO es admin/supervisor pero tiene permisos para talonario o diagnóstico */}
          {!isAdminOrSupervisor && allowedTabs.includes('emergency') && (
            <button
              type="button"
              onClick={() => handleTabClick('emergency')}
              className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shrink-0 cursor-pointer ${
                currentTab === 'emergency'
                  ? 'bg-amber-500 text-tocineta-bg shadow-md'
                  : 'text-amber-400/80 hover:text-amber-300 hover:bg-tocineta-bg border border-amber-500/30'
              }`}
            >
              <Receipt className="w-4 h-4" />
              <span>Ventas en Talonario</span>
            </button>
          )}
        </div>
      </header>

      {/* Contenido Principal con padding inferior en móvil para la barra de navegación */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 pb-24 sm:pb-8">
        {children}
      </main>

      {/* Barra de Navegación Móvil Inferior (Fix Táctil Celular) */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0E1118]/95 backdrop-blur-lg border-t border-tocineta-border/80 px-2 py-1.5 flex items-center justify-around shadow-2xl">
        {allowedTabs.includes('pos') && (
          <button
            type="button"
            onClick={() => onTabChange('pos')}
            className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
              currentTab === 'pos'
                ? 'text-tocineta-yellow font-black'
                : 'text-tocineta-muted hover:text-white'
            }`}
          >
            <Utensils className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] tracking-tight">Tomar Pedido</span>
          </button>
        )}

        {(allowedTabs.includes('cashier') || canPay) && (
          <button
            type="button"
            onClick={() => handleTabClick('cashier')}
            className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
              currentTab === 'cashier'
                ? 'text-tocineta-yellow font-black'
                : 'text-tocineta-muted hover:text-white'
            }`}
          >
            <ShoppingCart className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] tracking-tight">Caja</span>
          </button>
        )}

        {allowedTabs.includes('kds') && (
          <button
            type="button"
            onClick={() => handleTabClick('kds')}
            className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
              currentTab === 'kds'
                ? 'text-tocineta-yellow font-black'
                : 'text-tocineta-muted hover:text-white'
            }`}
          >
            <ChefHat className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] tracking-tight">Cocina</span>
          </button>
        )}

        {isAdminOrSupervisor && uiMode === 'duena' && (
          <button
            type="button"
            onClick={() => handleTabClick('menu-admin')}
            className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
              currentTab === 'menu-admin'
                ? 'text-tocineta-yellow font-black'
                : 'text-tocineta-muted hover:text-white'
            }`}
          >
            <ClipboardList className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] tracking-tight">Carta</span>
          </button>
        )}

        {isAdminOrSupervisor && uiMode === 'duena' && (
          <button
            type="button"
            onClick={() => handleTabClick('staff')}
            className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all relative cursor-pointer ${
              currentTab === 'staff'
                ? 'text-tocineta-yellow font-black'
                : 'text-tocineta-muted hover:text-white'
            }`}
          >
            <Users className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] tracking-tight">Equipo</span>
            {pendingApprovalsCount > 0 && (
              <span className="absolute top-0 right-1 w-2 h-2 rounded-full bg-red-600 animate-pulse" />
            )}
          </button>
        )}
      </nav>

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

      {/* MODAL TASA BCV OFICIAL / DÍA SIGUIENTE */}
      {isBcvModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-tocineta-card border border-tocineta-border rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-tocineta-border">
              <div className="flex items-center gap-2">
                <span className="text-xl">🇻🇪</span>
                <h3 className="text-sm font-extrabold text-tocineta-text">Tasa BCV Vigente / Día Siguiente</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsBcvModalOpen(false)}
                className="text-tocineta-muted hover:text-tocineta-text cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-[11px] text-tocineta-muted mt-2">
              Horario Food Truck (5:00 PM - 6:00 PM): El BCV ya emitió la tasa oficial con fecha valor del día siguiente hábil.
            </p>

            <div className="my-4 space-y-3">
              <div>
                <label className="text-xs text-tocineta-muted block mb-1 font-semibold">
                  Editar tasa en 1 clic (Bs/$):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="ej. 45.50"
                    value={manualBcvInput}
                    onChange={e => setManualBcvInput(e.target.value)}
                    className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-2 text-sm text-tocineta-text font-mono font-bold focus:border-tocineta-yellow outline-none"
                    autoFocus
                  />
                  <span className="absolute right-3 top-2 text-xs text-tocineta-muted font-mono">
                    Bs/$
                  </span>
                </div>
              </div>

              {bcvModalMsg && (
                <p className={`text-xs text-center font-semibold ${bcvModalMsg.startsWith('✓') ? 'text-emerald-500' : 'text-red-500'}`}>
                  {bcvModalMsg}
                </p>
              )}
            </div>

            <div className="space-y-2 pt-2 border-t border-tocineta-border">
              <button
                type="button"
                onClick={handleSaveManualBcv}
                disabled={isSavingBcv || !manualBcvInput}
                className="w-full py-2.5 rounded-xl bg-tocineta-yellow text-tocineta-bg font-black text-xs uppercase hover:bg-tocineta-yellow/90 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 shadow cursor-pointer"
              >
                {isSavingBcv ? 'Guardando...' : 'Guardar Tasa Manual'}
              </button>

              <button
                type="button"
                onClick={async () => {
                  await handleSyncBcv();
                  setBcvModalMsg('✓ Tasa BCV Oficial Día Siguiente obtenida con éxito');
                  setTimeout(() => setIsBcvModalOpen(false), 1200);
                }}
                disabled={isSyncingBcv}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
              >
                <span>🔄</span>
                <span>{isSyncingBcv ? 'Sincronizando...' : 'Tomar Tasa BCV Día Siguiente'}</span>
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
