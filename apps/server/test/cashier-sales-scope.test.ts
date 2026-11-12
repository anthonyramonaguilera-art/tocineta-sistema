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
import { CANONICAL_CREDENTIALS, loginAs } from './test-helpers.js';
import {
  openJornada,
  openCashSession
} from '../src/modules/cashier/cashier-service.js';

describe('Alcance de ventas de caja (scope=jornada, turn, date)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_cashier_sales_scope_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_cashier_sales_scope.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let cajeraToken: string;
  let jornada1: any;
  let jornada2: any;
  let session1: any;
  let session2: any;
  let order1: any;
  let order2: any;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    await loginAs(app, 'admin', rawDb);
    const cajeraAuth = await loginAs(app, 'cajera', rawDb);
    cajeraToken = cajeraAuth.token;

    // Jornada 1 con sesion 1 y orden 1 pagada
    jornada1 = openJornada(rawDb, {
      openedByUserId: CANONICAL_CREDENTIALS.admin.userId,
      initialCashUsdCents: 0,
      initialCashBsCents: 0
    });
    session1 = openCashSession(rawDb, {
      userId: CANONICAL_CREDENTIALS.admin.userId,
      locationId: 'loc_alta_vista',
      openingCashUsdCents: 0,
      openingCashBsCents: 0
    });

    const resOrder1 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: '1',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_texas_mex', quantity: 1 }]
      }
    });
    expect(resOrder1.statusCode).toBe(201);
    order1 = resOrder1.json().order;

    const resPay1 = await app.inject({
      method: 'POST',
      url: `/api/orders/${order1.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'cash_usd', amountCents: order1.total_to_collect_usd_cents }
        ]
      }
    });
    expect(resPay1.statusCode).toBe(200);

    // Cerrar sesion 1 y jornada 1
    rawDb.prepare("UPDATE cash_sessions SET status = 'cerrada' WHERE id = ?").run(session1.id);
    rawDb.prepare("UPDATE jornadas SET status = 'cerrada' WHERE id = ?").run(jornada1.id);

    // Jornada 2 con sesion 2 y orden 2 pagada
    jornada2 = openJornada(rawDb, {
      openedByUserId: CANONICAL_CREDENTIALS.admin.userId,
      initialCashUsdCents: 0,
      initialCashBsCents: 0
    });
    session2 = openCashSession(rawDb, {
      userId: CANONICAL_CREDENTIALS.admin.userId,
      locationId: 'loc_alta_vista',
      openingCashUsdCents: 0,
      openingCashBsCents: 0
    });

    const resOrder2 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: '2',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_texas_mex', quantity: 1 }]
      }
    });
    expect(resOrder2.statusCode).toBe(201);
    order2 = resOrder2.json().order;

    const resPay2 = await app.inject({
      method: 'POST',
      url: `/api/orders/${order2.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'cash_usd', amountCents: order2.total_to_collect_usd_cents }
        ]
      }
    });
    expect(resPay2.statusCode).toBe(200);
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      const dbCtx = getDatabaseContext();
      if (dbCtx && dbCtx.db) {
        dbCtx.db.close();
      }
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. Una jornada cerrada con ventas pagadas y una jornada abierta con ventas pagadas: GET /api/cash-sessions/current/sales?scope=jornada devuelve SOLO las de la abierta', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/cash-sessions/current/sales?scope=jornada',
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.scope).toBe('jornada');
    expect(body.sales.length).toBe(1);
    expect(body.sales[0].orderId).toBe(order2.id);
    expect(body.sales[0].jornadaId).toBe(jornada2.id);
    expect(body.sales.some((s: any) => s.orderId === order1.id)).toBe(false);
  });

  it('2. scope=turn devuelve solo ordenes cuyo cash_session_id es el de la sesion operativa del usuario', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/cash-sessions/current/sales?scope=turn',
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.scope).toBe('turn');
    expect(body.sales.length).toBe(1);
    expect(body.sales[0].orderId).toBe(order2.id);
    expect(body.sales[0].cashSessionId).toBe(session2.id);
    expect(body.sales.every((s: any) => s.cashSessionId === session2.id)).toBe(true);
    expect(body.sales.some((s: any) => s.orderId === order1.id)).toBe(false);
  });

  it('3. scope=date&date=YYYY-MM-DD (fecha de hoy en hora UTC-4) devuelve ventas de ese dia, incluso de una jornada cerrada', async () => {
    const todayUtc4 = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
    const res = await app.inject({
      method: 'GET',
      url: `/api/cash-sessions/current/sales?scope=date&date=${todayUtc4}`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.scope).toBe('date');
    const orderIds = body.sales.map((s: any) => s.orderId);
    expect(orderIds).toContain(order1.id);
    expect(orderIds).toContain(order2.id);
  });

  it('4. scope=date sin date, o con date=\'31-12-2026\', responde 400', async () => {
    const resNoDate = await app.inject({
      method: 'GET',
      url: '/api/cash-sessions/current/sales?scope=date',
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resNoDate.statusCode).toBe(400);
    expect(resNoDate.json().success).toBe(false);

    const resBadDate = await app.inject({
      method: 'GET',
      url: '/api/cash-sessions/current/sales?scope=date&date=31-12-2026',
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resBadDate.statusCode).toBe(400);
    expect(resBadDate.json().success).toBe(false);
  });

  it('5. Orden pagada y luego editada (UPDATE orders SET updated_at_ms = Date.now() + 60000): paidAtMs sigue igual a MAX(payments.created_at_ms), no a la edicion', async () => {
    const paymentRow = rawDb.prepare('SELECT MAX(created_at_ms) as max_pay FROM payments WHERE order_id = ?').get(order2.id) as { max_pay: number };
    expect(paymentRow.max_pay).toBeDefined();

    const futureUpdatedAt = Date.now() + 60000;
    rawDb.prepare('UPDATE orders SET updated_at_ms = ? WHERE id = ?').run(futureUpdatedAt, order2.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/cash-sessions/current/sales?scope=jornada',
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const sale = body.sales.find((s: any) => s.orderId === order2.id);
    expect(sale).toBeDefined();
    expect(sale.paidAtMs).toBe(paymentRow.max_pay);
    expect(sale.paidAtMs).not.toBe(futureUpdatedAt);
  });

  it('6. La respuesta incluye jornada.openedAtMs y, en cada venta, totalUsdCents, primaryMethod y tableLabel', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/cash-sessions/current/sales?scope=jornada',
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jornada).toBeDefined();
    expect(typeof body.jornada.openedAtMs).toBe('number');
    expect(body.jornada.openedAtMs).toBe(jornada2.opened_at_ms);

    expect(body.sales.length).toBeGreaterThan(0);
    for (const sale of body.sales) {
      expect(typeof sale.totalUsdCents).toBe('number');
      expect(sale.totalUsdCents).toBeGreaterThan(0);
      expect(typeof sale.primaryMethod).toBe('string');
      expect(sale.primaryMethod).toBe('EFECTIVO_USD');
      expect(typeof sale.tableLabel).toBe('string');
      expect(sale.tableLabel).toBe('Mesa 2');
    }
  });
});
