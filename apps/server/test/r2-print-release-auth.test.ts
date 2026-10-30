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

describe('R2 — Print Release Auth & Wiring Tests', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_print_release_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_print_release.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;
  let cajeraToken: string;
  let jornadaId: string;
  let sessionId: string;
  let testOrderId: string;
  let testJobId: string;

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

    // Configurar print_mode = 'one', print_flow = 'manual', print_delivery_note = 1
    await app.inject({
      method: 'PATCH',
      url: '/api/business-settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { print_mode: 'one', print_flow: 'manual', print_delivery_note: 1 }
    });

    // Crear orden con items de dos estaciones (hot_dogs y hamburguesas) para generar 3 jobs (nota + 2 comandas)
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa Test',
        fulfillmentType: 'salon',
        lines: [
          { productId: 'prod_texas_mex', quantity: 1 }, // hamburguesas
          { productId: 'prod_street_dog', quantity: 1 } // hot_dogs
        ]
      }
    });
    const dataOrder = resOrder.json();
    if (!dataOrder.success || !dataOrder.order) {
      throw new Error(`Error creando orden de prueba: ${JSON.stringify(dataOrder)}`);
    }
    testOrderId = dataOrder.order.id;
    rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, testOrderId);

    // Cobrar orden
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${testOrderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { tenders: [{ method: 'cash_usd', amountCents: 940 }] }
    });
    expect(resPay.statusCode).toBe(200);

    const jobs = rawDb.prepare('SELECT id FROM print_jobs WHERE order_id = ?').all(testOrderId) as any[];
    expect(jobs.length).toBeGreaterThan(0);
    testJobId = jobs[0].id;
  });

  afterAll(async () => {
    try {
      if (app && adminToken) {
        // Restaurar business settings a print_mode 'two', print_flow 'auto' para no afectar otros tests
        await app.inject({
          method: 'PATCH',
          url: '/api/business-settings',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { print_mode: 'two', print_flow: 'auto', print_delivery_note: 1 }
        });
      }
    } catch {}

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

  it('1) POST /release sin Authorization responde 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/print-jobs/${testJobId}/release`
    });
    expect(res.statusCode).toBe(403);
  });

  it('2) POST /release con token de cajera sobre job pending responde 200 y pasa a en_cola', async () => {
    // Asegurar que el job esté pending
    rawDb.prepare("UPDATE print_jobs SET status = 'pending' WHERE id = ?").run(testJobId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/print-jobs/${testJobId}/release`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.success).toBe(true);
    expect(data.status).toBe('en_cola');
  });

  it('3) Segundo release sobre job ya no pending responde 409 Conflict', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/print-jobs/${testJobId}/release`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(res.statusCode).toBe(409);
    const data = res.json();
    expect(data.error).toBe('CONFLICT');
  });

  it('4) GET /api/print-jobs?orderId=X devuelve los jobs generados tras cobrar en modo one manual', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/print-jobs?orderId=${testOrderId}`
    });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThanOrEqual(3); // nota de entrega + 2 comandas
  });
});
