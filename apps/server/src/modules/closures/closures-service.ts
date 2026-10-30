import type Database from 'better-sqlite3';
import { generateUuidV7, renderTicketToEscPos } from '@tocineta/shared';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';
import { buildZReportTicketIR, getPaymentMethodHumanLabel, type ZReportData } from '../printing/templates.js';
import { getPrinterConfig } from '../printing/worker.js';
import { createEncryptedBackup } from '../backups/backup-service.js';
import { getFinancialTruth } from '../finances/financial-truth-service.js';

export interface BlindCountInput {
  cashUsdCents: number;
  cashBsCents: number;
  ubiiVoucherBsCents: number;
  notes?: string;
}

export interface UserContext {
  id: string;
  name: string;
  role: 'admin' | 'supervisor' | 'cajera' | 'mesonero' | 'cocinero' | 'despachador';
  permissions?: string[];
}

export interface BlindCountResult {
  status: 'RECOUNT_REQUIRED' | 'CLOSED';
  message: string;
  session?: {
    id: string;
    jornadaId: string;
    userId: string;
    openedAtMs: number;
    closedAtMs: number;
    closingCashUsdCents: number;
    closingCashBsCents: number;
    closingUbiiVoucherBsCents: number;
    expectedCashUsdCents?: number;
    expectedCashBsCents?: number;
    expectedUbiiGrossBsCents?: number;
    diffUsdCents?: number;
    diffBsCents?: number;
    diffUbiiBsCents?: number;
    ubiiLiquidation?: {
      grossBsCents: number;
      feeBsCents: number;
      netBsCents: number;
      voucherDiffBsCents: number;
    };
  };
}

/**
 * 1. Arqueo Ciego con Regla Anti-Tanteo estricta y Liquidación Ubii 0.75%
 */
