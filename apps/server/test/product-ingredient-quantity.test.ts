import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../src/db/migrate.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { getAdminMenu, getPosMenu } from '../src/modules/menu/menu-service.js';
import { calculateDishUnitCost, calculateShoppingList } from '../src/modules/quotes/quotes-service.js';

const NEW_MIGRATION = '0049_product_ingredients_quantity.sql';
const migrationsDir = fileURLToPath(new URL('../src/db/migrations/', import.meta.url));

// Americana Deluxe: pan 35 + carne 70 + pollo crispy 80 + queso americano 30 +
// tocineta 30 + pepinillo 15 + cebolla caramelizada 15 + salsa americana 15 + papas 30.
const AMERICANA_COST_COLLAPSED_BY_0047 = 320;
const AMERICANA_COST_RESTORED = 560;

describe('Cantidad por ingrediente de producto restaurada por 0049 (@tocineta/server)', () => {
  let db: Database.Database;
  let legacyMigrationsDir: string;

  const countLinks = (productId: string, ingredientId: string): number =>
    (
      db
        .prepare('SELECT COUNT(*) AS c FROM product_ingredients WHERE product_id = ? AND ingredient_id = ?')
        .get(productId, ingredientId) as { c: number }
    ).c;

  const posBaseIngredient = (productId: string, ingredientId: string) => {
    const product = getPosMenu(db).categories
      .flatMap(c => c.products)
      .find(p => p.id === productId);
    expect(product).toBeDefined();
    return product!.baseIngredients.find(i => i.id === ingredientId);
  };

  // Aplica la 0049 como en producción: primero la base sembrada (0000..0048) y
  // luego el runner real, de modo que la migración opere sobre filas existentes.
  const upgradeToQuantityMigration = async (): Promise<void> => {
    const result = await runMigrations(db, { dbPath: ':memory:', migrationsDir });
    expect(result.appliedMigrations).toContain(NEW_MIGRATION);
  };

  beforeAll(() => {
    legacyMigrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tocineta_pi_qty_legacy_'));
    for (const file of fs.readdirSync(migrationsDir)) {
      if (file.endsWith('.sql') && file < NEW_MIGRATION) {
        fs.copyFileSync(path.join(migrationsDir, file), path.join(legacyMigrationsDir, file));
      }
    }
  });

  afterAll(() => {
    fs.rmSync(legacyMigrationsDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    db = new Database(':memory:');
    await runMigrations(db, { dbPath: ':memory:', migrationsDir: legacyMigrationsDir });
    seedCatalog(db);
  });

  afterEach(() => {
    db.close();
  });

  it('La 0049 agrega quantity INTEGER NOT NULL DEFAULT 1 y conserva el índice uq_prod_ing', async () => {
    await upgradeToQuantityMigration();

    const columns = db.prepare('PRAGMA table_info(product_ingredients)').all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const quantity = columns.find(c => c.name === 'quantity');
    expect(quantity).toBeDefined();
    expect(quantity?.type).toBe('INTEGER');
    expect(quantity?.notnull).toBe(1);
    expect(quantity?.dflt_value).toBe('1');

    const indexes = db.prepare('PRAGMA index_list(product_ingredients)').all() as Array<{
      name: string;
      unique: number;
    }>;
    expect(indexes.find(i => i.name === 'uq_prod_ing')?.unique).toBe(1);
  });

  it('Americana Deluxe devuelve carne con cantidad 4 y queso americano con cantidad 2', async () => {
    await upgradeToQuantityMigration();

    expect(posBaseIngredient('prod_americana_deluxe', 'ing_base_carne_smash')?.quantity).toBe(4);
    expect(posBaseIngredient('prod_americana_deluxe', 'ing_base_queso_americano')?.quantity).toBe(2);

    const admin = getAdminMenu(db) as any;
    const adminProduct = admin.products.find((p: any) => p.id === 'prod_americana_deluxe');
    const carne = adminProduct.ingredients.find((i: any) => i.ingredientId === 'ing_base_carne_smash');
    const queso = adminProduct.ingredients.find((i: any) => i.ingredientId === 'ing_base_queso_americano');
    expect(carne.quantity).toBe(4);
    expect(queso.quantity).toBe(2);
  });

  it('El costo de cotización vuelve al valor anterior a la 0047 (Americana Deluxe: 320 -> 560)', async () => {
    const collapsed = db.prepare(`
      SELECT COALESCE(SUM(i.internal_cost_usd_cents), 0) AS total
      FROM product_ingredients pi
      JOIN ingredients i ON pi.ingredient_id = i.id
      WHERE pi.product_id = ?
    `).get('prod_americana_deluxe') as { total: number };
    expect(collapsed.total).toBe(AMERICANA_COST_COLLAPSED_BY_0047);

    await upgradeToQuantityMigration();

    expect(calculateDishUnitCost(db, 'prod_americana_deluxe')).toBe(AMERICANA_COST_RESTORED);
  });

  it('La lista de compras multiplica la cantidad de cada ingrediente', async () => {
    await upgradeToQuantityMigration();

    const list = calculateShoppingList(db, [{ productId: 'prod_americana_deluxe', quantity: 2 }]);
    const carne = list.find(i => i.ingredientId === 'ing_base_carne_smash');
    expect(carne?.requiredCount).toBe(8);
    expect(carne?.totalCostUsdCents).toBe(560);

    const queso = list.find(i => i.ingredientId === 'ing_base_queso_americano');
    expect(queso?.requiredCount).toBe(4);
    expect(queso?.totalCostUsdCents).toBe(120);
  });

  it('Los ingredientes sin cantidad restaurada quedan en 1', async () => {
    await upgradeToQuantityMigration();

    // Solo los 11 pares colapsados por la 0047 recuperan cantidad; el resto vale 1.
    const restored = db.prepare('SELECT COUNT(*) AS c FROM product_ingredients WHERE quantity > 1').get() as { c: number };
    expect(restored.c).toBe(11);

    expect(posBaseIngredient('prod_americana_deluxe', 'ing_base_pan_brioche')?.quantity).toBe(1);
    const streetDog = getPosMenu(db).categories
      .flatMap(c => c.products)
      .find(p => p.id === 'prod_street_dog');
    expect(streetDog).toBeDefined();
    expect(streetDog!.baseIngredients.every(i => i.quantity === 1)).toBe(true);
  });

  it('Insertar el mismo ingrediente dos veces sigue dejando una sola fila', async () => {
    await upgradeToQuantityMigration();

    db.prepare(`
      INSERT INTO product_ingredients (id, product_id, ingredient_id, is_removable, display_order, quantity)
      VALUES ('pi_qty_dup_1', 'prod_street_dog', 'ing_base_carne_smash', 1, 99, 2)
    `).run();

    expect(() =>
      db.prepare(`
        INSERT INTO product_ingredients (id, product_id, ingredient_id, is_removable, display_order, quantity)
        VALUES ('pi_qty_dup_2', 'prod_street_dog', 'ing_base_carne_smash', 1, 100, 3)
      `).run()
    ).toThrow(/UNIQUE constraint failed/);

    expect(countLinks('prod_street_dog', 'ing_base_carne_smash')).toBe(1);
    const row = db.prepare(`
      SELECT quantity FROM product_ingredients
      WHERE product_id = 'prod_street_dog' AND ingredient_id = 'ing_base_carne_smash'
    `).get() as { quantity: number };
    expect(row.quantity).toBe(2);
  });
});
