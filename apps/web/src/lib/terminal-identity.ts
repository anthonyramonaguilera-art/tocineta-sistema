/**
 * TOCINETA — Identidad del Terminal de Punto de Venta / Dispositivo Móvil
 */

declare global {
  interface Window {
    __TOCINETA_TERMINAL_ID__?: string;
  }
}

const TERMINAL_ID_KEY = 'tocineta_terminal_id';
const TERMINAL_LABEL_KEY = 'tocineta_terminal_label';
const VALID_TERMINAL_ID_REGEX = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Obtiene el identificador único persistente de este terminal.
 * Prioriza window.__TOCINETA_TERMINAL_ID__ si es válido, sincronizándolo en localStorage.
 * Si no existe o no es válido, lee de localStorage o genera un UUID v4 sin guiones.
 */
export function getTerminalId(): string {
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.__TOCINETA_TERMINAL_ID__ === 'string' &&
      VALID_TERMINAL_ID_REGEX.test(window.__TOCINETA_TERMINAL_ID__)
    ) {
      const nativeId = window.__TOCINETA_TERMINAL_ID__;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(TERMINAL_ID_KEY, nativeId);
        }
      } catch {
        // Ignorar fallo al persistir
      }
      return nativeId;
    }
  } catch {
    // Si el acceso a window falla, continuar con fallback
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(TERMINAL_ID_KEY);
      if (stored && stored.trim().length > 0) {
        return stored.trim();
      }
    }
  } catch {
    // Si localStorage está bloqueado o restringido, continúa generando
  }

  const generated = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).substring(2) + Date.now().toString(36);

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TERMINAL_ID_KEY, generated);
    }
  } catch {
    // Ignorar fallo al persistir
  }

  return generated;
}

/**
 * Obtiene la etiqueta o nombre asignado localmente a este terminal.
 */
export function getTerminalLabel(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(TERMINAL_LABEL_KEY);
    }
  } catch {
    // Ignorar fallo de acceso
  }
  return null;
}

/**
 * Guarda la etiqueta o nombre asignado localmente a este terminal.
 */
export function setTerminalLabel(label: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TERMINAL_LABEL_KEY, label);
    }
  } catch {
    // Ignorar fallo de persistencia
  }
}
