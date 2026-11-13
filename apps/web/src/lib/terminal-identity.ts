/**
 * TOCINETA — Identidad del Terminal de Punto de Venta / Dispositivo Móvil
 */

const TERMINAL_ID_KEY = 'tocineta_terminal_id';
const TERMINAL_LABEL_KEY = 'tocineta_terminal_label';

/**
 * Obtiene el identificador único persistente de este terminal.
 * Si no existe en localStorage, genera un UUID v4 sin guiones y lo almacena.
 */
export function getTerminalId(): string {
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
