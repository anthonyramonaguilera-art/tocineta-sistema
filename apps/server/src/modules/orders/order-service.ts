import type Database from 'better-sqlite3';
import { generateUuidV7, prorateComboLargestRemainder, type ComboItemInput } from '@tocineta/shared';
import { getCurrentExchangeRate } from '../menu/menu-service.js';
import { publishDomainEvent } from '../events/event-bus.js';
import { appendAuditEvent } from '../audit/audit-service.js';
import { verifyPin } from '../auth/pin.js';
import { checkUserLockout, recordFailedAttempt, resetLockout } from '../auth/lockout.js';
import { mapUserRow } from '../../db/schema.js';
import { enqueueOrderPrintJobs } from '../printing/worker.js';

export type ModifierRawInput = string | {
  ingredientId?: string | null;
  ingredientName?: string;
  name?: string;
  modifierName?: string;
  modifierType?: string;
  type?: string;
  state?: string;
  extraPriceUsdCents?: number;
  extraPriceCents?: number;
  internalCostUsdCents?: number;
};

export interface NormalizedOrderModifier {
  ingredientId: string | null;
  ingredientName: string;
  modifierName: string;
  modifierType: string;
  state: string;
  extraPriceUsdCents: number;
  internalCostUsdCents: number;
}

export function normalizeModifier(raw: any): NormalizedOrderModifier {
  if (typeof raw === 'string') {
    const text = raw.trim();
    const lower = text.toLowerCase();
    const isSin = lower.includes('sin');
    const isPoco = lower.includes('poco');
    return {
      ingredientId: null,
      ingredientName: text,
      modifierName: text,
      modifierType: 'GLOBAL_INSTRUCTION',
      state: isSin ? 'sin' : isPoco ? 'poco' : 'normal',
      extraPriceUsdCents: 0,
      internalCostUsdCents: 0
    };
  }

  const name = raw.modifierName || raw.modifier_name || raw.ingredientName || raw.ingredient_name || raw.name || 'Modificador';
  const type = raw.modifierType || raw.modifier_type || raw.type || ((raw.extraPriceUsdCents || raw.extra_price_usd_cents) ? 'PAID_EXTRA' : 'BASE_INGREDIENT');
  let state = raw.state;
  if (!state) {
    if (type === 'SIN_INGREDIENTE') state = 'sin';
    else if (type === 'POCO_INGREDIENTE') state = 'poco';
    else if (type === 'EXTRA_INGREDIENTE' || type === 'PAID_EXTRA') state = 'extra';
    else state = 'normal';
  }

  const price = raw.extraPriceUsdCents ?? raw.extra_price_usd_cents ?? raw.extraPriceCents ?? 0;
  const cost = raw.internalCostUsdCents ?? raw.internal_cost_usd_cents ?? 0;
  const ingId = raw.ingredientId || raw.ingredient_id || null;

  return {
    ingredientId: ingId,
    ingredientName: name,
    modifierName: name,
    modifierType: type,
    state,
    extraPriceUsdCents: price,
    internalCostUsdCents: cost
  };
}

export type OrderModifierInput = ModifierRawInput;

export interface ComboChildInput {
  productId: string;
  quantity?: number;
  flavorChoice?: string;
  customInstructions?: string;
  modifiers?: OrderModifierInput[];
}

export interface OrderLineInput {
  productId: string;
  quantity: number;
  flavorChoice?: string;
  customInstructions?: string;
  modifiers?: OrderModifierInput[];
  comboChildren?: ComboChildInput[];
}

export interface CreateOrderInput {
  orderId?: string;
  idempotencyKey?: string;
  createdByUserId: string;
  fulfillmentType?: 'salon' | 'para_llevar' | 'delivery';
  tableNumber?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryReference?: string | null;
  motorizadoId?: string | null;
  cashCollectedByDriver?: boolean;
  deliveryFeeUsdCents?: number;
  couponCode?: string | null;
  notes?: string | null;
  lines: OrderLineInput[];
}

export interface UpdateOrderInput {
  version: number;
  fulfillmentType?: 'salon' | 'para_llevar' | 'delivery';
  tableNumber?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryReference?: string | null;
  motorizadoId?: string | null;
  deliveryFeeUsdCents?: number;
  notes?: string | null;
  lines?: OrderLineInput[];
}

