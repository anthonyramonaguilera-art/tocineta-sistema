import type Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { usdToBsCents, formatMicroBsToRate } from '@tocineta/shared';
import { publishDomainEvent, getLatestEventSeq } from '../events/event-bus.js';
import { appendAuditEvent } from '../audit/audit-service.js';

export function getCurrentExchangeRate(rawDb: Database.Database): number {
  const row = rawDb.prepare(`
    SELECT rate_micro_bs 
    FROM exchange_rates 
    WHERE is_current = 1 
    ORDER BY created_at_ms DESC 
    LIMIT 1
  `).get() as { rate_micro_bs: number } | undefined;

  return row?.rate_micro_bs ?? 40_000_000; // 40.00 Bs/$ por defecto
}

/**
 * Catálogo Operativo para Comandero y Caja (GET /api/menu/pos)
 * - Solo categorías activas (is_active = 1, is_internal = 0)
 * - Precios calculados en centavos USD y centavos Bs con tasa BCV vigente
 * - Indicador de disponibilidad en tiempo real (is_available)
 * - Opciones de sabores activos (ej. 6 Pepsi) y modificadores de Barra Libre
 */
export function getPosMenu(rawDb: Database.Database) {
  const rateMicroBs = getCurrentExchangeRate(rawDb);
  const formattedRate = formatMicroBsToRate(rateMicroBs);
  const latestSeq = getLatestEventSeq(rawDb);

  // 1. Categorías públicas activas
  const categoriesRows = rawDb.prepare(`
    SELECT id, name, description, display_order, station
    FROM categories
    WHERE is_active = 1 AND is_internal = 0
    ORDER BY display_order ASC
  `).all() as Array<{
    id: string;
    name: string;
    description: string | null;
    display_order: number;
    station: string;
  }>;

  // 2. Productos activos vinculados a categorías activas
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

  // 3. Sabores activos de productos
  const flavorRows = rawDb.prepare(`
    SELECT id, product_id, flavor_name, is_available, display_order
    FROM product_flavor_options
    WHERE is_active = 1
    ORDER BY display_order ASC
  `).all() as Array<{
    id: string;
    product_id: string;
    flavor_name: string;
    is_available: number;
    display_order: number;
  }>;

  const flavorsByProduct = new Map<string, Array<{ id: string; flavorName: string; isAvailable: boolean }>>();
  for (const f of flavorRows) {
    const list = flavorsByProduct.get(f.product_id) || [];
    list.push({
      id: f.id,
      flavorName: f.flavor_name,
      isAvailable: Boolean(f.is_available)
    });
    flavorsByProduct.set(f.product_id, list);
  }

  // 4. Ingredientes base de productos (removibles: "Sin Salsa de Ajo", "Sin Pan", etc.)
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

  const baseIngredientsByProduct = new Map<string, Array<{ id: string; name: string; isRemovable: boolean; defaultState: 'normal' }>>();
  for (const pi of prodIngRows) {
    const list = baseIngredientsByProduct.get(pi.product_id) || [];
    list.push({
      id: pi.ingredient_id,
      name: pi.ingredient_name,
      isRemovable: Boolean(pi.is_removable),
      defaultState: 'normal'
    });
    baseIngredientsByProduct.set(pi.product_id, list);
  }

  // Estructurar productos dentro de sus categorías
  const categories = categoriesRows.map(cat => {
    const catProducts = productRows
      .filter(p => p.category_id === cat.id)
      .map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        priceUsdCents: p.price_usd_cents,
        priceBsCents: usdToBsCents(p.price_usd_cents, rateMicroBs),
        station: p.station,
        isAvailable: Boolean(p.is_available),
        isCombo: Boolean(p.is_combo),
        allowsFlavors: Boolean(p.allows_flavors),
        imageUrl: p.image_url,
        flavors: flavorsByProduct.get(p.id) || [],
        baseIngredients: baseIngredientsByProduct.get(p.id) || []
      }));

    return {
      id: cat.id,
      name: cat.name,
      description: cat.description,
      displayOrder: cat.display_order,
      station: cat.station,
      products: catProducts
    };
  });

  // 5. Ingredientes de Barra Libre ($0.00 venta)
  const barraLibreRows = rawDb.prepare(`
    SELECT id, name
    FROM ingredients
    WHERE is_barra_libre = 1 AND is_active = 1
    ORDER BY name ASC
  `).all() as Array<{ id: string; name: string }>;

  const barraLibreIngredients = barraLibreRows.map(b => ({
    id: b.id,
    name: b.name,
    priceUsdCents: 0,
    priceBsCents: 0
  }));

  // 6. Configuración de combos con sus slots y opciones elegibles
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
    SELECT 
      cso.slot_id, cso.product_id, p.name as product_name,
      p.is_available, cso.default_selected
    FROM combo_slot_options cso
    JOIN products p ON cso.product_id = p.id
    WHERE p.is_active = 1
    ORDER BY p.name ASC
  `).all() as Array<{
    slot_id: string;
    product_id: string;
    product_name: string;
    is_available: number;
    default_selected: number;
  }>;

  const optionsBySlot = new Map<string, Array<{ productId: string; productName: string; isAvailable: boolean; defaultSelected: boolean }>>();
  for (const opt of optionRows) {
    const list = optionsBySlot.get(opt.slot_id) || [];
    list.push({
      productId: opt.product_id,
      productName: opt.product_name,
      isAvailable: Boolean(opt.is_available),
      defaultSelected: Boolean(opt.default_selected)
    });
    optionsBySlot.set(opt.slot_id, list);
  }

  const slotsByCombo = new Map<string, Array<any>>();
  for (const slot of slotRows) {
    const list = slotsByCombo.get(slot.combo_id) || [];
    list.push({
      id: slot.id,
      slotNumber: slot.slot_number,
      slotName: slot.slot_name,
      requiredStation: slot.required_station,
      options: optionsBySlot.get(slot.id) || []
    });
    slotsByCombo.set(slot.combo_id, list);
  }

  const combos = comboRows.map(c => ({
    id: c.id,
    name: c.name,
    comboPriceUsdCents: c.combo_price_usd_cents,
    comboPriceBsCents: usdToBsCents(c.combo_price_usd_cents, rateMicroBs),
    description: c.description,
    slots: slotsByCombo.get(c.id) || []
  }));

  // 7. Zonas rápidas de Delivery desde business_settings
  const settingsRow = rawDb.prepare(`
    SELECT delivery_accounting_mode, delivery_quick_tiers_json
    FROM business_settings
    WHERE id = 'default'
  `).get() as { delivery_accounting_mode: string; delivery_quick_tiers_json: string } | undefined;

  let deliveryQuickTiers: Array<{ usdCents: number; bsCents: number; label: string }> = [];
  try {
    const tiers = JSON.parse(settingsRow?.delivery_quick_tiers_json || '[200, 300, 400, 500]') as number[];
    deliveryQuickTiers = tiers.map(cents => ({
      usdCents: cents,
      bsCents: usdToBsCents(cents, rateMicroBs),
      label: `$${(cents / 100).toFixed(2)}`
    }));
  } catch {}

  return {
    success: true,
    rateMicroBs,
    formattedRate,
    latestSeq,
    categories,
    barraLibreIngredients,
    globalModifiers: ['Poca Salsa', 'Sin Salsas', 'Sin Pan / Envuelta en Lechuga'],
    deliveryQuickTiers,
    combos
  };
}

/**
 * Catálogo Completo para Administradora (GET /api/menu/admin)
 */
export function getAdminMenu(rawDb: Database.Database) {
  const rateMicroBs = getCurrentExchangeRate(rawDb);
  const formattedRate = formatMicroBsToRate(rateMicroBs);
  const latestSeq = getLatestEventSeq(rawDb);

  const categories = rawDb.prepare(`
    SELECT id, name, description, display_order, is_active, is_internal, station
    FROM categories
    ORDER BY display_order ASC
  `).all();

  const products = rawDb.prepare(`
    SELECT 
      id, category_id, name, description, price_usd_cents, estimated_cost_usd_cents,
      station, is_active, is_available, is_combo, allows_flavors, image_url, updated_at_ms
    FROM products
    ORDER BY name ASC
  `).all() as any[];

  const formattedProducts = products.map(p => ({
    ...p,
    isActive: Boolean(p.is_active),
    isAvailable: Boolean(p.is_available),
    isCombo: Boolean(p.is_combo),
    allowsFlavors: Boolean(p.allows_flavors),
    priceBsCents: usdToBsCents(p.price_usd_cents, rateMicroBs)
  }));

  const ingredients = rawDb.prepare(`
    SELECT id, name, is_barra_libre, extra_price_usd_cents, internal_cost_usd_cents, is_active
    FROM ingredients
    ORDER BY name ASC
  `).all() as any[];

  const flavors = rawDb.prepare(`
    SELECT id, product_id, flavor_name, is_active, is_available, display_order
    FROM product_flavor_options
    ORDER BY product_id, display_order ASC
  `).all() as any[];

  const coupons = rawDb.prepare(`
    SELECT * FROM coupons ORDER BY created_at_ms DESC
  `).all() as any[];

  const businessSettings = rawDb.prepare(`
    SELECT * FROM business_settings WHERE id = 'default'
  `).get() as any;

  return {
    success: true,
    rateMicroBs,
    formattedRate,
    latestSeq,
    categories,
    products: formattedProducts,
    ingredients,
    flavors,
    coupons,
    businessSettings
  };
}

/**
 * Conmutar Feature Flag de Categoría (ej. Malteadas y Helados)
 */
export function toggleCategoryActive(
  rawDb: Database.Database,
  categoryId: string,
  actorUserId: string
): { categoryId: string; isActive: boolean } {
  const cat = rawDb.prepare('SELECT id, name, is_active FROM categories WHERE id = ?').get(categoryId) as {
    id: string;
    name: string;
    is_active: number;
  } | undefined;

  if (!cat) {
    throw new Error(`Categoría '${categoryId}' no encontrada`);
  }

  const newActive = cat.is_active === 1 ? 0 : 1;
  rawDb.prepare('UPDATE categories SET is_active = ? WHERE id = ?').run(newActive, categoryId);

  appendAuditEvent(rawDb, {
    actorUserId,
    action: 'CATEGORY_TOGGLE_ACTIVE',
    entityType: 'category',
    entityId: categoryId,
    payload: { categoryName: cat.name, previousActive: cat.is_active, newActive }
  });

  publishDomainEvent(rawDb, {
    eventType: 'MENU_CATEGORY_TOGGLED',
    entityId: categoryId,
    payload: { categoryId, categoryName: cat.name, isActive: Boolean(newActive) }
  });

  return { categoryId, isActive: Boolean(newActive) };
}

/**
 * Conmutar Disponibilidad de Producto (Agotado / Disponible)
 */
export function setProductAvailability(
  rawDb: Database.Database,
  productId: string,
  isAvailable: boolean,
  actorUserId: string
): { productId: string; isAvailable: boolean } {
  const prod = rawDb.prepare('SELECT id, name, is_available FROM products WHERE id = ?').get(productId) as {
    id: string;
    name: string;
    is_available: number;
  } | undefined;

  if (!prod) {
    throw new Error(`Producto '${productId}' no encontrado`);
  }

  const val = isAvailable ? 1 : 0;
  rawDb.prepare('UPDATE products SET is_available = ?, updated_at_ms = ? WHERE id = ?').run(val, Date.now(), productId);

  appendAuditEvent(rawDb, {
    actorUserId,
    action: 'PRODUCT_AVAILABILITY_CHANGED',
    entityType: 'product',
    entityId: productId,
    payload: { productName: prod.name, isAvailable }
  });

  publishDomainEvent(rawDb, {
    eventType: 'PRODUCT_AVAILABILITY_CHANGED',
    entityId: productId,
    payload: { productId, productName: prod.name, isAvailable }
  });

  return { productId, isAvailable };
}

/**
 * Conmutar Disponibilidad de Sabor (ej. Sabor Pepsi Agotado)
 */
export function setFlavorAvailability(
  rawDb: Database.Database,
  flavorId: string,
  isAvailable: boolean,
  actorUserId: string
): { flavorId: string; isAvailable: boolean } {
  const flav = rawDb.prepare('SELECT id, product_id, flavor_name, is_available FROM product_flavor_options WHERE id = ?').get(flavorId) as {
    id: string;
    product_id: string;
    flavor_name: string;
    is_available: number;
  } | undefined;

  if (!flav) {
    throw new Error(`Sabor '${flavorId}' no encontrado`);
  }

  const val = isAvailable ? 1 : 0;
  rawDb.prepare('UPDATE product_flavor_options SET is_available = ? WHERE id = ?').run(val, flavorId);

  appendAuditEvent(rawDb, {
    actorUserId,
    action: 'FLAVOR_AVAILABILITY_CHANGED',
    entityType: 'product_flavor',
    entityId: flavorId,
    payload: { productId: flav.product_id, flavorName: flav.flavor_name, isAvailable }
  });

  publishDomainEvent(rawDb, {
    eventType: 'FLAVOR_AVAILABILITY_CHANGED',
    entityId: flavorId,
    payload: { flavorId, productId: flav.product_id, flavorName: flav.flavor_name, isAvailable }
  });

  return { flavorId, isAvailable };
}

/**
 * Crear un nuevo producto en el catálogo
 */
export function createProduct(
  rawDb: Database.Database,
  data: {
    id?: string;
    categoryId: string;
    name: string;
    priceUsdCents: number;
    estimatedCostUsdCents?: number;
    station: 'hot_dogs' | 'hamburguesas' | 'caja_bebidas';
    description?: string;
    allowsFlavors?: boolean;
    isCombo?: boolean;
    baseIngredientIds?: string[];
  },
  actorUserId: string
) {
  const productId = data.id || `prod_${data.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
  const now = Date.now();

  rawDb.prepare(`
    INSERT INTO products (
      id, category_id, name, description, price_usd_cents, estimated_cost_usd_cents,
      station, is_active, is_available, is_combo, allows_flavors, image_url, created_at_ms, updated_at_ms
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, 1, 1, ?, ?, NULL, ?, ?
    )
  `).run(
    productId,
    data.categoryId,
    data.name.trim(),
    data.description || null,
    data.priceUsdCents,
    data.estimatedCostUsdCents || 0,
    data.station,
    data.isCombo ? 1 : 0,
    data.allowsFlavors ? 1 : 0,
    now,
    now
  );

  // Vincular ingredientes base si fueron especificados
  if (data.baseIngredientIds && data.baseIngredientIds.length > 0) {
    const insertPI = rawDb.prepare(`
      INSERT OR REPLACE INTO product_ingredients (id, product_id, ingredient_id, is_removable, display_order)
      VALUES (?, ?, ?, 1, ?)
    `);
    for (let i = 0; i < data.baseIngredientIds.length; i++) {
      insertPI.run(`pi_${productId}_${i}`, productId, data.baseIngredientIds[i], i + 1);
    }
  }

  appendAuditEvent(rawDb, {
    actorUserId,
    action: 'PRODUCT_CREATED',
    entityType: 'product',
    entityId: productId,
    payload: { name: data.name, priceUsdCents: data.priceUsdCents, categoryId: data.categoryId }
  });

  publishDomainEvent(rawDb, {
    eventType: 'PRODUCT_CREATED',
    entityId: productId,
    payload: { productId, name: data.name, priceUsdCents: data.priceUsdCents }
  });

  return { id: productId, ...data };
}

