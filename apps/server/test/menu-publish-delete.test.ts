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

describe('Menu Publish & Delete Tests (Bugs A y C) (@tocineta/server)', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_menu_pub_del_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_pub_del.db');
  let rawDb: Database.Database;

  let adminToken: string;
  let cajeraToken: string;

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
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      const dbCtx = getDatabaseContext();
      dbCtx.rawDb.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // 1. Crear producto en categoría activa normal → 201 y aparece en GET /api/menu/pos.
  it('1. Crear producto en categoría activa normal → 201 y aparece en GET /api/menu/pos', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/menu/products',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        categoryId: 'cat_hot_dogs',
        name: 'Perro Especial Test',
        priceUsdCents: 350,
        station: 'hot_dogs',
        description: 'Perro caliente de prueba'
      }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.product.id).toBeDefined();

    const posRes = await app.inject({ method: 'GET', url: '/api/menu/pos' });
    expect(posRes.statusCode).toBe(200);
    const posData = posRes.json();
    const cat = posData.categories.find((c: any) => c.id === 'cat_hot_dogs');
    expect(cat).toBeDefined();
    const prod = cat.products.find((p: any) => p.name === 'Perro Especial Test');
    expect(prod).toBeDefined();
  });

  // 2. Crear en inactiva → 400. En cat_libre (interna) → 400. Categoría inexistente → 400.
  it('2. Crear en inactiva → 400. En cat_libre (interna) → 400. Categoría inexistente → 400', async () => {
    // Categoría inactiva (cat_malteadas por defecto está inactiva)
    const inactivaRes = await app.inject({
      method: 'POST',
      url: '/api/menu/products',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        categoryId: 'cat_malteadas',
        name: 'Malteada Inactiva Test',
        priceUsdCents: 400,
        station: 'caja_bebidas'
      }
    });
    expect(inactivaRes.statusCode).toBe(400);
    expect(inactivaRes.json().error).toContain('La categoría está inactiva');

    // Categoría interna (cat_libre o cat_obsequios)
    const internaRes = await app.inject({
      method: 'POST',
      url: '/api/menu/products',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        categoryId: 'cat_libre',
        name: 'Producto en Libre Test',
        priceUsdCents: 100,
        station: 'caja_bebidas'
      }
    });
    expect(internaRes.statusCode).toBe(400);
    expect(internaRes.json().error).toContain('No se pueden crear productos en una categoría interna');

    // Categoría inexistente
    const inexistenteRes = await app.inject({
      method: 'POST',
      url: '/api/menu/products',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        categoryId: 'cat_fantasma_no_existe',
        name: 'Producto Fantasma Test',
        priceUsdCents: 100,
        station: 'hot_dogs'
      }
    });
    expect(inexistenteRes.statusCode).toBe(400);
    expect(inexistenteRes.json().error).toContain('La categoría no existe');
  });

  // 3. PATCH { isActive:false } → desaparece de /api/menu/pos, sigue en admin con isActive=false.
  let toggleProdId: string;
  it('3. PATCH { isActive:false } → desaparece de /api/menu/pos, sigue en admin con isActive=false', async () => {
    // Crear producto primero
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/menu/products',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        categoryId: 'cat_hot_dogs',
        name: 'Perro Toggle Test',
        priceUsdCents: 300,
        station: 'hot_dogs'
      }
    });
    expect(createRes.statusCode).toBe(201);
    toggleProdId = createRes.json().product.id;

    // Desactivar producto vía PATCH
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/menu/products/${toggleProdId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { isActive: false }
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().product.isActive).toBe(false);

    // Desaparece de /api/menu/pos
    const posRes = await app.inject({ method: 'GET', url: '/api/menu/pos' });
    const posData = posRes.json();
    const cat = posData.categories.find((c: any) => c.id === 'cat_hot_dogs');
    expect(cat.products.some((p: any) => p.id === toggleProdId)).toBe(false);

    // Sigue en admin con isActive=false
    const adminRes = await app.inject({
      method: 'GET',
      url: '/api/menu/admin',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(adminRes.statusCode).toBe(200);
    const adminData = adminRes.json();
    const adminProd = adminData.products.find((p: any) => p.id === toggleProdId);
    expect(adminProd).toBeDefined();
    expect(adminProd.isActive).toBe(false);
  });

  // 4. PATCH { isActive:true } → reaparece en /api/menu/pos.
  it('4. PATCH { isActive:true } → reaparece en /api/menu/pos', async () => {
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/menu/products/${toggleProdId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { isActive: true }
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().product.isActive).toBe(true);

    const posRes = await app.inject({ method: 'GET', url: '/api/menu/pos' });
    const posData = posRes.json();
    const cat = posData.categories.find((c: any) => c.id === 'cat_hot_dogs');
    expect(cat.products.some((p: any) => p.id === toggleProdId)).toBe(true);
  });

  // 5. DELETE producto nuevo nunca vendido → mode 'deleted', ya no existe.
  it('5. DELETE producto nuevo nunca vendido → mode "deleted", ya no existe', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/menu/products',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        categoryId: 'cat_hamburguesas',
        name: 'Hamburguesa Desechable Test',
        priceUsdCents: 500,
        station: 'hamburguesas'
      }
    });
    expect(createRes.statusCode).toBe(201);
    const prodId = createRes.json().product.id;

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/menu/products/${prodId}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(delRes.statusCode).toBe(200);
    const delBody = delRes.json();
    expect(delBody.success).toBe(true);
    expect(delBody.mode).toBe('deleted');

    // Comprobar que en la base de datos ya no existe
    const row = rawDb.prepare('SELECT id FROM products WHERE id = ?').get(prodId);
    expect(row).toBeUndefined();
  });

  // 6. DELETE producto con venta → mode 'archived', isActive=false, pedidos existentes intactos.
  it('6. DELETE producto con venta → mode "archived", isActive=false, pedidos existentes intactos', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/menu/products',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        categoryId: 'cat_hamburguesas',
        name: 'Hamburguesa Con Venta Test',
        priceUsdCents: 600,
        station: 'hamburguesas'
      }
    });
    expect(createRes.statusCode).toBe(201);
    const prodId = createRes.json().product.id;

    // Crear jornada y simular pedido en order_lines
    const jornadaId = `jor_test_${Date.now()}`;
    const orderId = `ord_test_${Date.now()}`;
    const lineId = `line_test_${Date.now()}`;
    const now = Date.now();

    rawDb.prepare(`
      INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status)
      VALUES (?, 'usr_admin', ?, 'abierta')
    `).run(jornadaId, now);

    rawDb.prepare(`
      INSERT INTO orders (
        id, order_number, jornada_id, created_by_user_id,
        gross_food_subtotal_usd_cents, net_food_sales_usd_cents,
        total_to_collect_usd_cents, rate_micro_bs,
        created_at_ms, updated_at_ms
      ) VALUES (
        ?, 9999, ?, 'usr_admin',
        600, 600,
        600, 40000000,
        ?, ?
      )
    `).run(orderId, jornadaId, now, now);

    rawDb.prepare(`
      INSERT INTO order_lines (
        id, order_id, product_id, line_role, quantity,
        unit_price_usd_cents, prorated_unit_price_usd_cents,
        subtotal_usd_cents, station, created_at_ms
      ) VALUES (
        ?, ?, ?, 'STANDARD', 1,
        600, 600,
        600, 'hamburguesas', ?
      )
    `).run(lineId, orderId, prodId, now);

    // Intentar DELETE
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/menu/products/${prodId}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(delRes.statusCode).toBe(200);
    const delBody = delRes.json();
    expect(delBody.success).toBe(true);
    expect(delBody.mode).toBe('archived');

    // Comprobar que en BD sigue existiendo con is_active = 0
    const row = rawDb.prepare('SELECT id, is_active FROM products WHERE id = ?').get(prodId) as any;
    expect(row).toBeDefined();
    expect(row.is_active).toBe(0);

    // Comprobar que pedidos existentes siguen intactos
    const lineCheck = rawDb.prepare('SELECT id, product_id FROM order_lines WHERE id = ?').get(lineId) as any;
    expect(lineCheck).toBeDefined();
    expect(lineCheck.product_id).toBe(prodId);
  });

  // 7. DELETE prod_libre → 403.
  it('7. DELETE prod_libre → 403', async () => {
    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/menu/products/prod_libre',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(delRes.statusCode).toBe(403);
    expect(delRes.json().error).toContain('Producto protegido del sistema');
  });

  // 8. DELETE sin rol admin (cajera) → 403.
  it('8. DELETE sin rol admin (cajera) → 403', async () => {
    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/menu/products/prod_doritos_dog_snacks',
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(delRes.statusCode).toBe(403);
  });

  // 9. DELETE id inexistente → 404.
  it('9. DELETE id inexistente → 404', async () => {
    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/menu/products/prod_id_que_no_existe_nunca',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(delRes.statusCode).toBe(404);
    expect(delRes.json().error).toContain('Producto no encontrado');
  });
});
