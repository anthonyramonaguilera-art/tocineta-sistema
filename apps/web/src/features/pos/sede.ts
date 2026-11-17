import { useCallback, useEffect, useState } from 'react';

export type SedeKey = 'sede_a' | 'sede_b';

export const SEDE_LOCATION_IDS: Record<SedeKey, string> = {
  sede_a: 'loc_los_olivos',
  sede_b: 'loc_alta_vista'
};

export const SEDE_LABELS: Record<SedeKey, string> = {
  sede_a: 'Sede A: Los Olivos',
  sede_b: 'Sede B: Alta Vista'
};

const SEDE_CHANGED_EVENT = 'tocineta:sede-changed';

/** Normaliza la sede guardada en localStorage a su clave canónica. */
export function resolveSedeKey(value: string | null | undefined): SedeKey {
  if (value === 'sede_a' || value === 'loc_los_olivos' || /los olivos/i.test(value || '')) {
    return 'sede_a';
  }
  return 'sede_b';
}

/**
 * Sede activa del terminal. Se inicializa desde localStorage y se mantiene
 * sincronizada cuando el menú lateral cambia de sede.
 */
export function useActiveSede(): [SedeKey, (sede: string) => void] {
  const [activeSede, setActiveSede] = useState<SedeKey>(() => {
    try {
      return resolveSedeKey(localStorage.getItem('tocineta_active_sede'));
    } catch {
      return 'sede_b';
    }
  });

  useEffect(() => {
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<{ sede?: string }>).detail;
      if (detail?.sede) setActiveSede(resolveSedeKey(detail.sede));
    };
    window.addEventListener(SEDE_CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(SEDE_CHANGED_EVENT, handleChange);
  }, []);

  const selectSede = useCallback((sede: string) => {
    setActiveSede(resolveSedeKey(sede));
  }, []);

  return [activeSede, selectSede];
}
