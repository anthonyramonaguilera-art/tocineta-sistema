/**
 * SISTEMA OPERATIVO LOCAL TOCINETA
 * Pruebas de Aceptación P3-B: Inmutabilidad de órdenes en cocina (BUG-08)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { buildServer } from '../src/server.js';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { deductInventoryForOrder } from '../src/modules/profitability/recipes-service.js';
import { loginAs, ensureTestSupervisor } from './test-helpers.js';

describe('P3-B — Inmutabilidad de órdenes en cocina (BUG-08) (@tocineta/server)', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_p3b_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_p3b.db');
  let rawDb: Database.Database;

  let adminToken: string;
  let cajeraToken: string;
  let mesoneroToken: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { migrationsDir: path.join(__dirname, '../src/db/migrations') });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureTestSupervisor(rawDb);

    // Configurar insumo y receta para prod_smash_clasica para verificar deducción en inventario
    const now = Date.now();
    rawDb.prepare(`
      INSERT OR REPLACE INTO supply_items (id, name, unit, cost_per_unit_usd_cents, created_at_ms, updated_at_ms)
      VALUES ('sup_carne_p3b', 'Carne Molida P3B', 'kg', 500, ?, ?)
    `).run(now, now);

    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES ('loc_inv_p3b', 'loc_alta_vista', 'sup_carne_p3b', 100, 10, ?)
    `).run(now);

    rawDb.prepare(`
      INSERT OR REPLACE INTO recipes (id, product_id, name)
      VALUES ('rec_smash_p3b', 'prod_smash_clasica', 'Receta Smash P3B')
    `).run();

    rawDb.prepare(`
      INSERT OR REPLACE INTO recipe_items (id, recipe_id, supply_item_id, quantity_required)
      VALUES ('ritem_p3b_1', 'rec_smash_p3b', 'sup_carne_p3b', 1)
    `).run();

    // Habilitar modo tracked de inventario
    rawDb.prepare(`
      UPDATE business_settings
      SET inventory_operation_mode = 'tracked',
          inventory_tracking_since_ms = ?
      WHERE id = 'default'
    `).run(now - 10000);

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    // Iniciar jornada de prueba con usuario cajera
    rawDb.prepare(`
      INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status, initial_cash_usd_cents)
      VALUES ('jor_p3b_test', 'usr_cajera', ?, 'abierta', 5000)
    `).run(now);

    rawDb.prepare(`
      INSERT INTO cash_sessions (id, jornada_id, user_id, opened_at_ms, status)
      VALUES ('cs_p3b_test', 'jor_p3b_test', 'usr_cajera', ?, 'abierta')
    `).run(now);

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
    mesoneroToken = (await loginAs(app, 'mesonero', rawDb)).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('(a) orden pagada -> líneas listo -> deliver; luego POST /api/kds/lines/:id/status {status: "preparando"} -> 409 y la orden sigue "entregado" y el inventario no cambia', async () => {
    // 1. Crear orden
    const resCreate = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        idempotencyKey: `idemp_p3b_a_${Date.now()}`,
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_smash_clasica', quantity: 1 }]
      }
    });
    expect(resCreate.statusCode).toBe(201);
    const order = JSON.parse(resCreate.payload).order;

    // 2. Pagar orden
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { tenders: [{ method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }] }
    });
    expect(resPay.statusCode).toBe(200);

    // 3. Marcar líneas de cocina como 'listo'
    const orderLines = rawDb.prepare('SELECT id FROM order_lines WHERE order_id = ?').all(order.id) as any[];
    expect(orderLines.length).toBeGreaterThan(0);
    const lineId = orderLines[0].id;

    const resReady = await app.inject({
      method: 'POST',
      url: `/api/kds/lines/${lineId}/status`,
      payload: { status: 'listo' }
    });
    expect(resReady.statusCode).toBe(200);

    // 4. Entregar orden con archive: false para que quede en 'entregado'
    const resDeliver = await app.inject({
      method: 'POST',
      url: `/api/kds/orders/${order.id}/deliver`,
      payload: { archive: false }
    });
    expect(resDeliver.statusCode).toBe(200);
    expect(JSON.parse(resDeliver.payload).fulfillmentStatus).toBe('entregado');

    const dbOrderAfterDeliver = rawDb.prepare('SELECT fulfillment_status FROM orders WHERE id = ?').get(order.id) as any;
    expect(dbOrderAfterDeliver.fulfillment_status).toBe('entregado');

    // Registrar estado del inventario para esta orden
    const movementsBefore = rawDb.prepare('SELECT * FROM inventory_movements WHERE order_id = ?').all(order.id);

    // 5. Toque tardío sobre tarjeta entregada intentando pasar a 'preparando'
    const resLateTouch = await app.inject({
      method: 'POST',
      url: `/api/kds/lines/${lineId}/status`,
      payload: { status: 'preparando' }
    });

    expect(resLateTouch.statusCode).toBe(409);
    const lateBody = JSON.parse(resLateTouch.payload);
    expect(lateBody.code).toBe('ORDER_ALREADY_FINALIZED');

    // 6. Verificar que la orden sigue 'entregado' y el inventario no cambió
    const dbOrderAfterLate = rawDb.prepare('SELECT fulfillment_status FROM orders WHERE id = ?').get(order.id) as any;
    expect(dbOrderAfterLate.fulfillment_status).toBe('entregado');

    const movementsAfter = rawDb.prepare('SELECT * FROM inventory_movements WHERE order_id = ?').all(order.id);
    expect(movementsAfter.length).toBe(movementsBefore.length);
  });

  it('(b) dos llamadas seguidas que disparan deducción generan UN solo conjunto de movimientos de inventario', async () => {
    // 1. Crear orden con 2 líneas
    const resCreate = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        idempotencyKey: `idemp_p3b_b_${Date.now()}`,
        fulfillmentType: 'salon',
        lines: [
          { productId: 'prod_smash_clasica', quantity: 1 },
          { productId: 'prod_smash_clasica', quantity: 1 }
        ]
      }
    });
    expect(resCreate.statusCode).toBe(201);
    const order = JSON.parse(resCreate.payload).order;

    // Autorizar sin pago para habilitar KDS sin pasar por la caja (y verificar deducción en KDS)
    rawDb.prepare("UPDATE orders SET payment_status = 'autorizado_sin_pago' WHERE id = ?").run(order.id);

    const lines = rawDb.prepare('SELECT id FROM order_lines WHERE order_id = ?').all(order.id) as any[];
    expect(lines.length).toBe(2);

    // Verificar 0 movimientos antes de entrar a preparación en KDS
    const movsBefore = rawDb.prepare('SELECT count(*) as cnt FROM inventory_movements WHERE order_id = ?').get(order.id) as any;
    expect(movsBefore.cnt).toBe(0);

    // Primera llamada: pasa línea 1 a 'preparando' -> dispara deducción de inventario
    const resStep1 = await app.inject({
      method: 'POST',
      url: `/api/kds/lines/${lines[0].id}/status`,
      payload: { status: 'preparando' }
    });
    expect(resStep1.statusCode).toBe(200);

    const movsAfterStep1 = rawDb.prepare('SELECT count(*) as cnt FROM inventory_movements WHERE order_id = ?').get(order.id) as any;
    expect(movsAfterStep1.cnt).toBeGreaterThan(0);

    // Segunda llamada: pasa línea 2 a 'preparando' -> no debe duplicar movimientos
    const resStep2 = await app.inject({
      method: 'POST',
      url: `/api/kds/lines/${lines[1].id}/status`,
      payload: { status: 'preparando' }
    });
    expect(resStep2.statusCode).toBe(200);

    const movsAfterStep2 = rawDb.prepare('SELECT count(*) as cnt FROM inventory_movements WHERE order_id = ?').get(order.id) as any;
    expect(movsAfterStep2.cnt).toBe(movsAfterStep1.cnt);

    // Tercera llamada directa a deductInventoryForOrder -> idempotente
    deductInventoryForOrder(rawDb, order.id, 'loc_alta_vista', Date.now(), 'usr_kds');
    const movsAfterStep3 = rawDb.prepare('SELECT count(*) as cnt FROM inventory_movements WHERE order_id = ?').get(order.id) as any;
    expect(movsAfterStep3.cnt).toBe(movsAfterStep1.cnt);
  });

  it('(c) orden "cerrado" y "anulado" -> 409', async () => {
    // 1. Caso 'cerrado'
    const resCreateClosed = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        idempotencyKey: `idemp_p3b_c1_${Date.now()}`,
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_smash_clasica', quantity: 1 }]
      }
    });
    const orderClosed = JSON.parse(resCreateClosed.payload).order;
    await app.inject({
      method: 'POST',
      url: `/api/orders/${orderClosed.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { tenders: [{ method: 'cash_usd', amountCents: orderClosed.total_to_collect_usd_cents }] }
    });
    const linesClosed = rawDb.prepare('SELECT id FROM order_lines WHERE order_id = ?').all(orderClosed.id) as any[];
    await app.inject({
      method: 'POST',
      url: `/api/kds/lines/${linesClosed[0].id}/status`,
      payload: { status: 'listo' }
    });
    // Entregar con archive: true -> queda 'cerrado'
    await app.inject({
      method: 'POST',
      url: `/api/kds/orders/${orderClosed.id}/deliver`,
      payload: { archive: true }
    });

    const dbClosed = rawDb.prepare('SELECT fulfillment_status FROM orders WHERE id = ?').get(orderClosed.id) as any;
    expect(dbClosed.fulfillment_status).toBe('cerrado');

    // Intentar modificar línea de orden cerrada -> 409
    const resClosedLine = await app.inject({
      method: 'POST',
      url: `/api/kds/lines/${linesClosed[0].id}/status`,
      payload: { status: 'preparando' }
    });
    expect(resClosedLine.statusCode).toBe(409);
    expect(JSON.parse(resClosedLine.payload).code).toBe('ORDER_ALREADY_FINALIZED');

    // Intentar deliver de orden cerrada -> 409
    const resClosedDeliver = await app.inject({
      method: 'POST',
      url: `/api/kds/orders/${orderClosed.id}/deliver`,
      payload: { archive: true }
    });
    expect(resClosedDeliver.statusCode).toBe(409);
    expect(JSON.parse(resClosedDeliver.payload).code).toBe('ORDER_ALREADY_FINALIZED');

    // Intentar force-complete de orden cerrada -> 409
    const resClosedForce = await app.inject({
      method: 'POST',
      url: `/api/kds/orders/${orderClosed.id}/force-complete`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {}
    });
    expect(resClosedForce.statusCode).toBe(409);
    expect(JSON.parse(resClosedForce.payload).code).toBe('ORDER_ALREADY_FINALIZED');

    // 2. Caso 'anulado'
    const resCreateAnulada = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        idempotencyKey: `idemp_p3b_c2_${Date.now()}`,
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_smash_clasica', quantity: 1 }]
      }
    });
    const orderAnulada = JSON.parse(resCreateAnulada.payload).order;
    const linesAnulada = rawDb.prepare('SELECT id FROM order_lines WHERE order_id = ?').all(orderAnulada.id) as any[];

    // Marcar como anulada en base de datos
    rawDb.prepare("UPDATE orders SET fulfillment_status = 'anulado', payment_status = 'anulado' WHERE id = ?").run(orderAnulada.id);

    // Intentar modificar línea de orden anulada -> 409
    const resAnuladaLine = await app.inject({
      method: 'POST',
      url: `/api/kds/lines/${linesAnulada[0].id}/status`,
      payload: { status: 'preparando' }
    });
    expect(resAnuladaLine.statusCode).toBe(409);
    expect(JSON.parse(resAnuladaLine.payload).code).toBe('ORDER_ALREADY_FINALIZED');

    // Intentar deliver de orden anulada -> 409
    const resAnuladaDeliver = await app.inject({
      method: 'POST',
      url: `/api/kds/orders/${orderAnulada.id}/deliver`,
      payload: { archive: false }
    });
    expect(resAnuladaDeliver.statusCode).toBe(409);
    expect(JSON.parse(resAnuladaDeliver.payload).code).toBe('ORDER_ALREADY_FINALIZED');

    // Intentar force-complete de orden anulada -> 409
    const resAnuladaForce = await app.inject({
      method: 'POST',
      url: `/api/kds/orders/${orderAnulada.id}/force-complete`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {}
    });
    expect(resAnuladaForce.statusCode).toBe(409);
    expect(JSON.parse(resAnuladaForce.payload).code).toBe('ORDER_ALREADY_FINALIZED');
  });
});