/**
 * Actualizar producto del catálogo (Nombre, precio, estación, costo)
 * REGLA DE INTEGRIDAD: No altera las líneas de órdenes pasadas (order_lines)
 */
export function updateProduct(
  rawDb: Database.Database,
  productId: string,
  data: {
    name?: string;
    description?: string;
    priceUsdCents?: number;
    estimatedCostUsdCents?: number;
    station?: 'hot_dogs' | 'hamburguesas' | 'caja_bebidas';
    isActive?: boolean;
  },
  actorUserId: string
) {
  const current = rawDb.prepare('SELECT * FROM products WHERE id = ?').get(productId) as any;
  if (!current) {
    throw new Error(`Producto '${productId}' no encontrado`);
  }

  const name = data.name !== undefined ? data.name.trim() : current.name;
  const description = data.description !== undefined ? data.description : current.description;
  const priceUsdCents = data.priceUsdCents !== undefined ? data.priceUsdCents : current.price_usd_cents;
  const estimatedCostUsdCents = data.estimatedCostUsdCents !== undefined ? data.estimatedCostUsdCents : current.estimated_cost_usd_cents;
  const station = data.station !== undefined ? data.station : current.station;
  const isActive = data.isActive !== undefined ? (data.isActive ? 1 : 0) : current.is_active;
  const now = Date.now();

  rawDb.prepare(`
    UPDATE products
    SET name = ?, description = ?, price_usd_cents = ?, estimated_cost_usd_cents = ?,
        station = ?, is_active = ?, updated_at_ms = ?
    WHERE id = ?
  `).run(name, description, priceUsdCents, estimatedCostUsdCents, station, isActive, now, productId);

  appendAuditEvent(rawDb, {
    actorUserId,
    action: 'PRODUCT_UPDATED',
    entityType: 'product',
    entityId: productId,
    payload: { previous: { name: current.name, priceUsdCents: current.price_usd_cents }, updated: { name, priceUsdCents } }
  });

  publishDomainEvent(rawDb, {
    eventType: 'PRODUCT_UPDATED',
    entityId: productId,
    payload: { productId, name, priceUsdCents }
  });

  return { id: productId, name, priceUsdCents, isActive: Boolean(isActive) };
}

