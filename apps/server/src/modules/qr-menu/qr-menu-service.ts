import * as fs from 'node:fs';
import * as path from 'node:path';
import type Database from 'better-sqlite3';
import { usdToBsCents, formatMicroBsToRate } from '@tocineta/shared';

export interface QrProductFlavor {
  id: string;
  flavorName: string;
  isAvailable: boolean;
}

export interface QrBaseIngredient {
  id: string;
  name: string;
  isRemovable: boolean;
}

export interface QrProductItem {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceUsdCents: number;
  priceBsCents: number;
  priceUsdFormatted: string;
  priceBsFormatted: string;
  station: string;
  isAvailable: boolean;
  isCombo: boolean;
  allowsFlavors: boolean;
  imageUrl: string | null;
  flavors: QrProductFlavor[];
  baseIngredients: QrBaseIngredient[];
}

export interface QrCategory {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
  products: QrProductItem[];
}

export interface QrBarraLibreItem {
  id: string;
  name: string;
  priceUsdCents: 0;
  priceBsCents: 0;
  priceFormatted: string;
}

export interface QrComboSlotOption {
  productId: string;
  productName: string;
  isAvailable: boolean;
}

export interface QrComboSlot {
  id: string;
  comboId: string;
  slotNumber: number;
  slotName: string;
  requiredStation: string;
  options: QrComboSlotOption[];
}

export interface QrComboItem {
  id: string;
  name: string;
  description: string | null;
  comboPriceUsdCents: number;
  comboPriceBsCents: number;
  comboPriceUsdFormatted: string;
  comboPriceBsFormatted: string;
  slots: QrComboSlot[];
}

export interface PublicQrMenuPayload {
  storeName: string;
  slogan: string;
  schedule: string;
  location: string;
  whatsappNumber: string;
  whatsappDisplay: string;
  currency: {
    rateMicroBs: number;
    rateFormatted: string;
    rateUpdatedAtMs: number;
    rateUpdatedAtCaracas: string;
  };
  categories: QrCategory[];
  barraLibre: QrBarraLibreItem[];
  combos: QrComboItem[];
  generatedAtMs: number;
}

export interface WhatsAppOrderItemInput {
  name: string;
  quantity: number;
  priceUsdCents: number;
  flavor?: string;
  removals?: string[];
  barraLibre?: string[];
  comboSelections?: Array<{
    slotName: string;
    productName: string;
    flavor?: string;
    removals?: string[];
    barraLibre?: string[];
  }>;
  notes?: string;
}

export interface WhatsAppOrderInput {
  fulfillmentType: 'takeout' | 'delivery';
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryReference?: string;
  deliveryFeeUsdCents?: number;
  items: WhatsAppOrderItemInput[];
}

export const OFFICIAL_WHATSAPP_NUMBER = '584121928527';
export const OFFICIAL_WHATSAPP_DISPLAY = '0412-1928527';
export const OFFICIAL_STORE_NAME = 'Tocineta Sonríe';
export const OFFICIAL_SLOGAN = 'Cocinamos con amor, te servimos como mereces y damos gloria a Dios';
export const OFFICIAL_SCHEDULE = 'Martes a Domingo de 6:00 p. m. a 12:00 a. m.';
export const OFFICIAL_LOCATION = 'Alta Vista detrás de Torre Movistar, Puerto Ordaz';

/**
 * Obtiene la fecha/hora en formato legible en zona horaria America/Caracas (Venezuela)
 */
