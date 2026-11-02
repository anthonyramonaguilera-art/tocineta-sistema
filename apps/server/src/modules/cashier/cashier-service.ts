import type Database from 'better-sqlite3';
import {
  generateUuidV7,
  calculateSettlement,
  parseRateToMicroBs,
  canUserProcessPayments,
  type SettlementResult
} from '@tocineta/shared';
export { canUserProcessPayments };
import { findAuthorizerByPin, assertAuthorizerAttemptAllowed } from '../auth/authorizer-guard.js';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';
import { getCurrentExchangeRate } from '../menu/menu-service.js';
import { enqueueOrderPrintJobs } from '../printing/worker.js';
import { deductInventoryForOrder, revertInventoryForOrder } from '../profitability/recipes-service.js';
import { resolveLocationId } from '../profitability/locations-service.js';

export interface OpenJornadaInput {
  openedByUserId: string;
  rateMicroBs?: number;
  rateStr?: string;
  initialCashUsdCents: number;
  initialCashBsCents: number;
  notes?: string;
}

export interface OpenCashSessionInput {
  userId: string;
  openingCashUsdCents: number;
  openingCashBsCents: number;
}

export type ClassifiedTender = {
  dbMethod: 'EFECTIVO_USD' | 'EFECTIVO_BS' | 'PAGO_MOVIL' | 'PUNTO_DE_VENTA' | 'UBII' | 'TRANSFERENCIA' | 'BINANCE' | 'ZELLE' | 'OTROS';
  currency: 'USD' | 'BS';
};

export function classifyTender(method: string): ClassifiedTender {
  const m = (method || '').toLowerCase().trim();
  switch (m) {
    case 'cash_usd':
    case 'efectivo_usd':
      return { dbMethod: 'EFECTIVO_USD', currency: 'USD' };
    case 'cash_bs':
    case 'efectivo_bs':
      return { dbMethod: 'EFECTIVO_BS', currency: 'BS' };
    case 'pago_movil':
      return { dbMethod: 'PAGO_MOVIL', currency: 'BS' };
    case 'punto_de_venta':
      return { dbMethod: 'PUNTO_DE_VENTA', currency: 'BS' };
    case 'ubii':
      return { dbMethod: 'UBII', currency: 'BS' };
    case 'transferencia':
      return { dbMethod: 'TRANSFERENCIA', currency: 'BS' };
    case 'binance':
      return { dbMethod: 'BINANCE', currency: 'USD' };
    case 'zelle':
      return { dbMethod: 'ZELLE', currency: 'USD' };
    case 'otros':
      return { dbMethod: 'OTROS', currency: 'USD' };
    default: {
      const err: any = new Error('Método de pago no soportado: ' + method);
      err.statusCode = 400;
      throw err;
    }
  }
}

export interface PaymentTenderInput {
  method: 'cash_usd' | 'cash_bs' | 'pago_movil' | 'ubii' | 'binance' | 'zelle' | 'otros' | string;
  amountCents: number;
  referenceCode?: string;
}

export interface ChangeOutputInput {
  method?: 'cash_usd' | 'cash_bs' | 'pago_movil' | string;
  changeUsdCents?: number;
  changeBsCents?: number;
  referenceCode?: string;
}

export interface ProcessOrderPaymentInput {
  orderId: string;
  cashierUserId: string;
  tenders: PaymentTenderInput[];
  changeOutputs?: ChangeOutputInput;
  overpaymentDisposition?: 'tip_in' | 'adjustment';
  overpaymentReason?: string;
  supervisorPin?: string;
  confirmWarning?: boolean;
  actingKey?: string;
}

/**
 * 1. Abrir o confirmar la Jornada Diaria (POST /api/jornadas/open)
 */
