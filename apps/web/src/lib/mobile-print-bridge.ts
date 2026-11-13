/**
 * TOCINETA — Puente de Impresión Móvil y Registro de Terminal
 */

import { apiFetch } from '../api/client.js';
import { getTerminalId, getTerminalLabel } from './terminal-identity.js';

declare global {
  interface Window {
    TocinetaNative?: {
      getCapabilities(): Promise<{ bluetoothSpp: boolean }>;
      getSelectedPrinter(): Promise<{ name: string; mac: string } | null>;
      printEscPos(args: {
        mac: string;
        base64: string;
      }): Promise<{ success: boolean; bytesSent?: number; error?: string }>;
    };
  }
}

/**
 * Indica si el entorno actual cuenta con la interfaz de puente nativo de impresión.
 */
export function hasNativePrinting(): boolean {
  return typeof window !== 'undefined' && Boolean(window.TocinetaNative);
}

/**
 * Añade saltos de línea ESC/POS (0x0A) al final del payload base64.
 */
export function appendLineFeedsToBase64(base64: string, count = 3): string {
  try {
    const binString = typeof atob === 'function'
      ? atob(base64)
      : Buffer.from(base64, 'base64').toString('binary');
    const extra = '\n'.repeat(count);
    return typeof btoa === 'function'
      ? btoa(binString + extra)
      : Buffer.from(binString + extra, 'binary').toString('base64');
  } catch {
    return base64;
  }
}

/**
 * Imprime directamente un payload base64 en la impresora Bluetooth seleccionada en el dispositivo.
 * Si no hay impresora seleccionada, devuelve error 'No hay impresora Bluetooth seleccionada'.
 * Nunca lanza excepciones.
 */
export async function printBase64OnDevice(
  base64: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!hasNativePrinting() || !window.TocinetaNative) {
      return { ok: false, error: 'No hay impresora Bluetooth seleccionada' };
    }

    const printer = await window.TocinetaNative.getSelectedPrinter();
    if (!printer || !printer.mac) {
      return { ok: false, error: 'No hay impresora Bluetooth seleccionada' };
    }

    const result = await window.TocinetaNative.printEscPos({
      mac: printer.mac,
      base64
    });

    if (result && result.success) {
      return { ok: true };
    }

    return {
      ok: false,
      error: result?.error || 'Fallo al imprimir en el dispositivo'
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Error inesperado durante la impresión en el dispositivo'
    };
  }
}

/**
 * Reclama, imprime y completa un trabajo de impresión en el dispositivo actual.
 * POST /api/print-jobs/:id/claim -> printBase64OnDevice -> POST /api/print-jobs/:id/complete { ok, error }.
 * Si el claim responde 409 (conflicto/ya reclamado), devuelve ok: true.
 */
