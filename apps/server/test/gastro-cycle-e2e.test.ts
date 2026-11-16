import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { seedCriticalSuppliesAndRecipes } from '../src/modules/profitability/inventory.js';
import { registerPurchase } from '../src/modules/profitability/purchases-service.js';
import { createSellableProductWithRecipe } from '../src/modules/profitability/recipes-service.js';
import { registerWasteLog } from '../src/modules/profitability/waste-service.js';
import { createOperatingExpense } from '../src/modules/profitability/net-profit.js';
import { openJornada, processOrderPayment } from '../src/modules/cashier/cashier-service.js';
import { createOrder } from '../src/modules/orders/order-service.js';
import { getFinancialTruth } from '../src/modules/finances/financial-truth-service.js';
import { calculateProfitAndLoss } from '../src/modules/finances/profit-service.js';
import { closeJornadaZ } from '../src/modules/closures/closures-service.js';
import { resolveRoutePolicy, isRoleAllowed } from '../src/config/route-policy.js';
import { loginAs } from './test-helpers.js';

describe('E6 — Trazabilidad gastro extremo a extremo + recetas incompletas', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_gastro_cycle_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_gastro_cycle.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;
  let cajeraToken: string;
  let supervisorToken: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureOfficialLocations(rawDb);
    seedCriticalSuppliesAndRecipes(rawDb);

    // Activar descuento de inventario por receta (modo tracked)
    rawDb.prepare("UPDATE business_settings SET inventory_operation_mode = 'tracked' WHERE id = 'default'").run();

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
    supervisorToken = (await loginAs(app, 'supervisor', rawDb)).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      const dbCtx = getDatabaseContext();
      if (dbCtx && dbCtx.db) {
        dbCtx.db.close();
      }
    } catch {
      // Base ya cerrada
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Directorio temporal ya removido
    }
  });

  it('1. Ciclo completo con centavos exactos: compra con conversión, receta, venta con SIN, merma y P&L', () => {
    const now = Date.now();

    // --- Insumo nuevo con conversión de unidad: caja de 24 → unidades ---
    const supplyId = 'sup_salchicha_cycle';
    rawDb.prepare(`
      INSERT INTO supply_items (
        id, name, unit, unit_measure, purchase_unit, usage_unit, conversion_factor,
        category, min_stock, current_stock_qty, minimum_stock_qty,
        cost_per_unit_usd_cents, weighted_avg_cost_usd_cents, last_cost_usd_cents,
        previous_cost_usd_cents, is_active, created_at_ms, updated_at_ms
      ) VALUES (?, 'Salchicha Polaca Premium', 'unidad', 'und', 'caja_24', 'unidad', 24,
        'carnes', 5, 0, 5, 0, 0, 0, 0, 1, ?, ?)
    `).run(supplyId, now, now);

    // Pan de perro con WAC y stock conocidos por sede
    rawDb.prepare(`
      UPDATE supply_items
      SET current_stock_qty = 100, weighted_avg_cost_usd_cents = 25, cost_per_unit_usd_cents = 25
      WHERE id = 'sup_pan_perro'
    `).run();
    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES ('loc_alta_vista_sup_pan_perro', 'loc_alta_vista', 'sup_pan_perro', 100, 5, ?)
    `).run(now);

    // --- Compra CONTADO con conversión (1 caja de 24 = $24.00 → 24 unidades a $1.00) ---
    const purchase = registerPurchase(rawDb, {
      locationId: 'loc_alta_vista',
      supplierName: 'Distribuidora Premium',
      invoiceNumber: 'FAC-CICLO-001',
      paymentCondition: 'CONTADO',
      paymentMethod: 'EFECTIVO_USD',
      createdBy: 'usr_admin',
      items: [{ supplyId, purchaseQuantity: 1, unitCostUsdCents: 2400 }]
    });

    expect(purchase.totalUsdCents).toBe(2400);

    const salchicha = rawDb.prepare('SELECT * FROM supply_items WHERE id = ?').get(supplyId) as any;
    expect(salchicha.current_stock_qty).toBe(24);
    expect(salchicha.weighted_avg_cost_usd_cents).toBe(100); // WAC = $1.00 por unidad
    expect(salchicha.cost_per_unit_usd_cents).toBe(100);

    // --- Receta + producto en carta en una sola acción (E4) ---
    const product = createSellableProductWithRecipe(rawDb, {
      id: 'prod_jalapenos_cycle',
      name: 'Jalapeños Dog Ciclo',
      categoryId: 'cat_hot_dogs',
      station: 'hot_dogs',
      priceUsdCents: 300,
      recipeMode: 'UNITS',
      items: [
        { supplyId: 'sup_pan_perro', quantity: 1 },
        { supplyId, quantity: 1 }
      ]
    }, 'usr_admin');

    expect(product.calculatedCostUsdCents).toBe(125); // 25 pan + 100 salchicha

    // Mapeo de insumo para que el modificador SIN resuelva al insumo de la receta
    rawDb.prepare(`
      INSERT OR REPLACE INTO ingredient_supply_map (ingredient_id, supply_id)
      VALUES ('ing_base_salchicha_cycle', ?)
    `).run(supplyId);

    // --- Abrir jornada y vender 3 unidades con 1 SIN (una unidad sin salchicha) ---
    const jornada = openJornada(rawDb, {
      openedByUserId: 'usr_cajera',
      rateMicroBs: 40_000_000,
      initialCashUsdCents: 0,
      initialCashBsCents: 0,
      locationId: 'loc_alta_vista'
    });
    const jornadaId = jornada.id;

    const order = createOrder(rawDb, {
      createdByUserId: 'usr_cajera',
      fulfillmentType: 'salon',
      tableNumber: 'Mesa 1',
      lines: [
        { productId: 'prod_jalapenos_cycle', quantity: 2 },
        {
          productId: 'prod_jalapenos_cycle',
          quantity: 1,
          modifiers: [{ ingredientId: 'ing_base_salchicha_cycle', ingredientName: 'Salchicha', modifierType: 'SIN_INGREDIENTE' }]
        }
      ]
    });

    expect(order.gross_food_subtotal_usd_cents).toBe(900); // 3 × $3.00

    const payment = processOrderPayment(rawDb, order.id, {
      orderId: order.id,
      cashierUserId: 'usr_cajera',
      tenders: [{ method: 'cash_usd', amountCents: 900 }],
      changeOutputs: { changeUsdCents: 0, changeBsCents: 0 }
    });
    expect(payment.order.payment_status).toBe('pagado');

    // --- Merma de 1 plato ---
    const waste = registerWasteLog(rawDb, {
      locationId: 'loc_alta_vista',
      itemType: 'product',
      productId: 'prod_jalapenos_cycle',
      quantity: 1,
      reason: 'Plato dañado en preparación',
      reportedByUserId: 'usr_admin'
    });
    expect(waste.costUsdCents).toBe(125); // 1 pan (25) + 1 salchicha (100)

    // --- Gasto operativo ---
    createOperatingExpense(rawDb, {
      jornadaId,
      category: 'VARIOS',
      amountUsdCents: 150,
      description: 'Hielo y servilletas',
      authorizedByUserId: 'usr_admin'
    });

    // --- Stock por sede ---
    const panLoc = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', 'sup_pan_perro') as any;
    const salchichaLoc = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supplyId) as any;
    expect(panLoc.current_stock_qty).toBe(96);       // 100 - 3 vendidos - 1 merma
    expect(salchichaLoc.current_stock_qty).toBe(21); // 24 - 2 vendidos (1 SIN) - 1 merma

    // --- WAC intacto ---
    const salchichaAfter = rawDb.prepare('SELECT weighted_avg_cost_usd_cents FROM supply_items WHERE id = ?').get(supplyId) as any;
    expect(salchichaAfter.weighted_avg_cost_usd_cents).toBe(100);

    // --- Movimientos: COMPRA_ENTRADA, VENTA_RECETA y MERMA ---
    const types = rawDb.prepare('SELECT DISTINCT movement_type FROM inventory_movements').all() as any[];
    const typeNames = types.map((t) => t.movement_type);
    expect(typeNames).toContain('COMPRA_ENTRADA');
    expect(typeNames).toContain('VENTA_RECETA');
    expect(typeNames).toContain('MERMA');

    // --- COGS = Σ movimientos VENTA_RECETA ---
    const cogsMov = rawDb.prepare("SELECT COALESCE(SUM(total_cost_usd_cents), 0) as s FROM inventory_movements WHERE movement_type = 'VENTA_RECETA'").get() as any;
    expect(cogsMov.s).toBe(275); // 3 panes (75) + 2 salchichas (200)

    // --- Mermas = costo exacto (Σ movimientos MERMA) ---
    const mermaMov = rawDb.prepare("SELECT COALESCE(SUM(total_cost_usd_cents), 0) as s FROM inventory_movements WHERE movement_type = 'MERMA'").get() as any;
    expect(mermaMov.s).toBe(125);

    // --- Verdad Financiera ---
    const ft = getFinancialTruth(rawDb, { jornadaId });
    expect(ft.orders.netSalesUsdCents).toBe(900);
    expect(ft.cogsTheoretical).toBe(275);
    expect(ft.waste.totalUsdCents).toBe(125);
    expect(ft.operatingExpensesUsdCents).toBe(150);
    expect(ft.netProfitUsdCents).toBe(350);
    // utilidad = ventas − COGS − mermas − gastos
    expect(ft.netProfitUsdCents).toBe(
      ft.orders.netSalesUsdCents - ft.cogsTheoretical - ft.waste.totalUsdCents - ft.operatingExpensesUsdCents
    );

    // --- P&L (Estado de Resultados) ---
    const pl = calculateProfitAndLoss(rawDb, { locationId: 'ALL' });
    expect(pl.summary.netFoodSalesUsdCents).toBe(900);
    expect(pl.summary.costOfGoodsSoldUsdCents).toBe(275);
    expect(pl.summary.wasteLossUsdCents).toBe(125);
    expect(pl.summary.operatingExpensesUsdCents).toBe(150);
    expect(pl.summary.netProfitUsdCents).toBe(350);
    expect(pl.summary.purchasesUsdCents).toBe(2400);

    // Paridad P&L ↔ Verdad Financiera
    expect(pl.summary.netFoodSalesUsdCents).toBe(ft.orders.netSalesUsdCents);
    expect(pl.summary.costOfGoodsSoldUsdCents).toBe(ft.cogsTheoretical);
    expect(pl.summary.wasteLossUsdCents).toBe(ft.waste.totalUsdCents);
    expect(pl.summary.operatingExpensesUsdCents).toBe(ft.operatingExpensesUsdCents);
    expect(pl.summary.netProfitUsdCents).toBe(ft.netProfitUsdCents);

    // --- Cierre Z ---
    const { zReport } = closeJornadaZ(rawDb, jornadaId, { id: 'usr_admin', name: 'ADMIN', role: 'admin' });
    expect(zReport.netSalesUsdCents).toBe(900);
    expect(zReport.mermasLossUsdCents).toBe(125);
    expect(zReport.expensesUsdCents).toBe(150);
    expect(zReport.ordersCount).toBe(1);

    // Paridad Cierre Z ↔ Verdad Financiera
    expect(zReport.netSalesUsdCents).toBe(ft.orders.netSalesUsdCents);
    expect(zReport.mermasLossUsdCents).toBe(ft.waste.totalUsdCents);
    expect(zReport.expensesUsdCents).toBe(ft.operatingExpensesUsdCents);
  });

  it('2. GET /api/profitability/recipes/health lista productos incompletos y respeta rol admin/supervisor', async () => {
    const now = Date.now();

    // (a) sin receta
    rawDb.prepare(`
      INSERT INTO products (id, category_id, name, description, price_usd_cents, estimated_cost_usd_cents, station, recipe_mode, is_active, is_available, created_at_ms, updated_at_ms)
      VALUES ('prod_health_sin_receta', 'cat_hot_dogs', 'Health Sin Receta', null, 500, 0, 'hot_dogs', 'UNITS', 1, 1, ?, ?)
    `).run(now, now);

    // (b) receta sin insumos
    rawDb.prepare(`
      INSERT INTO products (id, category_id, name, description, price_usd_cents, estimated_cost_usd_cents, station, recipe_mode, is_active, is_available, created_at_ms, updated_at_ms)
      VALUES ('prod_health_receta_vacia', 'cat_hot_dogs', 'Health Receta Vacía', null, 500, 0, 'hot_dogs', 'UNITS', 1, 1, ?, ?)
    `).run(now, now);
    rawDb.prepare("INSERT INTO recipes (id, product_id, name) VALUES ('rec_health_receta_vacia', 'prod_health_receta_vacia', 'Health Receta Vacía')").run();

    // (c) insumo con costo 0
    rawDb.prepare(`
      INSERT INTO supply_items (id, name, unit, unit_measure, current_stock_qty, minimum_stock_qty, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents, created_at_ms, updated_at_ms)
      VALUES ('sup_health_costo_cero', 'Insumo Sin Costo', 'unidad', 'und', 10, 1, 0, 0, ?, ?)
    `).run(now, now);
    rawDb.prepare(`
      INSERT INTO products (id, category_id, name, description, price_usd_cents, estimated_cost_usd_cents, station, recipe_mode, is_active, is_available, created_at_ms, updated_at_ms)
      VALUES ('prod_health_costo_cero', 'cat_hot_dogs', 'Health Costo Cero', null, 500, 0, 'hot_dogs', 'UNITS', 1, 1, ?, ?)
    `).run(now, now);
    rawDb.prepare("INSERT INTO recipes (id, product_id, name) VALUES ('rec_health_costo_cero', 'prod_health_costo_cero', 'Health Costo Cero')").run();
    rawDb.prepare("INSERT INTO recipe_items (id, recipe_id, supply_item_id, quantity_required) VALUES ('ri_health_costo_cero', 'rec_health_costo_cero', 'sup_health_costo_cero', 1)").run();

    // (d) FINISHED_PRODUCT sin espejo ni receta
    rawDb.prepare(`
      INSERT INTO products (id, category_id, name, description, price_usd_cents, estimated_cost_usd_cents, station, recipe_mode, is_active, is_available, created_at_ms, updated_at_ms)
      VALUES ('prod_health_finished_gap', 'cat_hot_dogs', 'Health Finished Gap', null, 500, 0, 'hot_dogs', 'FINISHED_PRODUCT', 1, 1, ?, ?)
    `).run(now, now);

    // (e) precio < costo
    rawDb.prepare(`
      INSERT INTO supply_items (id, name, unit, unit_measure, current_stock_qty, minimum_stock_qty, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents, created_at_ms, updated_at_ms)
      VALUES ('sup_health_caro', 'Insumo Caro', 'unidad', 'und', 10, 1, 900, 900, ?, ?)
    `).run(now, now);
    rawDb.prepare(`
      INSERT INTO products (id, category_id, name, description, price_usd_cents, estimated_cost_usd_cents, station, recipe_mode, is_active, is_available, created_at_ms, updated_at_ms)
      VALUES ('prod_health_precio_bajo', 'cat_hot_dogs', 'Health Precio Bajo', null, 500, 0, 'hot_dogs', 'UNITS', 1, 1, ?, ?)
    `).run(now, now);
    rawDb.prepare("INSERT INTO recipes (id, product_id, name) VALUES ('rec_health_precio_bajo', 'prod_health_precio_bajo', 'Health Precio Bajo')").run();
    rawDb.prepare("INSERT INTO recipe_items (id, recipe_id, supply_item_id, quantity_required) VALUES ('ri_health_precio_bajo', 'rec_health_precio_bajo', 'sup_health_caro', 1)").run();

    // Admin: permitido
    const resAdmin = await app.inject({
      method: 'GET',
      url: '/api/profitability/recipes/health',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(resAdmin.statusCode).toBe(200);
    const body = JSON.parse(resAdmin.payload);
    expect(body.success).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(5);
    expect(body.incompleteCount).toBeGreaterThanOrEqual(5);

    const byId = new Map<string, any>(body.incomplete.map((i: any) => [i.productId, i]));

    const sinReceta = byId.get('prod_health_sin_receta');
    expect(sinReceta).toBeDefined();
    expect(sinReceta.issues).toContain('sin_receta');

    const recetaVacia = byId.get('prod_health_receta_vacia');
    expect(recetaVacia).toBeDefined();
    expect(recetaVacia.issues).toContain('receta_sin_insumos');

    const costoCero = byId.get('prod_health_costo_cero');
    expect(costoCero).toBeDefined();
    expect(costoCero.issues).toContain('insumo_costo_cero');

    const finishedGap = byId.get('prod_health_finished_gap');
    expect(finishedGap).toBeDefined();
    expect(finishedGap.issues).toContain('producto_terminado_sin_espejo_ni_receta');

    const precioBajo = byId.get('prod_health_precio_bajo');
    expect(precioBajo).toBeDefined();
    expect(precioBajo.issues).toContain('precio_menor_costo');
    expect(precioBajo.calculatedCostUsdCents).toBe(900);
    expect(precioBajo.priceUsdCents).toBe(500);

    // Supervisor: permitido
    const resSuper = await app.inject({
      method: 'GET',
      url: '/api/profitability/recipes/health',
      headers: { authorization: `Bearer ${supervisorToken}` }
    });
    expect(resSuper.statusCode).toBe(200);

    // Cajera: denegado
    const resCajera = await app.inject({
      method: 'GET',
      url: '/api/profitability/recipes/health',
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resCajera.statusCode).toBe(403);

    // Route policy: ADMIN_SUPERVISOR
    const policy = resolveRoutePolicy('GET', '/api/profitability/recipes/health');
    expect(policy.matched).toBe(true);
    expect(policy.level).toBe('ADMIN_SUPERVISOR');
    expect(isRoleAllowed('ADMIN_SUPERVISOR', 'supervisor')).toBe(true);
    expect(isRoleAllowed('ADMIN_SUPERVISOR', 'cajera')).toBe(false);
  });
});