export function performBlindCount(
  rawDb: Database.Database,
  sessionId: string,
  input: BlindCountInput,
  user: UserContext
): BlindCountResult {
  const session = rawDb.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(sessionId) as any;
  if (!session) {
    const err: any = new Error(`Sesión de caja '${sessionId}' no encontrada`);
    err.statusCode = 404;
    throw err;
  }

  if (session.status === 'cerrada') {
    const err: any = new Error(`La sesión de caja '${sessionId}' ya se encuentra cerrada`);
    err.statusCode = 400;
    throw err;
  }

  // 1. Calcular montos esperados en efectivo USD, Bs y Ubii para esta sesión
  // Suma de pagos asociados a las órdenes cobradas en esta sesión de caja
  const payments = rawDb.prepare(`
    SELECT p.method, p.amount_cents, p.usd_equivalent_cents
    FROM payments p
    JOIN orders o ON p.order_id = o.id
    WHERE o.cash_session_id = ?
  `).all(sessionId) as Array<{
    method: string;
    amount_cents: number;
    usd_equivalent_cents: number;
  }>;

  // Suma de vueltos entregados en las órdenes de esta sesión
  const changes = rawDb.prepare(`
    SELECT cd.change_usd_cents, cd.change_bs_cents
    FROM change_deliveries cd
    JOIN orders o ON cd.order_id = o.id
    WHERE o.cash_session_id = ?
  `).all(sessionId) as Array<{
    change_usd_cents: number;
    change_bs_cents: number;
  }>;

  let cashUsdInflow = 0;
  let cashBsInflow = 0;
  let ubiiGrossBs = 0;

  for (const p of payments) {
    const m = p.method.toUpperCase();
    if (m === 'CASH_USD' || m === 'EFECTIVO_USD') {
      cashUsdInflow += p.amount_cents;
    } else if (m === 'CASH_BS' || m === 'EFECTIVO_BS') {
      cashBsInflow += p.amount_cents;
    } else if (m === 'UBII' || m === 'PUNTO_DE_VENTA') {
      ubiiGrossBs += p.amount_cents;
    }
  }

  let cashUsdOutflow = 0;
  let cashBsOutflow = 0;
  for (const c of changes) {
    cashUsdOutflow += c.change_usd_cents;
    cashBsOutflow += c.change_bs_cents;
  }

  // Gastos en efectivo pagados durante esta sesión
  const cashExpensesRow = rawDb.prepare(`
    SELECT 
      COALESCE(SUM(CASE WHEN payment_method IN ('EFECTIVO_USD', 'USD') THEN amount_usd_cents ELSE 0 END), 0) as exp_usd,
      COALESCE(SUM(CASE WHEN payment_method IN ('EFECTIVO_BS', 'BS') THEN amount_bs_cents ELSE 0 END), 0) as exp_bs
    FROM operating_expenses
    WHERE jornada_id = ? AND category != 'MERMAS_DESPERDICIOS'
      AND (authorized_by_user_id = ? OR location_id = ?)
      AND created_at_ms >= ? AND created_at_ms <= ?
  `).get(session.jornada_id, session.user_id, session.location_id || 'loc_alta_vista', session.opened_at_ms, session.closed_at_ms || Date.now()) as any;

  const cashExpUsd = cashExpensesRow?.exp_usd || 0;
  const cashExpBs = cashExpensesRow?.exp_bs || 0;

  const expectedCashUsdCents = session.opening_cash_usd_cents + cashUsdInflow - cashUsdOutflow - cashExpUsd;
  const expectedCashBsCents = session.opening_cash_bs_cents + cashBsInflow - cashBsOutflow - cashExpBs;
  const expectedUbiiGrossBsCents = ubiiGrossBs;

  // Diferencias
  const diffUsdCents = input.cashUsdCents - expectedCashUsdCents;
  const diffBsCents = input.cashBsCents - expectedCashBsCents;
  const diffUbiiBsCents = input.ubiiVoucherBsCents - expectedUbiiGrossBsCents;

  const hasDiscrepancy = diffUsdCents !== 0 || diffBsCents !== 0 || diffUbiiBsCents !== 0;

  // 2. REGLA ANTI-TANTEO:
  // Si hay descuadre y aún no ha usado el reconteo (recount_used === 0):
  // Da exactamente UNA oportunidad de reconteo a ciegas, sin indicar si falta o sobra ni montos.
  if (hasDiscrepancy && session.recount_used === 0) {
    rawDb.prepare('UPDATE cash_sessions SET recount_used = 1 WHERE id = ?').run(sessionId);

    appendAuditEvent(rawDb, {
      actorUserId: user.id,
      action: 'CASH_SESSION_BLIND_COUNT_RECOUNT_REQUIRED',
      entityType: 'cash_session',
      entityId: sessionId,
      payload: {
        recountUsed: 1
      }
    });

    return {
      status: 'RECOUNT_REQUIRED',
      message: 'Por favor realiza una segunda verificación del conteo físico.'
    };
  }

  // 3. CIERRE DEFINITIVO DE SESIÓN (En el segundo conteo o si cuadró exacto)
  const now = Date.now();
  const ubiiFeeBsCents = Math.round((expectedUbiiGrossBsCents * 75) / 10000); // 0.75%
  const ubiiNetExpectedBsCents = expectedUbiiGrossBsCents - ubiiFeeBsCents;

  rawDb.prepare(`
    UPDATE cash_sessions
    SET status = 'cerrada',
        closed_at_ms = ?,
        closing_cash_usd_cents = ?,
        closing_cash_bs_cents = ?,
        closing_ubii_voucher_bs_cents = ?,
        expected_cash_usd_cents = ?,
        expected_cash_bs_cents = ?,
        expected_ubii_gross_bs_cents = ?,
        diff_usd_cents = ?,
        diff_bs_cents = ?,
        diff_ubii_bs_cents = ?,
        closing_notes = ?
    WHERE id = ?
  `).run(
    now,
    input.cashUsdCents,
    input.cashBsCents,
    input.ubiiVoucherBsCents,
    expectedCashUsdCents,
    expectedCashBsCents,
    expectedUbiiGrossBsCents,
    diffUsdCents,
    diffBsCents,
    diffUbiiBsCents,
    input.notes || null,
    sessionId
  );

  appendAuditEvent(rawDb, {
    actorUserId: user.id,
    action: 'CASH_SESSION_CLOSED',
    entityType: 'cash_session',
    entityId: sessionId,
    payload: {
      hasDiscrepancy,
      diffUsdCents,
      diffBsCents,
      diffUbiiBsCents,
      recountUsed: session.recount_used
    }
  });

  // 4. RETORNO SEGREGADO POR ROL:
  // Si es cajera: NO recibe números esperados ni descuadres (anti-tanteo garantizado).
  // Si es admin o supervisor: recibe el desglose completo y conciliación.
  const isPrivileged = user.role === 'admin' || user.role === 'supervisor';

  if (!isPrivileged) {
    return {
      status: 'CLOSED',
      message: 'Sesión de caja cerrada exitosamente.'
    };
  }

  return {
    status: 'CLOSED',
    message: 'Sesión de caja cerrada y auditada con éxito.',
    session: {
      id: sessionId,
      jornadaId: session.jornada_id,
      userId: session.user_id,
      openedAtMs: session.opened_at_ms,
      closedAtMs: now,
      closingCashUsdCents: input.cashUsdCents,
      closingCashBsCents: input.cashBsCents,
      closingUbiiVoucherBsCents: input.ubiiVoucherBsCents,
      expectedCashUsdCents,
      expectedCashBsCents,
      expectedUbiiGrossBsCents,
      diffUsdCents,
      diffBsCents,
      diffUbiiBsCents,
      ubiiLiquidation: {
        grossBsCents: expectedUbiiGrossBsCents,
        feeBsCents: ubiiFeeBsCents,
        netBsCents: ubiiNetExpectedBsCents,
        voucherDiffBsCents: diffUbiiBsCents
      }
    }
  };
}

