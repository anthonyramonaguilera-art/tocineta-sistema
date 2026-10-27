/**
 * SISTEMA OPERATIVO LOCAL TOCINETA
 * Módulo de Incidentes, Mermas y Devoluciones (M8)
 * 
 * Reglas de Negocio Oficiales:
 * - 'refire': Requiere PIN de Supervisor o Admin. Registra el costo como merma en worker_incidents
 *   y dispara un ticket urgente '*** REPOSICIÓN SIN COBRO ***' a cocina sin alterar la caja.
 * - 'refund' / 'void_paid': Requiere PIN de Supervisor (hasta el tope de $20.00 USD) o Admin (ilimitado).
 *   Genera el contra-asiento contable en ledger_entries, actualiza payment_status a 'reembolsado'/'anulado'.
 */

import type Database from 'better-sqlite3';
import { generateUuidV7, renderTicketToEscPos } from '@tocineta/shared';
import { verifyPin } from '../auth/pin.js';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';
import {
  loadOrderReceiptDataFromDb,
  buildRefireTicketIR
} from '../printing/templates.js';
import { getPrinterConfig } from '../printing/worker.js';
import { reverseCouponRedemptionForOrder } from '../coupons/coupon-service.js';
import { revertInventoryForOrder } from '../profitability/recipes-service.js';

export const SUPERVISOR_REFUND_LIMIT_USD_CENTS = 2000; // $20.00 USD límite para supervisor

export interface ReportIncidentInput {
  reasonCode: string;
  responsibleArea: 'mesonero' | 'cocina' | 'cliente' | 'sistema' | 'impresora';
  resolution: 'refire' | 'refund' | 'void_paid';
  authorizerPin: string;
  workerId?: string;
  description?: string;
  estimatedLossUsdCents?: number;
  refundMethod?: 'CASH_USD' | 'CASH_BS' | 'PAGO_MOVIL';
}

export interface IncidentResult {
  success: boolean;
  incidentId: string;
  orderId: string;
  resolution: 'refire' | 'refund' | 'void_paid';
  authorizedBy: {
    id: string;
    name: string;
    role: string;
  };
  printJobId?: string;
  refundedUsdCents?: number;
  message: string;
}

