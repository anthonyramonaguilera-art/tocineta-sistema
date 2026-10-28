import React from 'react';
import { Icon } from '../ui/index.js';

export interface AppHeaderProps {
  title: string;
  formattedRate: string;
  isAdmin: boolean;
  onOpenBcvModal?: () => void;
  onOpenMenu: () => void;
  isOnline?: boolean;
  pendingSyncCount?: number;
}

/**
 * Cabecera oficial de TOCINETA (56px)
 * Estrictamente 4 elementos visibles, cabe completa a 360px sin truncar el título:
 * 1. Botón Menú Lateral (Icono Menu)
 * 2. Título de la pantalla (≤18 caracteres según mapa VIEW_TITLES)
 * 3. Tasa BCV compacta
 * 4. Indicador de conexión / cola offline
 *
 * El logo, conmutador Básico/Pro y selector de Sede residen en el menú lateral (AppSidebar).
 */
export const AppHeader: React.FC<AppHeaderProps> = ({
  title,
  formattedRate,
  isAdmin,
  onOpenBcvModal,
  onOpenMenu,
  isOnline = true,
  pendingSyncCount = 0
}) => {
  return (
    <header className="h-14 min-h-[56px] bg-surface border-b border-border px-2 sm:px-4 flex items-center justify-between gap-1.5 select-none transition-colors sticky top-0 z-30">
      {/* 1. Botón Menú Lateral */}
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Abrir Menú"
        className="w-10 h-10 rounded-xl bg-surface-alt border border-border flex items-center justify-center text-ink hover:bg-surface active:scale-95 transition-all shrink-0 cursor-pointer"
      >
        <Icon name="Menu" size={20} />
      </button>

      {/* 2. Título de la Vista (Nunca se trunca a 360px) */}
      <div className="flex-1 min-w-0 flex items-center justify-center text-center px-1">
        <h1 className="text-xs sm:text-sm font-black text-ink tracking-tight whitespace-nowrap">
          {title}
        </h1>
      </div>

      {/* 3. Chip de Tasa BCV Compacta */}
      <button
        type="button"
        onClick={isAdmin ? onOpenBcvModal : undefined}
        title={isAdmin ? 'Clic para editar tasa BCV' : 'Tasa oficial BCV'}
        className={`h-9 px-2 sm:px-2.5 rounded-xl border flex items-center gap-1 shrink-0 transition-all ${
          isAdmin
            ? 'bg-surface-alt border-border hover:border-primary text-ink cursor-pointer'
            : 'bg-surface-alt border-border text-ink cursor-default'
        }`}
      >
        <span className="text-[10px] font-black text-ink-muted uppercase">BCV</span>
        <span className="text-xs font-mono font-black text-ink">{formattedRate}</span>
        {isAdmin && <Icon name="Edit3" size={11} className="text-ink-muted hidden sm:inline" />}
      </button>

      {/* 4. Indicador de Conexión / Cola Offline */}
      <div
        className="h-9 px-2 rounded-xl bg-surface-alt border border-border flex items-center justify-center gap-1.5 shrink-0 text-ink select-none"
        title={
          isOnline
            ? pendingSyncCount > 0
              ? `${pendingSyncCount} pendientes de sincronizar`
              : 'Sistema en línea'
            : 'Sin conexión a internet (Modo Offline)'
        }
        aria-label={isOnline ? 'En línea' : 'Desconectado'}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            isOnline ? 'bg-success' : 'bg-warning animate-pulse'
          }`}
        />
        <span className="text-[10px] font-bold text-ink-muted uppercase hidden xs:inline font-mono">
          {isOnline ? (pendingSyncCount > 0 ? `${pendingSyncCount}` : 'OK') : 'OFF'}
        </span>
      </div>
    </header>
  );
};

export default AppHeader;
