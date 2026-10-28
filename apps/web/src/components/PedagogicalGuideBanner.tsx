import React, { useState, useEffect } from 'react';
import { Icon } from '../ui/Icon.js';

export interface PedagogicalGuideBannerProps {
  title: string;
  description: string;
  storageKey: string;
}

export const PedagogicalGuideBanner: React.FC<PedagogicalGuideBannerProps> = ({
  title,
  description,
  storageKey,
}) => {
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === 'hidden') {
        setIsOpen(false);
      }
    } catch {
      // LocalStorage access failsafe
    }
  }, [storageKey]);

  const handleDismiss = () => {
    setIsOpen(false);
    try {
      localStorage.setItem(storageKey, 'hidden');
    } catch {
      // Ignore
    }
  };

  const handleShow = () => {
    setIsOpen(true);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Ignore
    }
  };

  if (!isOpen) {
    return (
      <div className="flex justify-end mb-3">
        <button
          type="button"
          onClick={handleShow}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
          title="Ver guía explicativa"
        >
          <Icon name="Lightbulb" size={14} /> Ver guía rápida
        </button>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Guía rápida pedagógica"
      className="mb-4 p-4 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-amber-900/20 to-neutral-900/40 text-amber-100 shadow-md backdrop-blur-sm animate-fade-in"
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="select-none" aria-hidden="true">
            <Icon name="Lightbulb" size={24} className="text-amber-400" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-amber-200 tracking-wide">
              {title}
            </h4>
            <p className="text-xs sm:text-sm text-neutral-300 mt-0.5 leading-relaxed">
              {description}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          className="min-h-[38px] px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 transition-all shrink-0 self-end sm:self-center"
        >
          ✓ Entendido, ocultar guía
        </button>
      </div>
    </div>
  );
};