export async function printJobOnDevice(
  jobId: string,
  options?: { appendLineFeeds?: number }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const claimRes = await apiFetch(`/api/print-jobs/${encodeURIComponent(jobId)}/claim`, {
      method: 'POST'
    });

    if (claimRes.status === 409) {
      return { ok: true };
    }

    if (!claimRes.ok) {
      let errorMsg = `Error al reclamar trabajo: HTTP ${claimRes.status}`;
      try {
        const errorJson = await claimRes.json();
        if (errorJson?.message) errorMsg = errorJson.message;
      } catch {
        // Ignorar fallo al leer json de error
      }
      return { ok: false, error: errorMsg };
    }

    const claimData = (await claimRes.json()) as { payloadBase64?: string };
    let base64 = claimData?.payloadBase64 || '';

    const feedCount = options?.appendLineFeeds;
    if (feedCount && feedCount > 0) {
      base64 = appendLineFeedsToBase64(base64, feedCount);
    }

    const printResult = await printBase64OnDevice(base64);

    try {
      await apiFetch(`/api/print-jobs/${encodeURIComponent(jobId)}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          ok: printResult.ok,
          error: printResult.error
        })
      });
    } catch {
      // Si la confirmación de complete falla por red, no alteramos el resultado de impresión
    }

    return printResult;
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Error inesperado al procesar el trabajo de impresión'
    };
  }
}

export interface PrintJobDeviceResult {
  jobId: string;
  ok: boolean;
  error?: string;
}

/**
 * Imprime en serie una lista de trabajos en el orden recibido, con pausa de 400 ms entre ellos
 * y 3 saltos de línea al final de cada uno. Si uno falla, continúa con los siguientes.
 */
export async function printJobsOnDevice(
  jobIds: string[]
): Promise<PrintJobDeviceResult[]> {
  const results: PrintJobDeviceResult[] = [];

  for (let i = 0; i < jobIds.length; i++) {
    const jobId = jobIds[i];
    const res = await printJobOnDevice(jobId, { appendLineFeeds: 3 });
    results.push({
      jobId,
      ok: res.ok,
      error: res.error
    });

    if (i < jobIds.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  return results;
}

/**
 * Inicia el envío periódico de latidos (heartbeat) del terminal cada 30 segundos si hay puente nativo.
 * Opcionalmente ejecuta un callback tras confirmar el primer latido exitoso.
 * Devuelve la función para cancelar el latido. Sin puente no realiza ninguna acción.
 */
export function startTerminalHeartbeat(onFirstHeartbeat?: () => void): () => void {
  if (!hasNativePrinting()) {
    return () => {};
  }

  let cancelled = false;
  let hasFiredFirst = false;

  const sendHeartbeat = async () => {
    if (cancelled || !hasNativePrinting() || !window.TocinetaNative) return;

    try {
      const terminalId = getTerminalId();
      const rawLabel = getTerminalLabel();
      const label = rawLabel && rawLabel.trim().length > 0 ? rawLabel.trim().slice(0, 40) : undefined;

      let btPrinter: { name: string; mac: string } | undefined;
      try {
        const selected = await window.TocinetaNative.getSelectedPrinter();
        if (selected && selected.name && selected.mac) {
          btPrinter = { name: selected.name, mac: selected.mac };
        }
      } catch {
        btPrinter = undefined;
      }

      let capabilities: { bluetoothSpp?: boolean } | undefined;
      try {
        const caps = await window.TocinetaNative.getCapabilities();
        if (caps) {
          capabilities = { bluetoothSpp: Boolean(caps.bluetoothSpp) };
        }
      } catch {
        capabilities = undefined;
      }

      const body: {
        terminalId: string;
        label?: string;
        btPrinter?: { name: string; mac: string };
        capabilities?: { bluetoothSpp?: boolean };
      } = {
        terminalId
      };
      if (label) body.label = label;
      if (btPrinter) body.btPrinter = btPrinter;
      if (capabilities) body.capabilities = capabilities;

      const res = await apiFetch('/api/terminals/heartbeat', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      if (res && res.ok && !hasFiredFirst) {
        hasFiredFirst = true;
        if (onFirstHeartbeat) {
          try {
            onFirstHeartbeat();
          } catch {
            // Ignorar errores en callback
          }
        }
      }
    } catch {
      // Ignorar errores transitorios de red en el heartbeat
    }
  };

  void sendHeartbeat();

  const intervalId = setInterval(() => {
    void sendHeartbeat();
  }, 30000);

  return () => {
    cancelled = true;
    clearInterval(intervalId);
  };
}

/**
 * Consulta los trabajos pendientes de este terminal de los últimos 15 min e imprime con printJobsOnDevice.
 * Devuelve el número de tickets impresos exitosamente.
 */
export async function printPendingTerminalJobs(): Promise<number> {
  try {
    const res = await apiFetch('/api/terminals/me/print-jobs');
    if (!res.ok) return 0;
    const body = (await res.json()) as { data?: Array<{ id: string; job_type: string; created_at_ms: number }> };
    const jobs = body?.data || [];
    if (!Array.isArray(jobs) || jobs.length === 0) return 0;

    // Orden: comandas primero y nota al final
    const sorted = [...jobs].sort((a, b) => {
      const aIsKitchen = a.job_type === 'TICKET_COCINA';
      const bIsKitchen = b.job_type === 'TICKET_COCINA';
      if (aIsKitchen && !bIsKitchen) return -1;
      if (!aIsKitchen && bIsKitchen) return 1;
      return a.created_at_ms - b.created_at_ms;
    });

    const results = await printJobsOnDevice(sorted.map((j) => j.id));
    return results.filter((r) => r.ok).length;
  } catch {
    return 0;
  }
}
