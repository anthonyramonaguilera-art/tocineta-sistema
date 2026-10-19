import type Database from 'better-sqlite3';
import { type Station } from '../../db/schema.js';
import { getKitchenBuildableLines } from '../orders/kitchen-queries.js';
import { publishDomainEvent } from '../events/event-bus.js';
import { appendAuditEvent } from '../audit/audit-service.js';

export interface KdsOrderLineDto {
  lineId: string;
  productId: string;
  productName: string;
  displayName: string;
  quantity: number;
  station: Station;
  status: 'pendiente' | 'preparando' | 'listo';
  preparedAtMs?: number | null;
  readyAtMs?: number | null;
  flavorChoice?: string | null;
  customInstructions?: string | null;
  modifiers: string[];
  barraLibreModifiers: string[];
  ingredientExclusions: string[];
  ingredientExtras: string[];
  criticalModifiers: string[];
}

export interface KdsOrderDto {
  orderId: string;
  orderNumber: number;
  turnCode: string;
  customerName: string | null;
  customerPhone: string | null;
  tableNumber: string | null;
  fulfillmentType: 'salon' | 'para_llevar' | 'delivery';
  fulfillmentStatus: 'en_preparacion' | 'listo' | 'entregado' | 'cerrado';
  paymentStatus: 'pagado' | 'autorizado_sin_pago' | 'sin_pago';
  notes: string | null;
  createdAtMs: number;
  kitchenPassedAtMs: number;
  stationStatusHotDogs: 'na' | 'pendiente' | 'en_preparacion' | 'listo';
  stationStatusHamburguesas: 'na' | 'pendiente' | 'en_preparacion' | 'listo';
  isComposite: boolean;
  missingStations: Station[];
  isRefire: boolean;
  refireReason?: string | null;
  lines: KdsOrderLineDto[];
  readyCount: number;
  totalCount: number;
  aggregateStatus: 'pendiente' | 'preparando' | 'listo';
}

export interface GetKdsOrdersOptions {
  station?: Station;
}

/**
 * Obtiene todas las órdenes activas en KDS (fulfillment_status IN ('en_preparacion', 'listo') y pagadas/autorizadas)
 * Estricta regla de negocio: CERO precios ni montos de dinero para cocina.
 */
