import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { buildServer } from '../src/server.js';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { loginAs, ensureTestSupervisor } from './test-helpers.js';

describe('BUG B: Guard de productos agotados u ocultos al crear y editar pedidos', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_sold_out_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_sold_out.db');
  let rawDb: InstanceType<typeof Database>;

  let cajeraToken: string;
  let jornadaId: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    runMigrations(rawDb, path.join(__dirname, '../src/db/migrations'));
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureTestSupervisor(rawDb);

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;

    // Abrir jornada de prueba
    const openRes = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        rateStr: '40.00',
        initialCashUsdCents: 5000,
        initialCashBsCents: 200000,
        notes: 'Jornada Test Sold Out'
      }
    });
    jornadaId = openRes.json().jornada.id;

    // Abrir sesión de caja para cobros
    await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        initialCashUsdCents: 5000,
        initialCashBsCents: 200000,
        locationId: 'loc_alta_vista'
      }
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // 1. is_available=0 → crear pedido 409, NO crea fila en orders.
  it('1. is_available=0 -> crear pedido 409, NO crea fila en orders', async () => {
    const ordersCountBefore = (rawDb.prepare('SELECT count(*) as cnt FROM orders').get() as any).cnt;

    rawDb.prepare('UPDATE products SET is_available = 0 WHERE id = ?').run('prod_street_dog');

    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        lines: [
          {
            productId: 'prod_street_dog',
            quantity: 1
          }
        ]
      }
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('PRODUCT_UNAVAILABLE');
    expect(body.error).toContain('Street Dog');
    expect(body.unavailable).toEqual([
      { productId: 'prod_street_dog', name: 'Street Dog', reason: 'agotado' }
    ]);

    const ordersCountAfter = (rawDb.prepare('SELECT count(*) as cnt FROM orders').get() as any).cnt;
    expect(ordersCountAfter).toBe(ordersCountBefore);

    // Restaurar
    rawDb.prepare('UPDATE products SET is_available = 1 WHERE id = ?').run('prod_street_dog');
  });

  // 2. is_active=0 → 409, reason 'oculto'.
  it('2. is_active=0 -> 409, reason "oculto"', async () => {
    rawDb.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run('prod_street_dog');

    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        lines: [
          {
            productId: 'prod_street_dog',
            quantity: 1
          }
        ]
      }
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('PRODUCT_UNAVAILABLE');
    expect(body.unavailable).toEqual([
      { productId: 'prod_street_dog', name: 'Street Dog', reason: 'oculto' }
    ]);

    // Restaurar
    rawDb.prepare('UPDATE products SET is_active = 1 WHERE id = ?').run('prod_street_dog');
  });

  // 3. Producto disponible → 201.
  it('3. Producto disponible -> 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        lines: [
          {
            productId: 'prod_street_dog',
            quantity: 1
          }
        ]
      }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.order).toBeDefined();
  });

  // 4. Ítem libre (prod_libre) → sigue funcionando.
  it('4. Ítem libre (prod_libre) -> sigue funcionando', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        lines: [
          {
            productId: 'prod_libre',
            customName: 'Empanada Especial',
            customPriceUsdCents: 200,
            quantity: 1,
            station: 'caja_bebidas'
          }
        ]
      }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.order.lines[0].custom_name).toBe('Empanada Especial');
  });

  // 5. Combo con hijo agotado → 409.
  it('5. Combo con hijo agotado -> 409', async () => {
    // prod_combo_street tiene comboChildren. Hacemos que prod_street_dog esté agotado
    rawDb.prepare('UPDATE products SET is_available = 0 WHERE id = ?').run('prod_street_dog');

    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        lines: [
          {
            productId: 'prod_combo_street',
            quantity: 1,
            comboChildren: [
              {
                productId: 'prod_street_dog',
                quantity: 1
              }
            ]
          }
        ]
      }
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('PRODUCT_UNAVAILABLE');
    expect(body.unavailable).toEqual([
      { productId: 'prod_street_dog', name: 'Street Dog', reason: 'agotado' }
    ]);

    // Restaurar
    rawDb.prepare('UPDATE products SET is_available = 1 WHERE id = ?').run('prod_street_dog');
  });

  // 6. updateOrder sin cambiar X pero X agotado → 200.
  it('6. updateOrder sin cambiar X pero X agotado -> 200', async () => {
    // 1. Crear orden con prod_street_dog
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        lines: [
          {
            productId: 'prod_street_dog',
            quantity: 2
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(201);
    const createdOrder = createRes.json().order;

    // 2. Agotar prod_street_dog DESPUÉS de haber creado la orden
    rawDb.prepare('UPDATE products SET is_available = 0 WHERE id = ?').run('prod_street_dog');

    // 3. Editar la orden (por ejemplo cambiar notas o cantidad del mismo producto)
    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${createdOrder.id}`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        version: createdOrder.version,
        notes: 'Cliente pide servilletas extra',
        lines: [
          {
            productId: 'prod_street_dog',
            quantity: 3
          }
        ]
      }
    });

    expect(updateRes.statusCode).toBe(200);
    const updatedOrder = updateRes.json().order;
    expect(updatedOrder.version).toBe(createdOrder.version + 1);

    // Restaurar
    rawDb.prepare('UPDATE products SET is_available = 1 WHERE id = ?').run('prod_street_dog');
  });

  // 7. updateOrder agregando producto agotado nuevo → 409 y líneas originales intactas.
  it('7. updateOrder agregando producto agotado nuevo -> 409 y líneas originales intactas', async () => {
    // 1. Crear orden con prod_street_dog
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        lines: [
          {
            productId: 'prod_street_dog',
            quantity: 1
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(201);
    const createdOrder = createRes.json().order;

    // 2. Agotar prod_brazil_dog
    rawDb.prepare('UPDATE products SET is_available = 0 WHERE id = ?').run('prod_brazil_dog');

    // 3. Intentar actualizar agregando prod_brazil_dog
    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${createdOrder.id}`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        version: createdOrder.version,
        lines: [
          {
            productId: 'prod_street_dog',
            quantity: 1
          },
          {
            productId: 'prod_brazil_dog',
            quantity: 1
          }
        ]
      }
    });

    expect(updateRes.statusCode).toBe(409);
    const body = updateRes.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('PRODUCT_UNAVAILABLE');
    expect(body.unavailable).toEqual([
      { productId: 'prod_brazil_dog', name: 'Brazil Dog', reason: 'agotado' }
    ]);

    // 4. Verificar que las líneas originales siguen intactas
    const linesAfter = rawDb.prepare('SELECT product_id, quantity FROM order_lines WHERE order_id = ?').all(createdOrder.id) as any[];
    expect(linesAfter.length).toBe(1);
    expect(linesAfter[0].product_id).toBe('prod_street_dog');
    expect(linesAfter[0].quantity).toBe(1);

    // Restaurar
    rawDb.prepare('UPDATE products SET is_available = 1 WHERE id = ?').run('prod_brazil_dog');
  });

  // 8. Reactivar producto → pedido se crea.
  it('8. Reactivar producto -> pedido se crea', async () => {
    // 1. Desactivar producto
    rawDb.prepare('UPDATE products SET is_available = 0 WHERE id = ?').run('prod_street_dog');

    // 2. Intento falla con 409
    const failRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        lines: [
          {
            productId: 'prod_street_dog',
            quantity: 1
          }
        ]
      }
    });
    expect(failRes.statusCode).toBe(409);

    // 3. Reactivar producto
    rawDb.prepare('UPDATE products SET is_available = 1 WHERE id = ?').run('prod_street_dog');

    // 4. Intento exitoso 201
    const successRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        lines: [
          {
            productId: 'prod_street_dog',
            quantity: 1
          }
        ]
      }
    });
    expect(successRes.statusCode).toBe(201);
    expect(successRes.json().success).toBe(true);
  });
});
