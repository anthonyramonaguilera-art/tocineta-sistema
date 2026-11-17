import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrate.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import {
  CRITICAL_SUPPLIES,
  CRITICAL_RECIPES,
  ensureCriticalInventoryBootstrap,
  ensureIngredientSupplyMap
} from '../src/modules/profitability/inventory.js';

/**
 * R0 — Bootstrap de inventario no destructivo.
 *
 * Una base "limpia" aquí significa: migraciones al día + catálogo oficial sembrado,
 * sin ningún insumo/receta/mapa creado a mano. La migración 0048 ya deja 6 insumos
 * de reventa por sabor y sus recetas, así que los conteos se miden como delta.
 */
describe('R0 — Bootstrap de inventario no destructivo', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, { dbPath: ':memory:' });
    seedCatalog(db);
  });

  afterEach(() => {
    db.close();
  });

  function countRows(table: string): number {
    return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
  }

  function supplySnapshot(id: string) {
    return db.prepare(`
      SELECT cost_per_unit_usd_cents, previous_cost_usd_cents, current_stock_qty, minimum_stock_qty
      FROM supply_items WHERE id = ?
    `).get(id);
  }

  function recipeIdsOf(productId: string): string[] {
    return (db.prepare('SELECT id FROM recipes WHERE product_id = ? ORDER BY id').all(productId) as Array<{ id: string }>)
      .map(r => r.id);
  }

  function productsWithRecipe(): Set<string> {
    return new Set(
      (db.prepare('SELECT DISTINCT product_id FROM recipes').all() as Array<{ product_id: string }>)
        .map(r => r.product_id)
    );
  }

  function existingProductIds(): Set<string> {
    return new Set((db.prepare('SELECT id FROM products').all() as Array<{ id: string }>).map(p => p.id));
  }

  it('base limpia: siembra los insumos críticos, las recetas semilla y los 7 pares del mapa', () => {
    const suppliesBefore = countRows('supply_items');
    const recipesBefore = countRows('recipes');
    const itemsBefore = countRows('recipe_items');

    const recipesToCreate = CRITICAL_RECIPES.filter(
      r => existingProductIds().has(r.productId) && !productsWithRecipe().has(r.productId)
    );
    expect(recipesToCreate.length).toBeGreaterThan(0);

    ensureCriticalInventoryBootstrap(db);

    expect(countRows('supply_items')).toBe(suppliesBefore + CRITICAL_SUPPLIES.length);
    for (const sup of CRITICAL_SUPPLIES) {
      const row = db.prepare('SELECT name, cost_per_unit_usd_cents, current_stock_qty FROM supply_items WHERE id = ?')
        .get(sup.id) as { name: string; cost_per_unit_usd_cents: number; current_stock_qty: number };
      expect(row).toBeDefined();
      expect(row.name).toBe(sup.name);
      expect(row.cost_per_unit_usd_cents).toBe(sup.costPerUnitUsdCents);
      expect(row.current_stock_qty).toBe(sup.initialStock);
    }

    expect(countRows('recipes')).toBe(recipesBefore + recipesToCreate.length);
    expect(countRows('recipe_items')).toBe(
      itemsBefore + recipesToCreate.reduce((total, recipe) => total + recipe.items.length, 0)
    );

    const mapPairs = db.prepare('SELECT ingredient_id, supply_id FROM ingredient_supply_map ORDER BY ingredient_id').all();
    expect(mapPairs).toHaveLength(7);
  });

  it('preserva el costo real 999 y la receta propia del negocio', () => {
    // Insumo real ya existente con costo y stock capturados por la dueña.
    const now = Date.now();
    db.prepare(`
      INSERT INTO supply_items (
        id, name, unit, unit_measure, current_stock_qty, minimum_stock_qty,
        cost_per_unit_usd_cents, previous_cost_usd_cents, created_at_ms, updated_at_ms
      ) VALUES ('sup_pan_brioche', 'Pan Brioche Hamburguesa', 'unid', 'und', 77, 55, 999, 888, ?, ?)
    `).run(now, now);

    // Receta propia para un producto que también tiene receta semilla.
    db.prepare('INSERT INTO recipes (id, product_id, name, notes) VALUES (?, ?, ?, ?)')
      .run('rec_propia_miami', 'prod_miami', 'Receta propia Miami', 'editada por la dueña');
    db.prepare('INSERT INTO recipe_items (id, recipe_id, supply_item_id, quantity_required) VALUES (?, ?, ?, ?)')
      .run('ri_propia_miami_1', 'rec_propia_miami', 'sup_refresco_pepsi', 2);

    ensureCriticalInventoryBootstrap(db);

    expect(supplySnapshot('sup_pan_brioche')).toEqual({
      cost_per_unit_usd_cents: 999,
      previous_cost_usd_cents: 888,
      current_stock_qty: 77,
      minimum_stock_qty: 55
    });

    expect(recipeIdsOf('prod_miami')).toEqual(['rec_propia_miami']);
    expect(
      db.prepare('SELECT supply_item_id, quantity_required FROM recipe_items WHERE recipe_id = ?')
        .all('rec_propia_miami')
    ).toEqual([{ supply_item_id: 'sup_refresco_pepsi', quantity_required: 2 }]);
  });

  it('dos corridas seguidas son idempotentes', () => {
    ensureCriticalInventoryBootstrap(db);

    const snapshot = () => ({
      supplies: countRows('supply_items'),
      recipes: countRows('recipes'),
      recipeItems: countRows('recipe_items'),
      map: countRows('ingredient_supply_map'),
      brioche: supplySnapshot('sup_pan_brioche'),
      carne: supplySnapshot('sup_carne_smash'),
      miami: recipeIdsOf('prod_miami')
    });

    const first = snapshot();
    ensureCriticalInventoryBootstrap(db);
    expect(snapshot()).toEqual(first);

    ensureCriticalInventoryBootstrap(db);
    expect(snapshot()).toEqual(first);
  });

  it('una receta existente vacía NO se rellena', () => {
    const itemsBefore = countRows('recipe_items');
    db.prepare('INSERT INTO recipes (id, product_id, name) VALUES (?, ?, ?)')
      .run('rec_vacia_miami', 'prod_miami', 'Miami');

    const recipesToCreate = CRITICAL_RECIPES.filter(
      r => r.productId !== 'prod_miami' && existingProductIds().has(r.productId) && !productsWithRecipe().has(r.productId)
    );

    ensureCriticalInventoryBootstrap(db);

    expect(recipeIdsOf('prod_miami')).toEqual(['rec_vacia_miami']);
    expect(countRows('recipe_items')).toBe(
      itemsBefore + recipesToCreate.reduce((total, recipe) => total + recipe.items.length, 0)
    );
    expect(db.prepare('SELECT COUNT(*) AS c FROM recipe_items WHERE recipe_id = ?').get('rec_vacia_miami'))
      .toEqual({ c: 0 });
  });

  it('el mapa no se siembra si falta el ingrediente o el insumo', () => {
    ensureCriticalInventoryBootstrap(db);
    expect(countRows('ingredient_supply_map')).toBe(7);

    db.prepare('DELETE FROM ingredient_supply_map').run();

    // Se fuerza la ausencia del ingrediente y del insumo, saltando las claves foráneas.
    db.pragma('foreign_keys = OFF');
    db.prepare('DELETE FROM ingredients WHERE id = ?').run('ing_base_pan_brioche');
    db.prepare('DELETE FROM supply_items WHERE id = ?').run('sup_pechuga_pollo');
    db.pragma('foreign_keys = ON');

    ensureIngredientSupplyMap(db);

    expect(countRows('ingredient_supply_map')).toBe(5);
    expect(
      db.prepare('SELECT 1 AS ok FROM ingredient_supply_map WHERE ingredient_id = ?').get('ing_base_pan_brioche')
    ).toBeUndefined();
    expect(
      db.prepare('SELECT 1 AS ok FROM ingredient_supply_map WHERE supply_id = ?').get('sup_pechuga_pollo')
    ).toBeUndefined();
  });
});
