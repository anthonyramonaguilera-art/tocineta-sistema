import type Database from 'better-sqlite3';
import {
  generateUuidV7,
  calculateSettlement,
  parseRateToMicroBs,
  type SettlementResult
} from '@tocineta/shared';
import { verifyPin } from '../auth/pin.js';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';
import { getCurrentExchangeRate } from '../menu/menu-service.js';

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

  // Verificar si ya existe una jornada abierta
  const existing = rawDb.prepare(`
    SELECT * FROM jornadas WHERE status = 'abierta'
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

  // Asegurar jornada abierta
  let jornada = rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta'").get() as any;
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
  const current = rawDb.prepare("SELECT * FROM jornadas WHERE status = 'abierta'").get() as any;
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
    if (m === 'PAGO_MOVIL' && t.referenceCode && t.referenceCode.trim() !== '') {
      const cleanRef = t.referenceCode.trim();
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
          const authorizers = rawDb.prepare(`
            SELECT id, name, role, pin_salt, pin_hash 
            FROM users 
            WHERE role IN ('admin', 'supervisor') AND is_active = 1
          `).all() as any[];

          let verifiedAuth: any = null;
          for (const a of authorizers) {
            if (verifyPin(input.supervisorPin, a.pin_salt, a.pin_hash)) {
              verifiedAuth = a;
              break;
            }
          }

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
    const m = t.method.toLowerCase();
    if (m === 'cash_usd' || m === 'efectivo_usd' || m === 'binance' || m === 'zelle') {
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

  // Asegurar jornada y sesión de caja abiertas
  let jornada = rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta'").get() as any;
  if (!jornada) {
    jornada = openJornada(rawDb, {
      openedByUserId: input.cashierUserId,
      initialCashUsdCents: 0,
      initialCashBsCents: 0
    });
  }

  let session = rawDb.prepare("SELECT id FROM cash_sessions WHERE user_id = ? AND status = 'abierta'").get(input.cashierUserId) as any;
  if (!session) {
    session = openCashSession(rawDb, {
      userId: input.cashierUserId,
      openingCashUsdCents: 0,
      openingCashBsCents: 0
    });
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

      const mLower = t.method.toLowerCase();
      let dbMethod: string;
      let currency: 'USD' | 'BS';
      let usdEquivalentCents: number;

      if (mLower === 'cash_usd' || mLower === 'efectivo_usd') {
        dbMethod = 'EFECTIVO_USD';
        currency = 'USD';
        usdEquivalentCents = t.amountCents;
      } else if (mLower === 'cash_bs' || mLower === 'efectivo_bs') {
        dbMethod = 'EFECTIVO_BS';
        currency = 'BS';
        usdEquivalentCents = Math.round((t.amountCents * 1_000_000) / rateMicroBs);
      } else if (mLower === 'pago_movil') {
        dbMethod = 'PAGO_MOVIL';
        currency = 'BS';
        usdEquivalentCents = Math.round((t.amountCents * 1_000_000) / rateMicroBs);
      } else if (mLower === 'ubii' || mLower === 'punto_de_venta') {
        dbMethod = 'UBII';
        currency = 'BS';
        usdEquivalentCents = Math.round((t.amountCents * 1_000_000) / rateMicroBs);
      } else if (mLower === 'binance') {
        dbMethod = 'BINANCE';
        currency = 'USD';
        usdEquivalentCents = t.amountCents;
      } else if (mLower === 'zelle') {
        dbMethod = 'ZELLE';
        currency = 'USD';
        usdEquivalentCents = t.amountCents;
      } else {
        dbMethod = 'OTROS';
        currency = 'USD';
        usdEquivalentCents = t.amountCents;
      }

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
        t.referenceCode?.trim() || null,
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
      const mLower = t.method.toLowerCase();
      let bucket: string;
      let debitCents: number;

      if (mLower === 'cash_usd' || mLower === 'efectivo_usd') {
        bucket = 'CASH_USD';
        debitCents = t.amountCents;
      } else if (mLower === 'cash_bs' || mLower === 'efectivo_bs') {
        bucket = 'CASH_BS';
        debitCents = Math.round((t.amountCents * 1_000_000) / rateMicroBs);
      } else if (mLower === 'pago_movil' || mLower === 'ubii' || mLower === 'punto_de_venta') {
        bucket = 'BANK_BS';
        debitCents = Math.round((t.amountCents * 1_000_000) / rateMicroBs);
      } else {
        bucket = 'BANK_USD';
        debitCents = t.amountCents;
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
    rawDb.prepare(`
      UPDATE orders
      SET payment_status = 'pagado',
          fulfillment_status = 'en_preparacion',
          cash_session_id = ?,
          station_status_hot_dogs = CASE WHEN station_status_hot_dogs = 'na' THEN 'na' ELSE 'en_preparacion' END,
          station_status_hamburguesas = CASE WHEN station_status_hamburguesas = 'na' THEN 'na' ELSE 'en_preparacion' END,
          updated_at_ms = ?
      WHERE id = ?
    `).run(session.id, now, orderId);

    // 5. Encolar Trabajos de Impresión Asíncrona (Caja USB y Cocina TCP)
    const ticketBytes = Buffer.from(`TICKET_ORDEN_${order.order_number}_PAGADA\n`);
    rawDb.prepare(`
      INSERT INTO print_jobs (
        id, printer_id, order_id, job_type, payload_bytes, status, attempts, created_at_ms
      ) VALUES (?, 'print_caja_usb', ?, 'NOTA_ENTREGA', ?, 'pending', 0, ?)
    `).run(`pjob_${generateUuidV7()}`, orderId, ticketBytes, now);

    rawDb.prepare(`
      INSERT INTO print_jobs (
        id, printer_id, order_id, job_type, payload_bytes, status, attempts, created_at_ms
      ) VALUES (?, 'print_cocina', ?, 'TICKET_COCINA', ?, 'pending', 0, ?)
    `).run(`pjob_${generateUuidV7()}`, orderId, ticketBytes, now);

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
