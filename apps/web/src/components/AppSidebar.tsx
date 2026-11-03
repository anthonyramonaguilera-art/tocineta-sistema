import React from 'react';
import type { TabType } from '../App.js';
import { Icon, type IconName } from '../ui/index.js';

export type MenuSection = 'operacion' | 'gestion' | 'sistema';

interface MenuItem {
  tab: TabType;
  label: string;
  icon: IconName;
  section: MenuSection;
  requiresInventory?: boolean;
  isImplemented: boolean;
}

const MENU_ITEMS: MenuItem[] = [
  // SECCIÓN OPERACIÓN
  { tab: 'home', label: 'Inicio', icon: 'LayoutDashboard', section: 'operacion', isImplemented: true },
  { tab: 'pos', label: 'Tomar Pedido', icon: 'ShoppingBag', section: 'operacion', isImplemented: true },
  { tab: 'availability', label: 'Disponibilidad', icon: 'Power', section: 'operacion', isImplemented: true },
  { tab: 'kds', label: 'Plancha y Cocina', icon: 'Flame', section: 'operacion', isImplemented: true },
  { tab: 'cashier', label: 'Caja y Cierre', icon: 'DollarSign', section: 'operacion', isImplemented: true },

  // SECCIÓN GESTIÓN
  { tab: 'profitability', label: 'Inventario', icon: 'Package', section: 'gestion', requiresInventory: true, isImplemented: true },
  { tab: 'menu-admin', label: 'Carta y Precios', icon: 'Utensils', section: 'gestion', isImplemented: true },
  { tab: 'staff', label: 'Personal y Permisos', icon: 'Users', section: 'gestion', isImplemented: true },
  { tab: 'finances', label: 'Finanzas', icon: 'CircleDollarSign', section: 'gestion', isImplemented: true },
  { tab: 'owner', label: 'Panel Dueña', icon: 'TrendingUp', section: 'gestion', isImplemented: true },
  { tab: 'quotes', label: 'Cotizador Eventos', icon: 'Calculator', section: 'gestion', isImplemented: true },
  { tab: 'partners', label: 'Socios', icon: 'Handshake', section: 'gestion', isImplemented: true },

  // SECCIÓN SISTEMA
  { tab: 'health', label: 'Salud y Hardware', icon: 'Cpu', section: 'sistema', isImplemented: true },
  { tab: 'emergency', label: 'Talonario Contingencia', icon: 'FileText', section: 'sistema', isImplemented: true },
  { tab: 'qr-menu', label: 'Menú Digital QR', icon: 'QrCode', section: 'sistema', isImplemented: true },
  { tab: 'settings', label: 'Configuración Negocio', icon: 'Settings', section: 'sistema', isImplemented: true }
];

const SECTIONS: { id: MenuSection; label: string }[] = [
  { id: 'operacion', label: 'Operación' },
  { id: 'gestion', label: 'Gestión' },
  { id: 'sistema', label: 'Sistema' }
];

export interface AppSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  allowedTabs: TabType[];
  inventoryMode?: string;
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
  inventoryMode = 'free',
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

  // Filtrar solo items implementados y permitidos para el rol, ocultando requiresInventory si es modo free
  const visibleItems = MENU_ITEMS.filter((item) => {
    if (!item.isImplemented) return false;
    if (!allowedTabs.includes(item.tab)) return false;
    if (inventoryMode === 'free' && item.requiresInventory) return false;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex select-none">
      {/* Fondo sombreado */}
      <div
        className="fixed inset-0 bg-ink/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Contenedor del Cajón Lateral */}
      <div className="relative w-72 max-w-[85vw] bg-surface border-r border-border h-full flex flex-col shadow-2xl z-10 animate-in slide-in-from-left duration-200">
        {/* Cabecera del Cajón: Logo Oficial y Usuario */}
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
            className="w-10 h-10 rounded-lg bg-surface-alt flex items-center justify-center text-ink-muted hover:text-ink cursor-pointer"
            aria-label="Cerrar menú"
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        {/* Lista de Módulos dividida en 3 Secciones */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {SECTIONS.map((sec) => {
            const items = visibleItems.filter((item) => item.section === sec.id);
            if (items.length === 0) return null;

            return (
              <div key={sec.id} className="space-y-1">
                <div className="px-2 py-1 text-[10px] font-black text-ink-muted uppercase tracking-wider">
                  {sec.label}
                </div>
                {items.map((item) => {
                  const isActive = currentTab === item.tab;
                  return (
                    <button
                      key={item.tab}
                      type="button"
                      onClick={() => {
                        onSelectTab(item.tab);
                        onClose();
                      }}
                      className={`w-full min-h-[48px] px-3 rounded-xl flex items-center justify-between gap-3 text-xs font-bold transition-all cursor-pointer ${
                        isActive
                          ? 'bg-primary text-primary-ink shadow-sm'
                          : 'text-ink hover:bg-surface-alt'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon name={item.icon} size={18} />
                        <span>{item.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Pie del Menú Lateral */}
        <div className="p-3 border-t border-border bg-surface-alt/50 space-y-2">
          {/* Fila: Tema y Sede Operativa */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onToggleTheme}
              className="min-h-[48px] px-2 rounded-xl bg-surface border border-border flex items-center justify-center gap-1.5 text-xs font-bold text-ink hover:bg-surface-alt transition-colors cursor-pointer"
            >
              <Icon name={theme === 'dark' ? 'Sun' : 'Moon'} size={15} />
              <span>{theme === 'dark' ? 'Claro' : 'Oscuro'}</span>
            </button>

            <button
              type="button"
              onClick={onToggleSede}
              className="min-h-[48px] px-2 rounded-xl bg-surface border border-border flex items-center justify-center gap-1.5 text-[11px] font-bold text-ink hover:bg-surface-alt transition-colors cursor-pointer"
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
            className="w-full min-h-[48px] px-3 rounded-xl bg-surface border border-border flex items-center justify-center gap-2 text-xs font-bold text-ink hover:bg-surface-alt transition-colors cursor-pointer"
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
            className="w-full min-h-[48px] px-3 rounded-xl bg-danger/10 border border-danger/20 flex items-center justify-center gap-2 text-xs font-bold text-danger hover:bg-danger/20 transition-colors cursor-pointer"
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
