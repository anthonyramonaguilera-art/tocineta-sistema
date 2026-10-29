import type Database from 'better-sqlite3';
import { parseRateToMicroBs, formatMicroBsToRate } from '@tocineta/shared';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';

export interface BcvSyncResult {
  updated: boolean;
  rateMicroBs?: number;
  formattedRate?: string;
  source?: string;
  message?: string;
  error?: string;
  reason?: string;
  rateLabel?: string;
}

export async function syncBcvRateFromInternet(
  rawDb: Database.Database,
  customFetch?: typeof fetch
): Promise<BcvSyncResult> {
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

  if (isTest && !customFetch) {
    return { updated: false, reason: 'test_env_no_mock' };
  }

  const fetchFn = customFetch || globalThis.fetch;

  let parsedRate: number | null = null;
  let usedSource = '';
  let dolarapiError = '';
  let pydolarveError = '';

  // 1. Fuente 1: dolarapi oficial
  try {
    const res = await fetchFn('https://ve.dolarapi.com/v1/dolares/oficial', {
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      dolarapiError = `HTTP ${res.status}`;
    } else {
      const data = await res.json() as any;
      const val = Number(data?.promedio ?? data?.precio);
      if (typeof val === 'number' && !isNaN(val) && val > 10 && val < 100000) {
        parsedRate = val;
        usedSource = 'dolarapi';
      } else {
        dolarapiError = 'invalid data';
      }
    }
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.message?.toLowerCase().includes('timeout') || err?.message?.toLowerCase().includes('abort')) {
      dolarapiError = 'timeout';
    } else {
      dolarapiError = err?.message || 'error';
    }
  }

  // 2. Fuente 2 (fallback): pydolarve oficial
  if (parsedRate === null) {
    try {
      const res = await fetchFn('https://pydolarve.org/api/v1/dollar?page=bcv', {
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) {
        pydolarveError = `HTTP ${res.status}`;
      } else {
        const data = await res.json() as any;
        const val = Number(data?.monitors?.usd?.price ?? data?.price);
        if (typeof val === 'number' && !isNaN(val) && val > 10 && val < 100000) {
          parsedRate = val;
          usedSource = 'pydolarve';
        } else {
          pydolarveError = 'invalid data';
        }
      }
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.message?.toLowerCase().includes('timeout') || err?.message?.toLowerCase().includes('abort')) {
        pydolarveError = 'timeout';
      } else {
        pydolarveError = err?.message || 'error';
      }
    }
  }

  if (parsedRate === null) {
    return {
      updated: false,
      error: `dolarapi: ${dolarapiError}; pydolarve: ${pydolarveError}`
    };
  }

  try {
    const rateMicroBs = parseRateToMicroBs(String(parsedRate));
    const formattedRate = formatMicroBsToRate(rateMicroBs);

    const current = rawDb.prepare(`
      SELECT rate_micro_bs 
      FROM exchange_rates 
      WHERE is_current = 1 
      ORDER BY created_at_ms DESC 
      LIMIT 1
    `).get() as { rate_micro_bs: number } | undefined;

    if (current?.rate_micro_bs === rateMicroBs) {
      return {
        updated: false,
        rateMicroBs,
        formattedRate,
        source: usedSource,
        rateLabel: 'Tasa BCV Vigente / Día Siguiente',
        message: 'La tasa BCV ya se encuentra actualizada con la fecha valor vigente / día siguiente'
      };
    }

    const now = Date.now();
    const newRateId = `rate_${now}`;

    const updateTx = rawDb.transaction(() => {
      rawDb.prepare('UPDATE exchange_rates SET is_current = 0').run();
      rawDb.prepare(`
        INSERT INTO exchange_rates (id, rate_micro_bs, source, set_by_user_id, created_at_ms, is_current)
        VALUES (?, ?, 'AUTO_INTERNET', NULL, ?, 1)
      `).run(newRateId, rateMicroBs, now);

      appendAuditEvent(rawDb, {
        actorUserId: null,
        action: 'BCV_RATE_AUTO_UPDATED',
        entityType: 'exchange_rate',
        entityId: newRateId,
        payload: {
          rateMicroBs,
          formattedRate,
          source: 'AUTO_INTERNET',
          provider: usedSource,
          rateLabel: 'Tasa BCV Vigente / Día Siguiente'
        }
      });

      publishDomainEvent(rawDb, {
        eventType: 'EXCHANGE_RATE_UPDATED',
        entityId: newRateId,
        payload: {
          rateMicroBs,
          formattedRate,
          source: 'AUTO_INTERNET',
          rateLabel: 'Tasa BCV Vigente / Día Siguiente'
        }
      });
    });

    updateTx();

    return {
      updated: true,
      rateMicroBs,
      formattedRate,
      source: usedSource,
      rateLabel: 'Tasa BCV Vigente / Día Siguiente'
    };
  } catch (err: any) {
    return {
      updated: false,
      error: err?.message || 'Error al persistir tasa BCV sincronizada'
    };
  }
}