/**
 * Subida Local de Fotografía para Producto
 * Valida formato (PNG/JPG/WEBP), tamaño máx 2MB y guarda en data/uploads/
 */
export function saveProductPhoto(
  rawDb: Database.Database,
  productId: string,
  base64Payload: string,
  actorUserId: string,
  uploadsDir?: string
): { imageUrl: string } {
  const prod = rawDb.prepare('SELECT id, name FROM products WHERE id = ?').get(productId) as { id: string; name: string } | undefined;
  if (!prod) {
    throw new Error(`Producto '${productId}' no encontrado`);
  }

  // Detectar cabecera Data URL o base64 puro
  let mimeType = 'image/jpeg';
  let cleanBase64 = base64Payload;

  const dataUrlMatch = base64Payload.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (dataUrlMatch) {
    mimeType = dataUrlMatch[1];
    cleanBase64 = dataUrlMatch[2];
  }

  let ext = 'jpg';
  if (mimeType.includes('png')) ext = 'png';
  else if (mimeType.includes('webp')) ext = 'webp';
  else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
  else {
    throw new Error('Formato de imagen no soportado. Debe ser JPG, PNG o WEBP.');
  }

  const buffer = Buffer.from(cleanBase64, 'base64');
  if (buffer.length > 2 * 1024 * 1024) {
    throw new Error('El archivo excede el tamaño máximo permitido de 2 MB.');
  }

  const targetDir = uploadsDir || path.resolve(process.cwd(), 'data/uploads');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const filename = `${productId}-${Date.now()}.${ext}`;
  const filePath = path.join(targetDir, filename);
  fs.writeFileSync(filePath, buffer);

  const imageUrl = `/uploads/${filename}`;
  rawDb.prepare('UPDATE products SET image_url = ?, updated_at_ms = ? WHERE id = ?').run(imageUrl, Date.now(), productId);

  appendAuditEvent(rawDb, {
    actorUserId,
    action: 'PRODUCT_PHOTO_UPLOADED',
    entityType: 'product',
    entityId: productId,
    payload: { imageUrl }
  });

  publishDomainEvent(rawDb, {
    eventType: 'PRODUCT_PHOTO_UPDATED',
    entityId: productId,
    payload: { productId, imageUrl }
  });

  return { imageUrl };
}

