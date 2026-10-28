/**
 * SISTEMA OPERATIVO TOCINETA — HELPERS DE VERDAD FINANCIERA (R2 P2-B)
 */

import type Database from 'better-sqlite3';

export function normalizePaymentMethod(rawMethod: string | null | undefined): string {
  const m = (rawMethod || 'OTRO').toUpperCase().trim();
  if (m === 'CASH_USD' || m === 'EFECTIVO_USD' || m === 'USD') return 'EFECTIVO_USD';
  if (m === 'CASH_BS' || m === 'EFECTIVO_BS' || m === 'BS') return 'EFECTIVO_BS';
  if (m === 'PAGO_MOVIL' || m === 'PAGOMOVIL') return 'PAGO_MOVIL';
  if (m === 'UBII' || m === 'PUNTO_DE_VENTA' || m === 'PUNTO') return 'UBII';
  if (m === 'BINANCE' || m === 'USDT') return 'BINANCE';
  if (m === 'ZELLE') return 'ZELLE';
  if (m === 'TARJETA') return 'TARJETA';
  if (m === 'CREDITO') return 'CREDITO';
  return m;
}

export interface WasteSummary {
  totalWasteUsd: number;
  wasteLogsUsd: number;
  workerIncidentsUsd: number;
}

/**
 * Regla de deduplicación de mermas:
 * Si un incidente 'MERMA_ALIMENTO' coincide en monto y ventana de 60 segundos
 * con un registro de 'waste_logs', se considera el mismo hecho económico y no se duplica.
 */
export function calculateDeduplicatedWaste(
  rawDb: Database.Database,
  jornadaId: string | undefined,
  fromMs: number,
  toMs: number,
  targetLocId: string | null
): WasteSummary {
  const wasteConditions: string[] = [];
  const wasteParams: any[] = [];
  if (jornadaId) {
    wasteConditions.push('jornada_id = ?');
    wasteParams.push(jornadaId);
  } else {
    wasteConditions.push('created_at_ms >= ? AND created_at_ms <= ?');
    wasteParams.push(fromMs, toMs);
  }
  if (targetLocId) {
    wasteConditions.push('(location_id = ? OR (location_id IS NULL AND ? = ?))');
    wasteParams.push(targetLocId, targetLocId, 'loc_alta_vista');
  }

  const wasteLogs = rawDb.prepare(`
    SELECT cost_usd_cents, created_at_ms
    FROM waste_logs
    ${wasteConditions.length > 0 ? `WHERE ${wasteConditions.join(' AND ')}` : ''}
  `).all(...wasteParams) as any[];

  let wasteLogsUsd = 0;
  for (const wl of wasteLogs) {
    wasteLogsUsd += wl.cost_usd_cents || 0;
  }

  const incidentConditions: string[] = ['estimated_loss_usd_cents > 0'];
  const incidentParams: any[] = [];
  if (jornadaId) {
    incidentConditions.push('jornada_id = ?');
    incidentParams.push(jornadaId);
  } else {
    incidentConditions.push('created_at_ms >= ? AND created_at_ms <= ?');
    incidentParams.push(fromMs, toMs);
  }

  const incidents = rawDb.prepare(`
    SELECT id, incident_type, estimated_loss_usd_cents, created_at_ms
    FROM worker_incidents
    WHERE ${incidentConditions.join(' AND ')}
  `).all(...incidentParams) as any[];

  let workerIncidentsUsd = 0;
  for (const inc of incidents) {
    if (inc.incident_type === 'MERMA_ALIMENTO') {
      const isDuplicated = wasteLogs.some(
        wl => Math.abs(wl.created_at_ms - inc.created_at_ms) <= 60_000 && wl.cost_usd_cents === inc.estimated_loss_usd_cents
      );
      if (!isDuplicated) {
        workerIncidentsUsd += inc.estimated_loss_usd_cents;
      }
    } else {
      workerIncidentsUsd += inc.estimated_loss_usd_cents;
    }
  }

  return {
    totalWasteUsd: wasteLogsUsd + workerIncidentsUsd,
    wasteLogsUsd,
    workerIncidentsUsd
  };
}
