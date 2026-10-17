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