/**
 * 2. Cierre Z de Jornada: Suma exacta del libro inmutable (ledger_entries),
 * captura de Hash de Auditoría SHA-256 e impresión térmica.
 */
export function closeJornadaZ(
  rawDb: Database.Database,
  jornadaId: string,
  user: UserContext
): { success: boolean; zReport: ZReportData } {
  if (user.role !== 'admin' && user.role !== 'supervisor') {
    const err: any = new Error('Solo un Administrador o Supervisor puede ejecutar el Cierre Z de jornada');
    err.statusCode = 403;
    throw err;
  }

  const jornada = rawDb.prepare('SELECT * FROM jornadas WHERE id = ?').get(jornadaId) as any;
  if (!jornada) {
    const err: any = new Error(`Jornada '${jornadaId}' no encontrada`);
    err.statusCode = 404;
    throw err;
  }

  if (jornada.status === 'cerrada') {
    const err: any = new Error(`La jornada '${jornadaId}' ya ha sido cerrada con Cierre Z`);
    err.statusCode = 400;
    throw err;
  }

  const now = Date.now();

  // Delegar cálculo de verdad financiera a servicio central
  const ft = getFinancialTruth(rawDb, { jornadaId });
  const rateMicroBs = ft.rateMicroBs;

  const netSalesUsdCents = ft.orders.netSalesUsdCents;
  const discountUsdCents = ft.orders.discountsUsdCents;
  const grossSalesUsdCents = ft.orders.grossSalesUsdCents;
  const deliveryFeesUsdCents = ft.orders.deliveryFeesUsdCents;
  const totalCollectedUsdCents = netSalesUsdCents + deliveryFeesUsdCents;

  const cashUsdMethod = ft.collectedByMethod.find(m => m.method === 'EFECTIVO_USD');
  const cashBsMethod = ft.collectedByMethod.find(m => m.method === 'EFECTIVO_BS');
  const pagoMovilMethod = ft.collectedByMethod.find(m => m.method === 'PAGO_MOVIL');
  const ubiiMethod = ft.collectedByMethod.find(m => m.method === 'UBII');
  const binanceMethod = ft.collectedByMethod.find(m => m.method === 'BINANCE');
  const zelleMethod = ft.collectedByMethod.find(m => m.method === 'ZELLE');

  const cashUsdCents = cashUsdMethod?.grossUsdCents || 0;
  const cashBsCents = cashBsMethod?.grossBsCents || 0;
  const pagoMovilBsCents = pagoMovilMethod?.grossBsCents || 0;
  const ubiiGrossBsCents = ubiiMethod?.grossBsCents || 0;
  const binanceUsdCents = binanceMethod?.grossUsdCents || 0;
  const zelleUsdCents = zelleMethod?.grossUsdCents || 0;

  // Comisión Ubii 0.75%
  const ubiiFeeBsCents = Math.round((ubiiGrossBsCents * 75) / 10000);
  const ubiiNetBsCents = ubiiGrossBsCents - ubiiFeeBsCents;

  const expensesUsdCents = ft.operatingExpensesUsdCents;
  const mermasUsdCents = ft.waste.totalUsdCents;
  const ordersCount = ft.orders.totalCount;

  // 4. Capturar el Hash de Cabeza de la Cadena de Auditoría SHA-256
  const lastAudit = rawDb.prepare(`
    SELECT entry_hash
    FROM audit_events
    ORDER BY seq DESC
    LIMIT 1
  `).get() as { entry_hash: string } | undefined;
  const auditHeadHash = lastAudit?.entry_hash || 'GENESIS_AUDIT_HASH';

  const byMethod = ft.collectedByMethod.map(m => ({
    method: m.method,
    label: getPaymentMethodHumanLabel(m.method),
    count: m.count,
    grossUsdCents: m.grossUsdCents,
    grossBsCents: m.grossBsCents
  }));
  const receivablesUsdCents = ft.receivables.totalUsdCents;

  const zReportData: ZReportData = {
    jornadaId,
    openedAtMs: jornada.opened_at_ms,
    closedAtMs: now,
    closedByName: user.name,
    rateMicroBs,
    grossSalesUsdCents,
    discountUsdCents,
    netSalesUsdCents,
    deliveryFeesUsdCents,
    totalCollectedUsdCents,
    cashUsdCents,
    cashBsCents,
    pagoMovilBsCents,
    ubiiGrossBsCents,
    ubiiFeeBsCents,
    ubiiNetBsCents,
    binanceUsdCents,
    zelleUsdCents,
    expensesUsdCents,
    mermasLossUsdCents: mermasUsdCents,
    ordersCount,
    auditHeadHash,
    byMethod,
    receivablesUsdCents
  };

  // 5. Guardar estado de cierre en base de datos
  rawDb.prepare(`
    UPDATE jornadas
    SET status = 'cerrada',
        closed_at_ms = ?,
        closed_by_user_id = ?,
        audit_head_hash = ?,
        z_report_json = ?
    WHERE id = ?
  `).run(now, user.id, auditHeadHash, JSON.stringify(zReportData), jornadaId);

  // Cerrar también todas las sesiones de caja abiertas
  rawDb.prepare(`
    UPDATE cash_sessions
    SET status = 'cerrada',
        closed_at_ms = ?
    WHERE jornada_id = ? AND status = 'abierta'
  `).run(now, jornadaId);

  // 6. Encolar impresión del Ticket Térmico de Cierre Z con Hash SHA-256
  const zTicketIR = buildZReportTicketIR(zReportData);
  const cajaConfig = getPrinterConfig(rawDb, 'print_caja_usb');
  const zBytes = Buffer.from(renderTicketToEscPos(zTicketIR, cajaConfig));

  const newPrintJobId = `pjob_${generateUuidV7()}`;
  rawDb.prepare(`
    INSERT INTO print_jobs (
      id, printer_id, order_id, job_type, payload_bytes,
      ticket_ir_json, station, status, attempts, created_at_ms
    ) VALUES (?, 'print_caja_usb', NULL, 'CIERRE_Z', ?, ?, 'caja', 'en_cola', 0, ?)
  `).run(newPrintJobId, zBytes, JSON.stringify(zTicketIR), now);

  // 7. Auditoría y Bus de Eventos
  appendAuditEvent(rawDb, {
    actorUserId: user.id,
    action: 'JORNADA_CLOSED_Z_REPORT',
    entityType: 'jornada',
    entityId: jornadaId,
    payload: {
      zReport: zReportData,
      auditHeadHash
    }
  });

  publishDomainEvent(rawDb, {
    eventType: 'JORNADA_CLOSED',
    entityId: jornadaId,
    payload: {
      jornadaId,
      closedAtMs: now,
      closedByName: user.name,
      auditHeadHash
    }
  });

  // 8. SUG-04: Archivado seguro de events_log (> 30 días, preservando últimos 1.000) y purga de idempotency_keys
  try {
    archiveOldEventsAndPurgeIdempotency(rawDb, now);
  } catch (err) {
    console.error('[Cierre Z] Error en archivado seguro de eventos:', err);
  }

  // 9. Respaldo Cifrado Diario a USB (age) al cerrar jornada
  createEncryptedBackup(rawDb, {
    jornadaId,
    actorUserId: user.id,
    backupType: 'ENCRYPTED_USB_DAILY'
  }).catch((err) => {
    console.error('[Cierre Z] Error al generar respaldo cifrado automático a USB:', err);
  });

  return {
    success: true,
    zReport: zReportData
  };
}

