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

describe('R2 — Print Mode (one vs two)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_print_mode_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_print_mode.db');
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

  it('1) Rechaza print_mode inválido con 400 y field: print_mode', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/business-settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { print_mode: 'three' }
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.field).toBe('print_mode');
  });

  it('2) En modo one, el job de cocina de una orden pagada queda asignado a print_caja_usb', async () => {
    // Configurar print_mode = 'one'
    await app.inject({
      method: 'PATCH',
      url: '/api/business-settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { print_mode: 'one' }
    });

    // Crear orden
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 1',
        fulfillmentType: 'salon',
        lines: [
          {
            productId: 'prod_texas_mex',
            quantity: 1
          }
        ]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    // Asignar sesión de caja y pagar orden
    rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, order.id);

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 690 }]
      }
    });
    if (resPay.statusCode !== 200) {
      console.log('PAY ERROR:', resPay.body);
    }
    expect(resPay.statusCode).toBe(200);

    // Verificar print_jobs de TICKET_COCINA
    const jobs = rawDb.prepare("SELECT * FROM print_jobs WHERE order_id = ? AND job_type = 'TICKET_COCINA'").all(order.id) as any[];
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.printer_id).toBe('print_caja_usb');
    }
  });

  it('3) En modo two, el job de cocina de una orden pagada queda asignado a print_cocina', async () => {
    // Configurar print_mode = 'two'
    await app.inject({
      method: 'PATCH',
      url: '/api/business-settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { print_mode: 'two' }
    });

    // Crear orden
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 2',
        fulfillmentType: 'salon',
        lines: [
          {
            productId: 'prod_texas_mex',
            quantity: 1
          }
        ]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    // Asignar sesión de caja y pagar orden
    rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, order.id);

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 690 }]
      }
    });
    if (resPay.statusCode !== 200) {
      console.log('PAY ERROR:', resPay.body);
    }
    expect(resPay.statusCode).toBe(200);

    // Verificar print_jobs de TICKET_COCINA
    const jobs = rawDb.prepare("SELECT * FROM print_jobs WHERE order_id = ? AND job_type = 'TICKET_COCINA'").all(order.id) as any[];
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.printer_id).toBe('print_cocina');
    }
  });
});