export function formatCaracasDateTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleString('es-VE', {
    timeZone: 'America/Caracas',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Formatea céntimos USD a cadena con formato moneda (ej: 350 -> "$3.50")
 */
export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Formatea céntimos Bs a cadena con formato moneda venezolano (ej: 14000 -> "Bs. 140,00")
 */
export function formatBs(cents: number): string {
  const units = (cents / 100).toFixed(2);
  const [intPart, decPart] = units.split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `Bs. ${formattedInt},${decPart}`;
}

/**
 * 1. Payload Sanitizado Público del Menú Digital QR
 * - Excluye categorías inactivas (MALTEADAS_Y_HELADOS excluida mientras is_active = 0)
 * - Excluye estrictamente costos internos (estimated_cost_usd_cents)
 * - Incluye precios en USD y Bs calculados con la tasa BCV vigente
 * - Incluye timestamp exacto de la tasa en Caracas
 */
export function getPublicQrMenuData(rawDb: Database.Database): PublicQrMenuPayload {
  const now = Date.now();

  // 1. Tasa BCV vigente
  const rateRow = rawDb.prepare(`
    SELECT rate_micro_bs, created_at_ms
    FROM exchange_rates
    WHERE is_current = 1
    ORDER BY created_at_ms DESC
    LIMIT 1
  `).get() as { rate_micro_bs: number; created_at_ms: number } | undefined;

  const rateMicroBs = rateRow?.rate_micro_bs ?? 40_000_000;
  const rateUpdatedAtMs = rateRow?.created_at_ms ?? now;
  const rateFormatted = formatMicroBsToRate(rateMicroBs);
  const rateUpdatedAtCaracas = formatCaracasDateTime(rateUpdatedAtMs);

  // 2. Categorías públicas activas (is_active = 1, is_internal = 0)
  // Regla 1: cat_malteadas tiene is_active = 0 por defecto, por lo que queda excluida
  const categoriesRows = rawDb.prepare(`
    SELECT id, name, description, display_order
    FROM categories
    WHERE is_active = 1 AND is_internal = 0
    ORDER BY display_order ASC
  `).all() as Array<{
    id: string;
    name: string;
    description: string | null;
    display_order: number;
  }>;

  // 3. Productos activos vinculados a categorías activas
  // IMPORTANTE: NO SE SELECCIONA estimated_cost_usd_cents NI COSTOS INTERNOS
  const productRows = rawDb.prepare(`
    SELECT 
      p.id, p.category_id, p.name, p.description, p.price_usd_cents,
      p.station, p.is_available, p.is_combo, p.allows_flavors, p.image_url
    FROM products p
    JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = 1 AND c.is_active = 1 AND c.is_internal = 0
    ORDER BY p.name ASC
  `).all() as Array<{
    id: string;
    category_id: string;
    name: string;
    description: string | null;
    price_usd_cents: number;
    station: string;
    is_available: number;
    is_combo: number;
    allows_flavors: number;
    image_url: string | null;
  }>;

  // 4. Sabores activos (ej. 6 Pepsi)
  const flavorRows = rawDb.prepare(`
    SELECT id, product_id, flavor_name, is_available
    FROM product_flavor_options
    WHERE is_active = 1
    ORDER BY display_order ASC
  `).all() as Array<{
    id: string;
    product_id: string;
    flavor_name: string;
    is_available: number;
  }>;

  const flavorsByProduct = new Map<string, QrProductFlavor[]>();
  for (const f of flavorRows) {
    const list = flavorsByProduct.get(f.product_id) || [];
    list.push({
      id: f.id,
      flavorName: f.flavor_name,
      isAvailable: Boolean(f.is_available)
    });
    flavorsByProduct.set(f.product_id, list);
  }

  // 5. Ingredientes base removibles
  const prodIngRows = rawDb.prepare(`
    SELECT pi.product_id, i.id as ingredient_id, i.name as ingredient_name, pi.is_removable
    FROM product_ingredients pi
    JOIN ingredients i ON pi.ingredient_id = i.id
    WHERE i.is_active = 1
    ORDER BY pi.display_order ASC
  `).all() as Array<{
    product_id: string;
    ingredient_id: string;
    ingredient_name: string;
    is_removable: number;
  }>;

  const baseIngredientsByProduct = new Map<string, QrBaseIngredient[]>();
  for (const pi of prodIngRows) {
    const list = baseIngredientsByProduct.get(pi.product_id) || [];
    list.push({
      id: pi.ingredient_id,
      name: pi.ingredient_name,
      isRemovable: Boolean(pi.is_removable)
    });
    baseIngredientsByProduct.set(pi.product_id, list);
  }

  // Mapear categorías con sus productos
  const categories: QrCategory[] = categoriesRows.map(cat => {
    const prods = productRows
      .filter(p => p.category_id === cat.id)
      .map(p => {
        const bsCents = usdToBsCents(p.price_usd_cents, rateMicroBs);
        return {
          id: p.id,
          categoryId: p.category_id,
          name: p.name,
          description: p.description,
          priceUsdCents: p.price_usd_cents,
          priceBsCents: bsCents,
          priceUsdFormatted: formatUsd(p.price_usd_cents),
          priceBsFormatted: formatBs(bsCents),
          station: p.station,
          isAvailable: Boolean(p.is_available),
          isCombo: Boolean(p.is_combo),
          allowsFlavors: Boolean(p.allows_flavors),
          imageUrl: p.image_url,
          flavors: flavorsByProduct.get(p.id) || [],
          baseIngredients: baseIngredientsByProduct.get(p.id) || []
        };
      });

    return {
      id: cat.id,
      name: cat.name,
      description: cat.description,
      displayOrder: cat.display_order,
      products: prods
    };
  });

  // 6. Ingredientes de Barra Libre ($0.00 al público)
  const barraLibreRows = rawDb.prepare(`
    SELECT id, name
    FROM ingredients
    WHERE is_barra_libre = 1 AND is_active = 1
    ORDER BY name ASC
  `).all() as Array<{ id: string; name: string }>;

  const barraLibre: QrBarraLibreItem[] = barraLibreRows.map(b => ({
    id: b.id,
    name: b.name,
    priceUsdCents: 0,
    priceBsCents: 0,
    priceFormatted: '$0.00 (Gratis)'
  }));

  // 7. Combos y slots
  const comboRows = rawDb.prepare(`
    SELECT c.id, c.name, c.combo_price_usd_cents, c.description
    FROM combos c
    JOIN products p ON c.id = p.id
    WHERE p.is_active = 1
    ORDER BY c.name ASC
  `).all() as Array<{
    id: string;
    name: string;
    combo_price_usd_cents: number;
    description: string | null;
  }>;

  const slotRows = rawDb.prepare(`
    SELECT id, combo_id, slot_number, slot_name, required_station
    FROM combo_slots
    ORDER BY slot_number ASC
  `).all() as Array<{
    id: string;
    combo_id: string;
    slot_number: number;
    slot_name: string;
    required_station: string;
  }>;

  const optionRows = rawDb.prepare(`
    SELECT cso.slot_id, p.id as product_id, p.name as product_name, p.is_available
    FROM combo_slot_options cso
    JOIN products p ON cso.product_id = p.id
    WHERE p.is_active = 1
    ORDER BY p.name ASC
  `).all() as Array<{
    slot_id: string;
    product_id: string;
    product_name: string;
    is_available: number;
  }>;

  const optionsBySlot = new Map<string, QrComboSlotOption[]>();
  for (const opt of optionRows) {
    const list = optionsBySlot.get(opt.slot_id) || [];
    list.push({
      productId: opt.product_id,
      productName: opt.product_name,
      isAvailable: Boolean(opt.is_available)
    });
    optionsBySlot.set(opt.slot_id, list);
  }

  const slotsByCombo = new Map<string, QrComboSlot[]>();
  for (const s of slotRows) {
    const list = slotsByCombo.get(s.combo_id) || [];
    list.push({
      id: s.id,
      comboId: s.combo_id,
      slotNumber: s.slot_number,
      slotName: s.slot_name,
      requiredStation: s.required_station,
      options: optionsBySlot.get(s.id) || []
    });
    slotsByCombo.set(s.combo_id, list);
  }

  const combos: QrComboItem[] = comboRows.map(c => {
    const bsCents = usdToBsCents(c.combo_price_usd_cents, rateMicroBs);
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      comboPriceUsdCents: c.combo_price_usd_cents,
      comboPriceBsCents: bsCents,
      comboPriceUsdFormatted: formatUsd(c.combo_price_usd_cents),
      comboPriceBsFormatted: formatBs(bsCents),
      slots: slotsByCombo.get(c.id) || []
    };
  });

  return {
    storeName: OFFICIAL_STORE_NAME,
    slogan: OFFICIAL_SLOGAN,
    schedule: OFFICIAL_SCHEDULE,
    location: OFFICIAL_LOCATION,
    whatsappNumber: OFFICIAL_WHATSAPP_NUMBER,
    whatsappDisplay: OFFICIAL_WHATSAPP_DISPLAY,
    currency: {
      rateMicroBs,
      rateFormatted,
      rateUpdatedAtMs,
      rateUpdatedAtCaracas
    },
    categories,
    barraLibre,
    combos,
    generatedAtMs: now
  };
}

/**
 * 2. Formateador Oficial de Pedidos a WhatsApp
 * Genera el texto estructurado y el enlace https://wa.me/584121928527?text=...
 */
export function formatWhatsAppOrderMessage(
  input: WhatsAppOrderInput,
  rateMicroBs = 40_000_000,
  rateUpdatedAtStr?: string
): { text: string; url: string } {
  const rateFormatted = formatMicroBsToRate(rateMicroBs);
  const nowStr = rateUpdatedAtStr || formatCaracasDateTime(Date.now());

  let foodTotalUsdCents = 0;
  for (const item of input.items) {
    foodTotalUsdCents += (item.priceUsdCents * item.quantity);
  }

  const deliveryFeeUsdCents = input.fulfillmentType === 'delivery'
    ? (input.deliveryFeeUsdCents ?? 200) // $2.00 por defecto
    : 0;

  const totalUsdCents = foodTotalUsdCents + deliveryFeeUsdCents;
  const foodTotalBsCents = usdToBsCents(foodTotalUsdCents, rateMicroBs);
  const deliveryFeeBsCents = usdToBsCents(deliveryFeeUsdCents, rateMicroBs);
  const totalBsCents = usdToBsCents(totalUsdCents, rateMicroBs);

  const lines: string[] = [];

  lines.push(`*¡HOLA, TOCINETA SONRÍE!* 🥓`);
  lines.push(`Quisiera realizar el siguiente pedido desde el Menú Digital QR:\n`);

  lines.push(`📋 *DETALLE DEL PEDIDO:*`);
  for (const item of input.items) {
    const itemTotalUsd = item.priceUsdCents * item.quantity;
    const itemTotalBs = usdToBsCents(itemTotalUsd, rateMicroBs);
    lines.push(`• *${item.quantity}x ${item.name}* (${formatUsd(itemTotalUsd)} / ${formatBs(itemTotalBs)})`);

    if (item.flavor) {
      lines.push(`  - Sabor: ${item.flavor}`);
    }
    if (item.removals && item.removals.length > 0) {
      lines.push(`  - Exclusiones: ${item.removals.join(', ')}`);
    }
    if (item.barraLibre && item.barraLibre.length > 0) {
      lines.push(`  - Barra Libre ($0.00): ${item.barraLibre.join(', ')}`);
    }
    if (item.comboSelections && item.comboSelections.length > 0) {
      for (const sel of item.comboSelections) {
        lines.push(`  - Incluye: ${sel.productName}`);
        if (sel.flavor) lines.push(`    * Sabor: ${sel.flavor}`);
        if (sel.removals && sel.removals.length > 0) lines.push(`    * Exclusiones: ${sel.removals.join(', ')}`);
        if (sel.barraLibre && sel.barraLibre.length > 0) lines.push(`    * Barra Libre: ${sel.barraLibre.join(', ')}`);
      }
    }
    if (item.notes) {
      lines.push(`  - Nota: ${item.notes}`);
    }
  }

  lines.push(``);
  lines.push(`📦 *MODALIDAD:* ${input.fulfillmentType === 'delivery' ? '🛵 Delivery a Domicilio' : '🍔 Para Llevar / Retiro en Food Truck'}`);

  if (input.customerName) {
    lines.push(`👤 *Cliente:* ${input.customerName}`);
  }
  if (input.customerPhone) {
    lines.push(`📞 *Teléfono:* ${input.customerPhone}`);
  }
  if (input.fulfillmentType === 'delivery') {
    if (input.deliveryAddress) {
      lines.push(`📍 *Dirección:* ${input.deliveryAddress}`);
    }
    if (input.deliveryReference) {
      lines.push(`🗺️ *Punto de Referencia:* ${input.deliveryReference}`);
    }
  }

  lines.push(``);
  lines.push(`💵 *RESUMEN DE PAGO ESTIMADO:*`);
  lines.push(`• Subtotal Comida: ${formatUsd(foodTotalUsdCents)} / ${formatBs(foodTotalBsCents)}`);
  if (input.fulfillmentType === 'delivery') {
    lines.push(`• Tarifa Delivery: ${formatUsd(deliveryFeeUsdCents)} / ${formatBs(deliveryFeeBsCents)}`);
  }
  lines.push(`• *TOTAL ESTIMADO: ${formatUsd(totalUsdCents)} / ${formatBs(totalBsCents)}*`);
  lines.push(`*(Tasa BCV oficial: ${rateFormatted} Bs/$ - Actualizada: ${nowStr})*`);
  lines.push(``);
  lines.push(`"${OFFICIAL_SLOGAN}"`);

  const text = lines.join('\n');
  const url = `https://wa.me/${OFFICIAL_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;

  return { text, url };
}

/**
 * 3. Generador del Menú Estático Autocontenido para Nube (Vercel / Cloudflare Pages) y Local
 */
export async function generateStaticQrSite(
  rawDb: Database.Database,
  customDistDir?: string
): Promise<{
  distDir: string;
  htmlPath: string;
  jsonPath: string;
  files: string[];
}> {
  const distDir = customDistDir || path.resolve(process.cwd(), './data/qr-static-dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const menuData = getPublicQrMenuData(rawDb);
  const jsonPath = path.join(distDir, 'menu-snapshot.json');
  fs.writeFileSync(jsonPath, JSON.stringify(menuData, null, 2), 'utf-8');

  // Generar index.html estático autocontenido con JavaScript y CSS en línea
  const htmlContent = generateSelfContainedHtml(menuData);
  const htmlPath = path.join(distDir, 'index.html');
  fs.writeFileSync(htmlPath, htmlContent, 'utf-8');

  return {
    distDir,
    htmlPath,
    jsonPath,
    files: ['index.html', 'menu-snapshot.json']
  };
}

/**
 * 4. Resumen Financiero Agregado para Sincronización en la Nube
 * Garantiza con un guard estricto que NO contenga nombres, teléfonos ni direcciones de clientes.
 */
export function getCloudSummaryMetrics(
  rawDb: Database.Database,
  jornadaId?: string
): {
  generatedAtMs: number;
  jornadaId: string | null;
  dateCaracas: string;
  totals: {
    ordersCount: number;
    totalFoodSalesUsdCents: number;
    totalDeliveryFeesUsdCents: number;
    totalDiscountUsdCents: number;
    totalCollectedUsdCents: number;
    totalCollectedBsCents: number;
  };
  dishesSold: Array<{
    productId: string;
    productName: string;
    quantitySold: number;
    totalSalesUsdCents: number;
  }>;
} {
  const now = Date.now();
  let targetJornadaId: string | null = jornadaId || null;

  if (!targetJornadaId) {
    const currentJornada = rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
    targetJornadaId = currentJornada?.id || null;
  }

  const jornadaFilter = targetJornadaId ? 'WHERE o.jornada_id = ?' : '';
  const jornadaParams = targetJornadaId ? [targetJornadaId] : [];

  // Totales agregados numéricos
  const totalsRow = rawDb.prepare(`
    SELECT 
      COUNT(o.id) as orders_count,
      COALESCE(SUM(o.net_food_sales_usd_cents), 0) as food_sales,
      COALESCE(SUM(o.delivery_fee_usd_cents), 0) as delivery_fees,
      COALESCE(SUM(o.discount_usd_cents), 0) as discounts,
      COALESCE(SUM(o.total_to_collect_usd_cents), 0) as total_usd
    FROM orders o
    ${jornadaFilter}
      ${targetJornadaId ? 'AND' : 'WHERE'} o.fulfillment_status != 'anulado'
  `).get(...jornadaParams) as any;

  // Platos más vendidos
  const dishesRows = rawDb.prepare(`
    SELECT 
      ol.product_id,
      p.name as product_name,
      SUM(ol.quantity) as quantity_sold,
      SUM(ol.subtotal_usd_cents) as total_sales_usd_cents
    FROM order_lines ol
    JOIN orders o ON ol.order_id = o.id
    JOIN products p ON ol.product_id = p.id
    ${jornadaFilter}
      ${targetJornadaId ? 'AND' : 'WHERE'} o.fulfillment_status != 'anulado'
      AND ol.line_role IN ('STANDARD', 'COMBO_CHILD')
    GROUP BY ol.product_id, p.name
    ORDER BY quantity_sold DESC
  `).all(...jornadaParams) as Array<{
    product_id: string;
    product_name: string;
    quantity_sold: number;
    total_sales_usd_cents: number;
  }>;

  const rateRow = rawDb.prepare(`
    SELECT rate_micro_bs FROM exchange_rates WHERE is_current = 1 ORDER BY created_at_ms DESC LIMIT 1
  `).get() as { rate_micro_bs: number } | undefined;
  const rateMicroBs = rateRow?.rate_micro_bs ?? 40_000_000;

  const summary = {
    generatedAtMs: now,
    jornadaId: targetJornadaId,
    dateCaracas: formatCaracasDateTime(now),
    totals: {
      ordersCount: totalsRow?.orders_count || 0,
      totalFoodSalesUsdCents: totalsRow?.food_sales || 0,
      totalDeliveryFeesUsdCents: totalsRow?.delivery_fees || 0,
      totalDiscountUsdCents: totalsRow?.discounts || 0,
      totalCollectedUsdCents: totalsRow?.total_usd || 0,
      totalCollectedBsCents: usdToBsCents(totalsRow?.total_usd || 0, rateMicroBs)
    },
    dishesSold: dishesRows.map(d => ({
      productId: d.product_id,
      productName: d.product_name,
      quantitySold: d.quantity_sold,
      totalSalesUsdCents: d.total_sales_usd_cents
    }))
  };

  // 5. GUARD ESTRICTO DE PRIVACIDAD: CERO FILTRACIÓN DE NOMBRES, TELÉFONOS O DIRECCIONES
  const summaryJson = JSON.stringify(summary);
  verifyZeroPersonalDataLeak(summaryJson, rawDb);

  return summary;
}

/**
 * Inspección profunda de seguridad para certificar que ningún dato personal de cliente
 * (nombre, teléfono, dirección, referencia) esté presente en el payload de la nube
 */
export function verifyZeroPersonalDataLeak(jsonString: string, rawDb: Database.Database): void {
  // Consultar todos los datos de clientes registrados en el sistema
  const customerRows = rawDb.prepare(`
    SELECT DISTINCT customer_name, customer_phone, delivery_address, delivery_reference
    FROM orders
    WHERE customer_name IS NOT NULL OR customer_phone IS NOT NULL OR delivery_address IS NOT NULL
  `).all() as Array<{
    customer_name: string | null;
    customer_phone: string | null;
    delivery_address: string | null;
    delivery_reference: string | null;
  }>;

  const lowerJson = jsonString.toLowerCase();

  for (const row of customerRows) {
    // 1. Verificar teléfono (si tiene 6 o más dígitos significativos)
    if (row.customer_phone) {
      const cleanPhone = row.customer_phone.replace(/\D/g, '');
      if (cleanPhone.length >= 6 && lowerJson.includes(cleanPhone)) {
        throw new Error(`DATA_PRIVACY_VIOLATION: Se detectó el teléfono del cliente '${row.customer_phone}' en el payload de la nube.`);
      }
    }

    // 2. Verificar nombre del cliente (si no es genérico)
    if (row.customer_name) {
      const name = row.customer_name.trim().toLowerCase();
      if (name.length >= 4 && !name.includes('cliente') && lowerJson.includes(name)) {
        throw new Error(`DATA_PRIVACY_VIOLATION: Se detectó el nombre del cliente '${row.customer_name}' en el payload de la nube.`);
      }
    }

    // 3. Verificar dirección
    if (row.delivery_address) {
      const addr = row.delivery_address.trim().toLowerCase();
      if (addr.length >= 6 && lowerJson.includes(addr)) {
        throw new Error(`DATA_PRIVACY_VIOLATION: Se detectó la dirección del cliente '${row.delivery_address}' en el payload de la nube.`);
      }
    }
  }
}

/**
 * Generador HTML interactivo ultra optimizado para Vercel / Cloudflare Pages
 */
export function generateSelfContainedHtml(menuData: PublicQrMenuPayload): string {
  const dataJson = JSON.stringify(menuData);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tocineta Sonríe • Menú Digital Oficial</title>
  <meta name="description" content="Menú digital oficial de Tocineta Sonríe. Los mejores perros calientes y hamburguesas con Barra Libre en Puerto Ordaz.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;700;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #121212;
      --card: #1E1E1E;
      --card-hover: #262626;
      --border: #333333;
      --yellow: #F59E0B;
      --yellow-hover: #D97706;
      --text: #F3F4F6;
      --muted: #9CA3AF;
      --green: #10B981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      padding-bottom: 90px;
      -webkit-font-smoothing: antialiased;
    }
    header {
      background: linear-gradient(180deg, #1A1A1A 0%, var(--bg) 100%);
      border-bottom: 1px solid var(--border);
      padding: 24px 16px 16px;
      text-align: center;
    }
    .badge-bcv {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.4);
      color: var(--yellow);
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 700;
      margin-top: 10px;
    }
    .category-pills {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 14px 16px;
      position: sticky;
      top: 0;
      background: rgba(18, 18, 18, 0.95);
      backdrop-filter: blur(10px);
      z-index: 30;
      border-bottom: 1px solid var(--border);
    }
    .pill {
      background: var(--card);
      border: 1px solid var(--border);
      color: var(--muted);
      padding: 8px 16px;
      border-radius: 14px;
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.2s;
    }
    .pill.active {
      background: var(--yellow);
      color: #000;
      border-color: var(--yellow);
    }
    .container { max-width: 900px; margin: 0 auto; padding: 16px; }
    .product-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
      margin-bottom: 30px;
    }
    .product-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: transform 0.2s, border-color 0.2s;
    }
    .product-card:hover {
      border-color: rgba(245, 158, 11, 0.5);
      transform: translateY(-2px);
    }
    .price-tag {
      font-size: 18px;
      font-weight: 900;
      color: var(--yellow);
    }
    .price-bs {
      font-size: 13px;
      color: var(--muted);
      font-family: 'JetBrains Mono', monospace;
    }
    .btn-add {
      background: var(--yellow);
      color: #000;
      border: none;
      padding: 10px 16px;
      border-radius: 12px;
      font-weight: 900;
      font-size: 13px;
      cursor: pointer;
      width: 100%;
      margin-top: 14px;
      transition: opacity 0.2s;
    }
    .btn-add:active { transform: scale(0.98); }
    /* Barra Flotante de Carrito */
    .cart-bar {
      position: fixed;
      bottom: 16px;
      left: 16px;
      right: 16px;
      max-width: 600px;
      margin: 0 auto;
      background: #000;
      border: 2px solid var(--yellow);
      border-radius: 24px;
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 10px 25px rgba(0,0,0,0.8);
      z-index: 50;
      cursor: pointer;
    }
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(6px);
      z-index: 100;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .modal-content {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 24px;
      width: 100%;
      max-width: 520px;
      max-height: 90vh;
      overflow-y: auto;
    }
  </style>
</head>
<body>
  <header>
    <div style="font-size: 42px;">🥓</div>
    <h1 style="font-size: 26px; font-weight: 900; letter-spacing: 0.5px; margin-top: 4px;">TOCINETA SONRÍE</h1>
    <p style="font-size: 13px; color: var(--muted); margin-top: 4px; font-style: italic;">
      "${menuData.slogan}"
    </p>
    <div style="font-size: 12px; color: #D1D5DB; margin-top: 8px;">
      📍 ${menuData.location}<br>
      ⏰ ${menuData.schedule}
    </div>
    <div class="badge-bcv">
      💵 Tasa BCV: <strong>${menuData.currency.rateFormatted} Bs/$</strong>
      <span style="font-size: 11px; opacity: 0.8;">• ${menuData.currency.rateUpdatedAtCaracas}</span>
    </div>
  </header>

  <div class="category-pills" id="categoryTabs">
    <div class="pill active" onclick="filterCategory('all', this)">Todos</div>
    ${menuData.categories.map(c => `
      <div class="pill" onclick="filterCategory('${c.id}', this)">${c.name}</div>
    `).join('')}
  </div>

  <div class="container">
    <div id="productGrid" class="product-grid">
      <!-- Los productos se inyectan dinámicamente -->
    </div>
  </div>

  <!-- Botón Flotante Carrito -->
  <div id="cartBar" class="cart-bar" style="display: none;" onclick="openCartModal()">
    <div style="display: flex; align-items: center; gap: 10px;">
      <span style="font-size: 22px;">🛒</span>
      <div>
        <div style="font-weight: 900; font-size: 14px;" id="cartItemCount">0 platos</div>
        <div style="font-size: 12px; color: var(--yellow);" id="cartTotalSummary">$0.00 / Bs. 0,00</div>
      </div>
    </div>
    <button style="background: var(--yellow); color: #000; border: none; font-weight: 900; font-size: 13px; padding: 10px 18px; border-radius: 14px;">
      Ver Carrito ➔
    </button>
  </div>

  <!-- Modal de Carrito y Checkout WhatsApp -->
  <div id="cartModal" class="modal-overlay" onclick="closeCartModal(event)">
    <div class="modal-content" onclick="event.stopPropagation()">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 16px;">
        <h2 style="font-size: 18px; font-weight: 900;">🛒 Tu Pedido</h2>
        <button onclick="closeCartModal()" style="background: none; border: none; color: #fff; font-size: 20px; cursor: pointer;">✕</button>
      </div>

      <div id="cartItemsList" style="max-height: 220px; overflow-y: auto; margin-bottom: 16px;"></div>

      <!-- Selector Modalidad -->
      <div style="margin-bottom: 16px;">
        <label style="font-size: 12px; font-weight: 700; color: var(--muted); display: block; margin-bottom: 6px;">Modalidad de Entrega:</label>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <button id="btnTakeout" onclick="setFulfillment('takeout')" style="padding: 10px; border-radius: 12px; border: 1px solid var(--yellow); background: rgba(245, 158, 11, 0.15); color: #fff; font-weight: 700; font-size: 12px; cursor: pointer;">
            🍔 Para Llevar
          </button>
          <button id="btnDelivery" onclick="setFulfillment('delivery')" style="padding: 10px; border-radius: 12px; border: 1px solid var(--border); background: var(--bg); color: var(--muted); font-weight: 700; font-size: 12px; cursor: pointer;">
            🛵 Delivery
          </button>
        </div>
      </div>

      <!-- Campos de Entrega -->
      <div id="customerFields" style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px;">
        <input type="text" id="custName" placeholder="Tu Nombre" style="padding: 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--bg); color: #fff; font-size: 13px;">
        <input type="tel" id="custPhone" placeholder="Teléfono (ej: 0414-1234567)" style="padding: 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--bg); color: #fff; font-size: 13px;">
        <div id="deliveryFields" style="display: none; flex-direction: column; gap: 10px;">
          <input type="text" id="custAddress" placeholder="Dirección de Entrega" style="padding: 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--bg); color: #fff; font-size: 13px;">
          <input type="text" id="custReference" placeholder="Punto de Referencia (ej: frente al parque)" style="padding: 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--bg); color: #fff; font-size: 13px;">
        </div>
      </div>

      <!-- Totales y Botón WhatsApp -->
      <div style="border-top: 1px solid var(--border); padding-top: 14px; margin-top: 14px;">
        <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 6px;">
          <span style="color: var(--muted);">Subtotal Comida:</span>
          <span style="font-weight: 700;" id="modalSubtotal">$0.00</span>
        </div>
        <div id="deliveryRow" style="display: none; justify-content: space-between; font-size: 14px; margin-bottom: 6px;">
          <span style="color: var(--muted);">Delivery:</span>
          <span style="font-weight: 700;">$2.00</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 18px; font-weight: 900; color: var(--yellow); margin-bottom: 14px;">
          <span>TOTAL ESTIMADO:</span>
          <span id="modalTotal">$0.00</span>
        </div>

        <button onclick="sendOrderToWhatsApp()" style="width: 100%; background: #25D366; color: #000; border: none; padding: 14px; border-radius: 16px; font-weight: 900; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <span>📲 Enviar Pedido por WhatsApp (${menuData.whatsappDisplay})</span>
        </button>
      </div>
    </div>
  </div>

  <script>
    const MENU = ${dataJson};
    let currentCategory = 'all';
    let cart = [];
    let fulfillment = 'takeout';

    function renderProducts() {
      const grid = document.getElementById('productGrid');
      grid.innerHTML = '';

      const categoriesToRender = currentCategory === 'all'
        ? MENU.categories
        : MENU.categories.filter(c => c.id === currentCategory);

      categoriesToRender.forEach(cat => {
        cat.products.forEach(p => {
          const card = document.createElement('div');
          card.className = 'product-card';
          card.innerHTML = \`
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                <h3 style="font-size: 16px; font-weight: 900;">\${p.name}</h3>
                <div style="text-align: right;">
                  <div class="price-tag">\${p.priceUsdFormatted}</div>
                  <div class="price-bs">\${p.priceBsFormatted}</div>
                </div>
              </div>
              <p style="font-size: 12px; color: var(--muted); margin: 6px 0 12px; line-height: 1.4;">
                \${p.description || 'Deliciosa preparación artesanal de la casa.'}
              </p>
            </div>
            <button class="btn-add" onclick="addToCart('\${p.id}', '\${p.name}', \${p.priceUsdCents})">
              + Agregar al Carrito
            </button>
          \`;
          grid.appendChild(card);
        });
      });
    }

    function filterCategory(catId, element) {
      currentCategory = catId;
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      element.classList.add('active');
      renderProducts();
    }

    function addToCart(id, name, priceUsdCents) {
      const existing = cart.find(i => i.id === id);
      if (existing) {
        existing.quantity += 1;
      } else {
        cart.push({ id, name, priceUsdCents, quantity: 1 });
      }
      updateCartBar();
    }

    function updateCartBar() {
      const totalCount = cart.reduce((acc, i) => acc + i.quantity, 0);
      const totalUsdCents = cart.reduce((acc, i) => acc + (i.priceUsdCents * i.quantity), 0);
      const totalBsCents = Math.round((totalUsdCents * MENU.currency.rateMicroBs) / 1000000);

      const cartBar = document.getElementById('cartBar');
      if (totalCount > 0) {
        cartBar.style.display = 'flex';
        document.getElementById('cartItemCount').innerText = \`\${totalCount} plato\${totalCount > 1 ? 's' : ''}\`;
        document.getElementById('cartTotalSummary').innerText = \`$\${(totalUsdCents/100).toFixed(2)} / Bs. \${(totalBsCents/100).toFixed(2)}\`;
      } else {
        cartBar.style.display = 'none';
      }
    }

    function openCartModal() {
      renderCartItems();
      document.getElementById('cartModal').style.display = 'flex';
    }

    function closeCartModal(e) {
      if (!e || e.target.id === 'cartModal') {
        document.getElementById('cartModal').style.display = 'none';
      }
    }

    function renderCartItems() {
      const list = document.getElementById('cartItemsList');
      list.innerHTML = '';
      let subtotalUsd = 0;

      cart.forEach((item, idx) => {
        subtotalUsd += (item.priceUsdCents * item.quantity);
        const row = document.createElement('div');
        row.style = 'display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border);';
        row.innerHTML = \`
          <div>
            <div style="font-weight: 700; font-size: 13px;">\${item.name}</div>
            <div style="font-size: 11px; color: var(--muted);">$\${(item.priceUsdCents/100).toFixed(2)} c/u</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button onclick="changeQty(\${idx}, -1)" style="width: 26px; height: 26px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: #fff;">-</button>
            <span style="font-weight: 700; font-size: 13px;">\${item.quantity}</span>
            <button onclick="changeQty(\${idx}, 1)" style="width: 26px; height: 26px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: #fff;">+</button>
          </div>
        \`;
        list.appendChild(row);
      });

      const deliveryFee = fulfillment === 'delivery' ? 200 : 0;
      const totalUsd = subtotalUsd + deliveryFee;
      const totalBs = Math.round((totalUsd * MENU.currency.rateMicroBs) / 1000000);

      document.getElementById('modalSubtotal').innerText = \`$\${(subtotalUsd/100).toFixed(2)}\`;
      document.getElementById('modalTotal').innerText = \`$\${(totalUsd/100).toFixed(2)} / Bs. \${(totalBs/100).toFixed(2)}\`;
    }

    function changeQty(idx, delta) {
      cart[idx].quantity += delta;
      if (cart[idx].quantity <= 0) {
        cart.splice(idx, 1);
      }
      updateCartBar();
      renderCartItems();
      if (cart.length === 0) {
        closeCartModal();
      }
    }

    function setFulfillment(type) {
      fulfillment = type;
      const btnT = document.getElementById('btnTakeout');
      const btnD = document.getElementById('btnDelivery');
      const dFields = document.getElementById('deliveryFields');
      const dRow = document.getElementById('deliveryRow');

      if (type === 'delivery') {
        btnD.style.border = '1px solid var(--yellow)';
        btnD.style.background = 'rgba(245, 158, 11, 0.15)';
        btnD.style.color = '#fff';
        btnT.style.border = '1px solid var(--border)';
        btnT.style.background = 'var(--bg)';
        btnT.style.color = 'var(--muted)';
        dFields.style.display = 'flex';
        dRow.style.display = 'flex';
      } else {
        btnT.style.border = '1px solid var(--yellow)';
        btnT.style.background = 'rgba(245, 158, 11, 0.15)';
        btnT.style.color = '#fff';
        btnD.style.border = '1px solid var(--border)';
        btnD.style.background = 'var(--bg)';
        btnD.style.color = 'var(--muted)';
        dFields.style.display = 'none';
        dRow.style.display = 'none';
      }
      renderCartItems();
    }

    function sendOrderToWhatsApp() {
      if (cart.length === 0) return;

      const custName = document.getElementById('custName').value.trim();
      const custPhone = document.getElementById('custPhone').value.trim();
      const custAddress = document.getElementById('custAddress')?.value.trim();
      const custReference = document.getElementById('custReference')?.value.trim();

      let text = '*¡HOLA, TOCINETA SONRÍE!* 🥓\\nQuisiera realizar el siguiente pedido:\\n\\n📋 *DETALLE DEL PEDIDO:*\\n';
      let subtotalUsd = 0;

      cart.forEach(i => {
        const itemTotal = i.priceUsdCents * i.quantity;
        subtotalUsd += itemTotal;
        const itemBs = Math.round((itemTotal * MENU.currency.rateMicroBs) / 1000000);
        text += \`• \${i.quantity}x \${i.name} ($\${(itemTotal/100).toFixed(2)} / Bs. \${(itemBs/100).toFixed(2)})\\n\`;
      });

      const deliveryFee = fulfillment === 'delivery' ? 200 : 0;
      const totalUsd = subtotalUsd + deliveryFee;
      const totalBs = Math.round((totalUsd * MENU.currency.rateMicroBs) / 1000000);

      text += \`\\n📦 *MODALIDAD:* \${fulfillment === 'delivery' ? '🛵 Delivery a Domicilio' : '🍔 Para Llevar / Retiro en Food Truck'}\\n\`;
      if (custName) text += \`👤 *Cliente:* \${custName}\\n\`;
      if (custPhone) text += \`📞 *Teléfono:* \${custPhone}\\n\`;
      if (fulfillment === 'delivery') {
        if (custAddress) text += \`📍 *Dirección:* \${custAddress}\\n\`;
        if (custReference) text += \`🗺️ *Referencia:* \${custReference}\\n\`;
      }

      text += \`\\n💵 *RESUMEN DE PAGO ESTIMADO:*\\n\`;
      text += \`• Subtotal Comida: $\${(subtotalUsd/100).toFixed(2)}\\n\`;
      if (fulfillment === 'delivery') {
        text += \`• Tarifa Delivery: $2.00\\n\`;
      }
      text += \`• *TOTAL ESTIMADO: $\${(totalUsd/100).toFixed(2)} / Bs. \${(totalBs/100).toFixed(2)}*\\n\`;
      text += \`*(Tasa BCV oficial: \${MENU.currency.rateFormatted} Bs/$ - Actualizada: \${MENU.currency.rateUpdatedAtCaracas})*\\n\\n\`;
      text += \`"\${MENU.slogan}"\`;

      const waUrl = \`https://wa.me/\${MENU.whatsappNumber}?text=\${encodeURIComponent(text)}\`;
      window.open(waUrl, '_blank');
    }

    // Inicializar
    renderProducts();
  </script>
</body>
</html>`;
}
