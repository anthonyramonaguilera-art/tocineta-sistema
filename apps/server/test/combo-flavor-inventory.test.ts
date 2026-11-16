import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { seedCriticalSuppliesAndRecipes } from '../src/modules/profitability/inventory.js';
import { openJornada, processOrderPayment } from '../src/modules/cashier/cashier-service.js';
import { createOrder } from '../src/modules/orders/order-service.js';

/**
 * I4 — El sabor del refresco de un combo descuenta su propio insumo.
 * La línea hija conserva el prorrateo del combo, pero cambia su product_id
 * al producto de variante (por ejemplo prod_refresco_pepsi).
 */
describe('I4 — Sabor de refresco descuenta su propio insumo', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_combo_flavor_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_combo_flavor.db');
  const RATE_MICRO_BS = 40_000_000;
  const LOC = 'loc_alta_vista';
  let rawDb: Database.Database;

  const getStock = (supplyId: string): number => {
    const row = rawDb.prepare(
      'SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?'
    ).get(LOC, supplyId) as any;
    return Number(row?.current_stock_qty ?? 0);
  };

  const setStock = (supplyId: string, qty: number) => {
    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(`${LOC}_${supplyId}`, LOC, supplyId, qty, Date.now());
  };

  const createComboOrder = (flavorChoice: string) => createOrder(rawDb, {
    createdByUserId: 'usr_cajera',
    fulfillmentType: 'salon',
    lines: [{
      productId: 'prod_combo_para_ti',
      quantity: 1,
      comboChildren: [
        { productId: 'prod_texas_mex', quantity: 1 },
        { productId: 'prod_pechuga_cesar', quantity: 1 },
        { productId: 'prod_refresco_1lt', quantity: 1, flavorChoice }
      ]
    }]
  });

  const getLines = (orderId: string) => rawDb.prepare(`
    SELECT product_id, line_role, quantity, unit_price_usd_cents,
           prorated_unit_price_usd_cents, subtotal_usd_cents
    FROM order_lines
    WHERE order_id = ?
  `).all(orderId) as any[];

  const childProrated = (orderId: string) => {
    const lines = getLines(orderId).filter(l => l.line_role === 'COMBO_CHILD');
    const keyFor = (productId: string) => productId.startsWith('prod_refresco_') ? 'refresco' : productId;
    return new Map(lines.map(l => [keyFor(l.product_id), l.prorated_unit_price_usd_cents]));
  };

  const payOrder = (orderId: string) => processOrderPayment(rawDb, orderId, {
    orderId,
    cashierUserId: 'usr_cajera',
    tenders: [{ method: 'cash_usd', amountCents: 1390 }],
    changeOutputs: { changeUsdCents: 0, changeBsCents: 0 }
  });

  const movementFor = (orderId: string, supplyId: string) => rawDb.prepare(`
    SELECT quantity_delta, location_id
    FROM inventory_movements
    WHERE order_id = ? AND supply_id = ?
  `).get(orderId, supplyId) as any;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureOfficialLocations(rawDb);
    seedCriticalSuppliesAndRecipes(rawDb);

    rawDb.prepare("UPDATE business_settings SET inventory_operation_mode = 'tracked' WHERE id = 'default'").run();

    openJornada(rawDb, {
      openedByUserId: 'usr_cajera',
      locationId: LOC,
      rateMicroBs: RATE_MICRO_BS,
      initialCashUsdCents: 0,
      initialCashBsCents: 0
    });

    setStock('sup_refresco_1lt', 10);
    setStock('sup_refresco_pepsi', 5);

    rawDb.prepare(`
      UPDATE supply_items
      SET current_stock_qty = 100, weighted_avg_cost_usd_cents = 90, cost_per_unit_usd_cents = 90
      WHERE id = 'sup_refresco_1lt'
    `).run();
    rawDb.prepare(`
      UPDATE supply_items
      SET current_stock_qty = 100, weighted_avg_cost_usd_cents = 90, cost_per_unit_usd_cents = 90
      WHERE id = 'sup_refresco_pepsi'
    `).run();
  });

  afterAll(() => {
    try {
      const dbCtx = getDatabaseContext();
      if (dbCtx && dbCtx.db) {
        dbCtx.db.close();
      }
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('la migración registra las seis variantes con producto y receta de reventa', () => {
    const variants = rawDb.prepare(`
      SELECT flavor_name, variant_product_id
      FROM product_flavor_variants
      WHERE product_id = 'prod_refresco_1lt'
      ORDER BY flavor_name
    `).all() as any[];

    expect(variants.map(v => v.flavor_name)).toEqual([
      '7up', 'frescolita', 'manzanita', 'naranja', 'pepsi', 'piña'
    ]);

    const pepsi = variants.find(v => v.flavor_name === 'pepsi');
    expect(pepsi?.variant_product_id).toBe('prod_refresco_pepsi');

    const recipeItem = rawDb.prepare(`
      SELECT ri.supply_item_id, ri.quantity_required
      FROM recipes r
      JOIN recipe_items ri ON ri.id = 'ri_rec_prod_refresco_pepsi' AND ri.recipe_id = r.id
      WHERE r.product_id = 'prod_refresco_pepsi'
    `).get() as any;
    expect(recipeItem?.supply_item_id).toBe('sup_refresco_pepsi');
    expect(recipeItem?.quantity_required).toBe(1);

    const variantProduct = rawDb.prepare(
      "SELECT price_usd_cents, is_active, station FROM products WHERE id = 'prod_refresco_pepsi'"
    ).get() as any;
    expect(variantProduct?.price_usd_cents).toBe(0);
    expect(variantProduct?.is_active).toBe(0);
    expect(variantProduct?.station).toBe('caja_bebidas');
  });

  it("combo con sabor 'Pepsi' descuenta sup_refresco_pepsi y NO sup_refresco_1lt", () => {
    const order = createComboOrder('Pepsi');
    expect(order.total_to_collect_usd_cents).toBe(1390);

    const lines = getLines(order.id);
    const parent = lines.find(l => l.line_role === 'COMBO_PARENT');
    const children = lines.filter(l => l.line_role === 'COMBO_CHILD');
    const refresco = children.find(l => l.product_id === 'prod_refresco_pepsi');

    expect(parent?.subtotal_usd_cents).toBe(1390);
    expect(children).toHaveLength(3);
    expect(refresco).toBeDefined();
    expect(refresco?.quantity).toBe(1);
    expect(children.reduce((acc, l) => acc + l.subtotal_usd_cents, 0)).toBe(1390);

    payOrder(order.id);

    expect(getStock('sup_refresco_pepsi')).toBe(4);
    expect(getStock('sup_refresco_1lt')).toBe(10);

    const pepsiMovement = movementFor(order.id, 'sup_refresco_pepsi');
    expect(pepsiMovement?.quantity_delta).toBe(-1);
    expect(pepsiMovement?.location_id).toBe(LOC);
    expect(movementFor(order.id, 'sup_refresco_1lt')).toBeUndefined();
  });

  it('sabor sin variante mantiene el producto genérico y no altera total ni prorrateo', () => {
    const pepsiOrder = createComboOrder('Pepsi');
    const genericOrder = createComboOrder('SaborSinVariante');

    expect(genericOrder.total_to_collect_usd_cents).toBe(1390);

    const genericLines = getLines(genericOrder.id);
    const genericRefresco = genericLines.find(
      l => l.line_role === 'COMBO_CHILD' && l.product_id === 'prod_refresco_1lt'
    );
    expect(genericRefresco).toBeDefined();
    expect(genericLines.find(l => l.line_role === 'COMBO_PARENT')?.subtotal_usd_cents).toBe(1390);
    expect(genericLines.filter(l => l.line_role === 'COMBO_CHILD')
      .reduce((acc, l) => acc + l.subtotal_usd_cents, 0)).toBe(1390);

    const pepsiProrated = childProrated(pepsiOrder.id);
    const genericProrated = childProrated(genericOrder.id);
    expect(genericProrated.get('refresco')).toBe(pepsiProrated.get('refresco'));
    expect(genericProrated.get('prod_texas_mex')).toBe(pepsiProrated.get('prod_texas_mex'));
    expect(genericProrated.get('prod_pechuga_cesar')).toBe(pepsiProrated.get('prod_pechuga_cesar'));

    payOrder(genericOrder.id);

    expect(getStock('sup_refresco_1lt')).toBe(9);
    expect(getStock('sup_refresco_pepsi')).toBe(4);

    expect(movementFor(genericOrder.id, 'sup_refresco_1lt')?.quantity_delta).toBe(-1);
    expect(movementFor(genericOrder.id, 'sup_refresco_pepsi')).toBeUndefined();
  });
});
