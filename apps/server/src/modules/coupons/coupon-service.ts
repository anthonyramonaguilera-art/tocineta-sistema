/**
 * SISTEMA OPERATIVO LOCAL TOCINETA
 * Módulo de Cupones Duales (Hito M11)
 * 
 * Reglas de Negocio Oficiales:
 * 1. Validación 100% en local: existencia, vigencia, max_uses y no duplicidad en la misma orden.
 * 2. Cupones de Descuento (DISCOUNT):
 *    - FIXED_USD ($1.00 BIENVENIDA1)
 *    - PERCENTAGE_BPS (10.00% PARATI10 sobre subtotal de comida)
 * 3. Cupones de Obsequio (COURTESY_ITEM):
 *    - CAFEGRATIS -> prod_cafe_cortesia ($0.00 venta, 35¢ costo interno)
 *    - SNACKSGRATIS -> prod_snacks_cortesia ($0.00 venta, 35¢ costo interno)
 *    - Inserta línea en order_lines con line_role = 'COURTESY_ITEM', $0.00 para el cliente.
 *    - Aparece en comanda de cocina y KDS con la etiqueta destacada '[OBSEQUIO CUPÓN - $0.00]'.
 *    - Registra en coupon_redemptions e imputa el costo a MARKETING_COURTESY.
 */

import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';
import { getOrderById } from '../orders/order-service.js';

export interface CouponData {
  id: string;
  code: string;
  description: string | null;
  couponType: 'DISCOUNT' | 'COURTESY_ITEM';
  discountMode: 'FIXED_USD' | 'PERCENTAGE_BPS' | null;
  discountValue: number | null;
  courtesyProductId: string | null;
  courtesyProductName?: string | null;
  maxUses: number | null;
  usedCount: number;
  expiresAtMs: number | null;
  isActive: boolean;
  createdAtMs: number;
}

export interface CouponValidationResult {
  valid: boolean;
  coupon?: CouponData;
  calculatedDiscountUsdCents?: number;
  courtesyProduct?: {
    id: string;
    name: string;
    estimatedCostUsdCents: number;
  };
  error?: string;
}

/**
 * Consulta la lista de cupones activos disponibles para clientes y comandas
 */
export function getAvailableCoupons(rawDb: Database.Database): CouponData[] {
  const now = Date.now();
  const rows = rawDb.prepare(`
    SELECT c.*, p.name as courtesy_product_name
    FROM coupons c
    LEFT JOIN products p ON c.courtesy_product_id = p.id
    WHERE c.is_active = 1
      AND (c.expires_at_ms IS NULL OR c.expires_at_ms > ?)
      AND (c.max_uses IS NULL OR c.used_count < c.max_uses)
    ORDER BY c.code ASC
  `).all(now) as any[];

  return rows.map(r => ({
    id: r.id,
    code: r.code,
    description: r.description,
    couponType: r.coupon_type,
    discountMode: r.discount_mode,
    discountValue: r.discount_value,
    courtesyProductId: r.courtesy_product_id,
    courtesyProductName: r.courtesy_product_name,
    maxUses: r.max_uses,
    usedCount: r.used_count,
    expiresAtMs: r.expires_at_ms,
    isActive: Boolean(r.is_active),
    createdAtMs: r.created_at_ms
  }));
}

/**
 * Valida un cupón y previsualiza su beneficio sin mutar la base de datos
 */