export interface EventArchiveResult {
  purgedIdempotencyKeys: number;
  archivedEventsCount: number;
  remainingEventsCount: number;
}

/**
 * SUG-04: Purga de idempotency_keys expiradas y archivado de events_log antiguos.
 * Regla de Oro: CONSERVAR SIEMPRE intactos los últimos 1.000 eventos en events_log
 * para garantizar la reconexión móvil continua por WebSocket (?since=<seq>).
 * Solo se mueven a events_log_archive los eventos previos a ese umbral que tengan
 * más de 30 días de antigüedad.
 * PROHIBIDO tocar orders, ledger_entries o audit_events.
 */
export function archiveOldEventsAndPurgeIdempotency(
  rawDb: Database.Database,
  now: number = Date.now()
): EventArchiveResult {
  // 1. Purga de claves de idempotencia expiradas
  const purgeIdempotency = rawDb.prepare(`
    DELETE FROM idempotency_keys WHERE expires_at_ms < ?
  `).run(now);

  // 2. Umbral de 30 días (30d * 24h * 60m * 60s * 1000ms = 2,592,000,000 ms)
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const cutoffTimeMs = now - thirtyDaysMs;

  let archivedEventsCount = 0;

  // Encontrar el seq del evento #1000 más reciente (orden DESC, offset 999)
  const offsetRow = rawDb.prepare(`
    SELECT seq FROM events_log ORDER BY seq DESC LIMIT 1 OFFSET 999
  `).get() as { seq: number } | undefined;

  // Si existen más de 1.000 eventos, offsetRow existe:
  // Cualquier evento con seq >= offsetRow.seq pertenece al grupo protegido de los últimos 1.000.
  // Solo los que tienen seq < offsetRow.seq Y created_at_ms < cutoffTimeMs son elegibles.
  if (offsetRow) {
    const cutoffSeq = offsetRow.seq;
    const archiveTx = rawDb.transaction(() => {
      rawDb.exec(`
        CREATE TABLE IF NOT EXISTS events_log_archive (
          seq INTEGER PRIMARY KEY,
          event_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          archived_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_log_archive_entity ON events_log_archive(entity_id);
        CREATE INDEX IF NOT EXISTS idx_events_log_archive_created ON events_log_archive(created_at_ms);
      `);

      const insertResult = rawDb.prepare(`
        INSERT OR IGNORE INTO events_log_archive (
          seq, event_type, entity_id, payload_json, created_at_ms, archived_at_ms
        )
        SELECT seq, event_type, entity_id, payload_json, created_at_ms, ?
        FROM events_log
        WHERE seq < ? AND created_at_ms < ?
      `).run(now, cutoffSeq, cutoffTimeMs);

      rawDb.prepare(`
        DELETE FROM events_log
        WHERE seq < ? AND created_at_ms < ?
      `).run(cutoffSeq, cutoffTimeMs);

      return insertResult.changes;
    });

    archivedEventsCount = archiveTx();
  }

  const remaining = rawDb.prepare('SELECT count(*) as count FROM events_log').get() as { count: number };

  return {
    purgedIdempotencyKeys: purgeIdempotency.changes,
    archivedEventsCount,
    remainingEventsCount: remaining.count
  };
}