export function getKdsOrders(rawDb: Database.Database, options?: GetKdsOrdersOptions): KdsOrderDto[] {
  const query = `
    SELECT 
      o.id as order_id,
      o.order_number,
      o.fulfillment_type,
      o.table_number,
      o.customer_name,
      o.customer_phone,
      o.payment_status,
      o.fulfillment_status,
      o.station_status_hot_dogs,
      o.station_status_hamburguesas,
      o.notes,
      o.created_at_ms,
      o.updated_at_ms,
      COALESCE(o.kitchen_passed_at_ms, o.updated_at_ms, o.created_at_ms) as kitchen_passed_at_ms
    FROM orders o
    WHERE o.fulfillment_status IN ('en_preparacion', 'listo')
      AND o.payment_status IN ('pagado', 'autorizado_sin_pago')
    ORDER BY kitchen_passed_at_ms ASC, o.order_number ASC
  `;

  const orderRows = rawDb.prepare(query).all() as Array<{
    order_id: string;
    order_number: number;
    fulfillment_type: 'salon' | 'para_llevar' | 'delivery';
    table_number: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    payment_status: 'pagado' | 'autorizado_sin_pago' | 'sin_pago';
    fulfillment_status: 'en_preparacion' | 'listo' | 'entregado' | 'cerrado';
    station_status_hot_dogs: 'na' | 'pendiente' | 'en_preparacion' | 'listo';
    station_status_hamburguesas: 'na' | 'pendiente' | 'en_preparacion' | 'listo';
    notes: string | null;
    created_at_ms: number;
    updated_at_ms: number;
    kitchen_passed_at_ms: number;
  }>;

  const result: KdsOrderDto[] = [];

  // Buscar reposiciones activas recientes
  const refireJobs = rawDb.prepare(`
    SELECT order_id, reprint_reason
    FROM print_jobs
    WHERE job_type = 'REPOSICION_COCINA'
    ORDER BY created_at_ms DESC
  `).all() as Array<{ order_id: string; reprint_reason: string | null }>;
  const refireMap = new Map<string, string | null>();
  for (const r of refireJobs) {
    if (r.order_id && !refireMap.has(r.order_id)) {
      refireMap.set(r.order_id, r.reprint_reason || 'Reposición urgente');
    }
  }

  for (const row of orderRows) {
    const allKitchenLines = getKitchenBuildableLines(rawDb, row.order_id);

    if (allKitchenLines.length === 0) {
      continue;
    }

    const hasHotDogs = allKitchenLines.some(l => l.station === 'hot_dogs');
    const hasBurgers = allKitchenLines.some(l => l.station === 'hamburguesas');
    const isComposite = hasHotDogs && hasBurgers;

    // Si se especificó un filtro de estación, verificar si la orden tiene líneas de esa estación
    if (options?.station) {
      const match = allKitchenLines.some(l => l.station === options.station);
      if (!match) continue;
    }

    // Filtrar líneas visibles según estación elegida
    const visibleLines = options?.station
      ? allKitchenLines.filter(l => l.station === options.station)
      : allKitchenLines;

    // Calcular estaciones faltantes para ensamble
    const missingStations: Station[] = [];
    if (hasBurgers && row.station_status_hamburguesas !== 'listo') {
      missingStations.push('hamburguesas');
    }
    if (hasHotDogs && row.station_status_hot_dogs !== 'listo') {
      missingStations.push('hot_dogs');
    }

    const turnCode = `T-${String(row.order_number).padStart(3, '0')}`;
    const isRefire = refireMap.has(row.order_id) || (row.notes ? row.notes.toUpperCase().includes('REPOSICION') : false);

    const readyCount = visibleLines.filter(l => l.status === 'listo').length;
    const totalCount = visibleLines.length;
    const allLinesPending = totalCount > 0 && visibleLines.every(l => l.status === 'pendiente');
    const allLinesReady = totalCount > 0 && readyCount === totalCount;
    const aggregateStatus: 'pendiente' | 'preparando' | 'listo' = allLinesReady
      ? 'listo'
      : allLinesPending
      ? 'pendiente'
      : 'preparando';

    result.push({
      orderId: row.order_id,
      orderNumber: row.order_number,
      turnCode,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      tableNumber: row.table_number,
      fulfillmentType: row.fulfillment_type,
      fulfillmentStatus: row.fulfillment_status,
      paymentStatus: row.payment_status,
      notes: row.notes,
      createdAtMs: row.created_at_ms,
      kitchenPassedAtMs: row.kitchen_passed_at_ms,
      stationStatusHotDogs: row.station_status_hot_dogs,
      stationStatusHamburguesas: row.station_status_hamburguesas,
      isComposite,
      missingStations,
      isRefire,
      refireReason: isRefire ? (refireMap.get(row.order_id) || 'Reposición urgente') : null,
      lines: visibleLines,
      readyCount,
      totalCount,
      aggregateStatus
    });
  }

  return result;
}

/**
 * Actualiza el estado de una línea de comanda (pendiente ➔ preparando ➔ listo)
 * Aplica la regla automática de ensamble: cuando todas las líneas de cocina están en 'listo',
 * orders.fulfillment_status pasa automáticamente a 'listo' y notifica por WebSocket.
 */