/**
 * Actualizar la tasa oficial BCV
 */
export function setExchangeRate(
  rawDb: Database.Database,
  rateMicroBs: number,
  actorUserId: string,
  source: 'MANUAL_ADMIN' | 'MANUAL_SUPERVISOR' = 'MANUAL_ADMIN'
) {
  if (!Number.isSafeInteger(rateMicroBs) || rateMicroBs <= 0) {
    throw new Error('Tasa en micro-Bs inválida');
  }

  const now = Date.now();
  const newRateId = `rate_${now}`;

  const setTx = rawDb.transaction(() => {
    rawDb.prepare('UPDATE exchange_rates SET is_current = 0').run();
    rawDb.prepare(`
      INSERT INTO exchange_rates (id, rate_micro_bs, source, set_by_user_id, created_at_ms, is_current)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(newRateId, rateMicroBs, source, actorUserId, now);

    appendAuditEvent(rawDb, {
      actorUserId,
      action: 'EXCHANGE_RATE_UPDATED',
      entityType: 'exchange_rate',
      entityId: newRateId,
      payload: { rateMicroBs, formattedRate: formatMicroBsToRate(rateMicroBs), source }
    });

    publishDomainEvent(rawDb, {
      eventType: 'EXCHANGE_RATE_UPDATED',
      entityId: newRateId,
      payload: { rateMicroBs, formattedRate: formatMicroBsToRate(rateMicroBs) }
    });
  });

  setTx();

  return {
    id: newRateId,
    rateMicroBs,
    formattedRate: formatMicroBsToRate(rateMicroBs)
  };
}
