import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { loginAs } from './test-helpers.js';

describe('H3 - Ingredientes únicos por producto (@tocineta/server)', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_pi_unique_${Date.now()}`);
  const tempDb = path.join(tempDir, 'product_ingredients.db');
  let rawDb: Database.Database;
  let adminToken: string;

  const countLinks = (productId: string, ingredientId: string): number =>
    (
      rawDb
        .prepare('SELECT COUNT(*) AS c FROM product_ingredients WHERE product_id = ? AND ingredient_id = ?')
        .get(productId, ingredientId) as { c: number }
    ).c;

  const countProductLinks = (productId: string): number =>
    (
      rawDb
        .prepare('SELECT COUNT(*) AS c FROM product_ingredients WHERE product_id = ?')
        .get(productId) as { c: number }
    ).c;

  const createProduct = async (name: string, baseIngredientIds?: string[]): Promise<string> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/menu/products',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        categoryId: 'cat_hot_dogs',
        name,
        priceUsdCents: 300,
        station: 'hot_dogs',
        baseIngredientIds
      }
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.payload).product.id;
  };

  const linkIngredient = async (productId: string, ingredientId: string) => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/menu/products/${productId}/ingredients`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { ingredientId }
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.payload);
  };

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { dbPath: tempDb });

    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      getDatabaseContext().rawDb.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('La migración 0047 crea el índice único uq_prod_ing sobre (product_id, ingredient_id)', () => {
    const indexes = rawDb.prepare('PRAGMA index_list(product_ingredients)').all() as Array<{
      name: string;
      unique: number;
    }>;
    const uq = indexes.find(i => i.name === 'uq_prod_ing');
    expect(uq).toBeDefined();
    expect(uq?.unique).toBe(1);
  });

  it('Crear un producto con 2 ingredientes deja exactamente una fila por ingrediente', async () => {
    const productId = await createProduct('Dog Dos Ingredientes QA', [
      'ing_base_pan_perro',
      'ing_base_queso_cheddar'
    ]);

    expect(countProductLinks(productId)).toBe(2);
    expect(countLinks(productId, 'ing_base_pan_perro')).toBe(1);
    expect(countLinks(productId, 'ing_base_queso_cheddar')).toBe(1);
  });

  it('Enlazar el mismo ingrediente dos veces mantiene una sola fila', async () => {
    const productId = await createProduct('Dog Enlace Repetido QA');

    const first = await linkIngredient(productId, 'ing_base_pan_perro');
    const second = await linkIngredient(productId, 'ing_base_pan_perro');

    // El segundo enlace es idempotente: devuelve el vínculo existente.
    expect(second.id).toBe(first.id);
    expect(countProductLinks(productId)).toBe(1);
    expect(countLinks(productId, 'ing_base_pan_perro')).toBe(1);
  });

  it('Crear un producto con el mismo ingrediente repetido en baseIngredientIds deja una sola fila', async () => {
    const productId = await createProduct('Dog Base Repetida QA', [
      'ing_base_pan_brioche',
      'ing_base_pan_brioche'
    ]);

    expect(countProductLinks(productId)).toBe(1);
    expect(countLinks(productId, 'ing_base_pan_brioche')).toBe(1);
  });

  it('La base rechaza un duplicado insertado directamente (índice único activo)', async () => {
    const productId = await createProduct('Dog Indice Unico QA');
    await linkIngredient(productId, 'ing_base_tocineta');

    expect(() =>
      rawDb
        .prepare(
          `INSERT INTO product_ingredients (id, product_id, ingredient_id, is_removable, display_order)
           VALUES (?, ?, ?, 1, 99)`
        )
        .run('pi_duplicado_manual', productId, 'ing_base_tocineta')
    ).toThrow(/UNIQUE constraint failed/);

    expect(countLinks(productId, 'ing_base_tocineta')).toBe(1);
  });
});
