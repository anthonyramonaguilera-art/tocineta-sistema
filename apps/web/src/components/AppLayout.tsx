import React, { useState, useEffect } from 'react';
import { canUserProcessPayments } from '@tocineta/shared';
import { useAuth } from '../context/AuthContext.js';
import { queryClient, ALLOWED_TABS_BY_ROLE, type TabType } from '../App.js';
import { AppHeader } from './AppHeader.js';
import { AppSidebar } from './AppSidebar.js';
import { PrintAttentionModal } from '../features/cashier/PrintAttentionModal.js';
import { TicketPreviewModal } from '../features/cashier/TicketPreviewModal.js';
import { ChangePinModal } from '../features/auth/ChangePinModal.js';
import { BcvRateModal } from './BcvRateModal.js';

/**
 * TOCINETA — Layout principal con cabecera oficial y navegación por roles
 */

interface AppLayoutProps {
  currentTab: TabType;
  onTabChange: (tab: TabType) => void;
  formattedRate?: string;
  children: React.ReactNode;
}

export const VIEW_TITLES: Record<TabType, string> = {
  home: 'Inicio',
  pos: 'Tomar pedido',
  cashier: 'Caja',
  kds: 'Cocina',
  profitability: 'Inventario',
  'menu-admin': 'Carta',
  staff: 'Personal',
  health: 'Salud',
  emergency: 'Contingencia',
  'qr-menu': 'Menú QR',
  owner: 'Panel dueña',
  finances: 'Finanzas',
  quotes: 'Cotizador',
  partners: 'Socios',
  settings: 'Ajustes'
};

export const AppLayout: React.FC<AppLayoutProps> = ({
  currentTab,
  onTabChange,
  formattedRate = '40,00',
  children
}) => {
  const { user, token, logout } = useAuth();
  const [isBcvModalOpen, setIsBcvModalOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);

  const mustChangePin = Boolean(user?.mustChangePin);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 1. Tema Claro por defecto ('light') con persistencia por dispositivo
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
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // 2. Selector de Sede Activa ('sede_a' | 'sede_b')
  const [activeSede, setActiveSede] = useState<'sede_a' | 'sede_b'>(() => {
    try {
      const saved = localStorage.getItem('tocineta_active_sede');
      if (saved === 'sede_a' || saved === 'sede_b') return saved;
    } catch {}
    return 'sede_b';
  });

  const handleToggleSede = () => {
    setActiveSede((prev) => {
      const next = prev === 'sede_a' ? 'sede_b' : 'sede_a';
      try {
        localStorage.setItem('tocineta_active_sede', next);
      } catch {}
      return next;
    });
  };

  // 3. Conmutador [Modo Básico] / [Modo Pro]
  const [uiMode, setUiMode] = useState<'basico' | 'pro'>(() => {
    try {
      const saved = localStorage.getItem('tocineta_ui_mode');
      if (saved === 'pro' || saved === 'basico') return saved;
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

  // 4. Logout
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

  const isAdmin = user?.role === 'admin' || user?.role === 'supervisor';

  return (
    <div className="min-h-screen bg-surface-alt flex flex-col font-sans select-none transition-colors">
      {/* Cabecera Oficial 56px (Estrictamente 4 elementos) */}
      <AppHeader
        title={VIEW_TITLES[currentTab] || 'Inicio'}
        isAdmin={isAdmin}
        formattedRate={formattedRate}
        onOpenBcvModal={() => {
          if (!mustChangePin) setIsBcvModalOpen(true);
        }}
        onOpenMenu={() => {
          if (!mustChangePin) setIsDrawerOpen(true);
        }}
        isOnline={isOnline}
      />

      {/* Menú Lateral Desplegable */}
      <AppSidebar
        isOpen={isDrawerOpen && !mustChangePin}
        onClose={() => setIsDrawerOpen(false)}
        currentTab={currentTab}
        onSelectTab={(tab) => {
          if (!mustChangePin) onTabChange(tab);
        }}
        allowedTabs={allowedTabs}
        uiMode={uiMode}
        onToggleUiMode={handleToggleUiMode}
        isAdmin={isAdmin}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        activeSede={activeSede}
        onToggleSede={handleToggleSede}
        onInstallClick={() => {
          if (!mustChangePin) window.location.hash = '#acceso';
        }}
        onLogout={handleLogout}
        userName={user?.name}
        userRole={user?.role}
      />

      {/* Contenido Principal: Bloqueado completamente si mustChangePin es true */}
      <main
        className={`flex-1 w-full max-w-7xl mx-auto p-2 sm:p-4 pb-20 sm:pb-6 transition-opacity ${
          mustChangePin ? 'pointer-events-none select-none opacity-30 filter blur-[1px]' : ''
        }`}
        aria-hidden={mustChangePin}
      >
        {children}
      </main>

      {/* Modal Edición Tasa BCV */}
      <BcvRateModal
        isOpen={isBcvModalOpen}
        onClose={() => setIsBcvModalOpen(false)}
        token={token}
        formattedRate={formattedRate}
      />

      {/* Modal Obligatorio y No Descartable de Cambio de PIN */}
      <ChangePinModal
        isOpen={mustChangePin}
      />

      <PrintAttentionModal onOpenTicketPreview={setPreviewJobId} />
      {previewJobId && <TicketPreviewModal jobId={previewJobId} onClose={() => setPreviewJobId(null)} />}
    </div>
  );
};

export default AppLayout;
