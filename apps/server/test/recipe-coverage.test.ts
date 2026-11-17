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
import { loginAs } from './test-helpers.js';

interface CoverageRow {
  productId: string;
  productName: string;
  ingredientsTotal: number;
  ingredientsWithSupply: number;
  coveredIngredients: number;
  uncoveredCount: number;
  missingSupplyCount: number;
  coveragePct: number;
}

interface HealthBody {
  success: boolean;
  total: number;
  incompleteCount: number;
  incomplete: Array<{ productId: string; issues: string[] }>;
  coverage: CoverageRow[];
}

describe('R1 — Cobertura de receta contra ingredientes del producto', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_recipe_coverage_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_recipe_coverage.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;
  const now = Date.now();

  const insertProduct = (id: string, name: string, priceUsdCents = 2000) => {
    rawDb.prepare(`
      INSERT INTO products (
        id, category_id, name, description, price_usd_cents, estimated_cost_usd_cents,
        station, recipe_mode, is_active, is_available, created_at_ms, updated_at_ms
      ) VALUES (?, 'cat_hot_dogs', ?, NULL, ?, 0, 'hot_dogs', 'UNITS', 1, 1, ?, ?)
    `).run(id, name, priceUsdCents, now, now);
  };

  const insertSupply = (id: string, costUsdCents: number) => {
    rawDb.prepare(`
      INSERT INTO supply_items (
        id, name, unit, unit_measure, current_stock_qty, minimum_stock_qty,
        cost_per_unit_usd_cents, weighted_avg_cost_usd_cents, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'unidad', 'und', 10, 1, ?, ?, ?, ?)
    `).run(id, `Insumo ${id}`, costUsdCents, costUsdCents, now, now);
  };

  const insertIngredient = (id: string) => {
    rawDb.prepare(`
      INSERT INTO ingredients (id, name, is_barra_libre, extra_price_usd_cents, internal_cost_usd_cents, is_active)
      VALUES (?, ?, 0, 0, 10, 1)
    `).run(id, `Ingrediente ${id}`);
  };

  const linkProductIngredient = (productId: string, ingredientId: string, displayOrder: number) => {
    rawDb.prepare(`
      INSERT INTO product_ingredients (id, product_id, ingredient_id, is_removable, display_order)
      VALUES (?, ?, ?, 1, ?)
    `).run(`pi_${productId}_${ingredientId}`, productId, ingredientId, displayOrder);
  };

  const mapIngredientToSupply = (ingredientId: string, supplyId: string) => {
    rawDb.prepare('INSERT INTO ingredient_supply_map (ingredient_id, supply_id) VALUES (?, ?)').run(ingredientId, supplyId);
  };

  const insertRecipe = (recipeId: string, productId: string, supplyIds: string[]) => {
    rawDb.prepare('INSERT INTO recipes (id, product_id, name) VALUES (?, ?, ?)').run(recipeId, productId, `Receta ${productId}`);
    supplyIds.forEach((supplyId, index) => {
      rawDb.prepare(`
        INSERT INTO recipe_items (id, recipe_id, supply_item_id, quantity_required)
        VALUES (?, ?, ?, 1)
      `).run(`ri_${recipeId}_${index}`, recipeId, supplyId);
    });
  };

  const fetchHealth = async (): Promise<HealthBody> => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/profitability/recipes/health',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.payload) as HealthBody;
  };

  const coverageOf = (body: HealthBody, productId: string): CoverageRow => {
    const row = body.coverage.find((item) => item.productId === productId);
    expect(row).toBeDefined();
    return row as CoverageRow;
  };

  const issuesOf = (body: HealthBody, productId: string): string[] => {
    const row = body.incomplete.find((item) => item.productId === productId);
    return row ? row.issues : [];
  };

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureOfficialLocations(rawDb);
    seedCriticalSuppliesAndRecipes(rawDb);

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
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

  it('1. Diez ingredientes mapeados y una receta de dos insumos dejan 8 sin cobertura', async () => {
    insertProduct('prod_cov_parcial', 'Cobertura Parcial');
    const mappedSupplyIds: string[] = [];
    for (let index = 1; index <= 10; index += 1) {
      const ingredientId = `ing_cov_parcial_${index}`;
      const supplyId = `sup_cov_parcial_${index}`;
      insertIngredient(ingredientId);
      insertSupply(supplyId, 10);
      mapIngredientToSupply(ingredientId, supplyId);
      linkProductIngredient('prod_cov_parcial', ingredientId, index);
      mappedSupplyIds.push(supplyId);
    }
    insertRecipe('rec_cov_parcial', 'prod_cov_parcial', mappedSupplyIds.slice(0, 2));

    const body = await fetchHealth();
    const parcial = coverageOf(body, 'prod_cov_parcial');

    expect(parcial.ingredientsTotal).toBe(10);
    expect(parcial.ingredientsWithSupply).toBe(10);
    expect(parcial.coveredIngredients).toBe(2);
    expect(parcial.missingSupplyCount).toBe(0);
    expect(parcial.uncoveredCount).toBe(8);
    expect(parcial.coveragePct).toBe(20);
    expect(issuesOf(body, 'prod_cov_parcial')).toContain('ingredientes_sin_cobertura');
  });

  it('2. Un ingrediente sin mapa de insumo se reporta como sin_insumo y no como sin cobertura', async () => {
    insertProduct('prod_cov_sin_mapa', 'Cobertura Sin Mapa');
    insertIngredient('ing_cov_sin_mapa');
    linkProductIngredient('prod_cov_sin_mapa', 'ing_cov_sin_mapa', 1);
    insertSupply('sup_cov_sin_mapa', 10);
    insertRecipe('rec_cov_sin_mapa', 'prod_cov_sin_mapa', ['sup_cov_sin_mapa']);

    const body = await fetchHealth();
    const sinMapa = coverageOf(body, 'prod_cov_sin_mapa');

    expect(sinMapa.ingredientsTotal).toBe(1);
    expect(sinMapa.ingredientsWithSupply).toBe(0);
    expect(sinMapa.coveredIngredients).toBe(0);
    expect(sinMapa.missingSupplyCount).toBe(1);
    expect(sinMapa.uncoveredCount).toBe(0);
    expect(sinMapa.coveragePct).toBe(0);
    expect(issuesOf(body, 'prod_cov_sin_mapa')).not.toContain('ingredientes_sin_cobertura');
  });

  it('3. Una receta que cubre todos los ingredientes mapeados reporta cero sin cobertura', async () => {
    insertProduct('prod_cov_completo', 'Cobertura Completa');
    const supplyIds: string[] = [];
    for (let index = 1; index <= 3; index += 1) {
      const ingredientId = `ing_cov_completo_${index}`;
      const supplyId = `sup_cov_completo_${index}`;
      insertIngredient(ingredientId);
      insertSupply(supplyId, 10);
      mapIngredientToSupply(ingredientId, supplyId);
      linkProductIngredient('prod_cov_completo', ingredientId, index);
      supplyIds.push(supplyId);
    }
    insertRecipe('rec_cov_completo', 'prod_cov_completo', supplyIds);

    const body = await fetchHealth();
    const completo = coverageOf(body, 'prod_cov_completo');

    expect(completo.ingredientsTotal).toBe(3);
    expect(completo.ingredientsWithSupply).toBe(3);
    expect(completo.coveredIngredients).toBe(3);
    expect(completo.missingSupplyCount).toBe(0);
    expect(completo.uncoveredCount).toBe(0);
    expect(completo.coveragePct).toBe(100);
    expect(issuesOf(body, 'prod_cov_completo')).not.toContain('ingredientes_sin_cobertura');
    expect(body.incomplete.some((item) => item.productId === 'prod_cov_completo')).toBe(false);
  });

  it('4. El insumo que aporta una sub-receta también cubre al ingrediente del producto', async () => {
    insertProduct('prod_cov_subreceta', 'Cobertura Sub-Receta');
    insertIngredient('ing_cov_subreceta');
    insertSupply('sup_cov_subreceta', 10);
    mapIngredientToSupply('ing_cov_subreceta', 'sup_cov_subreceta');
    linkProductIngredient('prod_cov_subreceta', 'ing_cov_subreceta', 1);

    rawDb.prepare(`
      INSERT INTO sub_recipes (id, name, yield_quantity, yield_unit, created_at_ms, updated_at_ms)
      VALUES ('sub_cov_salsa', 'Salsa Base', 2, 'kg', ?, ?)
    `).run(now, now);
    rawDb.prepare(`
      INSERT INTO sub_recipe_items (id, sub_recipe_id, supply_id, quantity_required)
      VALUES ('sri_cov_salsa', 'sub_cov_salsa', 'sup_cov_subreceta', 1)
    `).run();
    rawDb.prepare(`
      INSERT INTO recipes (id, product_id, name) VALUES ('rec_cov_subreceta', 'prod_cov_subreceta', 'Receta Sub-Receta')
    `).run();
    rawDb.prepare(`
      INSERT INTO recipe_items (id, recipe_id, supply_item_id, quantity_required, sub_recipe_id)
      VALUES ('ri_cov_subreceta', 'rec_cov_subreceta', NULL, 1, 'sub_cov_salsa')
    `).run();

    const body = await fetchHealth();
    const subreceta = coverageOf(body, 'prod_cov_subreceta');

    expect(subreceta.ingredientsTotal).toBe(1);
    expect(subreceta.ingredientsWithSupply).toBe(1);
    expect(subreceta.coveredIngredients).toBe(1);
    expect(subreceta.uncoveredCount).toBe(0);
    expect(subreceta.coveragePct).toBe(100);
    expect(issuesOf(body, 'prod_cov_subreceta')).not.toContain('ingredientes_sin_cobertura');
  });
});