export function updateKdsLineStatus(
  rawDb: Database.Database,
  lineId: string,
  newStatus: 'pendiente' | 'preparando' | 'listo',
  actorUserId?: string
): {
  success: boolean;
  lineId: string;
  orderId: string;
  newStatus: 'pendiente' | 'preparando' | 'listo';
  orderFulfillmentStatus: string;
  stationStatusHotDogs: string;
  stationStatusHamburguesas: string;
  missingStations: Station[];
  allReady: boolean;
} {
  const line = rawDb.prepare(`
    SELECT id, order_id, station, line_role, status
    FROM order_lines
    WHERE id = ?
  `).get(lineId) as {
    id: string;
    order_id: string;
    station: Station;
    line_role: string;
    status: 'pendiente' | 'preparando' | 'listo';
  } | undefined;

  if (!line) {
    const err: any = new Error(`Línea de orden con ID '${lineId}' no encontrada`);
    err.statusCode = 404;
    throw err;
  }

  const now = Date.now();
  let preparedAtMs: number | null = null;
  let readyAtMs: number | null = null;

  if (newStatus === 'preparando') {
    preparedAtMs = now;
  } else if (newStatus === 'listo') {
    readyAtMs = now;
  }

  // 1. Actualizar estado de la línea
  rawDb.prepare(`
    UPDATE order_lines
    SET status = ?,
        prepared_at_ms = CASE WHEN ? IS NOT NULL THEN ? ELSE prepared_at_ms END,
        ready_at_ms = CASE WHEN ? IS NOT NULL THEN ? ELSE ready_at_ms END
    WHERE id = ?
  `).run(newStatus, preparedAtMs, preparedAtMs, readyAtMs, readyAtMs, lineId);

  // 2. Obtener todas las líneas de cocina de la orden
  const kitchenLines = rawDb.prepare(`
    SELECT id, station, status
    FROM order_lines
    WHERE order_id = ?
      AND line_role IN ('STANDARD', 'COMBO_CHILD', 'COURTESY_ITEM')
      AND station != 'caja_bebidas'
  `).all(line.order_id) as Array<{
    id: string;
    station: Station;
    status: 'pendiente' | 'preparando' | 'listo';
  }>;

  const hotDogLines = kitchenLines.filter(l => l.station === 'hot_dogs');
  const burgerLines = kitchenLines.filter(l => l.station === 'hamburguesas');

  // Calcular estado por estación
  let stationStatusHotDogs: 'na' | 'pendiente' | 'en_preparacion' | 'listo' = 'na';
  if (hotDogLines.length > 0) {
    if (hotDogLines.every(l => l.status === 'listo')) {
      stationStatusHotDogs = 'listo';
    } else if (hotDogLines.some(l => l.status === 'preparando' || l.status === 'listo')) {
      stationStatusHotDogs = 'en_preparacion';
    } else {
      stationStatusHotDogs = 'pendiente';
    }
  }

  let stationStatusHamburguesas: 'na' | 'pendiente' | 'en_preparacion' | 'listo' = 'na';
  if (burgerLines.length > 0) {
    if (burgerLines.every(l => l.status === 'listo')) {
      stationStatusHamburguesas = 'listo';
    } else if (burgerLines.some(l => l.status === 'preparando' || l.status === 'listo')) {
      stationStatusHamburguesas = 'en_preparacion';
    } else {
      stationStatusHamburguesas = 'pendiente';
    }
  }

  // 3. Regla automática de ensamble:
  // Si todas las líneas de cocina de la orden están en 'listo', orders.fulfillment_status pasa a 'listo'
  const allReady = kitchenLines.length > 0 && kitchenLines.every(l => l.status === 'listo');
  const newFulfillmentStatus = allReady ? 'listo' : 'en_preparacion';

  // Actualizar orden
  rawDb.prepare(`
    UPDATE orders
    SET fulfillment_status = ?,
        station_status_hot_dogs = ?,
        station_status_hamburguesas = ?,
        updated_at_ms = ?
    WHERE id = ?
  `).run(newFulfillmentStatus, stationStatusHotDogs, stationStatusHamburguesas, now, line.order_id);

  // Calcular estaciones faltantes
  const missingStations: Station[] = [];
  if (burgerLines.length > 0 && stationStatusHamburguesas !== 'listo') {
    missingStations.push('hamburguesas');
  }
  if (hotDogLines.length > 0 && stationStatusHotDogs !== 'listo') {
    missingStations.push('hot_dogs');
  }

  const orderInfo = rawDb.prepare('SELECT order_number FROM orders WHERE id = ?').get(line.order_id) as { order_number: number };

  // Registrar auditoría
  appendAuditEvent(rawDb, {
    actorUserId: actorUserId || null,
    action: 'KDS_LINE_STATUS_UPDATED',
    entityType: 'order_line',
    entityId: lineId,
    payload: {
      orderId: line.order_id,
      orderNumber: orderInfo.order_number,
      station: line.station,
      newStatus,
      orderFulfillmentStatus: newFulfillmentStatus,
      allReady
    }
  });

  if (allReady) {
    appendAuditEvent(rawDb, {
      actorUserId: actorUserId || null,
      action: 'ORDER_AUTO_ASSEMBLED_READY',
      entityType: 'order',
      entityId: line.order_id,
      payload: {
        orderNumber: orderInfo.order_number
      }
    });

    // Notificar por WebSocket que la orden está lista para entregar
    publishDomainEvent(rawDb, {
      eventType: 'ORDER_READY',
      entityId: line.order_id,
      payload: {
        orderId: line.order_id,
        orderNumber: orderInfo.order_number,
        fulfillmentStatus: 'listo'
      }
    });
  }

  // Notificar cambio de estado de línea en KDS
  publishDomainEvent(rawDb, {
    eventType: 'KDS_LINE_STATUS_UPDATED',
    entityId: line.order_id,
    payload: {
      orderId: line.order_id,
      orderNumber: orderInfo.order_number,
      lineId,
      station: line.station,
      status: newStatus,
      orderFulfillmentStatus: newFulfillmentStatus,
      stationStatusHotDogs,
      stationStatusHamburguesas,
      missingStations,
      allReady
    }
  });

  return {
    success: true,
    lineId,
    orderId: line.order_id,
    newStatus,
    orderFulfillmentStatus: newFulfillmentStatus,
    stationStatusHotDogs,
    stationStatusHamburguesas,
    missingStations,
    allReady
  };
}