export function getOrCreateOpenJornada(rawDb: Database.Database, userId: string): string {
  const row = rawDb.prepare(`
    SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1
  `).get() as { id: string } | undefined;

  if (row) return row.id;

  const newJornadaId = `jornada_${Date.now()}`;
  rawDb.prepare(`
    INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status, initial_cash_usd_cents, initial_cash_bs_cents)
    VALUES (?, ?, ?, 'abierta', 0, 0)
  `).run(newJornadaId, userId, Date.now());

  return newJornadaId;
}

export function getNextOrderNumber(rawDb: Database.Database, jornadaId: string): number {
  const row = rawDb.prepare(`
    SELECT MAX(order_number) as max_num FROM orders WHERE jornada_id = ?
  `).get(jornadaId) as { max_num: number | null } | undefined;

  return (row?.max_num ?? 0) + 1;
}

/**
 * Crea un pedido en estado 'sin_pago' y 'enviado' a caja (NO envía a cocina aún).
 * Aplica prorrateo Hamilton en combos y guarda snapshot_json.
 */
export function createOrder(rawDb: Database.Database, input: CreateOrderInput) {
  const orderId = input.orderId || `ord_${generateUuidV7()}`;
  const now = Date.now();
  const rateMicroBs = getCurrentExchangeRate(rawDb);
  const jornadaId = getOrCreateOpenJornada(rawDb, input.createdByUserId);
  const orderNumber = getNextOrderNumber(rawDb, jornadaId);

  const settings = rawDb.prepare('SELECT table_service_mode FROM business_settings WHERE id = \'default\'').get() as any;
  const tableServiceMode = settings?.table_service_mode || 'ticket_independiente';

  let grossFoodSubtotalUsdCents = 0;
  let couponId: string | null = null;
  let discountUsdCents = 0;

  const createTx = rawDb.transaction(() => {
    // 1. Procesar cupón si fue ingresado
    if (input.couponCode) {
      const coup = rawDb.prepare(`
        SELECT * FROM coupons 
        WHERE code = ? AND is_active = 1
      `).get(input.couponCode.toUpperCase().trim()) as any;

      if (coup) {
        couponId = coup.id;
        if (coup.coupon_type === 'DISCOUNT') {
          if (coup.discount_mode === 'FIXED_USD') {
            discountUsdCents = coup.discount_value || 0;
          }
        }
      }
    }

    // 2. Procesar líneas
    interface ProcessedLine {
      id: string;
      productId: string;
      lineRole: 'STANDARD' | 'COMBO_PARENT' | 'COMBO_CHILD' | 'COURTESY_ITEM';
      parentLineId: string | null;
      quantity: number;
      unitPriceUsdCents: number;
      proratedUnitPriceUsdCents: number;
      subtotalUsdCents: number;
      station: string;
      flavorChoice: string | null;
      customInstructions: string | null;
      snapshotJson: string;
      modifiers: NormalizedOrderModifier[];
    }

    const processedLines: ProcessedLine[] = [];

    for (let i = 0; i < input.lines.length; i++) {
      const lineInput = input.lines[i];
      const prod = rawDb.prepare('SELECT * FROM products WHERE id = ?').get(lineInput.productId) as any;
      if (!prod) {
        throw new Error(`Producto '${lineInput.productId}' no existe en el catálogo`);
      }

      const lineId = `line_${generateUuidV7()}`;
      const qty = lineInput.quantity || 1;

      // Calcular modificadores extras pagados y normalizar
      const rawLineMods = lineInput.modifiers || [];
      const lineMods = rawLineMods.map(normalizeModifier);
      const extraPriceMods = lineMods.reduce((sum, m) => sum + (m.extraPriceUsdCents || 0), 0);

      if (prod.is_combo) {
        // --- PROCESAR LÍNEA PADRE DEL COMBO ---
        const parentUnitPrice = prod.price_usd_cents + extraPriceMods;
        const parentSubtotal = parentUnitPrice * qty;
        grossFoodSubtotalUsdCents += parentSubtotal;

        const parentSnapshot = JSON.stringify({
          productName: prod.name,
          basePrice: prod.price_usd_cents,
          isCombo: true,
          modifiers: lineMods
        });

        processedLines.push({
          id: lineId,
          productId: prod.id,
          lineRole: 'COMBO_PARENT',
          parentLineId: null,
          quantity: qty,
          unitPriceUsdCents: parentUnitPrice,
          proratedUnitPriceUsdCents: parentUnitPrice,
          subtotalUsdCents: parentSubtotal,
          station: prod.station,
          flavorChoice: lineInput.flavorChoice || null,
          customInstructions: lineInput.customInstructions || null,
          snapshotJson: parentSnapshot,
          modifiers: lineMods
        });

        // --- PROCESAR LÍNEAS HIJAS DEL COMBO (PRORRATEO HAMILTON) ---
        const comboChildren = lineInput.comboChildren || [];
        if (comboChildren.length > 0) {
          // Obtener precios normales de cada hijo para el prorrateo
          const childProducts = comboChildren.map((c, idx) => {
            const childProd = rawDb.prepare('SELECT * FROM products WHERE id = ?').get(c.productId) as any;
            return {
              childInput: c,
              product: childProd || { id: c.productId, price_usd_cents: 100, station: 'hot_dogs', name: 'Ítem Combo' },
              order: idx
            };
          });

          const prorateItems: ComboItemInput[] = childProducts.map(cp => ({
            id: `${cp.order}_${cp.product.id}`,
            normalPriceUsdCents: cp.product.price_usd_cents,
            order: cp.order
          }));

          const prorateResult = prorateComboLargestRemainder(prod.price_usd_cents, prorateItems);
          const allocatedMap = new Map<string, number>();
          for (const item of prorateResult.items) {
            allocatedMap.set(item.id, item.proratedUsdCents);
          }

          for (const cp of childProducts) {
            const childLineId = `line_${generateUuidV7()}`;
            const childProd = cp.product;
            const childQty = (cp.childInput.quantity || 1) * qty;
            const slotKey = `${cp.order}_${childProd.id}`;
            const proratedPrice = allocatedMap.get(slotKey) ?? childProd.price_usd_cents;
            const rawChildMods = cp.childInput.modifiers || [];
            const childMods = rawChildMods.map(normalizeModifier);

            const childSnapshot = JSON.stringify({
              productName: childProd.name,
              comboParentName: prod.name,
              proratedPrice,
              modifiers: childMods
            });

            processedLines.push({
              id: childLineId,
              productId: childProd.id,
              lineRole: 'COMBO_CHILD',
              parentLineId: lineId,
              quantity: childQty,
              unitPriceUsdCents: childProd.price_usd_cents,
              proratedUnitPriceUsdCents: proratedPrice,
              subtotalUsdCents: proratedPrice * childQty,
              station: childProd.station,
              flavorChoice: cp.childInput.flavorChoice || null,
              customInstructions: cp.childInput.customInstructions || null,
              snapshotJson: childSnapshot,
              modifiers: childMods
            });
          }
        }
      } else {
        // --- PRODUCTO REGULAR ---
        const unitPrice = prod.price_usd_cents + extraPriceMods;
        const subtotal = unitPrice * qty;
        grossFoodSubtotalUsdCents += subtotal;

        const snapshot = JSON.stringify({
          productName: prod.name,
          basePrice: prod.price_usd_cents,
          modifiers: lineMods
        });

        processedLines.push({
          id: lineId,
          productId: prod.id,
          lineRole: 'STANDARD',
          parentLineId: null,
          quantity: qty,
          unitPriceUsdCents: unitPrice,
          proratedUnitPriceUsdCents: unitPrice,
          subtotalUsdCents: subtotal,
          station: prod.station,
          flavorChoice: lineInput.flavorChoice || null,
          customInstructions: lineInput.customInstructions || null,
          snapshotJson: snapshot,
          modifiers: lineMods
        });
      }
    }

    // Si cupón era de tipo porcentaje
    if (couponId && !discountUsdCents) {
      const coup = rawDb.prepare('SELECT * FROM coupons WHERE id = ?').get(couponId) as any;
      if (coup && coup.discount_mode === 'PERCENTAGE_BPS' && coup.discount_value) {
        discountUsdCents = Math.round((grossFoodSubtotalUsdCents * coup.discount_value) / 10000);
      } else if (coup && coup.coupon_type === 'COURTESY_ITEM' && coup.courtesy_product_id) {
        // Agregar línea de cortesía $0.00
        const courtProd = rawDb.prepare('SELECT * FROM products WHERE id = ?').get(coup.courtesy_product_id) as any;
        if (courtProd) {
          const cLineId = `line_${generateUuidV7()}`;
          processedLines.push({
            id: cLineId,
            productId: courtProd.id,
            lineRole: 'COURTESY_ITEM',
            parentLineId: null,
            quantity: 1,
            unitPriceUsdCents: 0,
            proratedUnitPriceUsdCents: 0,
            subtotalUsdCents: 0,
            station: courtProd.station,
            flavorChoice: null,
            customInstructions: null,
            snapshotJson: JSON.stringify({ productName: courtProd.name, courtesy: true }),
            modifiers: []
          });
        }
      }
    }

    const netFoodSalesUsdCents = Math.max(0, grossFoodSubtotalUsdCents - discountUsdCents);
    const deliveryFeeUsdCents = input.deliveryFeeUsdCents || 0;
    const totalToCollectUsdCents = netFoodSalesUsdCents + deliveryFeeUsdCents;

    // Detectar presencia de estaciones de cocina para inicializar estados
    const hasHotDogs = processedLines.some(l => l.station === 'hot_dogs' && l.lineRole !== 'COMBO_PARENT');
    const hasBurgers = processedLines.some(l => l.station === 'hamburguesas' && l.lineRole !== 'COMBO_PARENT');
    const stationStatusHotDogs = hasHotDogs ? 'pendiente' : 'na';
    const stationStatusBurgers = hasBurgers ? 'pendiente' : 'na';

    // 3. Insertar orden en tabla orders
    rawDb.prepare(`
      INSERT INTO orders (
        id, order_number, jornada_id, created_by_user_id, fulfillment_type,
        table_number, customer_name, customer_phone, delivery_address, delivery_reference,
        delivery_fee_usd_cents, motorizado_id,
        gross_food_subtotal_usd_cents, discount_usd_cents, coupon_id, net_food_sales_usd_cents,
        total_to_collect_usd_cents, rate_micro_bs, payment_status, fulfillment_status,
        station_status_hot_dogs, station_status_hamburguesas,
        notes, version, table_service_mode, created_at_ms, updated_at_ms
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?, 'sin_pago', 'enviado',
        ?, ?,
        ?, 1, ?, ?, ?
      )
    `).run(
      orderId,
      orderNumber,
      jornadaId,
      input.createdByUserId,
      input.fulfillmentType || 'salon',
      input.tableNumber || null,
      input.customerName || null,
      input.customerPhone || null,
      input.deliveryAddress || null,
      input.deliveryReference || null,
      deliveryFeeUsdCents,
      input.motorizadoId || null,
      grossFoodSubtotalUsdCents,
      discountUsdCents,
      couponId,
      netFoodSalesUsdCents,
      totalToCollectUsdCents,
      rateMicroBs,
      stationStatusHotDogs,
      stationStatusBurgers,
      input.notes || null,
      tableServiceMode,
      now,
      now
    );

    // Si es delivery, registrar en tabla deliveries
    if (input.fulfillmentType === 'delivery') {
      let driverName = null;
      if (input.motorizadoId) {
        const d = rawDb.prepare('SELECT name FROM delivery_drivers WHERE id = ?').get(input.motorizadoId) as any;
        driverName = d?.name || null;
      }
      const cashCollected = input.cashCollectedByDriver ? 1 : 0;
      const cashAmount = cashCollected ? netFoodSalesUsdCents : 0;
      rawDb.prepare(`
        INSERT INTO deliveries (
          id, order_id, driver_id, motorizado_name, delivery_fee_usd_cents,
          status, settled_to_motorizado, cash_collected_by_driver, food_cash_amount_usd_cents, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, 'asignado', 0, ?, ?, ?)
      `).run(
        `del_${generateUuidV7()}`,
        orderId,
        input.motorizadoId || null,
        driverName,
        deliveryFeeUsdCents,
        cashCollected,
        cashAmount,
        now
      );
    }

    // 4. Insertar líneas y modificadores
    const insertLineStmt = rawDb.prepare(`
      INSERT INTO order_lines (
        id, order_id, product_id, line_role, parent_line_id, quantity,
        unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents,
        station, flavor_choice, custom_instructions, snapshot_json, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertModStmt = rawDb.prepare(`
      INSERT INTO order_line_modifiers (
        id, order_line_id, ingredient_id, ingredient_name, modifier_name, modifier_type,
        state, extra_price_usd_cents, internal_cost_usd_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const pl of processedLines) {
      insertLineStmt.run(
        pl.id,
        orderId,
        pl.productId,
        pl.lineRole,
        pl.parentLineId,
        pl.quantity,
        pl.unitPriceUsdCents,
        pl.proratedUnitPriceUsdCents,
        pl.subtotalUsdCents,
        pl.station,
        pl.flavorChoice,
        pl.customInstructions,
        pl.snapshotJson,
        now
      );

      for (const mod of pl.modifiers) {
        insertModStmt.run(
          `olm_${generateUuidV7()}`,
          pl.id,
          mod.ingredientId || null,
          mod.ingredientName,
          mod.modifierName || mod.ingredientName,
          mod.modifierType,
          mod.state || 'normal',
          mod.extraPriceUsdCents || 0,
          mod.internalCostUsdCents || 0
        );
      }
    }

    appendAuditEvent(rawDb, {
      actorUserId: input.createdByUserId,
      action: 'ORDER_CREATED',
      entityType: 'order',
      entityId: orderId,
      payload: { orderNumber, totalToCollectUsdCents, tableNumber: input.tableNumber, version: 1 }
    });

    publishDomainEvent(rawDb, {
      eventType: 'ORDER_CREATED',
      entityId: orderId,
      payload: {
        orderId,
        orderNumber,
        tableNumber: input.tableNumber,
        totalToCollectUsdCents,
        fulfillmentStatus: 'enviado',
        paymentStatus: 'sin_pago',
        version: 1
      }
    });
  });

  createTx();

  return getOrderById(rawDb, orderId);
}

/**
 * Consulta de orden por ID con sus líneas y modificadores
 */
export function hydrateOrderLines(rawDb: Database.Database, orderId: string, options?: { forCashier?: boolean }) {
  const allLines = rawDb.prepare(`
    SELECT ol.*, p.name as product_name
    FROM order_lines ol
    JOIN products p ON ol.product_id = p.id
    WHERE ol.order_id = ?
    ORDER BY ol.created_at_ms ASC
  `).all(orderId) as any[];

  const allMods = rawDb.prepare(`
    SELECT olm.*
    FROM order_line_modifiers olm
    JOIN order_lines ol ON olm.order_line_id = ol.id
    WHERE ol.order_id = ?
    ORDER BY olm.id ASC
  `).all(orderId) as any[];

  const modsByLine = new Map<string, any[]>();
  for (const m of allMods) {
    const list = modsByLine.get(m.order_line_id) || [];
    list.push({
      ...m,
      name: m.modifier_name || m.ingredient_name || m.name,
      ingredientName: m.ingredient_name || m.name,
      modifierName: m.modifier_name || m.ingredient_name || m.name
    });
    modsByLine.set(m.order_line_id, list);
  }

  const comboChildrenByParent = new Map<string, any[]>();
  for (const l of allLines) {
    if (l.line_role === 'COMBO_CHILD' && l.parent_line_id) {
      const list = comboChildrenByParent.get(l.parent_line_id) || [];
      list.push({
        ...l,
        qty: l.quantity,
        modifiers: modsByLine.get(l.id) || []
      });
      comboChildrenByParent.set(l.parent_line_id, list);
    }
  }

  const mainLines = allLines.filter(l =>
    l.line_role === 'STANDARD' || l.line_role === 'COMBO_PARENT' || l.line_role === 'COURTESY_ITEM'
  );

  const billableLines = (mainLines.length > 0 ? mainLines : allLines).map(l => ({
    ...l,
    qty: l.quantity,
    modifiers: modsByLine.get(l.id) || [],
    comboChildren: comboChildrenByParent.get(l.id) || []
  }));

  const itemsCount = billableLines.reduce((acc, l) => acc + (l.quantity || 1), 0);

  if (options?.forCashier) {
    return {
      lines: billableLines,
      itemsCount: Math.max(itemsCount, allLines.length > 0 ? 1 : 0)
    };
  }

  const linesWithChildren = allLines.map(l => ({
    ...l,
    qty: l.quantity,
    modifiers: modsByLine.get(l.id) || [],
    ...(l.line_role === 'COMBO_PARENT' ? { comboChildren: comboChildrenByParent.get(l.id) || [] } : {})
  }));

  return {
    lines: linesWithChildren,
    itemsCount: Math.max(itemsCount, allLines.length > 0 ? 1 : 0)
  };
}

export function getOrderById(rawDb: Database.Database, orderId: string, userRole?: string, options?: { forCashier?: boolean }) {
  const order = rawDb.prepare(`
    SELECT o.*, u.name as created_by_name,
           d.id as delivery_id, d.driver_id, d.motorizado_name, d.status as delivery_status,
           d.cash_collected_by_driver, d.food_cash_amount_usd_cents as cash_amount_usd_cents, d.settled_to_motorizado,
           dd.name as driver_name, dd.phone as driver_phone
    FROM orders o
    JOIN users u ON o.created_by_user_id = u.id
    LEFT JOIN deliveries d ON o.id = d.order_id
    LEFT JOIN delivery_drivers dd ON (d.driver_id = dd.id OR o.motorizado_id = dd.id)
    WHERE o.id = ?
  `).get(orderId) as any;

  if (!order) return null;

  if (userRole && userRole !== 'admin' && userRole !== 'supervisor') {
    if (order.customer_phone) {
      const clean = order.customer_phone.trim();
      order.customer_phone = clean.length <= 4 ? '***' : clean.slice(0, 4) + '***' + clean.slice(-2);
    }
  }

  const { lines, itemsCount } = hydrateOrderLines(rawDb, orderId, options);

  return {
    ...order,
    lines,
    itemsCount
  };
}

/**
 * Edición concurrente optimista con control estricto de version (PATCH /api/orders/:id).
 * Si payload.version !== order.version -> Lanza 409 Conflict.
 */
export function updateOrder(
  rawDb: Database.Database,
  orderId: string,
  input: UpdateOrderInput,
  actorUserId: string
) {
  const current = rawDb.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
  if (!current) {
    throw new Error(`Orden '${orderId}' no encontrada`);
  }

  if (current.payment_status !== 'sin_pago') {
    throw new Error('No se puede modificar una orden que ya fue cobrada o autorizada');
  }

  // --- CONTROL DE CONCURRENCIA OPTIMISTA ---
  if (current.version !== input.version) {
    const err: any = new Error(`CONFLICT_CONCURRENT_EDIT: La orden fue modificada por otro usuario (versión actual: ${current.version}, enviada: ${input.version})`);
    err.statusCode = 409;
    err.serverVersion = current.version;
    throw err;
  }

  const newVersion = current.version + 1;
  const now = Date.now();

  const updateTx = rawDb.transaction(() => {
    // Si se enviaron nuevas líneas, recrear líneas de la orden
    if (input.lines && input.lines.length > 0) {
      rawDb.prepare('DELETE FROM order_lines WHERE order_id = ?').run(orderId);

      // Re-procesar totales y líneas idéntico a createOrder
      let grossSubtotal = 0;
      for (const line of input.lines) {
        const prod = rawDb.prepare('SELECT price_usd_cents, station, name FROM products WHERE id = ?').get(line.productId) as any;
        const lineId = `line_${generateUuidV7()}`;
        const unitPrice = prod?.price_usd_cents || 0;
        const subtotal = unitPrice * line.quantity;
        grossSubtotal += subtotal;

        rawDb.prepare(`
          INSERT INTO order_lines (
            id, order_id, product_id, line_role, quantity,
            unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents,
            station, flavor_choice, custom_instructions, snapshot_json, created_at_ms
          ) VALUES (?, ?, ?, 'STANDARD', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          lineId,
          orderId,
          line.productId,
          line.quantity,
          unitPrice,
          unitPrice,
          subtotal,
          prod?.station || 'hot_dogs',
          line.flavorChoice || null,
          line.customInstructions || null,
          JSON.stringify({ name: prod?.name, price: unitPrice }),
          now
        );

        if (line.modifiers) {
          for (const rawM of line.modifiers) {
            const m = normalizeModifier(rawM);
            rawDb.prepare(`
              INSERT INTO order_line_modifiers (
                id, order_line_id, ingredient_id, ingredient_name, modifier_name, modifier_type, state, extra_price_usd_cents, internal_cost_usd_cents
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              `olm_${generateUuidV7()}`,
              lineId,
              m.ingredientId || null,
              m.ingredientName,
              m.modifierName || m.ingredientName,
              m.modifierType,
              m.state || 'normal',
              m.extraPriceUsdCents || 0,
              m.internalCostUsdCents || 0
            );
          }
        }
      }

      const fee = input.deliveryFeeUsdCents !== undefined ? input.deliveryFeeUsdCents : current.delivery_fee_usd_cents;
      const totalToCollect = grossSubtotal + fee;

      rawDb.prepare(`
        UPDATE orders
        SET gross_food_subtotal_usd_cents = ?,
            net_food_sales_usd_cents = ?,
            delivery_fee_usd_cents = ?,
            total_to_collect_usd_cents = ?,
            version = ?,
            notes = COALESCE(?, notes),
            table_number = COALESCE(?, table_number),
            fulfillment_type = COALESCE(?, fulfillment_type),
            customer_name = COALESCE(?, customer_name),
            customer_phone = COALESCE(?, customer_phone),
            delivery_address = COALESCE(?, delivery_address),
            delivery_reference = COALESCE(?, delivery_reference),
            motorizado_id = COALESCE(?, motorizado_id),
            updated_at_ms = ?
        WHERE id = ?
      `).run(
        grossSubtotal,
        grossSubtotal,
        fee,
        totalToCollect,
        newVersion,
        input.notes ?? null,
        input.tableNumber ?? null,
        input.fulfillmentType ?? null,
        input.customerName ?? null,
        input.customerPhone ?? null,
        input.deliveryAddress ?? null,
        input.deliveryReference ?? null,
        input.motorizadoId ?? null,
        now,
        orderId
      );
    } else {
      const fee = input.deliveryFeeUsdCents !== undefined ? input.deliveryFeeUsdCents : current.delivery_fee_usd_cents;
      const totalToCollect = current.net_food_sales_usd_cents + fee;

      rawDb.prepare(`
        UPDATE orders
        SET delivery_fee_usd_cents = ?,
            total_to_collect_usd_cents = ?,
            notes = COALESCE(?, notes),
            table_number = COALESCE(?, table_number),
            fulfillment_type = COALESCE(?, fulfillment_type),
            customer_name = COALESCE(?, customer_name),
            customer_phone = COALESCE(?, customer_phone),
            delivery_address = COALESCE(?, delivery_address),
            delivery_reference = COALESCE(?, delivery_reference),
            motorizado_id = COALESCE(?, motorizado_id),
            version = ?,
            updated_at_ms = ?
        WHERE id = ?
      `).run(
        fee,
        totalToCollect,
        input.notes ?? null,
        input.tableNumber ?? null,
        input.fulfillmentType ?? null,
        input.customerName ?? null,
        input.customerPhone ?? null,
        input.deliveryAddress ?? null,
        input.deliveryReference ?? null,
        input.motorizadoId ?? null,
        newVersion,
        now,
        orderId
      );
    }

    appendAuditEvent(rawDb, {
      actorUserId,
      action: 'ORDER_UPDATED',
      entityType: 'order',
      entityId: orderId,
      payload: { previousVersion: current.version, newVersion }
    });

    publishDomainEvent(rawDb, {
      eventType: 'ORDER_UPDATED',
      entityId: orderId,
      payload: { orderId, version: newVersion }
    });
  });

  updateTx();

  return getOrderById(rawDb, orderId);
}

