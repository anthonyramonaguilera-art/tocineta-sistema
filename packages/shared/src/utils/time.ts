export const CARACAS_TIMEZONE = 'America/Caracas';

/**
 * Retorna la hora y fecha actual formateada en la zona horaria de Caracas (UTC-4)
 */
export function formatCaracasDateTime(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('es-VE', {
    timeZone: CARACAS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  return formatter.format(date);
}

/**
 * Retorna timestamp UTC en milisegundos
 */
export function getUtcTimestampMs(): number {
  return Date.now();
}

export type ClockIntegrityStatus = 'OK' | 'CLOCK_WENT_BACKWARDS' | 'CLOCK_JUMP_CONFIRM_REQUIRED';

export interface ClockIntegrityResult {
  status: ClockIntegrityStatus;
  deltaMs?: number;
}

/**
 * Guardia de reloj oficial para detectar retrocesos o saltos temporales sospechosos
 */
export function checkClockIntegrity(
  nowUtcMs: number,
  lastRecordedUtcMs: number | null
): ClockIntegrityResult {
  if (lastRecordedUtcMs === null) {
    return { status: 'OK' };
  }

  const deltaMs = nowUtcMs - lastRecordedUtcMs;

  // Si el reloj retrocedió más de 1 minuto (60.000 ms)
  if (nowUtcMs < lastRecordedUtcMs - 60_000) {
    return {
      status: 'CLOCK_WENT_BACKWARDS',
      deltaMs
    };
  }

  // Si hubo un salto mayor a 36 horas (36 * 3600 * 1000 ms = 129.600.000 ms)
  if (deltaMs > 36 * 3600 * 1000) {
    return {
      status: 'CLOCK_JUMP_CONFIRM_REQUIRED',
      deltaMs
    };
  }

  return { status: 'OK' };
}
