import React, { useState, useEffect } from 'react';
import { canUserProcessPayments } from '@tocineta/shared';
import { useAuth } from '../context/AuthContext.js';
import { queryClient, ALLOWED_TABS_BY_ROLE, type TabType } from '../App.js';
import { AppHeader } from './AppHeader.js';
import { AppSidebar } from './AppSidebar.js';
import { Modal, Button, Input, Field, Icon } from '../ui/index.js';

interface AppLayoutProps {
  currentTab: TabType;
  onTabChange: (tab: TabType) => void;
  formattedRate?: string;
  children: React.ReactNode;
}

const TAB_TITLES: Record<TabType, string> = {
  home: 'Inicio',
  pos: 'Tomar Pedido',
  cashier: 'Caja y Cierre',
  kds: 'Plancha y Cocina',
  profitability: 'Inventario Rápido',
  'menu-admin': 'Carta y Precios',
  staff: 'Personal y Permisos',
  health: 'Salud y Hardware',
  emergency: 'Talonario de Contingencia',
  'qr-menu': 'Menú Digital QR'
};

export const AppLayout: React.FC<AppLayoutProps> = ({
  currentTab,
  onTabChange,
  formattedRate = '40,00',
  children
}) => {
  const { user, token, logout, changePin } = useAuth();
  const [isBcvModalOpen, setIsBcvModalOpen] = useState(false);
  const [manualBcvInput, setManualBcvInput] = useState('');
  const [bcvModalMsg, setBcvModalMsg] = useState<string | null>(null);
  const [isSavingBcv, setIsSavingBcv] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

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

  // 4. Contrato de Seguridad y Longitud de PIN
  const requiredPinLength = (user?.role === 'admin' || user?.role === 'supervisor') ? 6 : 4;
  const [isChangePinModalOpen, setIsChangePinModalOpen] = useState(false);
  const [currentPinInput, setCurrentPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [changePinError, setChangePinError] = useState<string | null>(null);
  const [isChangingPin, setIsChangingPin] = useState(false);

  useEffect(() => {
    if (user?.mustChangePin) {
      setIsChangePinModalOpen(true);
    }
  }, [user?.mustChangePin]);

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePinError(null);

    if (newPinInput.length !== requiredPinLength) {
      setChangePinError(`El nuevo PIN debe tener exactamente ${requiredPinLength} dígitos`);
      return;
    }
    if (newPinInput !== confirmPinInput) {
      setChangePinError('Los PINs no coinciden');
      return;
    }

    setIsChangingPin(true);
    const result = await changePin(currentPinInput, newPinInput);
    setIsChangingPin(false);

    if (result.success) {
      setIsChangePinModalOpen(false);
      setCurrentPinInput('');
      setNewPinInput('');
      setConfirmPinInput('');
    } else {
      setChangePinError(result.error || 'Error al cambiar PIN');
    }
  };

  // 5. Gestión de BCV
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

  // 6. Logout
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
      {/* Cabecera Oficial 56px */}
      <AppHeader
        businessName="TOCINETA"
        title={TAB_TITLES[currentTab] || 'Comandero'}
        isAdmin={isAdmin}
        uiMode={uiMode}
        onToggleUiMode={handleToggleUiMode}
        formattedRate={formattedRate}
        onOpenBcvModal={handleOpenBcvModal}
        onOpenMenu={() => setIsDrawerOpen(true)}
      />

      {/* Menú Lateral Desplegable */}
      <AppSidebar
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        currentTab={currentTab}
        onSelectTab={onTabChange}
        allowedTabs={allowedTabs}
        uiMode={uiMode}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        activeSede={activeSede}
        onToggleSede={handleToggleSede}
        onInstallClick={() => {
          // Navegar a la pantalla de acceso e instalación
          window.location.hash = '#acceso';
        }}
        onLogout={handleLogout}
        userName={user?.name}
        userRole={user?.role}
      />

      {/* Contenido Principal */}
      <main className="flex-1 w-full max-w-7xl mx-auto p-2 sm:p-4 pb-20 sm:pb-6">
        {children}
      </main>

      {/* Modal Edición Tasa BCV */}
      <Modal
        isOpen={isBcvModalOpen}
        onClose={() => setIsBcvModalOpen(false)}
        title="Actualizar Tasa Oficial BCV"
      >
        <div className="space-y-4">
          <p className="text-xs text-ink-muted">
            Define la tasa de cambio oficial en Bolívares por Dólar (Bs/USD) que regirá todos los cobros del sistema.
          </p>

          <Field label="Tasa BCV (Bs/$)" required>
            <Input
              type="text"
              value={manualBcvInput}
              onChange={(e) => setManualBcvInput(e.target.value)}
              placeholder="Ej: 42.50"
              leftIcon={<Icon name="DollarSign" size={18} />}
              autoFocus
            />
          </Field>

          {bcvModalMsg && (
            <div className={`p-3 rounded-xl text-xs font-bold text-center ${
              bcvModalMsg.startsWith('✓')
                ? 'bg-success/10 border border-success/30 text-success'
                : 'bg-danger/10 border border-danger/30 text-danger'
            }`}>
              {bcvModalMsg}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setIsBcvModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              loading={isSavingBcv}
              onClick={handleSaveManualBcv}
            >
              Guardar Tasa
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Obligatorio Cambio de PIN */}
      <Modal
        isOpen={isChangePinModalOpen}
        onClose={() => {}}
        title={`Cambio Obligatorio de PIN (${requiredPinLength} dígitos)`}
      >
        <form onSubmit={handleSavePin} className="space-y-4">
          <p className="text-xs text-ink-muted">
            Por seguridad física y auditoría, debe establecer su PIN de {requiredPinLength} dígitos antes de continuar.
          </p>

          <Field label="PIN Actual" required>
            <Input
              type="password"
              value={currentPinInput}
              onChange={(e) => setCurrentPinInput(e.target.value)}
              placeholder="PIN actual o semilla"
              required
            />
          </Field>

          <Field label={`Nuevo PIN (${requiredPinLength} dígitos)`} required>
            <Input
              type="password"
              maxLength={requiredPinLength}
              value={newPinInput}
              onChange={(e) => setNewPinInput(e.target.value)}
              placeholder={`${requiredPinLength} dígitos`}
              required
            />
          </Field>

          <Field label="Confirmar Nuevo PIN" required>
            <Input
              type="password"
              maxLength={requiredPinLength}
              value={confirmPinInput}
              onChange={(e) => setConfirmPinInput(e.target.value)}
              placeholder="Repite el nuevo PIN"
              required
            />
          </Field>

          {changePinError && (
            <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold text-center">
              {changePinError}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={isChangingPin}
          >
            Actualizar PIN y Entrar
          </Button>
        </form>
      </Modal>
    </div>
  );
};

export default AppLayout;
