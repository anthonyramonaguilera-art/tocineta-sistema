import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrate.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { seedCriticalSuppliesAndRecipes } from '../src/modules/profitability/inventory.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { registerPurchase } from '../src/modules/profitability/purchases-service.js';
import {
  getProductRecipe,
  saveProductRecipe,
  saveSubRecipe,
  syncProductEstimatedCost
} from '../src/modules/profitability/recipes-service.js';

describe('E3 — Costo del plato siempre al día', () => {
  let db: Database.Database;
  const locId = 'loc_alta_vista';

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, { dbPath: ':memory:' });
    seedInitialUsers(db);
    seedCatalog(db);
    ensureOfficialLocations(db);
    seedCriticalSuppliesAndRecipes(db);

    const now = Date.now();
    db.prepare(`
      INSERT OR IGNORE INTO jornadas (id, location_id, opened_by_user_id, opened_at_ms, status)
      VALUES ('jor_test_cost_sync', ?, 'usr_admin', ?, 'abierta')
    `).run(locId, now);

    db.prepare(`
      INSERT OR REPLACE INTO exchange_rates (id, rate_micro_bs, source, is_current, created_at_ms)
      VALUES ('rate_test', 50000000, 'BCV', 1, ?)
    `).run(now);
  });

  afterEach(() => {
    db.close();
  });

  it('Jalapeños Dog costo X; compra de pan_perro con costo más alto → estimated_cost se actualiza; price_usd_cents no cambia', () => {
    // 1. Estado inicial
    const initialProduct = db.prepare('SELECT price_usd_cents, estimated_cost_usd_cents FROM products WHERE id = ?')
      .get('prod_jalapenos_dog') as { price_usd_cents: number; estimated_cost_usd_cents: number };

    expect(initialProduct).toBeDefined();
    const originalSellingPrice = initialProduct.price_usd_cents;
    expect(originalSellingPrice).toBeGreaterThan(0);

    // Asegurar que Jalapeños Dog tiene su costo inicial sincronizado con su receta
    syncProductEstimatedCost(db, 'prod_jalapenos_dog');
    const initialRecipe = getProductRecipe(db, 'prod_jalapenos_dog')!;
    const initialCalculatedCost = initialRecipe.calculatedCostUsdCents;

    const syncedProductBefore = db.prepare('SELECT estimated_cost_usd_cents FROM products WHERE id = ?')
      .get('prod_jalapenos_dog') as { estimated_cost_usd_cents: number };
    expect(syncedProductBefore.estimated_cost_usd_cents).toBe(initialCalculatedCost);

    // 2. Registrar compra de pan_perro con un costo unitario mucho mayor
    // pan_perro tiene conversion_factor = 1.0 (unidad)
    const higherPanCost = 150; // $1.50 por pan
    const purchaseResult = registerPurchase(db, {
      locationId: locId,
      supplierName: 'Distribuidora Panificadora Express',
      paymentCondition: 'CONTADO',
      paymentMethod: 'PAGO_MOVIL_BANESCO',
      createdBy: 'usr_admin',
      items: [
        {
          supplyId: 'sup_pan_perro',
          purchaseQuantity: 20,
          unitCostUsdCents: higherPanCost
        }
      ]
    });

    expect(purchaseResult.purchaseId).toBeDefined();
    // Debe haber detectado a prod_jalapenos_dog entre las recetas impactadas
    const impacted = purchaseResult.affectedRecipes.find(r => r.productId === 'prod_jalapenos_dog');
    expect(impacted).toBeDefined();
    expect(impacted!.newCostUsdCents).toBeGreaterThan(initialCalculatedCost);

    // 3. Verificar en base de datos que products.estimated_cost_usd_cents se actualizó automáticamente
    const updatedProduct = db.prepare('SELECT price_usd_cents, estimated_cost_usd_cents, updated_at_ms FROM products WHERE id = ?')
      .get('prod_jalapenos_dog') as { price_usd_cents: number; estimated_cost_usd_cents: number; updated_at_ms: number };

    const expectedNewCost = impacted!.newCostUsdCents;
    expect(updatedProduct.estimated_cost_usd_cents).toBe(expectedNewCost);
    expect(updatedProduct.estimated_cost_usd_cents).toBeGreaterThan(initialCalculatedCost);

    // 4. REGLA DE ORO: El precio de venta (price_usd_cents) NUNCA debe cambiar automáticamente
    expect(updatedProduct.price_usd_cents).toBe(originalSellingPrice);
  });

  it('Guardar o editar una receta con saveProductRecipe sincroniza estimated_cost_usd_cents sin alterar price_usd_cents', () => {
    const prodBefore = db.prepare('SELECT price_usd_cents, estimated_cost_usd_cents FROM products WHERE id = ?')
      .get('prod_jalapenos_dog') as { price_usd_cents: number; estimated_cost_usd_cents: number };
    const originalSellingPrice = prodBefore.price_usd_cents;

    // Actualizar receta agregando insumo o modificando ingredientes
    saveProductRecipe(db, 'prod_jalapenos_dog', {
      recipeMode: 'UNITS',
      items: [
        { supplyId: 'sup_pan_perro', quantityRequired: 2 },
        { supplyId: 'sup_salchicha_pollo', quantityRequired: 2 }
      ]
    });

    const recipeAfter = getProductRecipe(db, 'prod_jalapenos_dog')!;
    const prodAfter = db.prepare('SELECT price_usd_cents, estimated_cost_usd_cents FROM products WHERE id = ?')
      .get('prod_jalapenos_dog') as { price_usd_cents: number; estimated_cost_usd_cents: number };

    // Costo estimado se actualizó al nuevo total de la receta
    expect(prodAfter.estimated_cost_usd_cents).toBe(recipeAfter.calculatedCostUsdCents);
    expect(prodAfter.estimated_cost_usd_cents).toBeGreaterThan(prodBefore.estimated_cost_usd_cents);

    // Precio de venta intacto
    expect(prodAfter.price_usd_cents).toBe(originalSellingPrice);
  });

  it('syncProductEstimatedCost maneja IDs inválidos de forma defensiva sin lanzar', () => {
    expect(() => {
      const res = syncProductEstimatedCost(db, 'prod_no_existe_999');
      expect(res).toBeNull();
    }).not.toThrow();
  });

  it('Modificar una sub-receta con saveSubRecipe actualiza el estimated_cost_usd_cents de los productos vinculados', () => {
    // 1. Crear sub-receta 'Salsa Especial' usando sup_salsa_tomate
    const subRec = saveSubRecipe(db, {
      name: 'Salsa Especial',
      yieldQuantity: 10,
      yieldUnit: 'porciones',
      items: [
        { supplyId: 'sup_pan_perro', quantityRequired: 1 } // costo 25 -> 25 / 10 = 3 cents por porcion
      ]
    });

    // 2. Asignar sub-receta a Jalapeños Dog
    saveProductRecipe(db, 'prod_jalapenos_dog', {
      recipeMode: 'UNITS',
      items: [
        { supplyId: 'sup_pan_perro', quantityRequired: 1 },
        { subRecipeId: subRec.id, quantityRequired: 2 }
      ]
    });

    const costBefore = (db.prepare('SELECT estimated_cost_usd_cents FROM products WHERE id = ?')
      .get('prod_jalapenos_dog') as any).estimated_cost_usd_cents;

    // 3. Modificar la sub-receta aumentando la cantidad de insumo
    saveSubRecipe(db, {
      id: subRec.id,
      name: 'Salsa Especial',
      yieldQuantity: 1, // Ahora rendimiento 1 -> costo mucho mayor (25 cents por unidad)
      yieldUnit: 'porciones',
      items: [
        { supplyId: 'sup_pan_perro', quantityRequired: 2 } // 2 * 25 = 50 cents
      ]
    });

    const costAfter = (db.prepare('SELECT estimated_cost_usd_cents FROM products WHERE id = ?')
      .get('prod_jalapenos_dog') as any).estimated_cost_usd_cents;

    expect(costAfter).toBeGreaterThan(costBefore);
  });
});
