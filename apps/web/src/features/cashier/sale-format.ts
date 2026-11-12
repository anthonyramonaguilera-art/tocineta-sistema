const TZ = 'America/Caracas';

export function formatSaleDateTime(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });
  const time = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  return `${date} · ${time}`;
}

export function todayCaracasISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

export function formatAgeHours(ms: number): number {
  return Math.floor(ms / 3_600_000);
}
