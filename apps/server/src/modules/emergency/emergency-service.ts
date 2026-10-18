import type Database from 'better-sqlite3';
import { formatSlipNumber } from './slips-generator.js';
import { createOrder, type OrderLineInput } from '../orders/order-service.js';
import { processOrderPayment, type PaymentTenderInput, type ChangeOutputInput } from '../cashier/cashier-service.js';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';

export interface DeferredPaperOrderInput {
  emergencySlipNumber: string | number;
  realCreatedAtMs: number;
  lines: OrderLineInput[];
  fulfillmentType?: 'salon' | 'para_llevar' | 'delivery';
  tableNumber?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryFeeUsdCents?: number;
  couponCode?: string | null;
  notes?: string | null;
  tenders: PaymentTenderInput[];
  changeOutputs?: ChangeOutputInput;
  supervisorPin?: string;
}

export interface UserContext {
  id: string;
  name: string;
  role: 'admin' | 'supervisor' | 'cajera' | 'mesonero' | 'cocinero' | 'despachador';
}

/**
 * Transcribe una comanda física de emergencia al sistema digital.
 * - Valida unicidad estricta del número de comanda (#EMG-001 a #EMG-200).
 * - Registra la hora real en que ocurrió la comanda en papel.
 * - Procesa automáticamente los renglones contables y pagos.
 * - Registra evento de auditoría 'deferred_paper_entry'.
 */
export function createDeferredPaperOrder(
  rawDb: Database.Database,
  input: DeferredPaperOrderInput,
  user: UserContext
) {
  if (!input.emergencySlipNumber) {
    const err: any = new Error('El número de comanda de papel (ej. #EMG-001) es obligatorio');
    err.statusCode = 400;
    throw err;
  }

  const slipLabel = formatSlipNumber(input.emergencySlipNumber);

  // 1. Verificación de duplicados en la base de datos
  const existing = rawDb.prepare(`
    SELECT id, order_number 
    FROM orders 
    WHERE emergency_slip_number = ?
  `).get(slipLabel) as { id: string; order_number: number } | undefined;

  if (existing) {
    const err: any = new Error(
      `La comanda de papel ${slipLabel} ya fue registrada previamente en la orden #${existing.order_number}`
    );
    err.statusCode = 409;
    throw err;
  }

  // 2. Validar fecha y hora real de ocurrencia
  const now = Date.now();
  const realTime = Number(input.realCreatedAtMs);
  if (isNaN(realTime) || realTime <= 0 || realTime > now + 60000) {
    const err: any = new Error('La hora real de la comanda de papel (realCreatedAtMs) no es válida o está en el futuro');
    err.statusCode = 400;
    throw err;
  }

  // 3. Crear la orden en el motor de pedidos
  const created = createOrder(rawDb, {
    createdByUserId: user.id,
    fulfillmentType: input.fulfillmentType || 'salon',
    tableNumber: input.tableNumber,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    deliveryAddress: input.deliveryAddress,
    deliveryFeeUsdCents: input.deliveryFeeUsdCents,
    couponCode: input.couponCode,
    notes: input.notes ? `[Comanda Papel ${slipLabel}] ${input.notes}` : `[Comanda Papel ${slipLabel}]`,
    lines: input.lines
  });

  const orderId = created.id;

  // 4. Procesar cobro contable en caja
  const paymentResult = processOrderPayment(rawDb, orderId, {
    orderId,
    cashierUserId: user.id,
    tenders: input.tenders,
    changeOutputs: input.changeOutputs,
    supervisorPin: input.supervisorPin
  });

  // 5. Actualizar metadata de contingencia, hora real de suceso y estado final entregado
  rawDb.prepare(`
    UPDATE orders 
    SET emergency_slip_number = ?,
        is_deferred_paper = 1,
        created_at_ms = ?,
        fulfillment_status = 'entregado',
        station_status_hot_dogs = 'listo',
        station_status_hamburguesas = 'listo'
    WHERE id = ?
  `).run(slipLabel, realTime, orderId);

  // Marcar líneas como listas (ya fueron preparadas físicamente durante la contingencia)
  rawDb.prepare(`
    UPDATE order_lines 
    SET status = 'listo'
    WHERE order_id = ?
  `).run(orderId);

  // 6. Registrar en la cadena inmutable de auditoría con la acción 'deferred_paper_entry'
  appendAuditEvent(rawDb, {
    actorUserId: user.id,
    action: 'deferred_paper_entry',
    entityType: 'order',
    entityId: orderId,
    payload: {
      emergencySlipNumber: slipLabel,
      realCreatedAtMs: realTime,
      transcribedAtMs: now,
      transcribedByUserId: user.id,
      orderNumber: created.order_number,
      totalToCollectUsdCents: created.total_to_collect_usd_cents,
      paymentResult: paymentResult.payments
    }
  });

  // 7. Publicar en el bus de eventos
  publishDomainEvent(rawDb, {
    eventType: 'ORDER_DEFERRED_PAPER_REGISTERED',
    entityId: orderId,
    payload: {
      orderId,
      orderNumber: created.order_number,
      emergencySlipNumber: slipLabel,
      realCreatedAtMs: realTime,
      transcribedAtMs: now
    }
  });

  // Obtener orden consolidada final
  const finalOrder = rawDb.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;

  return {
    order: finalOrder,
    slipNumber: slipLabel,
    payments: paymentResult.payments,
    lines: created.lines
  };
}

/**
 * Consulta las comandas diferidas cargadas en una jornada o período
 */
export function getDeferredOrders(rawDb: Database.Database, limit = 50) {
  return rawDb.prepare(`
    SELECT o.*, u.name as transcribed_by_name
    FROM orders o
    LEFT JOIN users u ON o.created_by_user_id = u.id
    WHERE o.is_deferred_paper = 1
    ORDER BY o.created_at_ms DESC
    LIMIT ?
  `).all(limit);
}
