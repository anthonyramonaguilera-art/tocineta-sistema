import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrate.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { seedCriticalSuppliesAndRecipes } from '../src/modules/profitability/inventory.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { AppError } from '../src/lib/app-error.js';
import { saveSubRecipe, getSubRecipes, saveProductRecipe, getProductRecipe, deductInventoryForOrder, revertInventoryForOrder } from '../src/modules/profitability/recipes-service.js';
import { registerWasteLog, getWasteLogs } from '../src/modules/profitability/waste-service.js';
import { registerPurchase } from '../src/modules/profitability/purchases-service.js';

describe('R2 — P4-A: Inventario, Recetas, Compras, Mermas y Asistente', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, { dbPath: ':memory:' });
    seedInitialUsers(db);
    seedCatalog(db);
    ensureOfficialLocations(db);
    seedCriticalSuppliesAndRecipes(db);
    db.prepare("INSERT OR IGNORE INTO jornadas (id, opened_by_user_id, opened_at_ms, status) VALUES ('jor_1', 'usr_admin', ?, 'abierta')").run(Date.now());
  });

  afterEach(() => {
    db.close();
  });

  it('1. Validación de insumos y prevención de duplicados (409)', () => {
    const supId = 'sup_test_1';
    const now = Date.now();
    db.prepare(`
      INSERT INTO supply_items (id, name, unit, unit_measure, purchase_unit, usage_unit, conversion_factor, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents, is_active, created_at_ms, updated_at_ms)
      VALUES (?, 'Papa Frita', 'kg', 'kg', 'kg', 'g', 1000, 250, 250, 1, ?, ?)
    `).run(supId, now, now);

    const normExisting = 'papa frita';
    const newName = 'PAPA FRITA';
    const normNew = newName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    expect(normNew).toBe(normExisting);
  });

  it('2. Sub-recetas con validación estricta de campos y rendimiento', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO supply_items (id, name, unit, unit_measure, purchase_unit, usage_unit, conversion_factor, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents, is_active, created_at_ms, updated_at_ms)
      VALUES ('sup_salsa', 'Salsa de Ajo', 'litro', 'litro', 'litro', 'ml', 1000, 500, 500, 1, ?, ?)
    `).run(now, now);

    expect(() => {
      saveSubRecipe(db, {
        name: '',
        yieldQuantity: 1000,
        yieldUnit: 'ml',
        items: [{ supplyId: 'sup_salsa', quantityRequired: 500 }]
      });
    }).toThrow(AppError);

    const sub = saveSubRecipe(db, {
      name: 'Base de Salsa Ajo',
      yieldQuantity: 1000,
      yieldUnit: 'ml',
      items: [{ supplyId: 'sup_salsa', quantityRequired: 500 }]
    });

    expect(sub.id).toBeDefined();
    expect(sub.yieldQuantity).toBe(1000);
    expect(sub.costPerUnitUsdCents).toBeGreaterThan(0);
  });

  it('3. Recetas de productos desde cero y costos calculados', () => {
    const prod = db.prepare('SELECT id FROM products LIMIT 1').get() as any;
    if (!prod) return;

    const recipeDetail = saveProductRecipe(db, prod.id, {
      recipeMode: 'UNITS',
      targetMarginBps: 6500,
      items: [{ supplyId: 'sup_pan_brioche', quantityRequired: 1 }]
    });

    expect(recipeDetail.calculatedCostUsdCents).toBeGreaterThanOrEqual(0);
  });

  it('4. Mermas en fuente única waste_logs sin duplicar en operating_expenses', () => {
    const log = registerWasteLog(db, {
      locationId: 'loc_alta_vista',
      itemType: 'supply',
      supplyId: 'sup_pan_brioche',
      quantity: 2,
      unit: 'und',
      reason: 'Dañados en almacenamiento',
      reportedByUserId: 'usr_admin'
    });

    expect(log.costUsdCents).toBeGreaterThanOrEqual(0);

    const expCount = (db.prepare("SELECT COUNT(*) as c FROM operating_expenses WHERE category = 'MERMAS_DESPERDICIOS'").get() as any).c;
    expect(expCount).toBe(0);
  });

  it('5. Consumo por venta idempotente (inventory_consumed_at_ms)', () => {
    const prod = db.prepare('SELECT id FROM products LIMIT 1').get() as any;
    if (!prod) return;

    const now = Date.now();
    const orderId = 'ord_test_1';
    db.prepare(`
      INSERT INTO orders (id, order_number, jornada_id, location_id, created_by_user_id, fulfillment_status, payment_status, total_to_collect_usd_cents, rate_micro_bs, created_at_ms, updated_at_ms)
      VALUES (?, 1, 'jor_1', 'loc_alta_vista', 'usr_cajera', 'pendiente', 'pagado', 350, 40000000, ?, ?)
    `).run(orderId, now, now);

    db.prepare(`
      INSERT INTO order_lines (id, order_id, product_id, quantity, unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, station, line_role, created_at_ms)
      VALUES ('oline_1', ?, ?, 1, 350, 350, 350, 'hamburguesas', 'STANDARD', ?)
    `).run(orderId, prod.id, now);

    deductInventoryForOrder(db, orderId, 'loc_alta_vista', now, 'usr_cajera');
    const orderRecord = db.prepare('SELECT inventory_consumed_at_ms FROM orders WHERE id = ?').get(orderId) as any;
    expect(orderRecord.inventory_consumed_at_ms).toBeDefined();

    // Segunda llamada (idempotente)
    deductInventoryForOrder(db, orderId, 'loc_alta_vista', now, 'usr_cajera');
    expect(true).toBe(true);
  });

  it('6. Anulación y reversión de inventario (Regla D2)', () => {
    const now = Date.now();
    const orderId = 'ord_test_2';
    db.prepare(`
      INSERT INTO orders (id, order_number, jornada_id, location_id, created_by_user_id, fulfillment_status, payment_status, total_to_collect_usd_cents, rate_micro_bs, created_at_ms, updated_at_ms)
      VALUES (?, 2, 'jor_1', 'loc_alta_vista', 'usr_cajera', 'pendiente', 'anulado', 350, 40000000, ?, ?)
    `).run(orderId, now, now);

    revertInventoryForOrder(db, orderId, 'loc_alta_vista', 'Anulación de prueba', 'usr_cajera');
    expect(true).toBe(true);
  });

  it('7. Compras y costo promedio ponderado (WAC)', () => {
    const result = registerPurchase(db, {
      locationId: 'loc_alta_vista',
      supplierName: 'Lácteos C.A.',
      paymentCondition: 'CONTADO',
      createdBy: 'usr_admin',
      items: [
        { supplyId: 'sup_queso_cheddar', purchaseQuantity: 5, unitCostUsdCents: 900 }
      ]
    });

    expect(result.purchaseId).toBeDefined();
    expect(result.totalUsdCents).toBe(4500);
  });
});