/**
 * Autorización de orden sin pago (POST /api/orders/:id/authorize-without-payment)
 * Exclusivo con PIN de admin o supervisor.
 * Pasa a payment_status = 'autorizado_sin_pago' y fulfillment_status = 'en_preparacion',
 * disparando la preparación en cocina y dejando la deuda abierta en caja.
 */
export function authorizeWithoutPayment(
  rawDb: Database.Database,
  orderId: string,
  authorizerUserId: string,
  pin: string
) {
  const current = rawDb.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
  if (!current) {
    throw new Error(`Orden '${orderId}' no encontrada`);
  }

  // 1. Validar autorizador y PIN
  const rawAuthorizer = rawDb.prepare('SELECT * FROM users WHERE id = ?').get(authorizerUserId);
  if (!rawAuthorizer) {
    throw new Error('Usuario autorizador no encontrado');
  }

  const authorizer = mapUserRow(rawAuthorizer);
  if (authorizer.role !== 'admin' && authorizer.role !== 'supervisor') {
    const err: any = new Error('Solo administradores o supervisores pueden autorizar pedidos sin pago');
    err.statusCode = 403;
    throw err;
  }

  const now = Date.now();
  const lockCheck = checkUserLockout(authorizer, now);
  if (lockCheck.isLocked) {
    const err: any = new Error('El usuario autorizador se encuentra bloqueado temporalmente');
    err.statusCode = 423;
    throw err;
  }

  const isValidPin = verifyPin(pin, authorizer.pinSalt, authorizer.pinHash);
  if (!isValidPin) {
    recordFailedAttempt(rawDb, authorizer.id, authorizer.failedAttempts, authorizer.lockoutStage, now);
    const err: any = new Error('PIN de autorización inválido');
    err.statusCode = 401;
    throw err;
  }

  resetLockout(rawDb, authorizer.id, now);

  const newVersion = current.version + 1;

  // 2. Actualizar estado de orden
  const hasHotDogs = rawDb.prepare("SELECT 1 FROM order_lines WHERE order_id = ? AND station = 'hot_dogs' AND line_role != 'COMBO_PARENT' LIMIT 1").get(orderId) !== undefined;
  const hasBurgers = rawDb.prepare("SELECT 1 FROM order_lines WHERE order_id = ? AND station = 'hamburguesas' AND line_role != 'COMBO_PARENT' LIMIT 1").get(orderId) !== undefined;

  rawDb.prepare(`
    UPDATE orders
    SET payment_status = 'autorizado_sin_pago',
        fulfillment_status = 'en_preparacion',
        kitchen_passed_at_ms = COALESCE(kitchen_passed_at_ms, ?),
        station_status_hot_dogs = ?,
        station_status_hamburguesas = ?,
        authorized_without_payment_by = ?,
        version = ?,
        updated_at_ms = ?
    WHERE id = ?
  `).run(
    now,
    hasHotDogs ? 'en_preparacion' : 'na',
    hasBurgers ? 'en_preparacion' : 'na',
    authorizer.id,
    newVersion,
    now,
    orderId
  );

  // 3. Encolar impresión de comanda de cocina y comprobante
  enqueueOrderPrintJobs(rawDb, orderId);

  appendAuditEvent(rawDb, {
    actorUserId: authorizer.id,
    authorizerUserId: authorizer.id,
    action: 'ORDER_AUTHORIZED_WITHOUT_PAYMENT',
    entityType: 'order',
    entityId: orderId,
    payload: {
      orderNumber: current.order_number,
      totalToCollectUsdCents: current.total_to_collect_usd_cents,
      authorizedBy: authorizer.name,
      newVersion
    }
  });

  publishDomainEvent(rawDb, {
    eventType: 'ORDER_AUTHORIZED_WITHOUT_PAYMENT',
    entityId: orderId,
    payload: {
      orderId,
      orderNumber: current.order_number,
      paymentStatus: 'autorizado_sin_pago',
      fulfillmentStatus: 'en_preparacion',
      authorizedBy: authorizer.name,
      version: newVersion
    }
  });

  return getOrderById(rawDb, orderId);
}
