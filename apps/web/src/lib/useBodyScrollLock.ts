import { useEffect } from 'react';

// Contador global de bloqueos: varios consumidores pueden abrirse/cerrarse en cualquier orden.
let lockCount = 0;
let originalOverflow: string | null = null;

/**
 * Adquiere un bloqueo del scroll del body.
 * Solo el primer bloqueo guarda el overflow original y aplica 'hidden'.
 * Exportada para poder probar el contador de forma unitaria.
 */
export function acquireBodyScrollLock(): void {
  if (typeof document === 'undefined') return;
  if (lockCount === 0) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}

/**
 * Libera un bloqueo del scroll del body.
 * Solo el último bloqueo restaura el overflow original; cerrar un modal
 * intermedio no desbloquea el body.
 * Exportada para poder probar el contador de forma unitaria.
 */
export function releaseBodyScrollLock(): void {
  if (typeof document === 'undefined') return;
  if (lockCount === 0) return;
  lockCount -= 1;
  if (lockCount === 0) {
    document.body.style.overflow = originalOverflow ?? '';
    originalOverflow = null;
  }
}

/**
 * Bloquea el scroll del body mientras `active` sea true.
 * Usa un contador global para que abrir A, abrir B, cerrar A y cerrar B
 * deje el overflow en el valor original. No toca touchAction.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    acquireBodyScrollLock();
    return () => releaseBodyScrollLock();
  }, [active]);
}