export function openJornada(rawDb: Database.Database, input: OpenJornadaInput) {
  const now = Date.now();

  // Si se envió tasa BCV para la jornada, registrarla
  let rateMicroBs = input.rateMicroBs;
  if (!rateMicroBs && input.rateStr) {
    rateMicroBs = parseRateToMicroBs(input.rateStr);
  }

  if (rateMicroBs && rateMicroBs > 0) {
    rawDb.prepare('UPDATE exchange_rates SET is_current = 0 WHERE is_current = 1').run();
    rawDb.prepare(`
      INSERT INTO exchange_rates (id, rate_micro_bs, source, set_by_user_id, created_at_ms, is_current)
      VALUES (?, ?, 'MANUAL_ADMIN', ?, ?, 1)
    `).run(`rate_${generateUuidV7()}`, rateMicroBs, input.openedByUserId, now);
  }

  const currentRate = getCurrentExchangeRate(rawDb);

  // Verificar si ya existe una jornada abierta (idempotente - D1 / P2-A)
  const existing = rawDb.prepare(`
    SELECT * FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1
  `).get() as any;

  if (existing) {
    return {
      ...existing,
      current_rate_micro_bs: currentRate
    };
  }

  const jornadaId = `jor_${generateUuidV7()}`;
  rawDb.prepare(`
    INSERT INTO jornadas (
      id, opened_by_user_id, opened_at_ms, status,
      initial_cash_usd_cents, initial_cash_bs_cents, notes
    ) VALUES (?, ?, ?, 'abierta', ?, ?, ?)
  `).run(
    jornadaId,
    input.openedByUserId,
    now,
    input.initialCashUsdCents || 0,
    input.initialCashBsCents || 0,
    input.notes || null
  );

  // D1: Crear automáticamente la sesión de caja de la persona que abre la jornada
  const sessionId = `cs_${generateUuidV7()}`;
  rawDb.prepare(`
    INSERT INTO cash_sessions (
      id, jornada_id, user_id, opened_at_ms, status,
      opening_cash_usd_cents, opening_cash_bs_cents
    ) VALUES (?, ?, ?, ?, 'abierta', ?, ?)
  `).run(
    sessionId,
    jornadaId,
    input.openedByUserId,
    now,
    input.initialCashUsdCents || 0,
    input.initialCashBsCents || 0
  );

  appendAuditEvent(rawDb, {
    actorUserId: input.openedByUserId,
    action: 'JORNADA_OPENED',
    entityType: 'jornada',
    entityId: jornadaId,
    payload: {
      initialCashUsdCents: input.initialCashUsdCents,
      initialCashBsCents: input.initialCashBsCents,
      rateMicroBs: currentRate
    }
  });

  publishDomainEvent(rawDb, {
    eventType: 'JORNADA_OPENED',
    entityId: jornadaId,
    payload: { jornadaId, rateMicroBs: currentRate }
  });

  return {
    id: jornadaId,
    opened_by_user_id: input.openedByUserId,
    opened_at_ms: now,
    status: 'abierta',
    initial_cash_usd_cents: input.initialCashUsdCents || 0,
    initial_cash_bs_cents: input.initialCashBsCents || 0,
    current_rate_micro_bs: currentRate,
    notes: input.notes || null
  };
}

/**
 * 2. Abrir o confirmar Sesión de Caja (POST /api/cash-sessions/open)
 */
export function openCashSession(rawDb: Database.Database, input: OpenCashSessionInput) {
  const now = Date.now();

  // Asegurar jornada abierta global (D1 / P2-A)
  let jornada = rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
  if (!jornada) {
    jornada = openJornada(rawDb, {
      openedByUserId: input.userId,
      initialCashUsdCents: input.openingCashUsdCents,
      initialCashBsCents: input.openingCashBsCents
    });
  }

  // Verificar si el usuario ya tiene sesión abierta
  const existing = rawDb.prepare(`
    SELECT * FROM cash_sessions 
    WHERE user_id = ? AND status = 'abierta'
  `).get(input.userId) as any;

  if (existing) {
    return existing;
  }

  const sessionId = `cs_${generateUuidV7()}`;
  rawDb.prepare(`
    INSERT INTO cash_sessions (
      id, jornada_id, user_id, opened_at_ms, status,
      opening_cash_usd_cents, opening_cash_bs_cents
    ) VALUES (?, ?, ?, ?, 'abierta', ?, ?)
  `).run(
    sessionId,
    jornada.id,
    input.userId,
    now,
    input.openingCashUsdCents || 0,
    input.openingCashBsCents || 0
  );

  appendAuditEvent(rawDb, {
    actorUserId: input.userId,
    action: 'CASH_SESSION_OPENED',
    entityType: 'cash_session',
    entityId: sessionId,
    payload: {
      jornadaId: jornada.id,
      openingCashUsdCents: input.openingCashUsdCents,
      openingCashBsCents: input.openingCashBsCents
    }
  });

  return {
    id: sessionId,
    jornada_id: jornada.id,
    user_id: input.userId,
    opened_at_ms: now,
    status: 'abierta',
    opening_cash_usd_cents: input.openingCashUsdCents || 0,
    opening_cash_bs_cents: input.openingCashBsCents || 0
  };
}

/**
 * Obtener jornada abierta actual
 */