export interface DeliverOrderOptions {
  archive?: boolean;
  actorUserId?: string;
}

/**
 * Marca la orden como 'entregado'. Si está pagada, permite archivarla en 'cerrado'.
 */
export function deliverKdsOrder(
  rawDb: Database.Database,
  orderId: string,
  options?: DeliverOrderOptions
): {
  success: boolean;
  orderId: string;
  orderNumber: number;
  fulfillmentStatus: string;
  closedAtMs: number | null;
} {
  const order = rawDb.prepare(`
    SELECT id, order_number, payment_status, fulfillment_status
    FROM orders
    WHERE id = ?
  `).get(orderId) as {
    id: string;
    order_number: number;
    payment_status: string;
    fulfillment_status: string;
  } | undefined;

  if (!order) {
    const err: any = new Error(`Orden con ID '${orderId}' no encontrada`);
    err.statusCode = 404;
    throw err;
  }

  const now = Date.now();
  // Si está pagada y se solicita archivar (o por defecto al pagar), archivar en 'cerrado'
  const shouldArchive = options?.archive ?? (order.payment_status === 'pagado');
  const newFulfillmentStatus = shouldArchive ? 'cerrado' : 'entregado';
  const closedAtMs = shouldArchive ? now : null;

  rawDb.prepare(`
    UPDATE orders
    SET fulfillment_status = ?,
        closed_at_ms = COALESCE(?, closed_at_ms),
        updated_at_ms = ?
    WHERE id = ?
  `).run(newFulfillmentStatus, closedAtMs, now, orderId);

  appendAuditEvent(rawDb, {
    actorUserId: options?.actorUserId || null,
    action: shouldArchive ? 'ORDER_CLOSED' : 'ORDER_DELIVERED',
    entityType: 'order',
    entityId: orderId,
    payload: {
      orderNumber: order.order_number,
      fulfillmentStatus: newFulfillmentStatus,
      paymentStatus: order.payment_status,
      closedAtMs
    }
  });

  publishDomainEvent(rawDb, {
    eventType: 'ORDER_DELIVERED',
    entityId: orderId,
    payload: {
      orderId,
      orderNumber: order.order_number,
      fulfillmentStatus: newFulfillmentStatus,
      closedAtMs
    }
  });

  return {
    success: true,
    orderId,
    orderNumber: order.order_number,
    fulfillmentStatus: newFulfillmentStatus,
    closedAtMs
  };
}
