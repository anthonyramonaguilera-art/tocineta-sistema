import type Database from 'better-sqlite3';
import { generateUuidV7, renderTicketToEscPos } from '@tocineta/shared';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';
import { buildZReportTicketIR, getPaymentMethodHumanLabel, type ZReportData } from '../printing/templates.js';
import { getPrinterConfig } from '../printing/worker.js';
import { createEncryptedBackup } from '../backups/backup-service.js';
import { getFinancialTruth } from '../finances/financial-truth-service.js';
import { computeExpectedByMethod, normalizeCanonicalMethod } from './method-expected.js';

export interface MethodCountInput {
  method: string;
  countedCents: number;
}

export interface MethodCountDetail {
  method: string;
  label: string;
  currency: 'USD' | 'BS';
  expectedCents: number;
  countedCents: number;
  diffCents: number;
}

export interface BlindCountInput {
  cashUsdCents?: number;
  cashBsCents?: number;
  ubiiVoucherBsCents?: number;
  notes?: string;
  counts?: MethodCountInput[];
  confirmEmpty?: boolean;
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
  methodCounts?: MethodCountDetail[];
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
    methodCounts?: MethodCountDetail[];
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

  // 1. Calcular montos esperados para los 9 métodos canónicos
  const expectedList = computeExpectedByMethod(rawDb, sessionId);

  // 2. Resolver conteos recibidos (soportando retrocompatibilidad)
  let rawCounts: MethodCountInput[];
  if (Array.isArray(input.counts) && input.counts.length > 0) {
    rawCounts = input.counts;
  } else {
    rawCounts = [
      { method: 'EFECTIVO_USD', countedCents: input.cashUsdCents ?? 0 },
      { method: 'EFECTIVO_BS', countedCents: input.cashBsCents ?? 0 },
      { method: 'UBII', countedCents: input.ubiiVoucherBsCents ?? 0 }
    ];
  }

  // 3. Emparejar cada método canónico con su conteo
  const methodCounts: MethodCountDetail[] = expectedList.map(exp => {
    let countedCents = 0;
    let found = false;
    for (const c of rawCounts) {
      if (normalizeCanonicalMethod(c.method) === exp.method) {
        countedCents += Math.round(Number(c.countedCents) || 0);
        found = true;
      }
    }
    const finalCounted = found ? countedCents : 0;
    const diffCents = finalCounted - exp.expectedCents;
    return {
      method: exp.method,
      label: getPaymentMethodHumanLabel(exp.method),
      currency: exp.currency,
      expectedCents: exp.expectedCents,
      countedCents: finalCounted,
      diffCents
    };
  });

  // 4. Regla D13 (Prohibido cerrar en cero con ventas)
  const sumExpected = expectedList.reduce((acc, m) => acc + (m.expectedCents > 0 ? m.expectedCents : 0), 0);
  const allCountedZero = methodCounts.every(m => m.countedCents === 0);

  if (sumExpected > 0 && allCountedZero) {
    const err: any = new Error('No se puede cerrar en cero cuando hubo movimientos o saldo esperado en el turno');
    err.statusCode = 400;
    err.code = 'BLIND_COUNT_ALL_ZERO';
    throw err;
  }

  if (sumExpected === 0 && allCountedZero && !input.confirmEmpty) {
    const err: any = new Error('Se requiere confirmación para cerrar un turno sin movimientos en cero');
    err.statusCode = 400;
    err.code = 'CONFIRM_EMPTY_REQUIRED';
    throw err;
  }

  // 5. Regla anti-tanteo (D12)
  const attempt = session.recount_used === 0 ? 1 : 2;
  const hasDiscrepancy = methodCounts.some(m => m.diffCents !== 0);

