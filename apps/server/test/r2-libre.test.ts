import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { openJornada } from '../src/modules/cashier/cashier-service.js';
import { deductInventoryForOrder, revertInventoryForOrder } from '../src/modules/profitability/recipes-service.js';
import { calculateProfitAndLoss } from '../src/modules/finances/profit-service.js';
import { getFinancialTruth } from '../src/modules/finances/financial-truth-service.js';

describe('R2 / Go-Live — Modo Inventario Libre y Tracked', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_libre_${Date.now()}`);
  const tempDbPath = path.join(tempDir, 'libre_test.db');
  let rawDb: Database.Database;
  let activeJornadaId: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const ctx = initSqlite(tempDbPath);
    rawDb = ctx.rawDb;
    rawDb.pragma('foreign_keys = ON');
    await runMigrations(rawDb, { dbPath: tempDbPath });
    seedInitialUsers(rawDb);
    ensureOfficialLocations(rawDb);
    const j = openJornada(rawDb, { openedByUserId: 'usr_cajera', initialCashUsdCents: 10000, initialCashBsCents: 400000 });
    activeJornadaId = j.id;

    rawDb.prepare(`
      INSERT OR IGNORE INTO categories (id, name, station)
      VALUES ('cat_hamburguesas', 'Hamburguesas', 'hamburguesas')
    `).run();
  });

  afterAll(() => {
    try {
      if (rawDb) rawDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. Modo libre: catálogo sin insumos ni recetas se crea, cobra y anula sin error (2xx) y 0 movimientos', () => {
    rawDb.prepare("UPDATE business_settings SET inventory_operation_mode = 'free' WHERE id = 'default'").run();

    const prodId = 'prod_test_free_1';
    const now = Date.now();
    rawDb.prepare(`
      INSERT OR REPLACE INTO products (id, category_id, name, price_usd_cents, station, is_active, recipe_mode, created_at_ms, updated_at_ms)
      VALUES (?, 'cat_hamburguesas', 'Hamburguesa Libre', 1000, 'hamburguesas', 1, 'UNITS', ?, ?)
    `).run(prodId, now, now);

    const orderId = 'ord_test_free_1';
    rawDb.prepare(`
      INSERT INTO orders (id, order_number, location_id, jornada_id, created_by_user_id, rate_micro_bs, fulfillment_status, payment_status, gross_food_subtotal_usd_cents, net_food_sales_usd_cents, created_at_ms, updated_at_ms)
      VALUES (?, 1, 'loc_alta_vista', ?, 'usr_cajera', 40000000, 'entregado', 'pagado', 1000, 1000, ?, ?)
    `).run(orderId, activeJornadaId, now, now);

    rawDb.prepare(`
      INSERT INTO order_lines (id, order_id, product_id, quantity, unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, line_role, station, created_at_ms)
      VALUES ('line_1', ?, ?, 1, 1000, 1000, 1000, 'STANDARD', 'hamburguesas', ?)
    `).run(orderId, prodId, now);

    expect(() => {
      deductInventoryForOrder(rawDb, orderId, 'loc_alta_vista', now, 'usr_cajera');
    }).not.toThrow();

    expect(() => {
      revertInventoryForOrder(rawDb, orderId, 'loc_alta_vista', 'Anulación de prueba', 'usr_cajera');
    }).not.toThrow();

    const movCount = (rawDb.prepare('SELECT count(*) as cnt FROM inventory_movements WHERE order_id = ?').get(orderId) as any).cnt;
    expect(movCount).toBe(0);
  });

  it('2. P&L y Verdad Financiera sin recetas devuelven 0 con cogsConfigured: false (nunca NaN / undefined)', () => {
    rawDb.prepare('DELETE FROM recipes').run();

    const pnl = calculateProfitAndLoss(rawDb);
    expect(pnl.summary.cogsConfigured).toBe(false);
    expect(pnl.summary.costOfGoodsSoldUsdCents).toBe(0);
    expect(isNaN(pnl.summary.netProfitUsdCents)).toBe(false);
    expect(isNaN(pnl.summary.netProfitMarginPercentage)).toBe(false);
    expect(pnl.summary.netProfitUsdCents).not.toBeUndefined();

    const ft = getFinancialTruth(rawDb);
    expect(ft.cogsConfigured).toBe(false);
    expect(ft.cogsTheoretical).toBe(0);
    expect(isNaN(ft.netProfitUsdCents)).toBe(false);
  });

  it('3. Modo tracked: 2 llamadas a deducción en la misma orden resultan en 1 solo descuento (idempotencia)', () => {
    const supplyId = 'sup_test_tracked_1';
    rawDb.prepare(`
      INSERT OR REPLACE INTO supply_items (id, name, unit, cost_per_unit_usd_cents, current_stock_qty, created_at_ms, updated_at_ms)
      VALUES (?, 'Pan Test Tracked', 'unid', 50, 100, ?, ?)
    `).run(supplyId, Date.now(), Date.now());

    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES ('loc_alta_vista_' || ?, 'loc_alta_vista', ?, 100, 10, ?)
    `).run(supplyId, supplyId, Date.now());

    const prodId = 'prod_test_tracked_1';
    const now = Date.now();
    rawDb.prepare(`
      INSERT OR REPLACE INTO products (id, category_id, name, price_usd_cents, station, is_active, recipe_mode, created_at_ms, updated_at_ms)
      VALUES (?, 'cat_hamburguesas', 'Burger Tracked', 1500, 'hamburguesas', 1, 'UNITS', ?, ?)
    `).run(prodId, now, now);

    const recId = 'rec_test_tracked_1';
    rawDb.prepare(`
      INSERT OR REPLACE INTO recipes (id, product_id, name) VALUES (?, ?, 'Receta Tracked')
    `).run(recId, prodId);

    rawDb.prepare(`
      INSERT OR REPLACE INTO recipe_items (id, recipe_id, supply_item_id, quantity_required)
      VALUES ('ritem_1', ?, ?, 2)
    `).run(recId, supplyId);

    rawDb.prepare("UPDATE business_settings SET inventory_operation_mode = 'tracked', inventory_tracking_since_ms = ? WHERE id = 'default'").run(now - 1000);

    const orderId = 'ord_test_tracked_2';
    rawDb.prepare(`
      INSERT INTO orders (id, order_number, location_id, jornada_id, created_by_user_id, rate_micro_bs, fulfillment_status, payment_status, gross_food_subtotal_usd_cents, net_food_sales_usd_cents, created_at_ms, updated_at_ms)
      VALUES (?, 2, 'loc_alta_vista', ?, 'usr_cajera', 40000000, 'entregado', 'pagado', 1500, 1500, ?, ?)
    `).run(orderId, activeJornadaId, now, now);

    rawDb.prepare(`
      INSERT INTO order_lines (id, order_id, product_id, quantity, unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, line_role, station, created_at_ms)
      VALUES ('line_2', ?, ?, 1, 1500, 1500, 1500, 'STANDARD', 'hamburguesas', ?)
    `).run(orderId, prodId, now);

    deductInventoryForOrder(rawDb, orderId, 'loc_alta_vista', now, 'usr_cajera');
    let stockAfter1 = (rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supplyId) as any).current_stock_qty;
    expect(stockAfter1).toBe(98);

    deductInventoryForOrder(rawDb, orderId, 'loc_alta_vista', now, 'usr_cajera');
    let stockAfter2 = (rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supplyId) as any).current_stock_qty;
    expect(stockAfter2).toBe(98);

    const movCount = (rawDb.prepare('SELECT count(*) as cnt FROM inventory_movements WHERE order_id = ? AND movement_type = ?').get(orderId, 'VENTA_RECETA') as any).cnt;
    expect(movCount).toBe(1);
  });

  it('4. Anular #1 no toca #10 ni #11 (búsqueda estricta por order_id)', () => {
    const supplyId = 'sup_test_tracked_1';
    const now = Date.now();

    const ordersData = [
      { id: 'ord_1', num: 1 },
      { id: 'ord_10', num: 10 },
      { id: 'ord_11', num: 11 }
    ];

    const prodId = 'prod_test_tracked_1';
    for (const ord of ordersData) {
      rawDb.prepare(`
        INSERT INTO orders (id, order_number, location_id, jornada_id, created_by_user_id, rate_micro_bs, fulfillment_status, payment_status, gross_food_subtotal_usd_cents, net_food_sales_usd_cents, created_at_ms, updated_at_ms)
        VALUES (?, ?, 'loc_alta_vista', ?, 'usr_cajera', 40000000, 'entregado', 'pagado', 1500, 1500, ?, ?)
      `).run(ord.id, ord.num, activeJornadaId, now, now);

      rawDb.prepare(`
        INSERT INTO order_lines (id, order_id, product_id, quantity, unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, line_role, station, created_at_ms)
        VALUES ('line_' || ?, ?, ?, 1, 1500, 1500, 1500, 'STANDARD', 'hamburguesas', ?)
      `).run(ord.id, ord.id, prodId, now);

      deductInventoryForOrder(rawDb, ord.id, 'loc_alta_vista', now, 'usr_cajera');
    }

    let stockBefore = (rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supplyId) as any).current_stock_qty;
    expect(stockBefore).toBe(92);

    revertInventoryForOrder(rawDb, 'ord_1', 'loc_alta_vista', 'Anulación de orden 1', 'usr_cajera');

    let stockAfterVoid1 = (rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supplyId) as any).current_stock_qty;
    expect(stockAfterVoid1).toBe(94);

    const revCount = (rawDb.prepare('SELECT count(*) as cnt FROM inventory_movements WHERE order_id = ? AND movement_type = ?').get('ord_1', 'REVERSION_VENTA') as any).cnt;
    expect(revCount).toBe(1);

    const rev10Count = (rawDb.prepare('SELECT count(*) as cnt FROM inventory_movements WHERE order_id = ? AND movement_type = ?').get('ord_10', 'REVERSION_VENTA') as any).cnt;
    expect(rev10Count).toBe(0);

    const rev11Count = (rawDb.prepare('SELECT count(*) as cnt FROM inventory_movements WHERE order_id = ? AND movement_type = ?').get('ord_11', 'REVERSION_VENTA') as any).cnt;
    expect(rev11Count).toBe(0);
  });
});