export function validateCoupon(
  rawDb: Database.Database,
  code: string,
  grossFoodSubtotalUsdCents = 0
): CouponValidationResult {
  if (!code || code.trim() === '') {
    return { valid: false, error: 'Debe ingresar un código de cupón' };
  }

  const cleanCode = code.trim().toUpperCase();
  const now = Date.now();

  const coup = rawDb.prepare(`
    SELECT c.*, p.name as courtesy_product_name, p.estimated_cost_usd_cents as courtesy_cost,
           p.is_available as courtesy_is_available, p.is_active as courtesy_is_active
    FROM coupons c
    LEFT JOIN products p ON c.courtesy_product_id = p.id
    WHERE UPPER(c.code) = ?
  `).get(cleanCode) as any;

  if (!coup) {
    return { valid: false, error: `El cupón '${cleanCode}' no existe en el sistema` };
  }

  if (!coup.is_active) {
    return { valid: false, error: `El cupón '${cleanCode}' está inactivo` };
  }

  if (coup.expires_at_ms && now > coup.expires_at_ms) {
    return { valid: false, error: `El cupón '${cleanCode}' ha expirado` };
  }

  if (coup.max_uses && coup.used_count >= coup.max_uses) {
    return { valid: false, error: `El cupón '${cleanCode}' ha alcanzado el límite máximo de usos permitidos` };
  }

  const couponData: CouponData = {
    id: coup.id,
    code: coup.code,
    description: coup.description,
    couponType: coup.coupon_type,
    discountMode: coup.discount_mode,
    discountValue: coup.discount_value,
    courtesyProductId: coup.courtesy_product_id,
    courtesyProductName: coup.courtesy_product_name,
    maxUses: coup.max_uses,
    usedCount: coup.used_count,
    expiresAtMs: coup.expires_at_ms,
    isActive: Boolean(coup.is_active),
    createdAtMs: coup.created_at_ms
  };

  if (coup.coupon_type === 'DISCOUNT') {
    let discountCents = 0;
    if (coup.discount_mode === 'FIXED_USD') {
      discountCents = Math.min(grossFoodSubtotalUsdCents, coup.discount_value || 0);
    } else if (coup.discount_mode === 'PERCENTAGE_BPS') {
      discountCents = Math.round((grossFoodSubtotalUsdCents * (coup.discount_value || 0)) / 10000);
    }
    return {
      valid: true,
      coupon: couponData,
      calculatedDiscountUsdCents: discountCents
    };
  }

  if (coup.coupon_type === 'COURTESY_ITEM') {
    if (coup.courtesy_is_available === 0 || coup.courtesy_is_active === 0) {
      return {
        valid: false,
        error: 'CUPON_PRODUCTO_AGOTADO',
        coupon: couponData
      };
    }

    return {
      valid: true,
      coupon: couponData,
      courtesyProduct: {
        id: coup.courtesy_product_id,
        name: coup.courtesy_product_name || 'Ítem de Cortesía',
        estimatedCostUsdCents: coup.courtesy_cost || 35
      }
    };
  }

  return { valid: true, coupon: couponData };
}

/**
 * Aplica interactivamente un cupón dual ("Cupones para ti") a una orden abierta
 */
