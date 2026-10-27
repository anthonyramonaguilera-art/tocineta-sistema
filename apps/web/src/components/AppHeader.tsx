import React from 'react';
import { Icon, Badge } from '../ui/index.js';

interface AppHeaderProps {
  businessName?: string;
  title: string;
  isAdmin: boolean;
  isDemoMode?: boolean;
  uiMode: 'basico' | 'pro';
  onToggleUiMode: (mode: 'basico' | 'pro') => void;
  formattedRate: string;
  onOpenBcvModal: () => void;
  onOpenMenu: () => void;
}

/**
 * Cabecera oficial de TOCINETA (56px)
 * Máximo 5 elementos visibles, cabe completa a 360px sin truncar.
 * 1. Botón Menú
 * 2. Logo + Nombre del Negocio + Badge DEMO
 * 3. Título de la pantalla
 * 4. Conmutador Modo Básico / Modo Pro (Solo Admin/Supervisor)
 * 5. Chip de Tasa BCV (editable por Admin)
 */
export const AppHeader: React.FC<AppHeaderProps> = ({
  businessName = 'TOCINETA',
  title,
  isAdmin,
  isDemoMode = false,
  uiMode,
  onToggleUiMode,
  formattedRate,
  onOpenBcvModal,
  onOpenMenu
}) => {
  return (
    <header className="h-14 min-h-[56px] bg-surface border-b border-border px-2 sm:px-4 flex items-center justify-between gap-1.5 select-none transition-colors sticky top-0 z-30">
      {/* 1. Botón Menú Lateral */}
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Abrir Menú"
        className="w-10 h-10 rounded-xl bg-surface-alt border border-border flex items-center justify-center text-ink hover:bg-surface active:scale-95 transition-all shrink-0"
      >
        <Icon name="Menu" size={20} />
      </button>

      {/* 2. Logo de Marca + Nombre + DEMO badge */}
      <div className="flex items-center gap-1.5 shrink-0">
        <img
          src="/brand/carita.png"
          alt="Logo"
          className="w-7 h-7 object-contain drop-shadow-sm"
        />
        <span className="hidden xs:inline-block font-black text-xs sm:text-sm tracking-tight text-ink uppercase">
          {businessName}
        </span>
        {isDemoMode && (
          <Badge variant="warning">
            DEMO
          </Badge>
        )}
      </div>

      {/* 3. Título de la Pantalla */}
      <div className="flex-1 min-w-0 text-center px-1">
        <h1 className="text-xs sm:text-sm font-black text-ink tracking-tight truncate">
          {title}
        </h1>
      </div>

      {/* 4. Conmutador Modo Básico / Modo Pro (Solo Admin) */}
      {isAdmin && (
        <div className="flex items-center bg-surface-alt p-0.5 rounded-xl border border-border shrink-0">
          <button
            type="button"
            onClick={() => onToggleUiMode('basico')}
            className={`px-1.5 sm:px-2 py-1 rounded-lg text-[10px] sm:text-xs font-black transition-all ${
              uiMode === 'basico'
                ? 'bg-primary text-primary-ink shadow-sm'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            Modo Básico
          </button>
          <button
            type="button"
            onClick={() => onToggleUiMode('pro')}
            className={`px-1.5 sm:px-2 py-1 rounded-lg text-[10px] sm:text-xs font-black transition-all ${
              uiMode === 'pro'
                ? 'bg-primary text-primary-ink shadow-sm'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            Modo Pro
          </button>
        </div>
      )}

      {/* 5. Chip de Tasa BCV */}
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
    </header>
  );
};

export default AppHeader;
