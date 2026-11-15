import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrate.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { seedCriticalSuppliesAndRecipes } from '../src/modules/profitability/inventory.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import {
  createSellableProductWithRecipe,
  deductInventoryForOrder
} from '../src/modules/profitability/recipes-service.js';
import { getPosMenu } from '../src/modules/menu/menu-service.js';
import { resolveRoutePolicy, isRoleAllowed } from '../src/config/route-policy.js';

describe('E4 — Crear producto de venta desde receta/insumo en una sola acción', () => {
  let db: Database.Database;
  const testJornadaId = 'jor_test_quick_create';
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
      VALUES (?, ?, 'usr_admin', ?, 'abierta')
    `).run(testJornadaId, locId, now);

    db.prepare(`
      INSERT OR REPLACE INTO exchange_rates (id, rate_micro_bs, source, is_current, created_at_ms)
      VALUES ('rate_test', 50000000, 'BCV', 1, ?)
    `).run(now);

    db.prepare("UPDATE business_settings SET inventory_operation_mode = 'tracked' WHERE id = 'default'").run();

    // Fijar costos conocidos de insumos críticos
    db.prepare(`
      UPDATE supply_items
      SET current_stock_qty = 100, weighted_avg_cost_usd_cents = 28, cost_per_unit_usd_cents = 25
      WHERE id = 'sup_pan_perro'
    `).run();
    db.prepare(`
      UPDATE supply_items
      SET current_stock_qty = 100, weighted_avg_cost_usd_cents = 42, cost_per_unit_usd_cents = 40
      WHERE id = 'sup_salchicha_pollo'
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, 'sup_pan_perro', 100, 5, ?)
    `).run(`${locId}_sup_pan_perro`, locId, now);
    db.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, 'sup_salchicha_pollo', 100, 5, ?)
    `).run(`${locId}_sup_salchicha_pollo`, locId, now);
  });

  afterEach(() => {
    db.close();
  });

  it('1. Crea "Jalapeños Dog 2" con pan×1 + salchicha×1: aparece en el POS, costo correcto en centavos y una venta descuenta ambos insumos', () => {
    const result = createSellableProductWithRecipe(
      db,
      {
        name: 'Jalapeños Dog 2',
        categoryId: 'cat_hot_dogs',
        station: 'hot_dogs',
        priceUsdCents: 250, // $2.50
        recipeMode: 'UNITS',
        items: [
          { supplyId: 'sup_pan_perro', quantity: 1 },
          { supplyId: 'sup_salchicha_pollo', quantity: 1 }
        ]
      },
      'usr_admin'
    );

    expect(result.productId).toBeDefined();
    expect(result.productName).toBe('Jalapeños Dog 2');
    expect(result.station).toBe('hot_dogs');
    expect(result.calculatedCostUsdCents).toBe(70); // 28 + 42 = 70 cents
    expect(result.priceUsdCents).toBe(250);
    expect(result.marginBps).toBe(7200); // (250 - 70) / 250 = 72%
    expect(result.recipe.items).toHaveLength(2);

    // Aparece en el POS (getPosMenu)
    const posMenu = getPosMenu(db);
    const allProducts = posMenu.categories.flatMap((c) => c.products);
    const createdProd = allProducts.find((p) => p.name === 'Jalapeños Dog 2');
    expect(createdProd).toBeDefined();
    expect(createdProd?.priceUsdCents).toBe(250);
    expect(createdProd?.station).toBe('hot_dogs');
    expect(createdProd?.isAvailable).toBe(true);

    // Verificar en BD que estimated_cost_usd_cents fue sincronizado
    const prodRow = db.prepare('SELECT estimated_cost_usd_cents, recipe_mode FROM products WHERE id = ?').get(result.productId) as any;
    expect(prodRow.estimated_cost_usd_cents).toBe(70);
    expect(prodRow.recipe_mode).toBe('UNITS');

    // Simular una venta de "Jalapeños Dog 2"
    const now = Date.now();
    const orderId = 'ord_test_jalapenos_2';
    db.prepare(`
      INSERT OR REPLACE INTO orders (
        id, order_number, location_id, jornada_id, created_by_user_id, rate_micro_bs,
        created_at_ms, updated_at_ms
      ) VALUES (?, 901, ?, ?, 'usr_admin', 50000000, ?, ?)
    `).run(orderId, locId, testJornadaId, now, now);

    db.prepare(`
      INSERT OR REPLACE INTO order_lines (
        id, order_id, product_id, quantity, unit_price_usd_cents, prorated_unit_price_usd_cents,
        subtotal_usd_cents, station, line_role, created_at_ms
      ) VALUES ('line_jd2_1', ?, ?, 1, 250, 250, 250, 'hot_dogs', 'STANDARD', ?)
    `).run(orderId, result.productId, now);

    // Ejecutar deducción atómica de inventario
    deductInventoryForOrder(db, orderId, locId, now, 'usr_admin');

    // Comprobar que se descontó 1 pan y 1 salchicha
    const panLoc = db.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get(locId, 'sup_pan_perro') as any;
    const salchichaLoc = db.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get(locId, 'sup_salchicha_pollo') as any;

    expect(panLoc.current_stock_qty).toBe(99);
    expect(salchichaLoc.current_stock_qty).toBe(99);

    const panGlobal = db.prepare('SELECT current_stock_qty FROM supply_items WHERE id = ?').get('sup_pan_perro') as any;
    const salchichaGlobal = db.prepare('SELECT current_stock_qty FROM supply_items WHERE id = ?').get('sup_salchicha_pollo') as any;

    expect(panGlobal.current_stock_qty).toBe(99);
    expect(salchichaGlobal.current_stock_qty).toBe(99);

    // Movimientos de inventario generados
    const movements = db.prepare('SELECT * FROM inventory_movements WHERE order_id = ?').all(orderId) as any[];
    expect(movements).toHaveLength(2);
    expect(movements.map((m) => m.supply_id).sort()).toEqual(['sup_pan_perro', 'sup_salchicha_pollo']);
  });

  it('2. Falla atómica: un insumo inexistente revierte todo y no deja producto huérfano en la base de datos', () => {
    expect(() => {
      createSellableProductWithRecipe(
        db,
        {
          name: 'Huérfano Test',
          categoryId: 'cat_hot_dogs',
          station: 'hot_dogs',
          items: [
            { supplyId: 'sup_pan_perro', quantity: 1 },
            { supplyId: 'sup_fantasma_no_existe', quantity: 1 }
          ]
        },
        'usr_admin'
      );
    }).toThrow(/sup_fantasma_no_existe.*no existe/i);

    // Verificar que NADA fue insertado en products ni en recipes
    const prodCount = db.prepare("SELECT count(*) as count FROM products WHERE name = 'Huérfano Test'").get() as any;
    expect(prodCount.count).toBe(0);

    const recCount = db.prepare("SELECT count(*) as count FROM recipes WHERE name LIKE '%huerfano%' OR product_id LIKE '%huerfano%'").get() as any;
    expect(recCount.count).toBe(0);
  });

  it('3. Valida categoría inactiva y la rechaza (caso real cat_malteadas is_active=0)', () => {
    // Verificar que cat_malteadas existe y está inactiva
    const cat = db.prepare('SELECT id, is_active FROM categories WHERE id = ?').get('cat_malteadas') as any;
    expect(cat).toBeDefined();
    expect(cat.is_active).toBe(0);

    expect(() => {
      createSellableProductWithRecipe(
        db,
        {
          name: 'Malteada Chocolate',
          categoryId: 'cat_malteadas',
          station: 'caja_bebidas',
          items: [{ supplyId: 'sup_pan_perro', quantity: 1 }]
        },
        'usr_admin'
      );
    }).toThrow(/categoría está inactiva/i);

    // No se creó el producto
    const count = db.prepare("SELECT count(*) as count FROM products WHERE name = 'Malteada Chocolate'").get() as any;
    expect(count.count).toBe(0);
  });

  it('4. Valida estación inválida y cantidades <= 0', () => {
    expect(() => {
      createSellableProductWithRecipe(
        db,
        {
          name: 'Perro Invalido',
          categoryId: 'cat_hot_dogs',
          station: 'estacion_falsa' as any,
          items: [{ supplyId: 'sup_pan_perro', quantity: 1 }]
        },
        'usr_admin'
      );
    }).toThrow(/Estación inválida/i);

    expect(() => {
      createSellableProductWithRecipe(
        db,
        {
          name: 'Perro Cantidad Cero',
          categoryId: 'cat_hot_dogs',
          station: 'hot_dogs',
          items: [{ supplyId: 'sup_pan_perro', quantity: 0 }]
        },
        'usr_admin'
      );
    }).toThrow(/mayor a 0/i);
  });

  it('5. Reventa de insumo (refresco/postre): 1 insumo × 1 unidad calcula costo y margen sugerido correctamente', () => {
    // Crear insumo de refresco
    const now = Date.now();
    db.prepare(`
      INSERT INTO supply_items (
        id, name, unit, purchase_unit, usage_unit, conversion_factor, category,
        cost_per_unit_usd_cents, weighted_avg_cost_usd_cents, last_cost_usd_cents, current_stock_qty,
        created_at_ms, updated_at_ms
      ) VALUES (
        'sup_refresco_colita', 'Refresco Colita Lata', 'unidad', 'caja_24', 'unidad', 24, 'bebidas',
        80, 80, 80, 50, ?, ?
      )
    `).run(now, now);

    const result = createSellableProductWithRecipe(
      db,
      {
        name: 'Refresco Colita Lata',
        categoryId: 'cat_bebidas',
        station: 'caja_bebidas',
        // Sin precio explícito: se sugiere con margen objetivo (65%)
        // Costo = 80 centavos. Margen 65% -> 80 / (1 - 0.65) = 80 / 0.35 = 228.57 -> 229 centavos
        items: [{ supplyId: 'sup_refresco_colita', quantity: 1 }]
      },
      'usr_admin'
    );

    expect(result.calculatedCostUsdCents).toBe(80);
    expect(result.suggestedPriceUsdCents).toBe(229);
    expect(result.priceUsdCents).toBe(229); // Adoptó el sugerido al no enviar precio
    expect(result.recipe.items).toHaveLength(1);
    expect(result.recipe.items[0].supplyItemId).toBe('sup_refresco_colita');
    expect(result.recipe.items[0].quantityRequired).toBe(1);
  });

  it('6. Route policy clasifica POST /api/profitability/products/quick-create como ADMIN', () => {
    const policy = resolveRoutePolicy('POST', '/api/profitability/products/quick-create');
    expect(policy.matched).toBe(true);
    expect(policy.level).toBe('ADMIN');

    expect(isRoleAllowed('ADMIN', 'admin')).toBe(true);
    expect(isRoleAllowed('ADMIN', 'supervisor')).toBe(false);
    expect(isRoleAllowed('ADMIN', 'cajera')).toBe(false);
    expect(isRoleAllowed('ADMIN', 'mesonero')).toBe(false);
  });
});
