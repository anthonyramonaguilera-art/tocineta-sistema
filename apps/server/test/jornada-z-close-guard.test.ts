import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { loginAs, ensureTestSupervisor, activateLegacyFixtureProducts } from './test-helpers.js';
import { getCurrentJornada } from '../src/modules/cashier/cashier-service.js';

describe('Guardia del Cierre Z e invariantes de ciclo de jornada', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_z_guard_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_guard.db');
  let rawDb: Database.Database, app: FastifyInstance;
  let adminToken = '', cajeraToken = '', jornadaId = '', orderId = '', savedZReportJson = '';

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    rawDb = initSqlite(tempDb).rawDb;
    await runMigrations(rawDb, { dbPath: tempDb });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    activateLegacyFixtureProducts(rawDb);
    ensureTestSupervisor(rawDb);
    app = await buildServer({ disableStatic: true });
    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
  });

  afterAll(async () => {
    await app.close();
    try { getDatabaseContext().rawDb.close(); } catch {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it('1. Jornada con orden sin pagar: Cierre Z responde 409 UNPAID_ORDERS_PENDING y sigue abierta', async () => {
    const resJornada = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { rateMicroBs: 40_000_000, rateStr: '40.00', initialCashUsdCents: 10000, initialCashBsCents: 200000 }
    });
    expect(resJornada.statusCode).toBe(200);
    jornadaId = resJornada.json().jornada.id;

    await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { openingCashUsdCents: 10000, openingCashBsCents: 200000 }
    });

    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { fulfillmentType: 'salon', tableNumber: 'Mesa 1', customerName: 'Cliente Test', lines: [{ productId: 'prod_classic_dog', quantity: 1 }] }
    });
    expect(resOrder.statusCode).toBe(201);
    orderId = resOrder.json().order.id;

    const resClose = await app.inject({
      method: 'POST',
      url: `/api/jornadas/${jornadaId}/close`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { pin: '123456', countedCashUsdCents: 10000, countedCashBsCents: 200000 }
    });
    expect(resClose.statusCode).toBe(409);
    const body = resClose.json();
    expect(body.code).toBe('UNPAID_ORDERS_PENDING');
    expect(body.pendingCount).toBe(1);

    const jornada = rawDb.prepare('SELECT status FROM jornadas WHERE id = ?').get(jornadaId) as any;
    expect(jornada.status).toBe('abierta');
  });

  it('2. Se paga esa orden: el cierre responde 200, jornada y cash_sessions quedan cerradas', async () => {
    const orderRow = rawDb.prepare('SELECT total_to_collect_usd_cents FROM orders WHERE id = ?').get(orderId) as any;
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { tenders: [{ method: 'cash_usd', amountCents: orderRow.total_to_collect_usd_cents }] }
    });
    expect(resPay.statusCode).toBe(200);

    const resClose = await app.inject({
      method: 'POST',
      url: `/api/jornadas/${jornadaId}/close`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { pin: '123456', countedCashUsdCents: 10000 + orderRow.total_to_collect_usd_cents, countedCashBsCents: 200000 }
    });
    expect(resClose.statusCode).toBe(200);

    const closed = rawDb.prepare('SELECT status, z_report_json FROM jornadas WHERE id = ?').get(jornadaId) as any;
    expect(closed.status).toBe('cerrada');
    savedZReportJson = closed.z_report_json;

    const sessions = rawDb.prepare('SELECT status FROM cash_sessions WHERE jornada_id = ?').all(jornadaId) as any[];
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((s) => s.status === 'cerrada')).toBe(true);
  });

  it('3. Tras el cierre, getCurrentJornada(rawDb) devuelve null', () => {
    expect(getCurrentJornada(rawDb)).toBeNull();
  });

  it('4. Crear orden posterior genera nueva jornada con id distinto y order_number = 1', async () => {
    const resNewOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { fulfillmentType: 'salon', tableNumber: 'Mesa 2', customerName: 'Cliente Nuevo', lines: [{ productId: 'prod_classic_dog', quantity: 1 }] }
    });
    expect(resNewOrder.statusCode).toBe(201);
    const newOrderId = resNewOrder.json().order.id;

    const row = rawDb.prepare('SELECT jornada_id, order_number FROM orders WHERE id = ?').get(newOrderId) as any;
    expect(row.jornada_id).not.toBe(jornadaId);
    expect(row.order_number).toBe(1);
  });

  it('5. El z_report_json de la jornada cerrada permanece identico', () => {
    const closed = rawDb.prepare('SELECT z_report_json FROM jornadas WHERE id = ?').get(jornadaId) as any;
    expect(closed.z_report_json).toBe(savedZReportJson);
  });
});
