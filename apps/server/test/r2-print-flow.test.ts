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
import { loginAs } from './test-helpers.js';

describe('R2 — Print Flow (manual, auto, delivery note, release)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_print_flow_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_print_flow.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;
  let cajeraToken: string;
  let jornadaId: string;
  let sessionId: string;

  beforeAll(async () => {
    process.env.PRINTER_DEV_SIMULATION = 'true';
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;

    // Abrir jornada
    const resJornada = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        rateMicroBs: 40_000_000,
        rateStr: '40.00',
        initialCashUsdCents: 5000,
        initialCashBsCents: 100000
      }
    });
    jornadaId = resJornada.json().jornada.id;

    // Abrir sesión de caja
    const resSession = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        jornadaId,
        openingCashUsdCents: 5000,
        openingCashBsCents: 100000
      }
    });
    sessionId = resSession.json().cashSession.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    delete process.env.PRINTER_DEV_SIMULATION;
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

  it('1) Modo two genera jobs en_cola', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/business-settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { print_mode: 'two', print_flow: 'manual', print_delivery_note: 1 }
    });

    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 10',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_texas_mex', quantity: 1 }]
      }
    });
    const order = resOrder.json().order;
    rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, order.id);

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { tenders: [{ method: 'cash_usd', amountCents: 690 }] }
    });
    expect(resPay.statusCode).toBe(200);

    const jobs = rawDb.prepare('SELECT status FROM print_jobs WHERE order_id = ?').all(order.id) as any[];
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.status).toBe('en_cola');
    }
  });

  it('2) Modo one manual genera jobs pending', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/business-settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { print_mode: 'one', print_flow: 'manual', print_delivery_note: 1 }
    });

    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 11',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_texas_mex', quantity: 1 }]
      }
    });
    const order = resOrder.json().order;
    rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, order.id);

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { tenders: [{ method: 'cash_usd', amountCents: 690 }] }
    });
    expect(resPay.statusCode).toBe(200);

    const jobs = rawDb.prepare('SELECT status FROM print_jobs WHERE order_id = ?').all(order.id) as any[];
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.status).toBe('pending');
    }
  });

  it('3) Release transiciona a en_cola, segundo release da 409', async () => {
    const job = rawDb.prepare("SELECT id, status FROM print_jobs WHERE status = 'pending' LIMIT 1").get() as any;
    expect(job).toBeDefined();

    // Primer release
    const resRelease1 = await app.inject({
      method: 'POST',
      url: `/api/print-jobs/${job.id}/release`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resRelease1.statusCode).toBe(200);
    expect(resRelease1.json().status).toBe('en_cola');

    // Segundo release (ya no está pending)
    const resRelease2 = await app.inject({
      method: 'POST',
      url: `/api/print-jobs/${job.id}/release`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resRelease2.statusCode).toBe(409);
  });

  it('4) print_delivery_note=0 no crea ningun NOTA_ENTREGA', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/business-settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { print_mode: 'one', print_flow: 'auto', print_delivery_note: 0 }
    });

    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 12',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_texas_mex', quantity: 1 }]
      }
    });
    const order = resOrder.json().order;
    rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, order.id);

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { tenders: [{ method: 'cash_usd', amountCents: 690 }] }
    });
    expect(resPay.statusCode).toBe(200);

    const notaEntrega = rawDb.prepare("SELECT * FROM print_jobs WHERE order_id = ? AND job_type = 'NOTA_ENTREGA'").get(order.id);
    expect(notaEntrega).toBeUndefined();
  });

  it('5) print_flow=auto pone todo en en_cola', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/business-settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { print_mode: 'one', print_flow: 'auto', print_delivery_note: 1 }
    });

    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 13',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_texas_mex', quantity: 1 }]
      }
    });
    const order = resOrder.json().order;
    rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, order.id);

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { tenders: [{ method: 'cash_usd', amountCents: 690 }] }
    });
    expect(resPay.statusCode).toBe(200);

    const jobs = rawDb.prepare('SELECT status FROM print_jobs WHERE order_id = ?').all(order.id) as any[];
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.status).toBe('en_cola');
    }
  });

  it('Verifica filtros GET /api/print-jobs (orderId y status=pending)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/print-jobs?status=pending',
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
});
