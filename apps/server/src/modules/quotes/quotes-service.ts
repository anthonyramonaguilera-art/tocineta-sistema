import type Database from 'better-sqlite3';
import { usdToBsCents, formatMicroBsToRate } from '@tocineta/shared';
import { ensureBusinessSettingsDefensive } from '../../db/business-settings.js';

export interface QuoteItemInput {
  productId: string;
  productName?: string;
  quantity: number;
  unitPriceUsdCents?: number;
  notes?: string;
}

export interface QuoteExtraInput {
  concept: string;
  category: 'LOGISTICA' | 'PERSONAL' | 'DESCARTABLES' | 'OTROS';
  priceUsdCents: number;
  costUsdCents?: number;
}

export interface CreateQuoteInput {
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  eventDateMs?: number;
  eventLocation?: string;
  guestCount?: number;
  discountPercent?: number;
  discountUsdCents?: number;
  items: QuoteItemInput[];
  extras?: QuoteExtraInput[];
  notes?: string;
}

export interface ShoppingListItem {
  ingredientId: string;
  ingredientName: string;
  requiredCount: number;
  unitCostUsdCents: number;
  totalCostUsdCents: number;
}

/**
 * Calcula el costo unitario de insumos de un plato según sus ingredientes en receta
 */
export function calculateDishUnitCost(rawDb: Database.Database, productId: string): number {
  const row = rawDb.prepare(`
    SELECT COALESCE(SUM(i.internal_cost_usd_cents), 0) as total_cost
    FROM product_ingredients pi
    JOIN ingredients i ON pi.ingredient_id = i.id
    WHERE pi.product_id = ?
  `).get(productId) as { total_cost: number } | undefined;

  return row?.total_cost ?? 0;
}

/**
 * Obtiene la lista consolidada de compras de insumos para una cotización
 */
export function calculateShoppingList(
  rawDb: Database.Database,
  items: Array<{ productId: string; quantity: number }>
): ShoppingListItem[] {
  const ingredientsMap = new Map<string, ShoppingListItem>();

  for (const item of items) {
    if (item.quantity <= 0) continue;

    const ingRows = rawDb.prepare(`
      SELECT i.id, i.name, i.internal_cost_usd_cents
      FROM product_ingredients pi
      JOIN ingredients i ON pi.ingredient_id = i.id
      WHERE pi.product_id = ?
    `).all(item.productId) as Array<{ id: string; name: string; internal_cost_usd_cents: number }>;

    for (const ing of ingRows) {
      const existing = ingredientsMap.get(ing.id);
      if (existing) {
        existing.requiredCount += item.quantity;
        existing.totalCostUsdCents = existing.requiredCount * existing.unitCostUsdCents;
      } else {
        ingredientsMap.set(ing.id, {
          ingredientId: ing.id,
          ingredientName: ing.name,
          requiredCount: item.quantity,
          unitCostUsdCents: ing.internal_cost_usd_cents,
          totalCostUsdCents: item.quantity * ing.internal_cost_usd_cents
        });
      }
    }
  }

  return Array.from(ingredientsMap.values()).sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));
}

/**
 * Obtiene la tasa BCV vigente
 */
function getCurrentRate(rawDb: Database.Database): number {
  const rateRow = rawDb.prepare(`
    SELECT rate_micro_bs FROM exchange_rates WHERE is_current = 1 ORDER BY created_at_ms DESC LIMIT 1
  `).get() as { rate_micro_bs: number } | undefined;
  return rateRow?.rate_micro_bs ?? 40_000_000;
}

/**
 * Listado de todas las cotizaciones
 */