  if (attempt === 1 && hasDiscrepancy) {
    const now = Date.now();
    rawDb.prepare('UPDATE cash_sessions SET recount_used = 1 WHERE id = ?').run(sessionId);

    const insertStmt = rawDb.prepare(`
      INSERT INTO cash_session_method_counts (
        id, cash_session_id, method, currency,
        expected_cents, counted_cents, diff_cents,
        attempt, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const mc of methodCounts) {
      insertStmt.run(
        `csmc_${generateUuidV7()}`,
        sessionId,
        mc.method,
        mc.currency,
        mc.expectedCents,
        mc.countedCents,
        mc.diffCents,
        1,
        now
      );
    }

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

  // 6. CIERRE DEFINITIVO DE SESIÓN (En el segundo conteo o si cuadró exacto)
  const now = Date.now();

  const insertStmt = rawDb.prepare(`
    INSERT INTO cash_session_method_counts (
      id, cash_session_id, method, currency,
      expected_cents, counted_cents, diff_cents,
      attempt, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const mc of methodCounts) {
    insertStmt.run(
      `csmc_${generateUuidV7()}`,
      sessionId,
      mc.method,
      mc.currency,
      mc.expectedCents,
      mc.countedCents,
      mc.diffCents,
      attempt,
      now
    );
  }

  const cashUsdCount = methodCounts.find(m => m.method === 'EFECTIVO_USD')!;
  const cashBsCount = methodCounts.find(m => m.method === 'EFECTIVO_BS')!;
  const ubiiCount = methodCounts.find(m => m.method === 'UBII')!;

  const ubiiFeeBsCents = Math.round((ubiiCount.expectedCents * 75) / 10000); // 0.75%
  const ubiiNetExpectedBsCents = ubiiCount.expectedCents - ubiiFeeBsCents;

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
    cashUsdCount.countedCents,
    cashBsCount.countedCents,
    ubiiCount.countedCents,
    cashUsdCount.expectedCents,
    cashBsCount.expectedCents,
    ubiiCount.expectedCents,
    cashUsdCount.diffCents,
    cashBsCount.diffCents,
    ubiiCount.diffCents,
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
      diffUsdCents: cashUsdCount.diffCents,
      diffBsCents: cashBsCount.diffCents,
      diffUbiiBsCents: ubiiCount.diffCents,
      recountUsed: session.recount_used,
      attempt
    }
  });

  // 4. RETORNO SEGREGADO POR ROL:
  // Si es cajera: NO recibe números esperados ni descuadres (anti-tanteo garantizado),
  // pero recibe methodCounts con el desglose auditado.
  // Si es admin o supervisor: recibe además session con conciliación completa.
  const isPrivileged = user.role === 'admin' || user.role === 'supervisor';

  if (!isPrivileged) {
    return {
      status: 'CLOSED',
      message: 'Sesión de caja cerrada exitosamente.',
      methodCounts
    };
  }

  return {
    status: 'CLOSED',
    message: 'Sesión de caja cerrada y auditada con éxito.',
    methodCounts,
    session: {
      id: sessionId,
      jornadaId: session.jornada_id,
      userId: session.user_id,
      openedAtMs: session.opened_at_ms,
      closedAtMs: now,
      closingCashUsdCents: cashUsdCount.countedCents,
      closingCashBsCents: cashBsCount.countedCents,
      closingUbiiVoucherBsCents: ubiiCount.countedCents,
      expectedCashUsdCents: cashUsdCount.expectedCents,
      expectedCashBsCents: cashBsCount.expectedCents,
      expectedUbiiGrossBsCents: ubiiCount.expectedCents,
      diffUsdCents: cashUsdCount.diffCents,
      diffBsCents: cashBsCount.diffCents,
      diffUbiiBsCents: ubiiCount.diffCents,
      methodCounts,
      ubiiLiquidation: {
        grossBsCents: ubiiCount.expectedCents,
        feeBsCents: ubiiFeeBsCents,
        netBsCents: ubiiNetExpectedBsCents,
        voucherDiffBsCents: ubiiCount.diffCents
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
  if (user.role !== 'admin' && user.role !== 'supervisor' && user.role !== 'cajera') {
    const err: any = new Error('Solo un Administrador, Supervisor o Cajera puede ejecutar el Cierre Z de jornada');
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

  const pending = rawDb.prepare(`
    SELECT COUNT(*) AS cnt FROM orders
    WHERE jornada_id = ?
      AND payment_status IN ('sin_pago', 'parcial', 'autorizado_sin_pago')
      AND fulfillment_status NOT IN ('cerrado', 'anulado')
  `).get(jornadaId) as { cnt: number };
  if (pending.cnt > 0) {
    const err: any = new Error(
      `No se puede cerrar la jornada: hay ${pending.cnt} pedido(s) sin cobrar. Cobralos o anulalos primero.`
    );
    err.statusCode = 409;
    err.code = 'UNPAID_ORDERS_PENDING';
    err.pendingCount = pending.cnt;
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
  const puntoDeVentaMethod = ft.collectedByMethod.find(m => m.method === 'PUNTO_DE_VENTA');
  const ubiiMethod = ft.collectedByMethod.find(m => m.method === 'UBII');
  const transferenciaMethod = ft.collectedByMethod.find(m => m.method === 'TRANSFERENCIA');
  const binanceMethod = ft.collectedByMethod.find(m => m.method === 'BINANCE');
  const zelleMethod = ft.collectedByMethod.find(m => m.method === 'ZELLE');
  const otrosMethod = ft.collectedByMethod.find(m => m.method === 'OTROS');

  const cashUsdCents = cashUsdMethod?.grossUsdCents || 0;
  const cashBsCents = cashBsMethod?.grossBsCents || 0;
  const pagoMovilBsCents = pagoMovilMethod?.grossBsCents || 0;
  const puntoDeVentaBsCents = puntoDeVentaMethod?.grossBsCents || 0;
  const ubiiGrossBsCents = ubiiMethod?.grossBsCents || 0;
  const transferenciaBsCents = transferenciaMethod?.grossBsCents || 0;
  const binanceUsdCents = binanceMethod?.grossUsdCents || 0;
  const zelleUsdCents = zelleMethod?.grossUsdCents || 0;
  const otrosUsdCents = otrosMethod?.grossUsdCents || 0;

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
    puntoDeVentaBsCents,
    ubiiGrossBsCents,
    ubiiFeeBsCents,
    ubiiNetBsCents,
    transferenciaBsCents,
    binanceUsdCents,
    zelleUsdCents,
    otrosUsdCents,
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
