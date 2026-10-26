/**
 * SISTEMA OPERATIVO GASTRONÓMICO TOCINETA
 * Módulo de Delivery y Liquidación Nocturna de Motorizados (Hito M11)
 * 
 * Reglas de Negocio Oficiales:
 * 1. Gestión de Motorizados oficiales (REPARTIDOR 1, REPARTIDOR 2, REPARTIDOR 3).
 * 2. Registro y despacho de órdenes delivery con tarifas rápidas ($2, $3, $4, $5 o manual).
 * 3. Enmascaramiento estricto de privacidad para roles no administrativos (teléfono y dirección).
 * 4. Control de efectivo en mano del motorizado (pago en efectivo al recibir vs pagado digital por adelantado).
 * 5. Liquidación nocturna: cálculo exacto de saldo neto (DRIVER_PAYS_CASHIER vs CASHIER_PAYS_DRIVER).
 * 6. Asiento contable en MOTORIZADO_FUND sin alterar jamás FOOD_SALES ni Food Cost % (THIRD_PARTY_PASS_THROUGH).
 */

import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';
import { getCurrentExchangeRate } from '../menu/menu-service.js';

export interface DeliveryDriver {
  id: string;
  name: string;
  phone: string;
  isActive: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface DriverSettlementPreviewItem {
  driverId: string;
  driverName: string;
  driverPhone: string;
  totalTrips: number;
  totalDeliveryFeesUsdCents: number;
  totalFoodCashCollectedUsdCents: number;
  netBalanceUsdCents: number;
  balanceDirection: 'DRIVER_PAYS_CASHIER' | 'CASHIER_PAYS_DRIVER' | 'BALANCED';
  pendingDeliveries: Array<{
    deliveryId: string;
    orderId: string;
    orderNumber: number;
    customerName: string | null;
    deliveryFeeUsdCents: number;
    cashCollectedByDriver: boolean;
    foodCashAmountUsdCents: number;
    paymentStatus: string;
    fulfillmentStatus: string;
    createdAtMs: number;
  }>;
}

export interface DriverSettlementResult {
  settlementId: string;
  jornadaId: string;
  driverId: string;
  driverName: string;
  totalTrips: number;
  totalDeliveryFeesUsdCents: number;
  totalFoodCashCollectedUsdCents: number;
  netBalanceUsdCents: number;
  balanceDirection: 'DRIVER_PAYS_CASHIER' | 'CASHIER_PAYS_DRIVER' | 'BALANCED';
  accountingMode?: 'THIRD_PARTY_PASS_THROUGH' | 'HOUSE_REVENUE';
  settledDeliveriesCount: number;
  ledgerEntriesCreated: number;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. HELPERS DE ENMASCARAMIENTO DE PRIVACIDAD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enmascara teléfono para proteger datos personales de clientes.
 * Admin, supervisor o despachador con orden activa ven teléfono real.
 */
export function maskPhoneNumber(phone?: string | null, userRole?: string, isOrderActive = false): string {
  if (!phone) return '';
  const clean = phone.trim();
  if (userRole === 'admin' || userRole === 'supervisor' || (userRole === 'despachador' && isOrderActive)) {
    return clean;
  }
  if (clean.length <= 6) return '***-***';
  const start = clean.slice(0, 4);
  const end = clean.slice(-4);
  return `${start}***${end}`;
}

/**
 * Enmascara dirección física para roles no autorizados en reportes históricos.
 */
export function maskAddress(address?: string | null, userRole?: string, isOrderActive = false): string {
  if (!address) return '';
  const clean = address.trim();
  if (userRole === 'admin' || userRole === 'supervisor' || (userRole === 'despachador' && isOrderActive)) {
    return clean;
  }
  if (clean.length <= 15) return '[Dirección Enmascarada]';
  return `${clean.slice(0, 12)}... [Enmascarado]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. GESTIÓN DE MOTORIZADOS (CRUD)
// ─────────────────────────────────────────────────────────────────────────────

export function getDeliveryDrivers(rawDb: Database.Database, includeInactive = false): DeliveryDriver[] {
  const query = includeInactive
    ? 'SELECT * FROM delivery_drivers ORDER BY name ASC'
    : 'SELECT * FROM delivery_drivers WHERE is_active = 1 ORDER BY name ASC';
  const rows = rawDb.prepare(query).all() as any[];
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    isActive: Boolean(r.is_active),
    createdAtMs: r.created_at_ms,
    updatedAtMs: r.updated_at_ms
  }));
}

export function createDeliveryDriver(
  rawDb: Database.Database,
  input: { name: string; phone: string; actorUserId?: string }
): DeliveryDriver {
  if (!input.name || input.name.trim() === '') {
    const err: any = new Error('El nombre del motorizado es obligatorio');
    err.statusCode = 400;
    throw err;
  }
  if (!input.phone || input.phone.trim() === '') {
    const err: any = new Error('El teléfono del motorizado es obligatorio');
    err.statusCode = 400;
    throw err;
  }

  const now = Date.now();
  const id = `drv_${generateUuidV7()}`;
  const cleanName = input.name.trim();
  const cleanPhone = input.phone.trim();

  rawDb.prepare(`
    INSERT INTO delivery_drivers (id, name, phone, is_active, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(id, cleanName, cleanPhone, now, now);

  if (input.actorUserId) {
    appendAuditEvent(rawDb, {
      actorUserId: input.actorUserId,
      action: 'DELIVERY_DRIVER_CREATED',
      entityType: 'delivery_driver',
      entityId: id,
      payload: { name: cleanName, phone: cleanPhone }
    });
  }

  return {
    id,
    name: cleanName,
    phone: cleanPhone,
    isActive: true,
    createdAtMs: now,
    updatedAtMs: now
  };
}

export function updateDeliveryDriver(
  rawDb: Database.Database,
  id: string,
  input: { name?: string; phone?: string; isActive?: boolean; actorUserId?: string }
): DeliveryDriver {
  const existing = rawDb.prepare('SELECT * FROM delivery_drivers WHERE id = ?').get(id) as any;
  if (!existing) {
    const err: any = new Error(`Motorizado '${id}' no encontrado`);
    err.statusCode = 404;
    throw err;
  }

  const now = Date.now();
  const name = input.name !== undefined ? input.name.trim() : existing.name;
  const phone = input.phone !== undefined ? input.phone.trim() : existing.phone;
  const isActive = input.isActive !== undefined ? (input.isActive ? 1 : 0) : existing.is_active;

  rawDb.prepare(`
    UPDATE delivery_drivers
    SET name = ?, phone = ?, is_active = ?, updated_at_ms = ?
    WHERE id = ?
  `).run(name, phone, isActive, now, id);

  if (input.actorUserId) {
    appendAuditEvent(rawDb, {
      actorUserId: input.actorUserId,
      action: 'DELIVERY_DRIVER_UPDATED',
      entityType: 'delivery_driver',
      entityId: id,
      payload: { name, phone, isActive: Boolean(isActive) }
    });
  }

  return {
    id,
    name,
    phone,
    isActive: Boolean(isActive),
    createdAtMs: existing.created_at_ms,
    updatedAtMs: now
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. SINCRONIZACIÓN Y DESPACHO DE DELIVERY EN ÓRDENES
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderDeliveryInput {
  deliveryFeeUsdCents?: number;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryReference?: string;
  motorizadoId?: string;
  cashCollectedByDriver?: boolean | number;
}

export function syncOrderDelivery(
  rawDb: Database.Database,
  orderId: string,
  input: OrderDeliveryInput,
  actorUserId?: string
) {
  const now = Date.now();
  const order = rawDb.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
  if (!order) {
    const err: any = new Error(`Orden '${orderId}' no encontrada`);
    err.statusCode = 404;
    throw err;
  }

  let driverName: string | null = null;
  if (input.motorizadoId) {
    const drv = rawDb.prepare('SELECT name FROM delivery_drivers WHERE id = ?').get(input.motorizadoId) as any;
    if (drv) driverName = drv.name;
  }

  const fee = input.deliveryFeeUsdCents !== undefined ? input.deliveryFeeUsdCents : order.delivery_fee_usd_cents;
  const isCashCollected = input.cashCollectedByDriver ? 1 : 0;
  const reference = input.deliveryReference !== undefined ? input.deliveryReference : (order.delivery_reference || null);

  // 1. Actualizar orden
  rawDb.prepare(`
    UPDATE orders
    SET fulfillment_type = 'delivery',
        delivery_fee_usd_cents = ?,
        customer_name = COALESCE(?, customer_name),
        customer_phone = COALESCE(?, customer_phone),
        delivery_address = COALESCE(?, delivery_address),
        delivery_reference = ?,
        motorizado_id = ?,
        total_to_collect_usd_cents = net_food_sales_usd_cents + ?,
        version = version + 1,
        updated_at_ms = ?
    WHERE id = ?
  `).run(
    fee,
    input.customerName || null,
    input.customerPhone || null,
    input.deliveryAddress || null,
    reference,
    input.motorizadoId || null,
    fee,
    now,
    orderId
  );

  // 2. Upsert en tabla deliveries
  const existingDeliv = rawDb.prepare('SELECT id FROM deliveries WHERE order_id = ?').get(orderId) as any;
  let deliveryId = existingDeliv?.id;

  if (existingDeliv) {
    rawDb.prepare(`
      UPDATE deliveries
      SET driver_id = ?,
          motorizado_name = ?,
          delivery_reference = ?,
          delivery_fee_usd_cents = ?,
          cash_collected_by_driver = ?,
          updated_at_ms = ?
      WHERE order_id = ?
    `).run(
      input.motorizadoId || null,
      driverName,
      reference,
      fee,
      isCashCollected,
      now,
      orderId
    );
  } else {
    deliveryId = `deliv_${generateUuidV7()}`;
    rawDb.prepare(`
      INSERT INTO deliveries (
        id, order_id, driver_id, motorizado_name, delivery_reference,
        delivery_fee_usd_cents, cash_collected_by_driver, food_cash_amount_usd_cents,
        status, settled_to_motorizado, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'asignado', 0, ?, ?)
    `).run(
      deliveryId,
      orderId,
      input.motorizadoId || null,
      driverName,
      reference,
      fee,
      isCashCollected,
      now,
      now
    );
  }

  if (actorUserId) {
    appendAuditEvent(rawDb, {
      actorUserId,
      action: 'ORDER_DELIVERY_SYNCED',
      entityType: 'order',
      entityId: orderId,
      payload: {
        deliveryId,
        motorizadoId: input.motorizadoId,
        driverName,
        fee,
        isCashCollected: Boolean(isCashCollected)
      }
    });
  }

  return rawDb.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. LIQUIDACIÓN NOCTURNA DE MOTORIZADOS
// ─────────────────────────────────────────────────────────────────────────────

export function getDriverSettlementPreview(
  rawDb: Database.Database,
  jornadaId: string
): DriverSettlementPreviewItem[] {
  // Consultar todas las entregas pendientes de liquidación de la jornada activa
  const rows = rawDb.prepare(`
    SELECT 
      d.id as delivery_id,
      d.order_id,
      d.driver_id,
      d.motorizado_name,
      d.delivery_fee_usd_cents,
      d.cash_collected_by_driver,
      d.food_cash_amount_usd_cents,
      d.created_at_ms,
      o.order_number,
      o.customer_name,
      o.payment_status,
      o.fulfillment_status,
      o.net_food_sales_usd_cents,
      drv.name as driver_table_name,
      drv.phone as driver_phone
    FROM deliveries d
    JOIN orders o ON d.order_id = o.id
    LEFT JOIN delivery_drivers drv ON d.driver_id = drv.id
    WHERE o.jornada_id = ?
      AND d.settled_to_motorizado = 0
      AND o.fulfillment_status != 'anulado'
    ORDER BY d.created_at_ms ASC
  `).all(jornadaId) as any[];

  // Agrupar por driver_id (o por motorizado_name si no tiene ID asignado)
  const mapByDriver = new Map<string, DriverSettlementPreviewItem>();

  for (const r of rows) {
    const driverKey = r.driver_id || `unassigned_${r.motorizado_name || 'Desconocido'}`;
    const driverName = r.driver_table_name || r.motorizado_name || 'Motorizado No Asignado';
    const driverPhone = r.driver_phone || 'N/A';

    if (!mapByDriver.has(driverKey)) {
      mapByDriver.set(driverKey, {
        driverId: r.driver_id || driverKey,
        driverName,
        driverPhone,
        totalTrips: 0,
        totalDeliveryFeesUsdCents: 0,
        totalFoodCashCollectedUsdCents: 0,
        netBalanceUsdCents: 0,
        balanceDirection: 'BALANCED',
        pendingDeliveries: []
      });
    }

    const item = mapByDriver.get(driverKey)!;
    item.totalTrips += 1;
    item.totalDeliveryFeesUsdCents += r.delivery_fee_usd_cents;

    // Si el motorizado cobró el efectivo de la comida al entregar:
    let effectiveCashCollected = r.food_cash_amount_usd_cents;
    if (r.cash_collected_by_driver && effectiveCashCollected === 0) {
      effectiveCashCollected = r.net_food_sales_usd_cents;
    }
    item.totalFoodCashCollectedUsdCents += effectiveCashCollected;

    item.pendingDeliveries.push({
      deliveryId: r.delivery_id,
      orderId: r.order_id,
      orderNumber: r.order_number,
      customerName: r.customer_name,
      deliveryFeeUsdCents: r.delivery_fee_usd_cents,
      cashCollectedByDriver: Boolean(r.cash_collected_by_driver),
      foodCashAmountUsdCents: effectiveCashCollected,
      paymentStatus: r.payment_status,
      fulfillmentStatus: r.fulfillment_status,
      createdAtMs: r.created_at_ms
    });
  }

  // Calcular balance neto y dirección para cada motorizado
  for (const item of mapByDriver.values()) {
    const diff = item.totalFoodCashCollectedUsdCents - item.totalDeliveryFeesUsdCents;
    item.netBalanceUsdCents = Math.abs(diff);

    if (diff > 0) {
      // El motorizado cobró más comida de lo que ganó en carreras -> Entrega dinero a Caja
      item.balanceDirection = 'DRIVER_PAYS_CASHIER';
    } else if (diff < 0) {
      // Caja le debe dinero de sus carreras (pedidos pagados digitalmente por adelantado)
      item.balanceDirection = 'CASHIER_PAYS_DRIVER';
    } else {
      item.balanceDirection = 'BALANCED';
    }
  }

  return Array.from(mapByDriver.values());
}

export function settleDriver(
  rawDb: Database.Database,
  input: {
    jornadaId: string;
    driverId: string;
    settledByUserId: string;
    notes?: string;
    modeOverride?: 'THIRD_PARTY_PASS_THROUGH' | 'HOUSE_REVENUE';
  }
): DriverSettlementResult {
  const previews = getDriverSettlementPreview(rawDb, input.jornadaId);
  const target = previews.find(p => p.driverId === input.driverId);

  if (!target || target.totalTrips === 0) {
    const err: any = new Error(`El motorizado '${input.driverId}' no tiene viajes pendientes de liquidar en esta jornada`);
    err.statusCode = 400;
    throw err;
  }

  const now = Date.now();
  const rateMicroBs = getCurrentExchangeRate(rawDb);
  const settlementId = `settle_${generateUuidV7()}`;

  // Obtener modo contable de delivery
  const settings = rawDb.prepare("SELECT delivery_accounting_mode FROM business_settings WHERE id = 'default'").get() as any;
  const accountingMode = input.modeOverride || settings?.delivery_accounting_mode || 'THIRD_PARTY_PASS_THROUGH';

  let ledgerEntriesCreated = 0;

  const settleTx = rawDb.transaction(() => {
    // 1. Insertar liquidación en delivery_driver_settlements
    rawDb.prepare(`
      INSERT INTO delivery_driver_settlements (
        id, jornada_id, driver_id, driver_name, total_trips,
        total_delivery_fees_usd_cents, total_food_cash_collected_usd_cents,
        net_balance_usd_cents, balance_direction, delivery_accounting_mode,
        settled_by_user_id, notes, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      settlementId,
      input.jornadaId,
      target.driverId,
      target.driverName,
      target.totalTrips,
      target.totalDeliveryFeesUsdCents,
      target.totalFoodCashCollectedUsdCents,
      target.netBalanceUsdCents,
      target.balanceDirection,
      accountingMode,
      input.settledByUserId,
      input.notes || null,
      now
    );

    // 2. Marcar las entregas como liquidadas
    const deliveryIds = target.pendingDeliveries.map(d => d.deliveryId);
    for (const dId of deliveryIds) {
      rawDb.prepare(`
        UPDATE deliveries
        SET settled_to_motorizado = 1,
            settled_at_ms = ?,
            settlement_id = ?,
            updated_at_ms = ?
        WHERE id = ?
      `).run(now, settlementId, now, dId);
    }

    // 3. Registrar partida doble canónica en ledger_entries
    // Regla de oro: En THIRD_PARTY_PASS_THROUGH jamás tocar FOOD_SALES
    const insertLedger = rawDb.prepare(`
      INSERT INTO ledger_entries (
        entry_id, jornada_id, order_id, account_bucket,
        debit_usd_cents, credit_usd_cents, rate_micro_bs, description, created_at_ms
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
    `);

    if (accountingMode === 'THIRD_PARTY_PASS_THROUGH') {
      if (target.balanceDirection === 'CASHIER_PAYS_DRIVER') {
        // Caja le paga al repartidor la diferencia neta de sus carreras acumuladas
        insertLedger.run(
          `led_${generateUuidV7()}`,
          input.jornadaId,
          'MOTORIZADO_FUND',
          target.totalDeliveryFeesUsdCents, // Débito liquida la totalidad del fondo acumulado
          0,
          rateMicroBs,
          `Liquidación Delivery ${target.driverName} - Pago Tarifas (${target.totalTrips} viajes)`,
          now
        );
        insertLedger.run(
          `led_${generateUuidV7()}`,
          input.jornadaId,
          'CASH_USD',
          0,
          target.netBalanceUsdCents, // Crédito a caja por el efectivo neto entregado en mano
          rateMicroBs,
          `Salida Efectivo Caja Liquidación Repartidor ${target.driverName}`,
          now
        );
        ledgerEntriesCreated += 2;

        if (target.totalFoodCashCollectedUsdCents > 0) {
          // Compensación contable del efectivo de comida retenido por el motorizado
          insertLedger.run(
            `led_${generateUuidV7()}`,
            input.jornadaId,
            'CASH_USD',
            0,
            target.totalFoodCashCollectedUsdCents,
            rateMicroBs,
            `Compensación Efectivo Comida Retenido por ${target.driverName}`,
            now
          );
          ledgerEntriesCreated += 1;
        }
      } else if (target.balanceDirection === 'DRIVER_PAYS_CASHIER') {
        // El repartidor entrega a Caja el excedente del dinero de la comida cobrado en mano
        insertLedger.run(
          `led_${generateUuidV7()}`,
          input.jornadaId,
          'CASH_USD',
          target.netBalanceUsdCents, // Débito ingresa el efectivo neto a caja
          0,
          rateMicroBs,
          `Ingreso Efectivo Neto Cobrado por Repartidor ${target.driverName} (${target.totalTrips} viajes)`,
          now
        );
        insertLedger.run(
          `led_${generateUuidV7()}`,
          input.jornadaId,
          'MOTORIZADO_FUND',
          target.totalDeliveryFeesUsdCents, // Se liquida el fondo de las carreras descontadas
          0,
          rateMicroBs,
          `Descuento Tarifas Ganadas por Repartidor ${target.driverName}`,
          now
        );
        insertLedger.run(
          `led_${generateUuidV7()}`,
          input.jornadaId,
          'CASH_USD',
          0,
          target.totalFoodCashCollectedUsdCents, // Compensación del efectivo registrado en la orden
          rateMicroBs,
          `Compensación Efectivo Cobrado en Calle por ${target.driverName}`,
          now
        );
        ledgerEntriesCreated += 3;
      } else {
        // BALANCED: Tarifas ganadas igual a comida retenida
        insertLedger.run(
          `led_${generateUuidV7()}`,
          input.jornadaId,
          'MOTORIZADO_FUND',
          target.totalDeliveryFeesUsdCents,
          0,
          rateMicroBs,
          `Liquidación Cuadrada Delivery ${target.driverName}`,
          now
        );
        insertLedger.run(
          `led_${generateUuidV7()}`,
          input.jornadaId,
          'CASH_USD',
          0,
          target.totalDeliveryFeesUsdCents,
          rateMicroBs,
          `Compensación Efectivo Cuadrado ${target.driverName}`,
          now
        );
        ledgerEntriesCreated += 2;
      }
    } else {
      // Modalidad HOUSE_REVENUE: el delivery fee es ingreso propio de la casa
      if (target.balanceDirection === 'CASHIER_PAYS_DRIVER') {
        insertLedger.run(
          `led_${generateUuidV7()}`,
          input.jornadaId,
          'OPERATING_EXPENSE',
          target.netBalanceUsdCents,
          0,
          rateMicroBs,
          `Gasto de Reparto Food Truck ${target.driverName}`,
          now
        );
        insertLedger.run(
          `led_${generateUuidV7()}`,
          input.jornadaId,
          'CASH_USD',
          0,
          target.netBalanceUsdCents,
          rateMicroBs,
          `Salida Efectivo Liquidación ${target.driverName}`,
          now
        );
        ledgerEntriesCreated += 2;
      }
    }

    // 4. Auditoría y Eventos
    appendAuditEvent(rawDb, {
      actorUserId: input.settledByUserId,
      action: 'DELIVERY_DRIVER_SETTLED',
      entityType: 'delivery_settlement',
      entityId: settlementId,
      payload: {
        driverId: target.driverId,
        driverName: target.driverName,
        totalTrips: target.totalTrips,
        totalDeliveryFeesUsdCents: target.totalDeliveryFeesUsdCents,
        totalFoodCashCollectedUsdCents: target.totalFoodCashCollectedUsdCents,
        netBalanceUsdCents: target.netBalanceUsdCents,
        balanceDirection: target.balanceDirection,
        accountingMode
      }
    });

    publishDomainEvent(rawDb, {
      eventType: 'DELIVERY_DRIVER_SETTLED',
      entityId: settlementId,
      payload: {
        settlementId,
        jornadaId: input.jornadaId,
        driverId: target.driverId,
        driverName: target.driverName,
        netBalanceUsdCents: target.netBalanceUsdCents,
        balanceDirection: target.balanceDirection
      }
    });
  });

  settleTx();

  const directionMsg = target.balanceDirection === 'DRIVER_PAYS_CASHIER'
    ? `El repartidor entregó $${(target.netBalanceUsdCents / 100).toFixed(2)} a Caja`
    : target.balanceDirection === 'CASHIER_PAYS_DRIVER'
    ? `Caja pagó $${(target.netBalanceUsdCents / 100).toFixed(2)} al repartidor`
    : 'Caja y repartidor quedaron cuadrados exactamente en $0.00';

  return {
    settlementId,
    jornadaId: input.jornadaId,
    driverId: target.driverId,
    driverName: target.driverName,
    totalTrips: target.totalTrips,
    totalDeliveryFeesUsdCents: target.totalDeliveryFeesUsdCents,
    totalFoodCashCollectedUsdCents: target.totalFoodCashCollectedUsdCents,
    netBalanceUsdCents: target.netBalanceUsdCents,
    balanceDirection: target.balanceDirection,
    accountingMode,
    settledDeliveriesCount: target.pendingDeliveries.length,
    ledgerEntriesCreated,
    message: `Liquidación completada exitosamente. ${directionMsg}.`
  };
}