export function applyCouponToOrder(
  rawDb: Database.Database,
  orderId: string,
  couponCode: string,
  actorUserId = 'usr_cajera_principal'
) {
  const now = Date.now();

  // 1. Validar estado de la orden
  const order = rawDb.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
  if (!order) {
    const err: any = new Error(`Orden '${orderId}' no encontrada`);
    err.statusCode = 404;
    throw err;
  }

  if (order.payment_status === 'pagado') {
    const err: any = new Error(`La orden #${order.order_number} ya está pagada. No se pueden aplicar cupones.`);
    err.statusCode = 400;
    throw err;
  }

  if (order.fulfillment_status === 'cerrado' || order.fulfillment_status === 'anulado') {
    const err: any = new Error(`La orden #${order.order_number} está cerrada o anulada`);
    err.statusCode = 400;
    throw err;
  }

  if (order.coupon_id) {
    const applied = rawDb.prepare('SELECT code FROM coupons WHERE id = ?').get(order.coupon_id) as any;
    const err: any = new Error(
      `La orden ya tiene un cupón aplicado (${applied?.code || 'CUPÓN'}). Debe quitarlo antes de aplicar otro.`
    );
    err.statusCode = 400;
    throw err;
  }

  // 2. Validar cupón
  const validation = validateCoupon(rawDb, couponCode, order.gross_food_subtotal_usd_cents);
  if (!validation.valid || !validation.coupon) {
    const isAgotado = validation.error === 'CUPON_PRODUCTO_AGOTADO';
    const err: any = new Error(
      isAgotado
        ? 'El producto de cortesía está agotado temporalmente en este turno'
        : (validation.error || 'Cupón no válido')
    );
    err.errorCode = isAgotado ? 'CUPON_PRODUCTO_AGOTADO' : (validation.error || 'CUPON_INVALIDO');
    err.statusCode = 400;
    throw err;
  }

  const coupon = validation.coupon;
  let discountCents = 0;
  let courtesyLineId: string | null = null;
  let benefitCents = 0;

  const applyTx = rawDb.transaction(() => {
    if (coupon.couponType === 'DISCOUNT') {
      discountCents = validation.calculatedDiscountUsdCents || 0;
      benefitCents = discountCents;
      const netFoodSales = Math.max(0, order.gross_food_subtotal_usd_cents - discountCents);
      const totalToCollect = netFoodSales + order.delivery_fee_usd_cents;

      rawDb.prepare(`
        UPDATE orders
        SET coupon_id = ?,
            discount_usd_cents = ?,
            net_food_sales_usd_cents = ?,
            total_to_collect_usd_cents = ?,
            version = version + 1,
            updated_at_ms = ?
        WHERE id = ?
      `).run(coupon.id, discountCents, netFoodSales, totalToCollect, now, orderId);

    } else if (coupon.couponType === 'COURTESY_ITEM') {
      // Cupón de Obsequio: insertar línea de cortesía $0.00
      const prod = rawDb.prepare('SELECT * FROM products WHERE id = ?').get(coupon.courtesyProductId) as any;
      if (!prod) {
        throw new Error(`Producto de cortesía '${coupon.courtesyProductId}' no encontrado en el catálogo`);
      }

      if (prod.is_available === 0 || prod.is_active === 0) {
        const err: any = new Error('El producto de cortesía está agotado. Consulta al supervisor.');
        err.statusCode = 400;
        err.code = 'CUPON_PRODUCTO_AGOTADO';
        err.errorCode = 'CUPON_PRODUCTO_AGOTADO';
        throw err;
      }

      courtesyLineId = `line_${generateUuidV7()}`;
      benefitCents = prod.price_usd_cents || prod.estimated_cost_usd_cents || 35;

      const snapshot = JSON.stringify({
        productName: prod.name,
        isCourtesy: true,
        couponCode: coupon.code,
        internalCostUsdCents: prod.estimated_cost_usd_cents || 35
      });

      rawDb.prepare(`
        INSERT INTO order_lines (
          id, order_id, product_id, line_role, parent_line_id, quantity,
          unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents,
          station, flavor_choice, custom_instructions, status, snapshot_json, created_at_ms
        ) VALUES (?, ?, ?, 'COURTESY_ITEM', NULL, 1, 0, 0, 0, ?, NULL, '[OBSEQUIO CUPÓN - $0.00]', 'pendiente', ?, ?)
      `).run(
        courtesyLineId,
        orderId,
        prod.id,
        prod.station,
        snapshot,
        now
      );

      // Si la estación de la cortesía estaba en 'na', activarla en 'pendiente'
      const stationField = prod.station === 'hamburguesas' ? 'station_status_hamburguesas' : 'station_status_hot_dogs';
      rawDb.prepare(`
        UPDATE orders
        SET coupon_id = ?,
            ${stationField} = CASE WHEN ${stationField} = 'na' THEN 'pendiente' ELSE ${stationField} END,
            version = version + 1,
            updated_at_ms = ?
        WHERE id = ?
      `).run(coupon.id, now, orderId);
    }

    // Registrar redención del cupón
    const redemptionId = `red_${generateUuidV7()}`;
    rawDb.prepare(`
      INSERT INTO coupon_redemptions (
        id, coupon_id, order_id, user_id, benefit_usd_cents, redeemed_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(redemptionId, coupon.id, orderId, actorUserId, benefitCents, now);

    // Incrementar contador de usos del cupón
    rawDb.prepare(`
      UPDATE coupons
      SET used_count = used_count + 1
      WHERE id = ?
    `).run(coupon.id);

    // Auditoría y Eventos
    appendAuditEvent(rawDb, {
      actorUserId,
      action: 'COUPON_APPLIED',
      entityType: 'order',
      entityId: orderId,
      payload: {
        couponCode: coupon.code,
        couponType: coupon.couponType,
        discountUsdCents: discountCents,
        courtesyLineId,
        benefitUsdCents: benefitCents
      }
    });

    publishDomainEvent(rawDb, {
      eventType: 'ORDER_UPDATED',
      entityId: orderId,
      payload: {
        orderId,
        couponCode: coupon.code,
        couponType: coupon.couponType,
        discountUsdCents: discountCents
      }
    });
  });

  applyTx();

  const updatedOrder = getOrderById(rawDb, orderId);

  return {
    success: true,
    message: coupon.couponType === 'DISCOUNT'
      ? `Cupón ${coupon.code} aplicado con éxito (-$${(discountCents / 100).toFixed(2)})`
      : `Cupón ${coupon.code} aplicado con éxito: 1x ${validation.courtesyProduct?.name} de cortesía agregado`,
    order: updatedOrder,
    coupon,
    discountUsdCents: discountCents,
    courtesyProduct: validation.courtesyProduct
  };
}

/**
 * Quita un cupón de una orden abierta y restaura los importes originales
 */
export function removeCouponFromOrder(
  rawDb: Database.Database,
  orderId: string,
  actorUserId = 'usr_cajera_principal'
) {
  const now = Date.now();
  const order = rawDb.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
  if (!order) {
    const err: any = new Error(`Orden '${orderId}' no encontrada`);
    err.statusCode = 404;
    throw err;
  }

  if (order.payment_status === 'pagado') {
    const err: any = new Error('No se puede quitar el cupón de una orden ya pagada');
    err.statusCode = 400;
    throw err;
  }

  if (!order.coupon_id) {
    return { success: true, message: 'La orden no tiene ningún cupón aplicado', order: getOrderById(rawDb, orderId) };
  }

  const couponId = order.coupon_id;
  const coup = rawDb.prepare('SELECT * FROM coupons WHERE id = ?').get(couponId) as any;

  const removeTx = rawDb.transaction(() => {
    // 1. Eliminar líneas de cortesía asociadas al cupón
    rawDb.prepare(`
      DELETE FROM order_lines
      WHERE order_id = ? AND line_role = 'COURTESY_ITEM'
    `).run(orderId);

    // 2. Restaurar importes de la orden
    const grossFood = order.gross_food_subtotal_usd_cents;
    const totalToCollect = grossFood + order.delivery_fee_usd_cents;

    rawDb.prepare(`
      UPDATE orders
      SET coupon_id = NULL,
          discount_usd_cents = 0,
          net_food_sales_usd_cents = ?,
          total_to_collect_usd_cents = ?,
          version = version + 1,
          updated_at_ms = ?
      WHERE id = ?
    `).run(grossFood, totalToCollect, now, orderId);

    // 3. Decrementar contador de usos del cupón
    rawDb.prepare(`
      UPDATE coupons
      SET used_count = MAX(0, used_count - 1)
      WHERE id = ?
    `).run(couponId);

    // 4. Eliminar redención
    rawDb.prepare(`
      DELETE FROM coupon_redemptions
      WHERE order_id = ? AND coupon_id = ?
    `).run(orderId, couponId);

    // 5. Auditoría
    appendAuditEvent(rawDb, {
      actorUserId,
      action: 'COUPON_REMOVED',
      entityType: 'order',
      entityId: orderId,
      payload: { couponId, couponCode: coup?.code }
    });
  });

  removeTx();

  return {
    success: true,
    message: `Cupón ${coup?.code || ''} removido de la orden exitosamente`,
    order: getOrderById(rawDb, orderId)
  };
}

/**
 * Revierte la redención de cupones para una orden cuando es reembolsada o anulada.
 * Ajuste A1: actualiza reversed_at_ms y reversed_at, y decrementa used_count en coupons.
 */
export function reverseCouponRedemptionForOrder(
  rawDb: Database.Database,
  orderId: string,
  now = Date.now()
): number {
  const redemptions = rawDb.prepare(`
    SELECT id, coupon_id FROM coupon_redemptions
    WHERE order_id = ? AND (reversed_at_ms IS NULL OR reversed_at_ms = 0)
  `).all(orderId) as { id: string; coupon_id: string }[];

  if (redemptions.length === 0) return 0;

  for (const r of redemptions) {
    rawDb.prepare(`
      UPDATE coupon_redemptions
      SET reversed_at_ms = ?, reversed_at = ?
      WHERE id = ?
    `).run(now, now, r.id);

    rawDb.prepare(`
      UPDATE coupons
      SET used_count = MAX(0, used_count - 1)
      WHERE id = ?
    `).run(r.coupon_id);
  }

  return redemptions.length;
}

