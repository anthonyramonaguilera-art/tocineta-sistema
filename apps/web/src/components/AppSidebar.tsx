import React from 'react';
import type { TabType } from '../App.js';
import { Icon, Badge } from '../ui/index.js';

interface MenuItem {
  tab: TabType;
  label: string;
  icon: any;
  mode: 'basico' | 'pro';
  isImplemented: boolean;
}

const MENU_ITEMS: MenuItem[] = [
  // MODO BÁSICO
  { tab: 'home', label: 'Inicio', icon: 'LayoutDashboard', mode: 'basico', isImplemented: true },
  { tab: 'pos', label: 'Tomar Pedido', icon: 'ShoppingBag', mode: 'basico', isImplemented: true },
  { tab: 'kds', label: 'Plancha y Cocina', icon: 'Flame', mode: 'basico', isImplemented: true },
  { tab: 'cashier', label: 'Caja y Cierre', icon: 'DollarSign', mode: 'basico', isImplemented: true },
  { tab: 'profitability', label: 'Inventario Rápido', icon: 'Package', mode: 'basico', isImplemented: true },

  // MODO PRO
  { tab: 'menu-admin', label: 'Carta y Precios', icon: 'Utensils', mode: 'pro', isImplemented: true },
  { tab: 'staff', label: 'Personal y Permisos', icon: 'Users', mode: 'pro', isImplemented: true },
  { tab: 'health', label: 'Salud y Hardware', icon: 'Cpu', mode: 'pro', isImplemented: true },
  { tab: 'emergency', label: 'Talonario Contingencia', icon: 'FileText', mode: 'pro', isImplemented: true },
  { tab: 'qr-menu', label: 'Menú Digital QR', icon: 'QrCode', mode: 'pro', isImplemented: true }
];

interface AppSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  allowedTabs: TabType[];
  uiMode: 'basico' | 'pro';
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  activeSede: 'sede_a' | 'sede_b';
  onToggleSede: () => void;
  onInstallClick: () => void;
  onLogout: () => void;
  userName?: string;
  userRole?: string;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  isOpen,
  onClose,
  currentTab,
  onSelectTab,
  allowedTabs,
  uiMode,
  theme,
  onToggleTheme,
  activeSede,
  onToggleSede,
  onInstallClick,
  onLogout,
  userName = 'Usuario',
  userRole = 'personal'
}) => {
  if (!isOpen) return null;

  // Filtrar solo items implementados y permitidos para el rol
  const visibleItems = MENU_ITEMS.filter((item) => {
    if (!item.isImplemented) return false;
    if (!allowedTabs.includes(item.tab)) return false;
    if (uiMode === 'basico' && item.mode === 'pro') return false;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex select-none">
      {/* Fondo sombreado */}
      <div
        className="fixed inset-0 bg-ink/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Contenedor del Cajón */}
      <div className="relative w-72 max-w-[85vw] bg-surface border-r border-border h-full flex flex-col shadow-2xl z-10 animate-in slide-in-from-left duration-200">
        {/* Cabecera del Cajón */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/brand/carita.png" alt="Logo" className="w-8 h-8 object-contain" />
            <div>
              <span className="font-black text-sm tracking-tight text-ink uppercase block">
                TOCINETA
              </span>
              <span className="text-[10px] text-ink-muted block uppercase font-bold tracking-wider">
                {userRole} · {userName}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-surface-alt flex items-center justify-center text-ink-muted hover:text-ink"
            aria-label="Cerrar menú"
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        {/* Lista de Módulos */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="px-2 py-1 text-[10px] font-black text-ink-muted uppercase tracking-wider">
            {uiMode === 'basico' ? 'Módulos Operativos' : 'Todos los Módulos (Pro)'}
          </div>

          {visibleItems.map((item) => {
            const isActive = currentTab === item.tab;
            return (
              <button
                key={item.tab}
                type="button"
                onClick={() => {
                  onSelectTab(item.tab);
                  onClose();
                }}
                className={`w-full min-h-[46px] px-3 rounded-xl flex items-center justify-between gap-3 text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-primary text-primary-ink shadow-sm'
                    : 'text-ink hover:bg-surface-alt'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon name={item.icon} size={18} />
                  <span>{item.label}</span>
                </div>
                {item.mode === 'pro' && (
                  <Badge variant={isActive ? 'neutral' : 'brand'}>PRO</Badge>
                )}
              </button>
            );
          })}
        </div>

        {/* Pie del Menú Lateral */}
        <div className="p-3 border-t border-border bg-surface-alt/50 space-y-2">
          {/* Fila: Tema y Sede */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onToggleTheme}
              className="min-h-[40px] px-2 rounded-xl bg-surface border border-border flex items-center justify-center gap-1.5 text-xs font-bold text-ink hover:bg-surface-alt transition-colors"
            >
              <Icon name={theme === 'dark' ? 'Sun' : 'Moon'} size={15} />
              <span>{theme === 'dark' ? 'Claro' : 'Oscuro'}</span>
            </button>

            <button
              type="button"
              onClick={onToggleSede}
              className="min-h-[40px] px-2 rounded-xl bg-surface border border-border flex items-center justify-center gap-1.5 text-[11px] font-bold text-ink hover:bg-surface-alt transition-colors"
              title="Cambiar sede operativa activa"
            >
              <Icon name="MapPin" size={14} className="text-primary" />
              <span className="truncate">{activeSede === 'sede_a' ? 'Los Olivos' : 'Alta Vista'}</span>
            </button>
          </div>

          {/* Instalar Aplicación */}
          <button
            type="button"
            onClick={() => {
              onInstallClick();
              onClose();
            }}
            className="w-full min-h-[40px] px-3 rounded-xl bg-surface border border-border flex items-center justify-center gap-2 text-xs font-bold text-ink hover:bg-surface-alt transition-colors"
          >
            <Icon name="Smartphone" size={15} />
            <span>Instalar Aplicación</span>
          </button>

          {/* Cerrar Sesión */}
          <button
            type="button"
            onClick={() => {
              onLogout();
              onClose();
            }}
            className="w-full min-h-[42px] px-3 rounded-xl bg-danger/10 border border-danger/20 flex items-center justify-center gap-2 text-xs font-bold text-danger hover:bg-danger/20 transition-colors"
          >
            <Icon name="LogOut" size={15} />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppSidebar;
