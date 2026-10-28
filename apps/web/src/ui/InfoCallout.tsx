import React, { useState, useEffect } from 'react';
import { Icon, type IconName } from './Icon.js';

export type InfoCalloutVariant = 'info' | 'success' | 'warning' | 'danger';

export interface InfoCalloutProps {
  title: string;
  description?: string;
  variant?: InfoCalloutVariant;
  icon?: IconName;
  storageKey?: string;
  dismissible?: boolean;
  dismissLabel?: string;
  className?: string;
  children?: React.ReactNode;
}

const DEFAULT_ICONS: Record<InfoCalloutVariant, IconName> = {
  info: 'Info',
  success: 'CheckCircle',
  warning: 'AlertTriangle',
  danger: 'AlertCircle'
};

const VARIANT_STYLES: Record<
  InfoCalloutVariant,
  {
    container: string;
    iconColor: string;
    titleColor: string;
    textColor: string;
    dismissBtn: string;
  }
> = {
  info: {
    container: 'bg-surface-alt border-border text-ink',
    iconColor: 'text-primary',
    titleColor: 'text-ink',
    textColor: 'text-ink-muted',
    dismissBtn: 'bg-surface hover:bg-surface-hover text-ink border-border hover:border-ink-muted'
  },
  success: {
    container: 'bg-success-subtle border-success/30 text-ink',
    iconColor: 'text-success',
    titleColor: 'text-success',
    textColor: 'text-ink',
    dismissBtn: 'bg-surface hover:bg-surface-hover text-ink border-success/30'
  },
  warning: {
    container: 'bg-warning-subtle border-warning/40 text-ink',
    iconColor: 'text-warning',
    titleColor: 'text-warning',
    textColor: 'text-ink',
    dismissBtn: 'bg-surface hover:bg-surface-hover text-ink border-warning/40'
  },
  danger: {
    container: 'bg-danger-subtle border-danger/40 text-ink',
    iconColor: 'text-danger',
    titleColor: 'text-danger',
    textColor: 'text-ink',
    dismissBtn: 'bg-surface hover:bg-surface-hover text-ink border-danger/40'
  }
};

export const InfoCallout: React.FC<InfoCalloutProps> = ({
  title,
  description,
  variant = 'info',
  icon,
  storageKey,
  dismissible = true,
  dismissLabel = 'Entendido, ocultar guía',
  className = '',
  children
}) => {
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === 'hidden') {
        setIsOpen(false);
      }
    } catch {}
  }, [storageKey]);

  const handleDismiss = () => {
    setIsOpen(false);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, 'hidden');
      } catch {}
    }
  };

  const handleRestore = () => {
    setIsOpen(true);
    if (storageKey) {
      try {
        localStorage.removeItem(storageKey);
      } catch {}
    }
  };

  const currentIcon = icon || DEFAULT_ICONS[variant];
  const styles = VARIANT_STYLES[variant];

  if (!isOpen) {
    if (!storageKey) return null;
    return (
      <div className="flex justify-end mb-3">
        <button
          type="button"
          onClick={handleRestore}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-surface border border-border text-ink hover:bg-surface-alt transition-colors"
          title="Mostrar guía explicativa"
        >
          <Icon name="Lightbulb" size={14} className="text-primary" />
          <span>Ver guía rápida</span>
        </button>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label={title}
      className={`p-4 rounded-2xl border shadow-xs transition-colors ${styles.container} ${className}`.trim()}
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-surface border border-border shrink-0 mt-0.5">
            <Icon name={currentIcon} size={20} className={styles.iconColor} />
          </div>
          <div>
            <h4 className={`text-sm font-black tracking-tight ${styles.titleColor}`}>
              {title}
            </h4>
            {description && (
              <p className={`text-xs sm:text-sm mt-0.5 leading-relaxed ${styles.textColor}`}>
                {description}
              </p>
            )}
            {children}
          </div>
        </div>

        {dismissible && (
          <button
            type="button"
            onClick={handleDismiss}
            className={`min-h-[38px] px-3.5 py-1.5 text-xs font-bold rounded-xl border transition-all shrink-0 self-end sm:self-center cursor-pointer ${styles.dismissBtn}`}
          >
            {dismissLabel}
          </button>
        )}
      </div>
    </div>
  );
};

export default InfoCallout;
