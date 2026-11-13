import type { OrderPrintJob } from './useOrderPrintJobs.js';

export function formatStationName(rawStation: string | null): string {
  if (!rawStation) return 'Cocina';
  const lower = rawStation.toLowerCase();
  if (lower.includes('hot') || lower.includes('perro')) return 'Hot Dogs';
  if (lower.includes('hamburguesa') || lower.includes('burg')) return 'Hamburguesas';
  return rawStation.charAt(0).toUpperCase() + rawStation.slice(1);
}

export function formatJobStatus(job: OrderPrintJob, hasError: boolean): 'impresa' | 'en cola' | 'error' {
  if (hasError || job.status === 'fallido' || job.status === 'requiere_atencion') return 'error';
  if (job.status === 'impreso') return 'impresa';
  return 'en cola';
}

export function getDeviceName(targetTerminalId?: string | null, printerName?: string | null): string {
  if (printerName && printerName.trim().length > 0) {
    return printerName.replace(/^BT:\s*/i, '').trim();
  }
  if (targetTerminalId && targetTerminalId.trim().length > 0) {
    return targetTerminalId.slice(0, 8);
  }
  return 'otro dispositivo';
}