export function listEventQuotations(rawDb: Database.Database) {
  const quotes = rawDb.prepare(`
    SELECT q.*, u.name as created_by_name,
      (SELECT COUNT(*) FROM event_quotation_items WHERE quotation_id = q.id) as items_count,
      (SELECT COUNT(*) FROM event_quotation_extras WHERE quotation_id = q.id) as extras_count
    FROM event_quotations q
    LEFT JOIN users u ON q.created_by_user_id = u.id
    ORDER BY q.created_at_ms DESC
  `).all() as any[];

  return quotes.map(q => ({
    ...q,
    totalPriceBsCents: usdToBsCents(q.total_price_usd_cents, q.rate_micro_bs),
    rateFormatted: formatMicroBsToRate(q.rate_micro_bs)
  }));
}

/**
 * Detalle completo de una cotización con items, extras y simulador de compras
 */
export function getEventQuotationById(rawDb: Database.Database, id: string) {
  const quote = rawDb.prepare(`
    SELECT q.*, u.name as created_by_name
    FROM event_quotations q
    LEFT JOIN users u ON q.created_by_user_id = u.id
    WHERE q.id = ?
  `).get(id) as any;

  if (!quote) return null;

  const items = rawDb.prepare(`
    SELECT * FROM event_quotation_items WHERE quotation_id = ? ORDER BY product_name ASC
  `).all(id) as any[];

  const extras = rawDb.prepare(`
    SELECT * FROM event_quotation_extras WHERE quotation_id = ? ORDER BY concept ASC
  `).all(id) as any[];

  const shoppingList = calculateShoppingList(rawDb, items.map(i => ({ productId: i.product_id, quantity: i.quantity })));
  const shoppingListTotalCostUsdCents = shoppingList.reduce((acc, curr) => acc + curr.totalCostUsdCents, 0);

  const projectedProfitUsdCents = quote.estimated_profit_usd_cents ?? 0;
  const totalPriceUsdCents = quote.total_price_usd_cents ?? 0;
  const projectedMarginPercent = totalPriceUsdCents > 0
    ? Math.round((projectedProfitUsdCents / totalPriceUsdCents) * 1000) / 10
    : 0;

  return {
    ...quote,
    totalPriceBsCents: usdToBsCents(quote.total_price_usd_cents, quote.rate_micro_bs),
    rateFormatted: formatMicroBsToRate(quote.rate_micro_bs),
    totalPriceUsdCents,
    projectedProfitUsdCents,
    projectedMarginPercent,
    estimatedCostUsdCents: quote.estimated_cost_usd_cents ?? 0,
    items,
    extras,
    shoppingList,
    shoppingListTotalCostUsdCents
  };
}

/**
 * Crear nueva cotización con cálculo defensivo de recetas y utilidad
 */