export function reportOrderIncident(
  rawDb: Database.Database,
  orderId: string,
  input: ReportIncidentInput
): IncidentResult {
  const now = Date.now();

  // 1. Validar que la orden exista
  const order = rawDb.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
  if (!order) {
    const err: any = new Error(`Orden '${orderId}' no encontrada`);
    err.statusCode = 404;
    throw err;
  }

  // 2. Validar PIN de Autorización (Supervisor o Admin requerido)
  const authorizers = rawDb.prepare(`
    SELECT id, name, role, pin_salt, pin_hash
    FROM users
    WHERE role IN ('admin', 'supervisor') AND is_active = 1
  `).all() as any[];

  let verifiedAuthorizer: { id: string; name: string; role: string } | null = null;
  for (const a of authorizers) {
    if (verifyPin(input.authorizerPin, a.pin_salt, a.pin_hash)) {
      verifiedAuthorizer = { id: a.id, name: a.name, role: a.role };
      break;
    }
  }

  if (!verifiedAuthorizer) {
    const err: any = new Error('PIN de autorización inválido o usuario sin privilegios de Supervisor o Administrador');
    err.statusCode = 403;
    throw err;
  }

  const incidentId = `inc_${generateUuidV7()}`;
  const targetWorkerId = input.workerId || order.created_by_user_id;

  // 3. Manejo de 'refire' (Reposición Urgente a Cocina)
  if (input.resolution === 'refire') {
    // Merma estimada: costo indicado o total neto de alimentos de la orden
    const lossCents = input.estimatedLossUsdCents !== undefined && input.estimatedLossUsdCents >= 0
      ? input.estimatedLossUsdCents
      : order.net_food_sales_usd_cents;

    // Registrar en worker_incidents
    rawDb.prepare(`
      INSERT INTO worker_incidents (
        id, jornada_id, user_id, order_id, incident_type,
        reason_code, responsible_area, resolution, description,
        estimated_loss_usd_cents, authorized_by_user_id, created_at_ms
      ) VALUES (?, ?, ?, ?, 'MERMA_ALIMENTO', ?, ?, 'refire', ?, ?, ?, ?)
    `).run(
      incidentId,
      order.jornada_id,
      targetWorkerId,
      orderId,
      input.reasonCode,
      input.responsibleArea,
      input.description || `Reposición de comida por ${input.reasonCode}`,
      lossCents,
      verifiedAuthorizer.id,
      now
    );

    // Cargar datos de la orden y líneas de cocina para ticket de reposición
    const { order: receiptOrder, kitchenLines } = loadOrderReceiptDataFromDb(rawDb, orderId);
    const refireIR = buildRefireTicketIR(receiptOrder, kitchenLines, input.reasonCode);
    const cocinaConfig = getPrinterConfig(rawDb, 'print_cocina');
    const refireBytes = Buffer.from(renderTicketToEscPos(refireIR, cocinaConfig));

    const printJobId = `pjob_${generateUuidV7()}`;
    rawDb.prepare(`
      INSERT INTO print_jobs (
        id, printer_id, order_id, job_type, payload_bytes,
        ticket_ir_json, station, status, attempts, created_at_ms
      ) VALUES (?, 'print_cocina', ?, 'REPOSICION_COCINA', ?, ?, 'cocina', 'en_cola', 0, ?)
    `).run(printJobId, orderId, refireBytes, JSON.stringify(refireIR), now);

    // Reactivar orden y líneas en cocina/KDS sin alterar pagos ni caja
    rawDb.prepare(`
      UPDATE orders
      SET fulfillment_status = 'en_preparacion',
          station_status_hot_dogs = CASE WHEN station_status_hot_dogs = 'na' THEN 'na' ELSE 'en_preparacion' END,
          station_status_hamburguesas = CASE WHEN station_status_hamburguesas = 'na' THEN 'na' ELSE 'en_preparacion' END,
          updated_at_ms = ?
      WHERE id = ?
    `).run(now, orderId);

    rawDb.prepare(`
      UPDATE order_lines
      SET status = 'pendiente',
          prepared_at_ms = NULL,
          ready_at_ms = NULL
      WHERE order_id = ? AND line_role IN ('STANDARD', 'COMBO_CHILD', 'COURTESY_ITEM') AND station != 'caja_bebidas'
    `).run(orderId);

    appendAuditEvent(rawDb, {
      actorUserId: verifiedAuthorizer.id,
      action: 'ORDER_INCIDENT_REFIRE',
      entityType: 'order',
      entityId: orderId,
      payload: {
        incidentId,
        reasonCode: input.reasonCode,
        responsibleArea: input.responsibleArea,
        estimatedLossUsdCents: lossCents,
        authorizedBy: verifiedAuthorizer.name
      }
    });

    publishDomainEvent(rawDb, {
      eventType: 'ORDER_REFIRE_DISPATCHED',
      entityId: orderId,
      payload: {
        orderId,
        incidentId,
        reasonCode: input.reasonCode,
        printJobId
      }
    });

    return {
      success: true,
      incidentId,
      orderId,
      resolution: 'refire',
      authorizedBy: verifiedAuthorizer,
      printJobId,
      message: 'Reposición urgente enviada a cocina e incidente registrado como merma sin alterar caja.'
    };
  }

  // 4. Manejo de 'refund' o 'void_paid' (Reembolso / Anulación de Orden)
  if (input.resolution === 'refund' || input.resolution === 'void_paid') {
    const totalOrderCents = order.total_to_collect_usd_cents || order.net_food_sales_usd_cents;

    // Regla de tope para Supervisor: Si supera $20.00 USD exige Admin
    if (verifiedAuthorizer.role === 'supervisor' && totalOrderCents > SUPERVISOR_REFUND_LIMIT_USD_CENTS) {
      const err: any = new Error(
        `El monto a reembolsar ($${(totalOrderCents / 100).toFixed(2)}) supera el límite de $${(SUPERVISOR_REFUND_LIMIT_USD_CENTS / 100).toFixed(2)} permitido para Supervisores. Requiere PIN de Administrador.`
      );
      err.statusCode = 403;
      throw err;
    }

    const isPaid = order.payment_status === 'pagado' || order.payment_status === 'autorizado_sin_pago';
    const rateMicroBs = order.rate_micro_bs || 40_000_000;

    // Si estaba pagada, revertir en ledger_entries (partida doble inversa)
    if (isPaid) {
      const insertLedger = rawDb.prepare(`
        INSERT INTO ledger_entries (
          entry_id, jornada_id, order_id, account_bucket,
          debit_usd_cents, credit_usd_cents, rate_micro_bs, description, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Reversión de Ingresos de Comida
      if (order.net_food_sales_usd_cents > 0) {
        insertLedger.run(
          `led_${generateUuidV7()}`,
          order.jornada_id,
          orderId,
          'FOOD_SALES',
          order.net_food_sales_usd_cents, // Débito revierte el crédito original
          0,
          rateMicroBs,
          `Reversión Venta Alimentos por Reembolso #${order.order_number} (${input.reasonCode})`,
          now
        );
      }

      // Reversión de Fondo Motorizado si existía
      if (order.delivery_fee_usd_cents > 0) {
        insertLedger.run(
          `led_${generateUuidV7()}`,
          order.jornada_id,
          orderId,
          'MOTORIZADO_FUND',
          order.delivery_fee_usd_cents,
          0,
          rateMicroBs,
          `Reversión Fondo Delivery por Reembolso #${order.order_number}`,
          now
        );
      }

      // Salida de Dinero / Reembolso de Caja o Banco
      // Se determina el bucket contable correcto (CASH_USD, CASH_BS o BANK_BS para PAGO_MOVIL)
      // usando la tasa histórica del pago original. PROHIBIDO tocar CASH_USD si fue en Bs.
      const orderPayments = rawDb.prepare('SELECT * FROM payments WHERE order_id = ?').all(orderId) as any[];

      let refundBucket: 'CASH_USD' | 'CASH_BS' | 'BANK_BS' = 'CASH_USD';
      let refundRateMicroBs = rateMicroBs;

      if (input.refundMethod) {
        if (input.refundMethod === 'PAGO_MOVIL') {
          refundBucket = 'BANK_BS';
        } else if (input.refundMethod === 'CASH_BS') {
          refundBucket = 'CASH_BS';
        } else {
          refundBucket = 'CASH_USD';
        }
        if (orderPayments.length > 0 && orderPayments[0].rate_micro_bs) {
          refundRateMicroBs = orderPayments[0].rate_micro_bs;
        }
      } else if (orderPayments.length > 0) {
        // Inferencia automática desde los registros en `payments` de la orden
        const hasPagoMovil = orderPayments.some(p => p.method === 'PAGO_MOVIL' || p.method === 'UBII');
        const hasCashBs = orderPayments.some(p => p.method === 'CASH_BS' || p.currency === 'BS');
        const hasUsd = orderPayments.some(p => p.currency === 'USD' || p.method === 'CASH_USD');

        if (hasPagoMovil) {
          refundBucket = 'BANK_BS';
        } else if (hasCashBs && !hasUsd) {
          refundBucket = 'CASH_BS';
        } else {
          refundBucket = 'CASH_USD';
        }

        const matchingPayment = orderPayments.find(p => {
          if (refundBucket === 'BANK_BS') return p.method === 'PAGO_MOVIL' || p.method === 'UBII';
          if (refundBucket === 'CASH_BS') return p.method === 'CASH_BS' || p.currency === 'BS';
          return p.currency === 'USD' || p.method === 'CASH_USD';
        }) || orderPayments[0];

        if (matchingPayment?.rate_micro_bs) {
          refundRateMicroBs = matchingPayment.rate_micro_bs;
        }
      }

      insertLedger.run(
        `led_${generateUuidV7()}`,
        order.jornada_id,
        orderId,
        refundBucket,
        0,
        totalOrderCents, // Crédito a caja/banco representa salida de dinero devuelto al cliente
        refundRateMicroBs,
        `Salida Reembolso Cliente Orden #${order.order_number} (${input.reasonCode}) [${refundBucket}]`,
        now
      );
    }

    // Asignación de sede con fallback seguro oficial
    const locationId = order.location_id || 'sede_alta_vista';

    // Reversión limpia e inmutable de inventario si existían movimientos
    revertInventoryForOrder(rawDb, orderId, locationId, input.reasonCode, verifiedAuthorizer.id);

    // Actualizar estados de la orden y sus líneas a cancelado para limpiar KDS
    const newPaymentStatus = isPaid ? 'reembolsado' : 'anulado';
    rawDb.prepare(`
      UPDATE orders
      SET payment_status = ?,
          fulfillment_status = 'anulado',
          cancelled_by_user_id = ?,
          updated_at_ms = ?
      WHERE id = ?
    `).run(newPaymentStatus, verifiedAuthorizer.id, now, orderId);

    try {
      rawDb.prepare(`UPDATE order_lines SET status = 'cancelado' WHERE order_id = ?`).run(orderId);
    } catch {
      // order_lines.status CHECK constraint ('pendiente', 'preparando', 'listo')
    }

    // Reversión de cupón si aplica (Ajuste A1)
    reverseCouponRedemptionForOrder(rawDb, orderId, now);

    // Registrar en worker_incidents
    rawDb.prepare(`
      INSERT INTO worker_incidents (
        id, jornada_id, user_id, order_id, incident_type,
        reason_code, responsible_area, resolution, description,
        estimated_loss_usd_cents, authorized_by_user_id, created_at_ms
      ) VALUES (?, ?, ?, ?, 'DISCREPANCIA_CAJA', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      incidentId,
      order.jornada_id,
      targetWorkerId,
      orderId,
      input.reasonCode,
      input.responsibleArea,
      input.resolution,
      input.description || `Reembolso de orden #${order.order_number} por ${input.reasonCode}`,
      totalOrderCents,
      verifiedAuthorizer.id,
      now
    );

    appendAuditEvent(rawDb, {
      actorUserId: verifiedAuthorizer.id,
      action: 'ORDER_INCIDENT_REFUND',
      entityType: 'order',
      entityId: orderId,
      payload: {
        incidentId,
        reasonCode: input.reasonCode,
        responsibleArea: input.responsibleArea,
        refundedUsdCents: totalOrderCents,
        authorizedBy: verifiedAuthorizer.name
      }
    });

    publishDomainEvent(rawDb, {
      eventType: 'ORDER_REFUNDED',
      entityId: orderId,
      payload: {
        orderId,
        incidentId,
        refundedUsdCents: totalOrderCents,
        paymentStatus: newPaymentStatus
      }
    });

    publishDomainEvent(rawDb, {
      eventType: 'ORDER_CANCELLED',
      entityId: orderId,
      payload: {
        orderId,
        orderNumber: order.order_number,
        fulfillmentStatus: 'cancelado',
        paymentStatus: newPaymentStatus,
        reason: input.reasonCode
      }
    });

    return {
      success: true,
      incidentId,
      orderId,
      resolution: input.resolution,
      authorizedBy: verifiedAuthorizer,
      refundedUsdCents: totalOrderCents,
      message: `Orden reembolsada/anulada exitosamente. Asiento contable de reversión registrado en libro mayor.`
    };
  }

  const err: any = new Error(`Resolución de incidente no soportada: '${input.resolution}'`);
  err.statusCode = 400;
  throw err;
}
