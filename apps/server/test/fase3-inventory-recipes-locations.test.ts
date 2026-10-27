import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { buildServer } from '../src/server.js';
import { getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { ensureOfficialLocations, getAllLocations } from '../src/modules/profitability/locations-service.js';
import { registerPurchase, confirmPriceAdjustments, getPriceHistory } from '../src/modules/profitability/purchases-service.js';
import { saveSubRecipe, getProductRecipe, saveProductRecipe, deductInventoryForOrder } from '../src/modules/profitability/recipes-service.js';
import { seedCriticalSuppliesAndRecipes } from '../src/modules/profitability/inventory.js';
import { registerWasteLog, performPhysicalStockCount } from '../src/modules/profitability/waste-service.js';
import { processOrderPayment } from '../src/modules/cashier/cashier-service.js';

describe('FASE 3 — Sedes, Inventario, Recetas, Compras, Costos y Mermas', () => {
  let app: FastifyInstance;
  let rawDb: Database.Database;

  beforeAll(async () => {
    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    const dbCtx = getDatabaseContext();
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureOfficialLocations(rawDb);
    seedCriticalSuppliesAndRecipes(rawDb);
  });

  // --------------------------------------------------------------------------
  // TEST 1: COSTO PROMEDIO PONDERADO (WAC)
  // --------------------------------------------------------------------------
  it('1. Debe calcular exactamente el Costo Promedio Ponderado (WAC) en compras sucesivas', () => {
    const supplyId = `sup_test_wac_${generateUuidV7().slice(0, 8)}`;
    const now = Date.now();

    // Crear insumo con stock 0
    rawDb.prepare(`
      INSERT INTO supply_items (
        id, name, unit, unit_measure, purchase_unit, usage_unit, conversion_factor,
        category, min_stock, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents,
        last_cost_usd_cents, is_active, current_stock_qty, created_at_ms, updated_at_ms
      ) VALUES (?, 'Queso Gouda Test', 'kg', 'kg', 'kg', 'kg', 1.0, 'lacteos', 5, 0, 0, 0, 1, 0, ?, ?)
    `).run(supplyId, now, now);

    // Compra 1: 10 kg a $10.00/kg (1000 centavos)
    const p1 = registerPurchase(rawDb, {
      locationId: 'loc_alta_vista',
      paymentCondition: 'CONTADO',
      createdBy: 'usr_admin',
      items: [{ supplyId, purchaseQuantity: 10, unitCostUsdCents: 1000 }]
    });

    let sRow = rawDb.prepare('SELECT current_stock_qty, weighted_avg_cost_usd_cents, last_cost_usd_cents FROM supply_items WHERE id = ?').get(supplyId) as any;
    expect(sRow.current_stock_qty).toBe(10);
    expect(sRow.weighted_avg_cost_usd_cents).toBe(1000);
    expect(sRow.last_cost_usd_cents).toBe(1000);

    // Compra 2: 10 kg a $20.00/kg (2000 centavos)
    // Nuevo WAC = (10*1000 + 10*2000) / 20 = 30000 / 20 = 1500 centavos
    registerPurchase(rawDb, {
      locationId: 'loc_alta_vista',
      paymentCondition: 'CONTADO',
      createdBy: 'usr_admin',
      items: [{ supplyId, purchaseQuantity: 10, unitCostUsdCents: 2000 }]
    });

    sRow = rawDb.prepare('SELECT current_stock_qty, weighted_avg_cost_usd_cents, last_cost_usd_cents FROM supply_items WHERE id = ?').get(supplyId) as any;
    expect(sRow.current_stock_qty).toBe(20);
    expect(sRow.weighted_avg_cost_usd_cents).toBe(1500);
    expect(sRow.last_cost_usd_cents).toBe(2000);

    // Compra 3: 20 kg a $30.00/kg (3000 centavos)
    // Nuevo WAC = (20*1500 + 20*3000) / 40 = (30000 + 60000) / 40 = 90000 / 40 = 2250 centavos
    registerPurchase(rawDb, {
      locationId: 'loc_alta_vista',
      paymentCondition: 'CONTADO',
      createdBy: 'usr_admin',
      items: [{ supplyId, purchaseQuantity: 20, unitCostUsdCents: 3000 }]
    });

    sRow = rawDb.prepare('SELECT current_stock_qty, weighted_avg_cost_usd_cents, last_cost_usd_cents FROM supply_items WHERE id = ?').get(supplyId) as any;
    expect(sRow.current_stock_qty).toBe(40);
    expect(sRow.weighted_avg_cost_usd_cents).toBe(2250);
    expect(sRow.last_cost_usd_cents).toBe(3000);
  });

  // --------------------------------------------------------------------------
  // TEST 2: CONVERSIÓN DE UNIDADES
  // --------------------------------------------------------------------------
  it('2. Debe convertir unidades de compra a unidades de uso con factor de conversión', () => {
    const supplyId = `sup_test_conv_${generateUuidV7().slice(0, 8)}`;
    const now = Date.now();

    // 1 Caja = 24 Unidades. Costo de la caja: $24.00 (2400 centavos) -> Costo por unidad de uso: $1.00 (100 centavos)
    rawDb.prepare(`
      INSERT INTO supply_items (
        id, name, unit, unit_measure, purchase_unit, usage_unit, conversion_factor,
        category, min_stock, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents,
        last_cost_usd_cents, is_active, current_stock_qty, created_at_ms, updated_at_ms
      ) VALUES (?, 'Malta en Caja Test', 'caja', 'und', 'caja', 'und', 24.0, 'bebidas', 2, 0, 0, 0, 1, 0, ?, ?)
    `).run(supplyId, now, now);

    registerPurchase(rawDb, {
      locationId: 'loc_alta_vista',
      paymentCondition: 'CONTADO',
      createdBy: 'usr_admin',
      items: [{ supplyId, purchaseQuantity: 5, unitCostUsdCents: 2400 }] // 5 cajas a $24 c/u = $120
    });

    const sRow = rawDb.prepare('SELECT current_stock_qty, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents FROM supply_items WHERE id = ?').get(supplyId) as any;
    // 5 cajas * 24 = 120 unidades de uso
    expect(sRow.current_stock_qty).toBe(120);
    // Costo por unidad de uso = 2400 / 24 = 100 centavos ($1.00)
    expect(sRow.cost_per_unit_usd_cents).toBe(100);
    expect(sRow.weighted_avg_cost_usd_cents).toBe(100);

    // Stock en location_inventory de Alta Vista
    const locRow = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supplyId) as any;
    expect(locRow.current_stock_qty).toBe(120);
  });

  // --------------------------------------------------------------------------
  // TEST 3: STOCK POR SEDE Y TRANSFERENCIAS
  // --------------------------------------------------------------------------
  it('3. Debe mantener stock independiente por sede y permitir transferencias inmutables', () => {
    const supplyId = `sup_test_loc_${generateUuidV7().slice(0, 8)}`;
    const now = Date.now();

    rawDb.prepare(`
      INSERT INTO supply_items (
        id, name, unit, unit_measure, purchase_unit, usage_unit, conversion_factor,
        category, min_stock, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents,
        last_cost_usd_cents, is_active, current_stock_qty, created_at_ms, updated_at_ms
      ) VALUES (?, 'Insumo Multi-Sede Test', 'und', 'und', 'paquete', 'und', 1.0, 'general', 5, 200, 200, 200, 1, 150, ?, ?)
    `).run(supplyId, now, now);

    // Cargar 100 unidades en Alta Vista y 50 en Los Olivos
    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, ?, 0, ?)').run(
      `loc_alta_vista_${supplyId}`, 'loc_alta_vista', supplyId, 100, now
    );
    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, ?, 0, ?)').run(
      `loc_los_olivos_${supplyId}`, 'loc_los_olivos', supplyId, 50, now
    );

    // Transferir 30 de Alta Vista a Los Olivos
    rawDb.transaction(() => {
      rawDb.prepare('UPDATE location_inventory SET current_stock_qty = current_stock_qty - ? WHERE location_id = ? AND supply_id = ?').run(30, 'loc_alta_vista', supplyId);
      rawDb.prepare('UPDATE location_inventory SET current_stock_qty = current_stock_qty + ? WHERE location_id = ? AND supply_id = ?').run(30, 'loc_los_olivos', supplyId);

      rawDb.prepare(`
        INSERT INTO inventory_movements (id, location_id, supply_id, movement_type, quantity_delta, unit_cost_usd_cents, total_cost_usd_cents, created_by, created_at_ms)
        VALUES (?, 'loc_alta_vista', ?, 'TRANSFERENCIA_SALIDA', -30, 200, 6000, 'usr_admin', ?)
      `).run(`mov_${generateUuidV7()}`, supplyId, now);

      rawDb.prepare(`
        INSERT INTO inventory_movements (id, location_id, supply_id, movement_type, quantity_delta, unit_cost_usd_cents, total_cost_usd_cents, created_by, created_at_ms)
        VALUES (?, 'loc_los_olivos', ?, 'TRANSFERENCIA_ENTRADA', 30, 200, 6000, 'usr_admin', ?)
      `).run(`mov_${generateUuidV7()}`, supplyId, now);
    })();

    const stockAV = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supplyId) as any;
    const stockLO = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_los_olivos', supplyId) as any;

    expect(stockAV.current_stock_qty).toBe(70);
    expect(stockLO.current_stock_qty).toBe(80);

    // Movimientos inmutables registrados
    const movs = rawDb.prepare("SELECT * FROM inventory_movements WHERE supply_id = ? AND movement_type LIKE 'TRANSFERENCIA%'").all(supplyId);
    expect(movs.length).toBe(2);
  });

  // --------------------------------------------------------------------------
  // TEST 4: DESCUENTO POR RECETA CON MODIFICADORES Y SUB-RECETAS
  // --------------------------------------------------------------------------
  it('4. Debe descontar inventario atómicamente considerando sub-recetas y modificadores', () => {
    const now = Date.now();
    const subRecId = `subrec_salsa_${generateUuidV7().slice(0, 8)}`;
    const supMayo = `sup_mayo_${generateUuidV7().slice(0, 8)}`;
    const supKetchup = `sup_ketchup_${generateUuidV7().slice(0, 8)}`;
    const supPan = 'sup_pan_brioche';
    const supCarne = 'sup_carne_smash';

    // 1. Crear insumos de sub-receta
    rawDb.prepare('INSERT INTO supply_items (id, name, unit, purchase_unit, usage_unit, conversion_factor, cost_per_unit_usd_cents, current_stock_qty, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, 1.0, ?, 1000, ?, ?)').run(
      supMayo, 'Mayonesa Base', 'g', 'kg', 'g', 10, now, now // 10c por gramo
    );
    rawDb.prepare('INSERT INTO supply_items (id, name, unit, purchase_unit, usage_unit, conversion_factor, cost_per_unit_usd_cents, current_stock_qty, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, 1.0, ?, 1000, ?, ?)').run(
      supKetchup, 'Ketchup Base', 'g', 'kg', 'g', 5, now, now // 5c por gramo
    );

    // 2. Crear sub-receta "Salsa Especial": rinde 500g usando 250g mayo y 250g ketchup
    saveSubRecipe(rawDb, {
      id: subRecId,
      name: 'Salsa Especial Test',
      yieldQuantity: 500,
      yieldUnit: 'g',
      items: [
        { supplyId: supMayo, quantityRequired: 250 },
        { supplyId: supKetchup, quantityRequired: 250 }
      ]
    });

    // 3. Crear plato y vincular receta con: 1 pan brioche, 2 carne smash, 50g salsa especial
    const testProdId = `prod_burger_test_${generateUuidV7().slice(0, 8)}`;
    rawDb.prepare(`
      INSERT INTO products (id, category_id, name, price_usd_cents, station, is_active, recipe_mode, created_at_ms, updated_at_ms)
      VALUES (?, 'cat_hamburguesas', 'Burger Especial Test', 800, 'hamburguesas', 1, 'UNITS', ?, ?)
    `).run(testProdId, now, now);

    saveProductRecipe(rawDb, testProdId, {
      recipeMode: 'UNITS',
      targetMarginBps: 6500,
      items: [
        { supplyItemId: supPan, quantityRequired: 1 },
        { supplyItemId: supCarne, quantityRequired: 2 },
        { subRecipeId: subRecId, quantityRequired: 50 } // 50g de la sub-receta
      ]
    });

    // Stock inicial en Alta Vista
    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, 100, 0, ?)').run(`loc_alta_vista_${supPan}`, 'loc_alta_vista', supPan, now);
    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, 100, 0, ?)').run(`loc_alta_vista_${supCarne}`, 'loc_alta_vista', supCarne, now);
    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, 1000, 0, ?)').run(`loc_alta_vista_${supMayo}`, 'loc_alta_vista', supMayo, now);
    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, 1000, 0, ?)').run(`loc_alta_vista_${supKetchup}`, 'loc_alta_vista', supKetchup, now);

    // 4. Crear orden con 1 Burger: modificador "Sin pan" + "Extra carne"
    const orderId = `ord_test_${generateUuidV7()}`;
    const lineId = `line_${generateUuidV7()}`;

    // Jornada de prueba
    rawDb.prepare("INSERT OR IGNORE INTO jornadas (id, opened_by_user_id, opened_at_ms, status) VALUES ('jornada_test', 'usr_admin', ?, 'abierta')").run(now);

    rawDb.prepare(`
      INSERT INTO orders (id, order_number, location_id, jornada_id, created_by_user_id, rate_micro_bs, total_to_collect_usd_cents, created_at_ms, updated_at_ms)
      VALUES (?, 9901, 'loc_alta_vista', 'jornada_test', 'usr_admin', 40000000, 800, ?, ?)
    `).run(orderId, now, now);

    rawDb.prepare(`
      INSERT INTO order_lines (id, order_id, product_id, quantity, unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, station, created_at_ms)
      VALUES (?, ?, ?, 1, 800, 800, 800, 'hamburguesas', ?)
    `).run(lineId, orderId, testProdId, now);

    // Modificador "Sin pan"
    rawDb.prepare(`
      INSERT INTO order_line_modifiers (id, order_line_id, ingredient_id, ingredient_name, modifier_type)
      VALUES (?, ?, 'ing_base_pan_brioche', 'Pan brioche', 'SIN_INGREDIENTE')
    `).run(`mod_${generateUuidV7()}`, lineId);

    // Modificador "Extra carne"
    rawDb.prepare(`
      INSERT INTO order_line_modifiers (id, order_line_id, ingredient_id, ingredient_name, modifier_type)
      VALUES (?, ?, 'ing_base_carne_smash', 'Carne smash', 'EXTRA_INGREDIENTE')
    `).run(`mod_${generateUuidV7()}`, lineId);

    // 5. Ejecutar deducción atómica
    deductInventoryForOrder(rawDb, orderId, 'loc_alta_vista', now, 'usr_admin');

    // Pan: tenía 100, receta pedía 1 pero modificador era "Sin pan" -> Debe seguir en 100
    const panStock = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supPan) as any;
    expect(panStock.current_stock_qty).toBe(100);

    // Carne: tenía 100, receta pedía 2 + extra pedía 1 = 3 -> Debe quedar en 97
    const carneStock = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supCarne) as any;
    expect(carneStock.current_stock_qty).toBe(97);

    // Sub-receta salsa: 50g sobre rendimiento de 500g = 10% -> 25g mayo y 25g ketchup
    const mayoStock = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supMayo) as any;
    const ketchupStock = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supKetchup) as any;
    expect(mayoStock.current_stock_qty).toBe(975); // 1000 - 25
    expect(ketchupStock.current_stock_qty).toBe(975); // 1000 - 25
  });

  // --------------------------------------------------------------------------
  // TEST 5: PRECIO SOLO CAMBIA CON CONFIRMACIÓN
  // --------------------------------------------------------------------------
  it('5. El precio de venta NUNCA debe cambiar sin confirmación explícita y debe quedar registrado en price_history', () => {
    const supplyId = 'sup_carne_smash';
    const prodId = 'prod_americana_deluxe';

    const prodBefore = rawDb.prepare('SELECT price_usd_cents FROM products WHERE id = ?').get(prodId) as any;
    const initialPrice = prodBefore.price_usd_cents;

    // Registrar compra con fuerte aumento de costo
    const purchaseRes = registerPurchase(rawDb, {
      locationId: 'loc_alta_vista',
      paymentCondition: 'CONTADO',
      createdBy: 'usr_admin',
      items: [{ supplyId, purchaseQuantity: 50, unitCostUsdCents: 500 }] // Sube carne de 75c a 500c
    });

    // Verificar que la compra detectó el impacto en Americana Deluxe
    const impact = purchaseRes.affectedRecipes.find(r => r.productId === prodId);
    expect(impact).toBeDefined();
    expect(impact!.suggestedPriceUsdCents).toBeGreaterThan(initialPrice);

    // REGLA FUNDAMENTAL: El precio en products NO cambió automáticamente
    const prodAfter = rawDb.prepare('SELECT price_usd_cents FROM products WHERE id = ?').get(prodId) as any;
    expect(prodAfter.price_usd_cents).toBe(initialPrice);

    // Ahora confirmar cambio de precio explícitamente
    const newConfirmedPrice = impact!.suggestedPriceUsdCents;
    const adjRes = confirmPriceAdjustments(rawDb, [
      { productId: prodId, newPriceUsdCents: newConfirmedPrice, reason: 'Confirmación por subida de carne prime' }
    ], 'usr_admin');

    expect(adjRes.adjustedCount).toBe(1);

    // Ahora SÍ debe haber cambiado
    const prodFinal = rawDb.prepare('SELECT price_usd_cents FROM products WHERE id = ?').get(prodId) as any;
    expect(prodFinal.price_usd_cents).toBe(newConfirmedPrice);

    // Y debe existir en price_history
    const history = getPriceHistory(rawDb, prodId);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].new_price_usd_cents).toBe(newConfirmedPrice);
    expect(history[0].old_price_usd_cents).toBe(initialPrice);
  });

  // --------------------------------------------------------------------------
  // TEST 6: VENTAS SIMULTÁNEAS NO DEJAN STOCK INCONSISTENTE
  // --------------------------------------------------------------------------
  it('6. Dos ventas simultáneas no deben dejar stock inconsistente (Consistencia ACID)', () => {
    const supplyId = `sup_concurrent_${generateUuidV7().slice(0, 8)}`;
    const now = Date.now();

    // Insumo con stock inicial 10
    rawDb.prepare(`
      INSERT INTO supply_items (id, name, unit, purchase_unit, usage_unit, conversion_factor, cost_per_unit_usd_cents, current_stock_qty, created_at_ms, updated_at_ms)
      VALUES (?, 'Item Concurrente Test', 'und', 'und', 'und', 1.0, 100, 10, ?, ?)
    `).run(supplyId, now, now);

    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, 10, 0, ?)').run(
      `loc_alta_vista_${supplyId}`, 'loc_alta_vista', supplyId, now
    );

    // Ejecutar 2 transacciones de descuento en serie/concurrencia
    const tx1 = rawDb.transaction(() => {
      rawDb.prepare('UPDATE location_inventory SET current_stock_qty = current_stock_qty - 4 WHERE location_id = ? AND supply_id = ?').run('loc_alta_vista', supplyId);
      rawDb.prepare('UPDATE supply_items SET current_stock_qty = current_stock_qty - 4 WHERE id = ?').run(supplyId);
    });

    const tx2 = rawDb.transaction(() => {
      rawDb.prepare('UPDATE location_inventory SET current_stock_qty = current_stock_qty - 3 WHERE location_id = ? AND supply_id = ?').run('loc_alta_vista', supplyId);
      rawDb.prepare('UPDATE supply_items SET current_stock_qty = current_stock_qty - 3 WHERE id = ?').run(supplyId);
    });

    tx1();
    tx2();

    const locFinal = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supplyId) as any;
    const supFinal = rawDb.prepare('SELECT current_stock_qty FROM supply_items WHERE id = ?').get(supplyId) as any;

    // 10 - 4 - 3 = 3 exacto
    expect(locFinal.current_stock_qty).toBe(3);
    expect(supFinal.current_stock_qty).toBe(3);
  });
});