export function getCurrentJornada(rawDb: Database.Database) {
  const current = rawDb.prepare("SELECT * FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
  if (!current) return null;
  return {
    ...current,
    current_rate_micro_bs: getCurrentExchangeRate(rawDb)
  };
}

/**
 * Obtener sesión de caja actual para un usuario
 */
export function getCurrentCashSession(rawDb: Database.Database, userId: string) {
  return rawDb.prepare("SELECT * FROM cash_sessions WHERE user_id = ? AND status = 'abierta'").get(userId) as any || null;
}

/**
 * 3. Procesar Cobro de Orden (POST /api/orders/:id/pay)
 * - Tolerancia máx 1 centavo USD solo por redondeo en pagos mixtos (asiento rounding_adjustment).
 * - Subpago > 1 centavo bloquea con 400.
 * - Sobrepago sin vuelto exige clasificar como tip_in o ajuste.
 * - Validación antifraude Pago Móvil Nivel 1 (bloqueo ref+monto) y Nivel 2 (advertencia ref distinta).
 * - Transacción atómica SQLite: payments + change_deliveries + ledger_entries + orden pagada + print_jobs.
 */
export function processOrderPayment(
  rawDb: Database.Database,
  orderId: string,
  input: ProcessOrderPaymentInput
) {
  const now = Date.now();
  const rateMicroBs = getCurrentExchangeRate(rawDb);

  // 1. Validar que la orden existe y está pendiente de pago
  const order = rawDb.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
  if (!order) {
    const err: any = new Error(`Orden '${orderId}' no encontrada`);
    err.statusCode = 404;
    throw err;
  }

  if (order.payment_status === 'pagado') {
    const err: any = new Error(`La orden #${order.order_number} ya fue cobrada previamente`);
    err.statusCode = 400;
    throw err;
  }

  if (!input.tenders || input.tenders.length === 0) {
    const err: any = new Error('Debe especificar al menos un método de pago en tenders');
    err.statusCode = 400;
    throw err;
  }

  // 2. Validación Antifraude de Pago Móvil en dos niveles (últimos 30 días)
  const thirtyDaysAgoMs = now - 30 * 24 * 3600 * 1000;
  for (const t of input.tenders) {
    const m = t.method.toUpperCase();
    const rawRef = t.referenceCode?.trim() || '';
    const isSinRef = !rawRef || rawRef.toUpperCase() === 'SIN-REF';

    if (m === 'PAGO_MOVIL' && !isSinRef) {
      const cleanRef = rawRef;
      const existingPayments = rawDb.prepare(`
        SELECT p.id, p.amount_cents, p.reference_code, p.created_at_ms, o.order_number
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE p.method = 'PAGO_MOVIL' 
          AND p.reference_code = ? 
          AND p.created_at_ms >= ?
      `).all(cleanRef, thirtyDaysAgoMs) as any[];

      if (existingPayments.length > 0) {
        // Nivel 1: Misma referencia Y mismo monto (Bloqueo estricto)
        const duplicateSameAmount = existingPayments.find(p => p.amount_cents === t.amountCents);
        if (duplicateSameAmount) {
          if (!input.supervisorPin) {
            const err: any = new Error(
              `ALERTA ANTIFRAUDE NIVEL 1 (BLOQUEO): La referencia Pago Móvil '${cleanRef}' con monto ${t.amountCents} céntimos ya fue utilizada en la Orden #${duplicateSameAmount.order_number}. Requiere PIN de Supervisor o Admin para autorizar.`
            );
            err.statusCode = 400;
            err.code = 'FRAUD_BLOCK_DUPLICATE_PAYMENT';
            err.requiresSupervisorPin = true;
            throw err;
          }

          // Verificar PIN de supervisor o admin
          const authorizerKey = input.actingKey || input.cashierUserId || 'unknown';
          const verifiedAuth = findAuthorizerByPin(rawDb, input.supervisorPin, authorizerKey);

          if (!verifiedAuth) {
            const err: any = new Error('PIN de Supervisor o Admin incorrecto para autorizar duplicidad de Pago Móvil');
            err.statusCode = 403;
            throw err;
          }

          appendAuditEvent(rawDb, {
            actorUserId: verifiedAuth.id,
            action: 'PAGO_MOVIL_DUPLICATE_AUTHORIZED',
            entityType: 'payment',
            entityId: orderId,
            payload: { referenceCode: cleanRef, amountCents: t.amountCents, authorizedBy: verifiedAuth.name }
          });
        } else {
          // Nivel 2: Misma referencia pero con OTRO monto (Advertencia)
          if (!input.confirmWarning) {
            const err: any = new Error(
              `ADVERTENCIA ANTIFRAUDE NIVEL 2: La referencia Pago Móvil '${cleanRef}' ya existe en el sistema en los últimos 30 días pero con otro monto. ¿Desea confirmar el cobro?`
            );
            err.statusCode = 400;
            err.code = 'FRAUD_WARN_DUPLICATE_REFERENCE';
            err.requiresConfirmation = true;
            throw err;
          }
        }
      }
    }
  }

  // 3. Separación de pagos en USD y Bs
  let paidUsdCents = 0;
  let paidBsCents = 0;

  for (const t of input.tenders) {
    const { currency } = classifyTender(t.method);
    if (currency === 'USD') {
      paidUsdCents += t.amountCents;
    } else {
      paidBsCents += t.amountCents;
    }
  }

  // 4. Liquidación financiera canónica (calculateSettlement)
  const settlement: SettlementResult = calculateSettlement({
    totalUsdCents: order.total_to_collect_usd_cents,
    paidUsdCents,
    paidBsCents,
    rateMicroBs
  });

  // Si falta dinero (subpago mayor a 1 centavo USD) -> Bloquear
  if (settlement.status === 'UNDERPAID') {
    const err: any = new Error(
      `SUBPAGO BLOQUEADO: El monto recibido es insuficiente. Saldo pendiente: ${settlement.differenceBsCents} céntimos de Bs.`
    );
    err.statusCode = 400;
    err.settlement = settlement;
    throw err;
  }

  // Manejo de Vueltos
  const changeUsd = input.changeOutputs?.changeUsdCents || 0;
  const changeBs = input.changeOutputs?.changeBsCents || 0;
  const changeUsdEquivalentFromBs = changeBs > 0 ? Math.round((changeBs * 1_000_000) / rateMicroBs) : 0;
  const totalChangeUsdEquivalent = changeUsd + changeUsdEquivalentFromBs;

  // Si el cliente pagó de más:
  // Calcular sobrepago neto en centavos USD
  const totalPaidUsdEquivalent = paidUsdCents + (paidBsCents > 0 ? Math.round((paidBsCents * 1_000_000) / rateMicroBs) : 0);
  const netOverpaymentUsdCents = Math.max(0, totalPaidUsdEquivalent - order.total_to_collect_usd_cents - totalChangeUsdEquivalent);

  if (netOverpaymentUsdCents > 0) {
    if (!input.overpaymentDisposition) {
      const err: any = new Error(
        `SOBREPAGO DETECTADO: Hay un excedente de $${(netOverpaymentUsdCents / 100).toFixed(2)} que no fue entregado como vuelto. Debe clasificarlo como propina ('tip_in') o registrar un ajuste con motivo.`
      );
      err.statusCode = 400;
      err.netOverpaymentUsdCents = netOverpaymentUsdCents;
      throw err;
    }

    if (input.overpaymentDisposition === 'adjustment' && !input.overpaymentReason) {
      const err: any = new Error('Debe especificar un motivo para el ajuste de sobrepago');
      err.statusCode = 400;
      throw err;
    }
  }

  // Exigir jornada global abierta (Regla D1, P2-B Task 5: JORNADA_CLOSED)
  const jornada = rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
  if (!jornada) {
    const err: any = new Error('No hay una jornada abierta en el sistema. Debe abrir la jornada del día antes de procesar cobros.');
    err.statusCode = 400;
    err.code = 'JORNADA_CLOSED';
    throw err;
  }

  // Exigir sesión de caja abierta del usuario que cobra (Regla D1, P2-B Task 5: CASH_SESSION_REQUIRED)
  let session = rawDb.prepare("SELECT id FROM cash_sessions WHERE user_id = ? AND status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get(input.cashierUserId) as any;
  if (!session) {
    // Si un mesonero con permiso temporal CASHIER_PAY cobra, utiliza la sesión de caja activa en la estación
    const userRow = rawDb.prepare('SELECT role, permissions_json FROM users WHERE id = ?').get(input.cashierUserId) as any;
    let permissions: string[] = [];
    if (userRow?.permissions_json) {
      try {
        permissions = typeof userRow.permissions_json === 'string' ? JSON.parse(userRow.permissions_json) : userRow.permissions_json;
      } catch {}
    }
    if (permissions.includes('CASHIER_PAY') && (userRow?.role === 'mesonero' || userRow?.role === 'mesero')) {
      session = rawDb.prepare("SELECT id FROM cash_sessions WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
    }
  }

  if (!session) {
    const err: any = new Error('Debe abrir su sesión de caja (arqueo inicial) antes de procesar cobros.');
    err.statusCode = 400;
    err.code = 'CASH_SESSION_REQUIRED';
    throw err;
  }

  // --------------------------------------------------------------------------
  // TRANSACCIÓN ATÓMICA SQLITE:
  // 1. Pagos en `payments`
  // 2. Vueltos en `change_deliveries`
  // 3. Asientos contables exactos en `ledger_entries`
  // 4. Actualización de orden
  // 5. Encolado de `print_jobs`
  // --------------------------------------------------------------------------
  const payTx = rawDb.transaction(() => {
    // 1. Insertar pagos
    const insertedPaymentIds: string[] = [];
    for (const t of input.tenders) {
      const paymentId = `pay_${generateUuidV7()}`;
      insertedPaymentIds.push(paymentId);

      const { dbMethod, currency } = classifyTender(t.method);
      const usdEquivalentCents = currency === 'USD'
        ? t.amountCents
        : Math.round((t.amountCents * 1_000_000) / rateMicroBs);

      rawDb.prepare(`
        INSERT INTO payments (
          id, order_id, method, currency, amount_cents, rate_micro_bs,
          usd_equivalent_cents, reference_code, recorded_by_user_id, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        paymentId,
        orderId,
        dbMethod,
        currency,
        t.amountCents,
        rateMicroBs,
        usdEquivalentCents,
        t.referenceCode?.trim() || (dbMethod === 'PAGO_MOVIL' ? 'SIN-REF' : null),
        input.cashierUserId,
        now
      );
    }

    // 2. Insertar vueltos en `change_deliveries` si hubo vuelto entregado
    if (changeUsd > 0 || changeBs > 0) {
      const changeId = `chg_${generateUuidV7()}`;
      rawDb.prepare(`
        INSERT INTO change_deliveries (
          id, order_id, change_usd_cents, change_bs_cents, rate_micro_bs,
          delivered_by_user_id, created_at_ms, method, reference_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        changeId,
        orderId,
        changeUsd,
        changeBs,
        rateMicroBs,
        input.cashierUserId,
        now,
        input.changeOutputs?.method || 'MIXTO',
        input.changeOutputs?.referenceCode || null
      );
    }

    // 3. Asientos Contables Inmutables en `ledger_entries` (Partida Doble)
    const insertLedger = rawDb.prepare(`
      INSERT INTO ledger_entries (
        entry_id, jornada_id, order_id, account_bucket,
        debit_usd_cents, credit_usd_cents, rate_micro_bs, description, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // A. DEBITOS POR CADA PAGO RECIBIDO
    for (const t of input.tenders) {
      const { dbMethod, currency } = classifyTender(t.method);
      let bucket: string;
      const debitCents = currency === 'USD'
        ? t.amountCents
        : Math.round((t.amountCents * 1_000_000) / rateMicroBs);

      if (dbMethod === 'EFECTIVO_USD') {
        bucket = 'CASH_USD';
      } else if (dbMethod === 'EFECTIVO_BS') {
        bucket = 'CASH_BS';
      } else if (currency === 'BS') {
        bucket = 'BANK_BS';
      } else {
        bucket = 'BANK_USD';
      }

      insertLedger.run(
        `led_${generateUuidV7()}`,
        jornada.id,
        orderId,
        bucket,
        debitCents,
        0,
        rateMicroBs,
        `Ingreso Pago Orden #${order.order_number} (${t.method})`,
        now
      );
    }

    // B. AJUSTE DE REDONDEO POR TOLERANCIA DE 1 CENTAVO (SI APLICA)
    if (settlement.roundingAdjustmentUsdCents > 0) {
      insertLedger.run(
        `led_${generateUuidV7()}`,
        jornada.id,
        orderId,
        'ROUNDING_ADJUSTMENT',
        settlement.roundingAdjustmentUsdCents,
        0,
        rateMicroBs,
        `Ajuste de Redondeo Permitido (Tolerancia 1c USD) Orden #${order.order_number}`,
        now
      );
    }

    // C. CREDITOS POR INGRESO DE VENTA (FOOD_SALES Y MOTORIZADO_FUND)
    insertLedger.run(
      `led_${generateUuidV7()}`,
      jornada.id,
      orderId,
      'FOOD_SALES',
      0,
      order.net_food_sales_usd_cents,
      rateMicroBs,
      `Venta Neta de Alimentos Orden #${order.order_number}`,
      now
    );

    if (order.delivery_fee_usd_cents > 0) {
      insertLedger.run(
        `led_${generateUuidV7()}`,
        jornada.id,
        orderId,
        'MOTORIZADO_FUND',
        0,
        order.delivery_fee_usd_cents,
        rateMicroBs,
        `Fondo Delivery Terceros Orden #${order.order_number}`,
        now
      );
    }

    // E. REGISTRO CONTABLE DE CORTESÍAS DE MARKETING (SI APLICA)
    const courtesyLines = rawDb.prepare(`
      SELECT ol.*, p.estimated_cost_usd_cents, p.name as product_name
      FROM order_lines ol
      JOIN products p ON ol.product_id = p.id
      WHERE ol.order_id = ? AND ol.line_role = 'COURTESY_ITEM'
    `).all(orderId) as any[];

    for (const cl of courtesyLines) {
      const costCents = cl.estimated_cost_usd_cents || 35;
      insertLedger.run(
        `led_${generateUuidV7()}`,
        jornada.id,
        orderId,
        'MARKETING_COURTESY',
        costCents,
        0,
        rateMicroBs,
        `Costo Interno Marketing Obsequio: ${cl.product_name} (${costCents}c USD) Orden #${order.order_number}`,
        now
      );
    }

    // D. CREDITOS POR ENTREGA DE VUELTOS (SALIDAS DE CAJA)
    if (changeUsd > 0) {
      insertLedger.run(
        `led_${generateUuidV7()}`,
        jornada.id,
        orderId,
        'CASH_USD',
        0,
        changeUsd,
        rateMicroBs,
        `Entrega Vuelto Efectivo USD Orden #${order.order_number}`,
        now
      );
    }

    if (changeBs > 0) {
      const changeBsEquivUsd = Math.round((changeBs * 1_000_000) / rateMicroBs);
      const changeBucket = (input.changeOutputs?.method || '').toLowerCase().includes('pago_movil') ? 'BANK_BS' : 'CASH_BS';
      insertLedger.run(
        `led_${generateUuidV7()}`,
        jornada.id,
        orderId,
        changeBucket,
        0,
        changeBsEquivUsd,
        rateMicroBs,
        `Entrega Vuelto en Bolívares (${changeBs} céntimos Bs) Orden #${order.order_number}`,
        now
      );
    }

    // E. CREDITO POR SOBREPAGO CLASIFICADO (TIP_IN O AJUSTE)
    if (netOverpaymentUsdCents > 0) {
      if (input.overpaymentDisposition === 'tip_in') {
        insertLedger.run(
          `led_${generateUuidV7()}`,
          jornada.id,
          orderId,
          'TIP_IN',
          0,
          netOverpaymentUsdCents,
          rateMicroBs,
          `Propina Equipo Tocineta Orden #${order.order_number}`,
          now
        );
      } else {
        insertLedger.run(
          `led_${generateUuidV7()}`,
          jornada.id,
          orderId,
          'OPERATING_EXPENSE',
          0,
          netOverpaymentUsdCents,
          rateMicroBs,
          `Ajuste de Excedente: ${input.overpaymentReason || 'Sin motivo'} Orden #${order.order_number}`,
          now
        );
      }
    }

    // 4. Actualizar Estado de la Orden a 'pagado' y 'en_preparacion'
    const hasHotDogs = rawDb.prepare("SELECT 1 FROM order_lines WHERE order_id = ? AND station = 'hot_dogs' AND line_role != 'COMBO_PARENT' LIMIT 1").get(orderId) !== undefined;
    const hasBurgers = rawDb.prepare("SELECT 1 FROM order_lines WHERE order_id = ? AND station = 'hamburguesas' AND line_role != 'COMBO_PARENT' LIMIT 1").get(orderId) !== undefined;

    rawDb.prepare(`
      UPDATE orders
      SET payment_status = 'pagado',
          fulfillment_status = 'en_preparacion',
          jornada_id = COALESCE(jornada_id, ?),
          cash_session_id = ?,
          kitchen_passed_at_ms = COALESCE(kitchen_passed_at_ms, ?),
          station_status_hot_dogs = ?,
          station_status_hamburguesas = ?,
          updated_at_ms = ?
      WHERE id = ?
    `).run(
      jornada.id,
      session.id,
      now,
      hasHotDogs ? 'en_preparacion' : 'na',
      hasBurgers ? 'en_preparacion' : 'na',
      now,
      orderId
    );

    // 5. Descuento atómico de inventario por receta en la sede de la venta
    const orderLocationId = order.location_id || 'loc_alta_vista';
    deductInventoryForOrder(rawDb, orderId, orderLocationId, now, input.cashierUserId);

    // 6. Encolar Trabajos de Impresión Asíncrona (Caja USB y Cocina TCP con Ticket IR)
    enqueueOrderPrintJobs(rawDb, orderId);

    // 6. Auditoría y Bus de Eventos
    appendAuditEvent(rawDb, {
      actorUserId: input.cashierUserId,
      action: 'ORDER_PAID',
      entityType: 'order',
      entityId: orderId,
      payload: {
        orderNumber: order.order_number,
        totalPaidUsdCents: totalPaidUsdEquivalent,
        changeUsdCents: changeUsd,
        changeBsCents: changeBs,
        rateMicroBs
      }
    });

    publishDomainEvent(rawDb, {
      eventType: 'ORDER_PAID',
      entityId: orderId,
      payload: {
        orderId,
        orderNumber: order.order_number,
        paymentStatus: 'pagado',
        fulfillmentStatus: 'en_preparacion',
        rateMicroBs
      }
    });
  });

  payTx();

  // Retornar orden actualizada
  const updatedOrder = rawDb.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
  const paymentsList = rawDb.prepare('SELECT * FROM payments WHERE order_id = ?').all(orderId);
  const changeList = rawDb.prepare('SELECT * FROM change_deliveries WHERE order_id = ?').all(orderId);
  const ledgerList = rawDb.prepare('SELECT * FROM ledger_entries WHERE order_id = ? ORDER BY seq ASC').all(orderId);

  return {
    order: updatedOrder,
    payments: paymentsList,
    changeDeliveries: changeList,
    ledgerEntries: ledgerList,
    settlement
  };
}

export interface AnnulOrderInCashierInput {
  orderId: string;
  reason?: string;
  actorUserId?: string;
  supervisorPin?: string;
  actingKey?: string;
}

/**
 * Anulación limpia de comanda en Caja:
 * - Resolución estricta de Sede con resolveLocationId
 * - Actualiza atómicamente orders.fulfillment_status = 'anulado' y order_lines.status = 'cancelado'
 * - Revierte inventario de recetas/insumos si existían movimientos previos (sin lanzar 500 si no hay receta)
 * - Emite el evento WebSocket correspondientes para limpiar el KDS inmediatamente.
 */
export function annulOrderInCashier(
  rawDb: Database.Database,
  input: AnnulOrderInCashierInput
): { success: boolean; orderId: string; message: string } {
  const { orderId } = input;
  const reason = input.reason?.trim() || 'Anulado desde Caja';
  const now = Date.now();

  const order = rawDb.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
  if (!order) {
    const err: any = new Error(`Orden '${orderId}' no encontrada`);
    err.statusCode = 404;
    throw err;
  }

  // 1. Resolución estricta de sede sin fallbacks silenciosos (P2-A)
  const locationId = resolveLocationId(rawDb, order.location_id, input.actorUserId);
  const isPaid = order.payment_status === 'pagado';
  const newPaymentStatus = isPaid ? 'reembolsado' : 'anulado';

  // Si la orden ya estaba pagada, exigir y validar PIN de supervisor/admin
  let verifiedAuthorizer: { id: string; name: string; role: string } | null = null;
  if (isPaid) {
    if (!input.supervisorPin || !input.supervisorPin.trim()) {
      const err: any = new Error('Se requiere PIN de supervisor o administrador para anular una orden pagada');
      err.statusCode = 400;
      err.code = 'SUPERVISOR_PIN_REQUIRED';
      throw err;
    }

    const authorizerKey = input.actingKey || input.actorUserId || 'unknown';
    verifiedAuthorizer = findAuthorizerByPin(rawDb, input.supervisorPin.trim(), authorizerKey);
    if (!verifiedAuthorizer) {
      assertAuthorizerAttemptAllowed(authorizerKey);
      const err: any = new Error('PIN de autorización inválido para anular comanda pagada');
      err.statusCode = 403;
      err.code = 'INVALID_AUTHORIZER_PIN';
      throw err;
    }
  }

  const annulTx = rawDb.transaction(() => {
    // 2. Revertir inventario si hubo movimientos previos (sin lanzar 500 si no hay receta)
    revertInventoryForOrder(rawDb, orderId, locationId, reason, input.actorUserId || 'usr_cajera');

    // 3. Revertir ledger si estaba pagada: reversión espejo exacta por método y vueltos
    if (isPaid) {
      const rateMicroBs = order.rate_micro_bs || 40_000_000;
      const insertLedger = rawDb.prepare(`
        INSERT INTO ledger_entries (
          entry_id, jornada_id, order_id, account_bucket,
          debit_usd_cents, credit_usd_cents, rate_micro_bs, description, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // A. Reversión de venta neta de alimentos
      if (order.net_food_sales_usd_cents > 0) {
        insertLedger.run(
          `led_${generateUuidV7()}`,
          order.jornada_id,
          orderId,
          'FOOD_SALES',
          order.net_food_sales_usd_cents,
          0,
          rateMicroBs,
          `Reversión Venta Alimentos #${order.order_number} (${reason})`,
          now
        );
      }

      // B. Reversión de fondo delivery si existía
      if (order.delivery_fee_usd_cents > 0) {
        insertLedger.run(
          `led_${generateUuidV7()}`,
          order.jornada_id,
          orderId,
          'MOTORIZADO_FUND',
          order.delivery_fee_usd_cents,
          0,
          rateMicroBs,
          `Reversión Fondo Delivery #${order.order_number} (${reason})`,
          now
        );
      }

      // C. Reversión espejo por cada pago registrado en la orden (mismo bucket, invertido débito -> crédito)
      const orderPayments = rawDb.prepare('SELECT * FROM payments WHERE order_id = ?').all(orderId) as any[];
      for (const p of orderPayments) {
        let bucket;
        const m = (p.method || '').toUpperCase();
        if (m === 'EFECTIVO_USD' || m === 'CASH_USD') {
          bucket = 'CASH_USD';
        } else if (m === 'EFECTIVO_BS' || m === 'CASH_BS') {
          bucket = 'CASH_BS';
        } else if (p.currency === 'BS' || m === 'PAGO_MOVIL' || m === 'PUNTO_DE_VENTA' || m === 'UBII' || m === 'TRANSFERENCIA') {
          bucket = 'BANK_BS';
        } else {
          bucket = 'BANK_USD';
        }

        const creditCents = p.usd_equivalent_cents || (p.currency === 'USD' ? p.amount_cents : Math.round((p.amount_cents * 1_000_000) / (p.rate_micro_bs || rateMicroBs)));

        insertLedger.run(
          `led_${generateUuidV7()}`,
          order.jornada_id,
          orderId,
          bucket,
          0,
          creditCents,
          p.rate_micro_bs || rateMicroBs,
          `Reversión Pago #${order.order_number} (${p.method})`,
          now
        );
      }

      // D. Reversión espejo por cada vuelto entregado en la orden (crédito original -> débito)
      const orderChanges = rawDb.prepare('SELECT * FROM change_deliveries WHERE order_id = ?').all(orderId) as any[];
      for (const cd of orderChanges) {
        if (cd.change_usd_cents > 0) {
          insertLedger.run(
            `led_${generateUuidV7()}`,
            order.jornada_id,
            orderId,
            'CASH_USD',
            cd.change_usd_cents,
            0,
            cd.rate_micro_bs || rateMicroBs,
            `Reversión Vuelto Efectivo USD #${order.order_number}`,
            now
          );
        }
        if (cd.change_bs_cents > 0) {
          const changeRate = cd.rate_micro_bs || rateMicroBs;
          const changeBsEquivUsd = Math.round((cd.change_bs_cents * 1_000_000) / changeRate);
          const changeBucket = (cd.method || '').toLowerCase().includes('pago_movil') ? 'BANK_BS' : 'CASH_BS';
          insertLedger.run(
            `led_${generateUuidV7()}`,
            order.jornada_id,
            orderId,
            changeBucket,
            changeBsEquivUsd,
            0,
            changeRate,
            `Reversión Vuelto Bolívares #${order.order_number}`,
            now
          );
        }
      }

      // E. Reversión de ajustes de redondeo, propinas o gastos por sobrepago de la orden original
      const existingEntries = rawDb.prepare(`
        SELECT account_bucket, debit_usd_cents, credit_usd_cents, rate_micro_bs
        FROM ledger_entries
        WHERE order_id = ? AND account_bucket IN ('ROUNDING_ADJUSTMENT', 'TIP_IN', 'OPERATING_EXPENSE', 'MARKETING_COURTESY')
      `).all(orderId) as any[];

      for (const entry of existingEntries) {
        if (entry.debit_usd_cents > 0) {
          insertLedger.run(
            `led_${generateUuidV7()}`,
            order.jornada_id,
            orderId,
            entry.account_bucket,
            0,
            entry.debit_usd_cents,
            entry.rate_micro_bs || rateMicroBs,
            `Reversión Ajuste #${order.order_number} (${entry.account_bucket})`,
            now
          );
        } else if (entry.credit_usd_cents > 0) {
          insertLedger.run(
            `led_${generateUuidV7()}`,
            order.jornada_id,
            orderId,
            entry.account_bucket,
            entry.credit_usd_cents,
            0,
            entry.rate_micro_bs || rateMicroBs,
            `Reversión Ajuste #${order.order_number} (${entry.account_bucket})`,
            now
          );
        }
      }
    }

    // 4. Actualizar estado de orden a 'cancelado' en la misma transacción
    rawDb.prepare(`
      UPDATE orders
      SET payment_status = ?,
          fulfillment_status = 'anulado',
          notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || ' [CANCELADO: ' || ? || ']' END,
          updated_at_ms = ?
      WHERE id = ?
    `).run(newPaymentStatus, `[CANCELADO: ${reason}]`, reason, now, orderId);

    // 5. Actualizar TODAS sus líneas a 'cancelado' (si el esquema lo admite)
    try {
      rawDb.prepare(`
        UPDATE order_lines
        SET status = 'cancelado'
        WHERE order_id = ?
      `).run(orderId);
    } catch {
      // order_lines.status CHECK constraint ('pendiente', 'preparando', 'listo')
    }

    // 6. Auditoría y eventos
    appendAuditEvent(rawDb, {
      actorUserId: input.actorUserId || 'usr_cajera',
      action: 'ORDER_ANNULLED_IN_CASHIER',
      entityType: 'order',
      entityId: orderId,
      payload: {
        orderNumber: order.order_number,
        reason,
        locationId,
        isPaid,
        authorizedBy: verifiedAuthorizer ? { id: verifiedAuthorizer.id, name: verifiedAuthorizer.name, role: verifiedAuthorizer.role } : null
      }
    });

    publishDomainEvent(rawDb, {
      eventType: 'ORDER_CANCELLED',
      entityId: orderId,
      payload: {
        orderId,
        orderNumber: order.order_number,
        fulfillmentStatus: 'anulado',
        paymentStatus: newPaymentStatus,
        reason
      }
    });
  });

  annulTx();

  return {
    success: true,
    orderId,
    message: 'Orden anulada con éxito'
  };
}

