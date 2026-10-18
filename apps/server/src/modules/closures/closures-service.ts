import type Database from 'better-sqlite3';
import { generateUuidV7, renderTicketToEscPos } from '@tocineta/shared';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';
import { buildZReportTicketIR, type ZReportData } from '../printing/templates.js';
import { getPrinterConfig } from '../printing/worker.js';
import { createEncryptedBackup } from '../backups/backup-service.js';

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

  const expectedCashUsdCents = session.opening_cash_usd_cents + cashUsdInflow - cashUsdOutflow;
  const expectedCashBsCents = session.opening_cash_bs_cents + cashBsInflow - cashBsOutflow;
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

  // Obtener tasa BCV oficial de la jornada
  const rateRow = rawDb.prepare('SELECT rate_micro_bs FROM exchange_rates WHERE is_current = 1 LIMIT 1').get() as any;
  const rateMicroBs = rateRow?.rate_micro_bs || 40_000_000;

  // 1. Totalizar Ventas de Alimentos y Fondos desde ledger_entries
  const foodSalesRow = rawDb.prepare(`
    SELECT 
      COALESCE(SUM(credit_usd_cents), 0) as total_food_sales
    FROM ledger_entries
    WHERE jornada_id = ? AND account_bucket = 'FOOD_SALES'
  `).get(jornadaId) as { total_food_sales: number };

  const discountRow = rawDb.prepare(`
    SELECT 
      COALESCE(SUM(debit_usd_cents), 0) as total_discounts
    FROM ledger_entries
    WHERE jornada_id = ? AND account_bucket = 'DISCOUNT_EXPENSE'
  `).get(jornadaId) as { total_discounts: number };

  const deliveryRow = rawDb.prepare(`
    SELECT 
      COALESCE(SUM(credit_usd_cents), 0) as total_delivery_fees
    FROM ledger_entries
    WHERE jornada_id = ? AND account_bucket = 'MOTORIZADO_FUND'
  `).get(jornadaId) as { total_delivery_fees: number };

  const netSalesUsdCents = foodSalesRow.total_food_sales;
  const discountUsdCents = discountRow.total_discounts;
  const grossSalesUsdCents = netSalesUsdCents + discountUsdCents;
  const deliveryFeesUsdCents = deliveryRow.total_delivery_fees;
  const totalCollectedUsdCents = netSalesUsdCents + deliveryFeesUsdCents;

  // 2. Desglose de Medios de Pago desde la tabla payments asociada a órdenes de esta jornada
  const paymentRows = rawDb.prepare(`
    SELECT p.method, p.amount_cents, p.usd_equivalent_cents
    FROM payments p
    JOIN orders o ON p.order_id = o.id
    WHERE o.jornada_id = ?
  `).all(jornadaId) as Array<{
    method: string;
    amount_cents: number;
    usd_equivalent_cents: number;
  }>;

  let cashUsdCents = 0;
  let cashBsCents = 0;
  let pagoMovilBsCents = 0;
  let ubiiGrossBsCents = 0;
  let binanceUsdCents = 0;
  let zelleUsdCents = 0;

  for (const p of paymentRows) {
    const m = p.method.toUpperCase();
    if (m === 'CASH_USD' || m === 'EFECTIVO_USD') {
      cashUsdCents += p.amount_cents;
    } else if (m === 'CASH_BS' || m === 'EFECTIVO_BS') {
      cashBsCents += p.amount_cents;
    } else if (m === 'PAGO_MOVIL') {
      pagoMovilBsCents += p.amount_cents;
    } else if (m === 'UBII' || m === 'PUNTO_DE_VENTA') {
      ubiiGrossBsCents += p.amount_cents;
    } else if (m === 'BINANCE') {
      binanceUsdCents += p.amount_cents;
    } else if (m === 'ZELLE') {
      zelleUsdCents += p.amount_cents;
    }
  }

  // Comisión Ubii 0.75%
  const ubiiFeeBsCents = Math.round((ubiiGrossBsCents * 75) / 10000);
  const ubiiNetBsCents = ubiiGrossBsCents - ubiiFeeBsCents;

  // 3. Total Gastos y Mermas
  const expensesRow = rawDb.prepare(`
    SELECT COALESCE(SUM(debit_usd_cents), 0) as total_expenses
    FROM ledger_entries
    WHERE jornada_id = ? AND account_bucket = 'OPERATING_EXPENSE'
  `).get(jornadaId) as { total_expenses: number };

  const mermasRow = rawDb.prepare(`
    SELECT COALESCE(SUM(estimated_loss_usd_cents), 0) as total_mermas
    FROM worker_incidents
    WHERE jornada_id = ?
  `).get(jornadaId) as { total_mermas: number };

  const ordersCountRow = rawDb.prepare(`
    SELECT count(*) as count
    FROM orders
    WHERE jornada_id = ?
  `).get(jornadaId) as { count: number };

  // 4. Capturar el Hash de Cabeza de la Cadena de Auditoría SHA-256
  const lastAudit = rawDb.prepare(`
    SELECT entry_hash
    FROM audit_events
    ORDER BY seq DESC
    LIMIT 1
  `).get() as { entry_hash: string } | undefined;
  const auditHeadHash = lastAudit?.entry_hash || 'GENESIS_AUDIT_HASH';

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
    expensesUsdCents: expensesRow.total_expenses,
    mermasLossUsdCents: mermasRow.total_mermas,
    ordersCount: ordersCountRow.count,
    auditHeadHash
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

  // 8. Respaldo Cifrado Diario a USB (age) al cerrar jornada
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