export function createEventQuotation(rawDb: Database.Database, input: CreateQuoteInput, userId?: string) {
  const now = Date.now();
  const id = `quote_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const rateMicroBs = getCurrentRate(rawDb);
  const effectiveUserId = userId || 'usr_admin';

  // Generar número correlativo
  const countRow = rawDb.prepare('SELECT COUNT(*) as c FROM event_quotations').get() as { c: number };
  const nextNum = (countRow?.c ?? 0) + 1;
  const year = new Date().getFullYear();
  const quotationNumber = `COT-${year}-${String(nextNum).padStart(4, '0')}`;

  const customerName = input.customerName || (input as any).clientName || (input as any).eventName || 'Cliente General';
  const customerPhone = input.customerPhone || (input as any).clientPhone || null;
  const customerEmail = input.customerEmail || (input as any).clientEmail || null;
  const eventDateMs = input.eventDateMs || ((input as any).eventDate ? new Date((input as any).eventDate).getTime() : now);
  const eventLocation = input.eventLocation || (input as any).notes || null;
  const guestCount = input.guestCount || 1;

  return rawDb.transaction(() => {
    let subtotalFood = 0;
    let estimatedFoodCost = 0;

    const preparedItems = (input.items || []).map(it => {
      const prodId = it.productId || (it as any).dishId;
      const prod = rawDb.prepare('SELECT name, price_usd_cents FROM products WHERE id = ?').get(prodId) as any;
      const name = it.productName || prod?.name || 'Plato';
      const unitPrice = it.unitPriceUsdCents ?? prod?.price_usd_cents ?? 0;
      const subtotal = unitPrice * it.quantity;
      const unitCost = calculateDishUnitCost(rawDb, prodId);
      const totalCost = unitCost * it.quantity;

      subtotalFood += subtotal;
      estimatedFoodCost += totalCost;

      return {
        id: `qi_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        quotationId: id,
        productId: prodId,
        productName: name,
        quantity: it.quantity,
        unitPriceUsdCents: unitPrice,
        subtotalUsdCents: subtotal,
        unitCostUsdCents: unitCost,
        totalCostUsdCents: totalCost,
        notes: it.notes || null
      };
    });

    // Descuento por volumen
    let discountUsd = input.discountUsdCents || 0;
    let discountPercent = input.discountPercent || 0;
    if ((input as any).discountType === 'PERCENTAGE' && (input as any).discountValue) {
      discountPercent = Number((input as any).discountValue);
    } else if ((input as any).discountType === 'FIXED_USD' && (input as any).discountValue) {
      discountUsd = Math.round(Number((input as any).discountValue) * 100);
    }

    if (discountPercent > 0) {
      discountUsd = Math.round((subtotalFood * discountPercent) / 100);
    }

    let extraCostsTotal = 0;
    let extraCostsInternal = 0;
    const preparedExtras = (input.extras || []).map(ex => {
      const price = ex.priceUsdCents ?? (ex as any).costUsdCents ?? 0;
      const cost = ex.costUsdCents ?? ex.priceUsdCents ?? 0;
      extraCostsTotal += price;
      extraCostsInternal += cost;
      return {
        id: `qe_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        quotationId: id,
        concept: ex.concept || 'Extra',
        category: ex.category || 'LOGISTICA',
        priceUsdCents: price,
        costUsdCents: cost
      };
    });

    const totalPrice = Math.max(0, subtotalFood - discountUsd) + extraCostsTotal;
    const estimatedTotalCost = estimatedFoodCost + extraCostsInternal;
    const estimatedProfit = totalPrice - estimatedTotalCost;

    rawDb.prepare(`
      INSERT INTO event_quotations (
        id, quotation_number, customer_name, customer_phone, customer_email,
        event_date_ms, event_location, guest_count, subtotal_food_usd_cents,
        discount_percent, discount_usd_cents, extra_costs_usd_cents,
        total_price_usd_cents, estimated_cost_usd_cents, estimated_profit_usd_cents,
        rate_micro_bs, status, notes, created_by_user_id, created_at_ms, updated_at_ms
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, 'BORRADOR', ?, ?, ?, ?
      )
    `).run(
      id, quotationNumber, customerName.trim(), customerPhone?.trim() || null, customerEmail?.trim() || null,
      eventDateMs, eventLocation?.trim() || null, guestCount, subtotalFood,
      discountPercent, discountUsd, extraCostsTotal,
      totalPrice, estimatedTotalCost, estimatedProfit,
      rateMicroBs, input.notes?.trim() || null, effectiveUserId, now, now
    );

    const insertItem = rawDb.prepare(`
      INSERT INTO event_quotation_items (
        id, quotation_id, product_id, product_name, quantity,
        unit_price_usd_cents, subtotal_usd_cents, unit_cost_usd_cents,
        total_cost_usd_cents, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const it of preparedItems) {
      insertItem.run(
        it.id, it.quotationId, it.productId, it.productName, it.quantity,
        it.unitPriceUsdCents, it.subtotalUsdCents, it.unitCostUsdCents,
        it.totalCostUsdCents, it.notes
      );
    }

    const insertExtra = rawDb.prepare(`
      INSERT INTO event_quotation_extras (
        id, quotation_id, concept, category, price_usd_cents, cost_usd_cents
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const ex of preparedExtras) {
      insertExtra.run(ex.id, ex.quotationId, ex.concept, ex.category, ex.priceUsdCents, ex.costUsdCents);
    }

    return getEventQuotationById(rawDb, id);
  })();
}

/**
 * Convertir cotización en reserva confirmada y generar lista de compras
 */
export function convertQuotationToReservation(rawDb: Database.Database, id: string) {
  const quote = getEventQuotationById(rawDb, id);
  if (!quote) throw new Error('Cotización no encontrada');

  const now = Date.now();
  rawDb.prepare(`
    UPDATE event_quotations
    SET status = 'RESERVADA', updated_at_ms = ?
    WHERE id = ?
  `).run(now, id);

  return {
    ...getEventQuotationById(rawDb, id),
    message: 'Cotización convertida en reserva con éxito. Lista de compras consolidada calculada.'
  };
}

/**
 * Eliminar cotización
 */
export function deleteEventQuotation(rawDb: Database.Database, id: string) {
  rawDb.prepare('DELETE FROM event_quotations WHERE id = ?').run(id);
  return { success: true, id };
}

/**
 * Genera el texto formal para enviar la cotización por WhatsApp al cliente (SIN costos internos)
 */
export function generateQuotationWhatsAppText(rawDb: Database.Database, id: string): { url: string; text: string } {
  const quote = getEventQuotationById(rawDb, id);
  if (!quote) throw new Error('Cotización no encontrada');

  const settings = ensureBusinessSettingsDefensive(rawDb);
  const storeName = settings.business_name || 'TOCINETA';
  const totalUsd = (quote.total_price_usd_cents / 100).toFixed(2);
  const totalBs = (quote.totalPriceBsCents / 100).toFixed(2);
  const eventDateStr = quote.event_date_ms ? new Date(quote.event_date_ms).toLocaleDateString('es-VE') : 'Por acordar';

  let msg = `*PRESUPUESTO DE EVENTO — ${storeName}*\n`;
  msg += `*N° Cotización:* ${quote.quotation_number}\n`;
  msg += `*Cliente:* ${quote.customer_name}\n`;
  if (quote.notes) msg += `*Evento:* ${quote.notes}\n`;
  msg += `*Fecha Evento:* ${eventDateStr}\n`;
  if (quote.event_location) msg += `*Lugar:* ${quote.event_location}\n`;
  if (quote.guest_count > 1) msg += `*Personas:* ${quote.guest_count}\n`;
  msg += `------------------------------------\n`;
  msg += `*MENÚ SELECCIONADO:*\n`;

  for (const it of quote.items) {
    const itemSub = (it.subtotal_usd_cents / 100).toFixed(2);
    msg += `• ${it.quantity}x ${it.product_name} ($${(it.unit_price_usd_cents / 100).toFixed(2)}) = $${itemSub}\n`;
  }

  if (quote.discount_usd_cents > 0) {
    msg += `• Descuento por volumen: -$${(quote.discount_usd_cents / 100).toFixed(2)}\n`;
  }

  if (quote.extras && quote.extras.length > 0) {
    msg += `------------------------------------\n`;
    msg += `*SERVICIOS ADICIONALES:*\n`;
    for (const ex of quote.extras) {
      msg += `• ${ex.concept} (${ex.category}): $${(ex.price_usd_cents / 100).toFixed(2)}\n`;
    }
  }

  msg += `====================================\n`;
  msg += `*TOTAL COTIZADO: $${totalUsd}*\n`;
  msg += `*Equivalente en Bs:* Bs. ${totalBs} (Tasa: ${quote.rateFormatted})\n`;
  msg += `====================================\n`;
  if (quote.notes) {
    msg += `*Nota:* ${quote.notes}\n`;
  }
  msg += `_Presupuesto válido por 5 días. Para reservar formalmente, se solicita 50% de anticipo._\n`;
  msg += `¡Estamos a su entera disposición!`;

  const phone = quote.customer_phone ? quote.customer_phone.replace(/\D/g, '') : '';
  const fullPhone = phone.startsWith('0') ? '58' + phone.slice(1) : (phone.startsWith('58') ? phone : '58' + phone);
  const url = phone ? `https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;

  return { url, text: msg };
}
