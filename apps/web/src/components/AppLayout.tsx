import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { canUserProcessPayments } from '@tocineta/shared';
import { useAuth } from '../context/AuthContext.js';
import { SupportBanner, StartSupportModal } from './SupportBanner.js';
import { FaithBanner } from './FaithBanner.js';
import { queryClient, ALLOWED_TABS_BY_ROLE, type TabType } from '../App.js';
import {
  Menu,
  X,
  Sun,
  Moon,
  LogOut,
  Smartphone,
  RotateCw,
  RefreshCw,
  Wrench
} from 'lucide-react';

interface AppLayoutProps {
  currentTab: TabType;
  onTabChange: (tab: TabType) => void;
  formattedRate?: string;
  children: React.ReactNode;
}

const TAB_TITLES: Record<TabType, string> = {
  pos: 'Tomar Pedido',
  cashier: 'Caja, Cobros y Cierre del Día',
  kds: 'Plancha y Cocina (KDS)',
  profitability: 'Centro Financiero e Inventario',
  'menu-admin': 'Carta, Recetas y Precios',
  staff: 'Personal, Permisos y Nómina',
  health: 'Impresoras, Respaldos y Configuración',
  emergency: 'Ventas en Talonario de Contingencia',
  'qr-menu': 'Menú Digital QR y Web'
};

export const AppLayout: React.FC<AppLayoutProps> = ({
  currentTab,
  onTabChange,
  formattedRate = '40,00',
  children
}) => {
  const { user, token, logout, changePin } = useAuth();
  const [isSyncingBcv, setIsSyncingBcv] = useState(false);
  const [isBcvModalOpen, setIsBcvModalOpen] = useState(false);
  const [manualBcvInput, setManualBcvInput] = useState('');
  const [bcvModalMsg, setBcvModalMsg] = useState<string | null>(null);
  const [isSavingBcv, setIsSavingBcv] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // 1. Tema Base Blanco Minimalista por defecto ('light') con persistencia
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

  // 2. Selector de Sede Activa ('sede_a' | 'sede_b')
  const [activeSede, setActiveSede] = useState<'sede_a' | 'sede_b'>(() => {
    try {
      const saved = localStorage.getItem('tocineta_active_sede');
      if (saved === 'sede_a' || saved === 'sede_b') return saved;
    } catch {}
    return 'sede_b'; // Sede B: Alta Vista por defecto
  });

  const handleToggleSede = () => {
    setActiveSede(prev => {
      const next = prev === 'sede_a' ? 'sede_b' : 'sede_a';
      try {
        localStorage.setItem('tocineta_active_sede', next);
      } catch {}
      return next;
    });
  };

  // 3. Conmutador [🟢 Modo Básico] / [🟣 Modo Pro]
  const [uiMode, setUiMode] = useState<'basico' | 'pro'>(() => {
    try {
      const saved = localStorage.getItem('tocineta_ui_mode');
      if (saved === 'pro' || saved === 'basico') return saved;
      if (saved === 'duena') return 'pro';
      if (saved === 'turno') return 'basico';
    } catch {}
    return 'basico';
  });

  const handleToggleUiMode = (newMode: 'basico' | 'pro') => {
    setUiMode(newMode);
    try {
      localStorage.setItem('tocineta_ui_mode', newMode);
    } catch {}
    if (newMode === 'basico') {
      const adminTabs: TabType[] = ['menu-admin', 'staff', 'profitability', 'health', 'emergency', 'qr-menu'];
      if (adminTabs.includes(currentTab)) {
        onTabChange('pos');
      }
    }
  };

  // 4. Manejo de PWA (Instalabilidad en este dispositivo)
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          setDeferredPrompt(null);
        }
      } catch {
        setIsInstallModalOpen(true);
      }
    } else {
      setIsInstallModalOpen(true);
    }
  };

  // 5. Sincronización y Cambio de Tasa BCV
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
      // Ignorar fallo de red
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
        setTimeout(() => setIsBcvModalOpen(false), 1000);
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

  // Cambio Obligatorio de PIN
  const [currentPinInput, setCurrentPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [activePinField, setActivePinField] = useState<'current' | 'new' | 'confirm'>('current');
  const [changePinError, setChangePinError] = useState<string | null>(null);
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);

  const requiredPinLength = (user?.role === 'admin' || user?.role === 'supervisor') ? 6 : 4;

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

  const isAdmin = user?.role === 'admin' || user?.role === 'supervisor';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B0D11] text-slate-900 dark:text-slate-100 flex flex-col font-sans select-none">
      {/* Franja de Fe y Honra a Dios */}
      <FaithBanner />

      {/* Banner de Modo Soporte Técnico */}
      <SupportBanner />

      {/* Menú Lateral Desplegable (Drawer Limpio y Unificado) */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setIsDrawerOpen(false)}
          />

          <aside className="relative w-80 max-w-[85vw] h-full bg-white dark:bg-[#121620] text-slate-900 dark:text-white border-r border-slate-200 dark:border-neutral-800 shadow-2xl flex flex-col z-10 overflow-hidden">
            {/* Cabecera del Drawer */}
            <div className="p-4 border-b border-slate-200 dark:border-neutral-800 flex items-center justify-between bg-slate-50 dark:bg-[#0c0f17]">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">🥓</span>
                <div>
                  <h3 className="font-extrabold text-sm tracking-wider text-slate-900 dark:text-white">TOCINETA</h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">Sistema Operativo Gastronómico</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Opciones de Navegación del Drawer */}
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {/* 🟢 SECCIÓN: OPERACIONES RÁPIDAS (MODO BÁSICO) */}
              <div>
                <div className="px-2 pb-1.5 text-[11px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <span>🟢</span>
                  <span>OPERACIONES RÁPIDAS</span>
                </div>
                <div className="space-y-1">
                  {/* 1. Tomar Pedido (UNIFICADO: Mostrador, Mesas y Delivery) */}
                  <button
                    type="button"
                    onClick={() => handleDrawerNav('pos')}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      currentTab === 'pos'
                        ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">🍔</span>
                      <div className="text-left">
                        <div>Tomar Pedido</div>
                        <div className="text-[10px] opacity-70 font-normal">Mostrador, Mesas y Delivery</div>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono opacity-80">POS</span>
                  </button>

                  {/* 2. Plancha y Cocina (KDS) */}
                  {allowedTabs.includes('kds') && (
                    <button
                      type="button"
                      onClick={() => handleDrawerNav('kds')}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        currentTab === 'kds'
                          ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">🍳</span>
                        <div className="text-left">
                          <div>Plancha y Cocina (KDS)</div>
                          <div className="text-[10px] opacity-70 font-normal">Comandas en tiempo real</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono opacity-80">KDS</span>
                    </button>
                  )}

                  {/* 3. Caja, Cobros y Cierre del Día */}
                  {(allowedTabs.includes('cashier') || canPay) && (
                    <button
                      type="button"
                      onClick={() => handleDrawerNav('cashier')}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        currentTab === 'cashier'
                          ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">💵</span>
                        <div className="text-left">
                          <div>Caja, Cobros y Cierre del Día</div>
                          <div className="text-[10px] opacity-70 font-normal">Cobros múltiples y reporte Z</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono opacity-80">CAJA</span>
                    </button>
                  )}

                  {/* 4. Inventario Rápido y Envíos entre Sedes */}
                  {allowedTabs.includes('profitability') && (
                    <button
                      type="button"
                      onClick={() => handleDrawerNav('profitability', 'inventory')}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60 transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">📦</span>
                        <div className="text-left">
                          <div>Inventario Rápido y Sedes</div>
                          <div className="text-[10px] opacity-70 font-normal">Stock y traslados entre sedes</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono opacity-80">STOCK</span>
                    </button>
                  )}
                </div>
              </div>

              {/* 🟣 SECCIÓN: HERRAMIENTAS GERENCIALES (MODO PRO) */}
              {isAdmin && uiMode === 'pro' && (
                <div className="pt-3 border-t border-slate-200 dark:border-neutral-800">
                  <div className="px-2 pb-1.5 text-[11px] font-black uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                    <span>🟣</span>
                    <span>HERRAMIENTAS GERENCIALES (PRO)</span>
                  </div>
                  <div className="space-y-1">
                    {/* 5. Carta, Recetas y Precios */}
                    <button
                      type="button"
                      onClick={() => handleDrawerNav('menu-admin')}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        currentTab === 'menu-admin'
                          ? 'bg-purple-600 text-white font-black shadow-sm'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">📋</span>
                        <div className="text-left">
                          <div>Carta, Recetas y Precios</div>
                          <div className="text-[10px] opacity-70 font-normal">Margen y costos de insumos</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono opacity-80">CARTA</span>
                    </button>

                    {/* 6. Centro Financiero, Compras y Mermas */}
                    <button
                      type="button"
                      onClick={() => handleDrawerNav('profitability', 'net-profit')}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        currentTab === 'profitability'
                          ? 'bg-purple-600 text-white font-black shadow-sm'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">📊</span>
                        <div className="text-left">
                          <div>Centro Financiero y Compras</div>
                          <div className="text-[10px] opacity-70 font-normal">Utilidad neta, compras y mermas</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono opacity-80">BALANCE</span>
                    </button>

                    {/* 7. Clientes por Cobrar, Proveedores y Socios */}
                    <button
                      type="button"
                      onClick={() => handleDrawerNav('profitability', 'receivables')}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60 transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">🤝</span>
                        <div className="text-left">
                          <div>Clientes y Cuentas por Cobrar</div>
                          <div className="text-[10px] opacity-70 font-normal">Socios, aliados y proveedores</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono opacity-80">CUENTAS</span>
                    </button>

                    {/* 8. Personal, Permisos y Nómina */}
                    <button
                      type="button"
                      onClick={() => handleDrawerNav('staff')}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        currentTab === 'staff'
                          ? 'bg-purple-600 text-white font-black shadow-sm'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">👥</span>
                        <div className="text-left">
                          <div>Personal, Permisos y Nómina</div>
                          <div className="text-[10px] opacity-70 font-normal">Aprobación de empleados y sueldos</div>
                        </div>
                      </div>
                      {pendingApprovalsCount > 0 && (
                        <span className="px-1.5 py-0.5 text-[9px] bg-red-600 text-white rounded-full font-black animate-pulse">
                          {pendingApprovalsCount}
                        </span>
                      )}
                    </button>

                    {/* 9. Cotizador de Eventos y Empresas */}
                    <button
                      type="button"
                      onClick={() => handleDrawerNav('profitability', 'quotes')}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60 transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">🎉</span>
                        <div className="text-left">
                          <div>Cotizador de Eventos y Empresas</div>
                          <div className="text-[10px] opacity-70 font-normal">Presupuestos y WhatsApp oficial</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono opacity-80">EVENTOS</span>
                    </button>

                    {/* 10. Impresoras, Respaldos y Talonario */}
                    <button
                      type="button"
                      onClick={() => handleDrawerNav('health')}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        currentTab === 'health'
                          ? 'bg-purple-600 text-white font-black shadow-sm'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">🖨️</span>
                        <div className="text-left">
                          <div>Impresoras, Respaldos y Sistema</div>
                          <div className="text-[10px] opacity-70 font-normal">Térmicas, diagnósticos y copias</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono opacity-80">SISTEMA</span>
                    </button>

                    {/* Menú Digital QR */}
                    <button
                      type="button"
                      onClick={() => handleDrawerNav('qr-menu')}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        currentTab === 'qr-menu'
                          ? 'bg-purple-600 text-white font-black shadow-sm'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">📱</span>
                        <div className="text-left">
                          <div>Menú Digital QR y Web</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono opacity-80">QR</span>
                    </button>

                    {/* Ventas en Talonario de Contingencia */}
                    <button
                      type="button"
                      onClick={() => handleDrawerNav('emergency')}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        currentTab === 'emergency'
                          ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                          : 'text-amber-700 dark:text-amber-400 hover:bg-amber-500/10'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">🧾</span>
                        <div className="text-left">
                          <div>Ventas en Talonario de Contingencia</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono opacity-80">PAPEL</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Pie del Drawer */}
            <div className="p-3 border-t border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-[#0c0f17] space-y-2">
              {/* Conmutador de Tema [☀️ Modo Claro / 🌙 Modo Oscuro] */}
              <button
                type="button"
                onClick={handleToggleTheme}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 text-slate-800 dark:text-white text-xs font-bold shadow-xs hover:bg-slate-100 dark:hover:bg-neutral-700 transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  {theme === 'light' ? (
                    <>
                      <Sun className="w-4 h-4 text-amber-500 fill-amber-400" />
                      <span>Modo Claro Activo</span>
                    </>
                  ) : (
                    <>
                      <Moon className="w-4 h-4 text-blue-400 fill-blue-400" />
                      <span>Modo Oscuro Activo</span>
                    </>
                  )}
                </div>
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                  Cambiar
                </span>
              </button>

              {/* Botón Instalar Aplicación */}
              <button
                type="button"
                onClick={handleInstallClick}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                <Smartphone className="w-4 h-4" />
                <span>📲 Instalar Aplicación en este Dispositivo</span>
              </button>

              {/* Información de Usuario y Botón Cerrar Sesión */}
              <div className="pt-2 border-t border-slate-200 dark:border-neutral-800 flex items-center justify-between">
                <div className="text-left">
                  <div className="text-xs font-black text-slate-900 dark:text-white leading-tight">{user?.name}</div>
                  <div className="text-[10px] text-amber-600 dark:text-amber-400 uppercase tracking-wider font-bold">
                    Rol: {user?.role}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-3 py-1.5 rounded-xl border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Cerrar Sesión</span>
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Barra Superior Minimalista (Solo lo esencial) */}
      <header className="bg-white dark:bg-[#121620] border-b border-slate-200 dark:border-neutral-800 sticky top-0 z-40 px-3 py-2 sm:px-6 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          {/* Izquierda: [☰ Menú] (min-h-[48px]) + Logo TOCINETA + Título de la pantalla actual */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsDrawerOpen(true)}
              className="min-h-[48px] min-w-[48px] px-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-800 dark:text-white border border-slate-200 dark:border-neutral-700 font-black text-xs flex items-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs"
              title="Abrir Menú Lateral"
            >
              <Menu className="w-5 h-5 text-amber-500" />
              <span className="hidden sm:inline">Menú</span>
            </button>

            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-2xl shadow-inner">
                🥓
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-black text-base sm:text-lg tracking-wider text-slate-900 dark:text-white">
                    TOCINETA
                  </span>
                </div>
                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 truncate max-w-[160px] sm:max-w-none">
                  {TAB_TITLES[currentTab] || 'Comandero'}
                </p>
              </div>
            </div>
          </div>

          {/* Derecha: Selector de Sede + [Modo Básico / Modo Pro] + [BCV: Bs. XX,XX] */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Selector rápido de Sede Activa */}
            <button
              type="button"
              onClick={handleToggleSede}
              className="min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-neutral-700 bg-slate-50 hover:bg-slate-100 dark:bg-neutral-800/80 dark:hover:bg-neutral-800 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
              title="Alternar Sede Activa"
            >
              <span>📍</span>
              <span className="hidden md:inline">{activeSede === 'sede_a' ? 'Sede A: Los Olivos' : 'Sede B: Alta Vista'}</span>
              <span className="md:hidden">{activeSede === 'sede_a' ? 'Los Olivos' : 'Alta Vista'}</span>
            </button>

            {/* Conmutador [🟢 Modo Básico] / [🟣 Modo Pro] (Visible solo para ADMIN) */}
            {isAdmin && (
              <div className="flex items-center bg-slate-100 dark:bg-neutral-900 p-0.5 rounded-xl border border-slate-200 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => handleToggleUiMode('basico')}
                  className={`min-h-[38px] px-2.5 sm:px-3 py-1 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                    uiMode === 'basico'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                  }`}
                >
                  <span>🟢</span>
                  <span className="hidden sm:inline">Modo Básico</span>
                  <span className="sm:hidden">Básico</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleUiMode('pro')}
                  className={`min-h-[38px] px-2.5 sm:px-3 py-1 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                    uiMode === 'pro'
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                  }`}
                >
                  <span>🟣</span>
                  <span className="hidden sm:inline">Modo Pro</span>
                  <span className="sm:hidden">Pro</span>
                </button>
              </div>
            )}

            {/* Botón [BCV: Bs. XX,XX] (Al tocarlo abre popover para cambiar tasa) */}
            <button
              type="button"
              onClick={handleOpenBcvModal}
              className="min-h-[42px] px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs font-black flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
              title="Tocar para cambiar tasa BCV"
            >
              <span className="text-slate-500 dark:text-slate-400 font-medium hidden sm:inline">BCV:</span>
              <span className="font-mono">{formattedRate} Bs/$</span>
            </button>

            {/* Soporte Técnico (Solo admin) */}
            {user?.role === 'admin' && (
              <button
                type="button"
                onClick={() => setIsSupportModalOpen(true)}
                title="Modo Soporte Técnico"
                className="min-h-[42px] p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-neutral-700 transition-all cursor-pointer"
              >
                <Wrench className="w-4 h-4 text-amber-500" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Contenido Principal */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-6 lg:p-8">
        {children}
      </main>

      {/* Modal Explicativo de Instalación de la App (PWA) */}
      {isInstallModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-neutral-800 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">📲</span>
                <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                  Instalar TOCINETA en este Dispositivo
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsInstallModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Instala TOCINETA para tener acceso directo instantáneo desde tu pantalla de inicio o escritorio sin barras de navegación:
            </p>

            <div className="space-y-3 bg-slate-50 dark:bg-neutral-900/60 p-4 rounded-2xl border border-slate-200 dark:border-neutral-800">
              <div className="flex items-start gap-3 text-xs">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold shrink-0 text-[11px]">
                  1
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white block">Abre el menú de tu navegador</strong>
                  <span className="text-slate-500 dark:text-slate-400">
                    En Chrome o Edge haz clic en los tres puntos <code className="font-mono font-bold">⋮</code> arriba a la derecha. En iPhone/iPad toca el botón Compartir <code className="font-mono font-bold">⬆️</code> en Safari.
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 text-xs">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold shrink-0 text-[11px]">
                  2
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-white block">Selecciona Instalar o Agregar</strong>
                  <span className="text-slate-500 dark:text-slate-400">
                    Toca <strong>"Instalar aplicación"</strong> o <strong>"Agregar a la pantalla de inicio"</strong> y confirma.
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsInstallModalOpen(false)}
              className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* Modal Obligatorio de Cambio de PIN */}
      {user?.mustChangePin && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#121620] border border-amber-500/40 rounded-3xl p-5 max-w-md w-full shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-500 flex items-center justify-center mx-auto text-2xl mb-2 shadow-inner">
              🔑
            </div>
            <h3 className="text-lg font-black text-slate-900 dark:text-white text-center">Cambio Obligatorio de PIN</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 text-center">
              Hola, <span className="font-bold text-slate-900 dark:text-white">{user.name}</span>. Por seguridad física y auditoría, debe establecer su PIN de {requiredPinLength} dígitos antes de continuar.
            </p>

            <div className="space-y-2.5 my-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
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
                  className={`w-full text-center text-lg font-mono bg-slate-50 dark:bg-neutral-900 border rounded-xl py-2 text-slate-900 dark:text-white outline-none transition-all ${
                    activePinField === 'current' ? 'border-amber-500 ring-1 ring-amber-500/40' : 'border-slate-200 dark:border-neutral-700'
                  }`}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                    {`Nuevo PIN (${requiredPinLength} dígitos):`}
                  </label>
                  <div className="flex items-center gap-1.5">
                    {Array.from({ length: requiredPinLength }).map((_, idx) => (
                      <span
                        key={idx}
                        className={`inline-block w-2.5 h-2.5 rounded-full transition-all ${
                          idx < newPinInput.length ? 'bg-amber-500 scale-110 shadow-sm' : 'bg-slate-300 dark:bg-zinc-700'
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
                  className={`w-full text-center text-lg font-mono tracking-widest bg-slate-50 dark:bg-neutral-900 border rounded-xl py-2 text-slate-900 dark:text-white outline-none transition-all ${
                    activePinField === 'new' ? 'border-amber-500 ring-1 ring-amber-500/40' : 'border-slate-200 dark:border-neutral-700'
                  }`}
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
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
                  className={`w-full text-center text-lg font-mono tracking-widest bg-slate-50 dark:bg-neutral-900 border rounded-xl py-2 text-slate-900 dark:text-white outline-none transition-all ${
                    activePinField === 'confirm' ? 'border-amber-500 ring-1 ring-amber-500/40' : 'border-slate-200 dark:border-neutral-700'
                  }`}
                />
              </div>

              {changePinError && (
                <div className="p-2 bg-red-500/20 border border-red-500/40 rounded-xl text-xs text-red-500 text-center font-medium">
                  {changePinError}
                </div>
              )}
            </div>

            {/* Teclado Numérico Táctil */}
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
                  className="min-h-[48px] text-lg font-bold rounded-xl bg-slate-100 dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 hover:border-amber-500 active:scale-95 text-slate-900 dark:text-white transition-all shadow-xs flex items-center justify-center cursor-pointer"
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
                className="min-h-[48px] text-xs font-bold uppercase rounded-xl bg-slate-100 dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 hover:border-red-500 text-slate-500 hover:text-red-500 active:scale-95 transition-all flex items-center justify-center cursor-pointer"
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
                className="min-h-[48px] text-lg font-bold rounded-xl bg-slate-100 dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 hover:border-amber-500 active:scale-95 text-slate-900 dark:text-white transition-all shadow-xs flex items-center justify-center cursor-pointer"
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
                className="min-h-[48px] text-base font-bold rounded-xl bg-slate-100 dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 hover:border-amber-500 text-slate-500 hover:text-amber-500 active:scale-95 transition-all flex items-center justify-center cursor-pointer"
              >
                ⌫
              </button>
            </div>

            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={logout}
                className="flex-1 min-h-[48px] py-2.5 rounded-xl border border-slate-200 dark:border-neutral-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-neutral-800 transition-all flex items-center justify-center cursor-pointer"
              >
                Cerrar Sesión
              </button>
              <button
                type="button"
                onClick={handleChangePin}
                disabled={isChangingPin || !currentPinInput || newPinInput.length !== requiredPinLength || confirmPinInput.length !== requiredPinLength}
                className="flex-1 min-h-[48px] py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-black uppercase tracking-wider hover:bg-amber-400 active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center cursor-pointer"
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
          <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <span className="text-xl">🇻🇪</span>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">Tasa BCV Oficial</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsBcvModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
              Edita la tasa en 1 clic para recalcular todos los precios en bolívares al instante o sincroniza con el BCV oficial.
            </p>

            <div className="my-4 space-y-3">
              <div>
                <label className="text-xs text-slate-600 dark:text-slate-300 block mb-1 font-semibold">
                  Tasa manual (Bs/$):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="ej. 45.50"
                    value={manualBcvInput}
                    onChange={e => setManualBcvInput(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white font-mono font-bold focus:border-amber-500 outline-none"
                    autoFocus
                  />
                  <span className="absolute right-3 top-2 text-xs text-slate-400 font-mono">
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

            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-neutral-800">
              <button
                type="button"
                onClick={handleSaveManualBcv}
                disabled={isSavingBcv || !manualBcvInput}
                className="w-full py-2.5 rounded-xl bg-amber-500 text-slate-950 font-black text-xs uppercase hover:bg-amber-400 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
              >
                {isSavingBcv ? 'Guardando...' : 'Guardar Tasa Manual'}
              </button>

              <button
                type="button"
                onClick={async () => {
                  await handleSyncBcv();
                  setBcvModalMsg('✓ Tasa BCV Oficial obtenida con éxito');
                  setTimeout(() => setIsBcvModalOpen(false), 1000);
                }}
                disabled={isSyncingBcv}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
              >
                {isSyncingBcv ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                <span>{isSyncingBcv ? 'Sincronizando...' : 'Tomar Tasa BCV Oficial'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para Iniciar Modo Soporte */}
      <StartSupportModal
        isOpen={isSupportModalOpen}
        onClose={() => setIsSupportModalOpen(false)}
      />
    </div>
  );
};
