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

describe('R2 — Z Summary Endpoint Test', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_z_summary_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_z_summary.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;
  let cajeraToken: string;
  let jornadaId: string;

  beforeAll(async () => {
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

  it('Escenarios para GET /api/reports/z-report/summary', async () => {
    const results: Array<{ escenario: string; status: number; body: any }> = [];

    // (c) sin jornada abierta (antes de abrir jornada)
    const resNoJornada = await app.inject({
      method: 'GET',
      url: '/api/reports/z-report/summary',
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    results.push({
      escenario: '(c) sin jornada abierta',
      status: resNoJornada.statusCode,
      body: resNoJornada.json()
    });

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

    // (a) jornada abierta sin ventas
    const resOpenNoSales = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/summary?jornadaId=${jornadaId}`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    results.push({
      escenario: '(a) jornada abierta sin ventas',
      status: resOpenNoSales.statusCode,
      body: resOpenNoSales.json()
    });

    // (b) jornada con orden pagada Pago Móvil + Punto de Venta + Efectivo USD con vuelto
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 1',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_texas_mex', quantity: 1 }]
      }
    });
    const order = resOrder.json().order;
    const orderId = order.id;

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'cash_usd', amountCents: 1000 },
          { method: 'pago_movil', amountCents: 500, referenceCode: `PM-${Date.now()}` },
          { method: 'punto_de_venta', amountCents: 500, referenceCode: `POS-${Date.now()}` }
        ],
        changeOutputs: {
          changeUsdCents: 335,
          changeBsCents: 0
        }
      }
    });
    if (resPay.statusCode !== 200) {
      console.log('PAY ERROR:', resPay.json());
    }
    expect(resPay.statusCode).toBe(200);

    const resWithSales = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/summary?jornadaId=${jornadaId}`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    results.push({
      escenario: '(b) jornada con orden pagada Pago Móvil + Punto de Venta + Efectivo USD con vuelto',
      status: resWithSales.statusCode,
      body: resWithSales.json()
    });

    // (d) jornada con venta a crédito (autorizado sin pago)
    const resCredOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 2',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_texas_mex', quantity: 1 }]
      }
    });
    const credOrderId = resCredOrder.json().order.id;

    await app.inject({
      method: 'POST',
      url: `/api/orders/${credOrderId}/authorize-without-payment`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { authorizerUserId: 'usr_admin', pin: '123456', notes: 'Fiado' }
    });

    const resWithCredit = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/summary?jornadaId=${jornadaId}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    results.push({
      escenario: '(d) jornada con venta a crédito',
      status: resWithCredit.statusCode,
      body: resWithCredit.json()
    });

    console.log('--- TABLA DE ESCENARIOS Z SUMMARY ---');
    for (const r of results) {
      console.log(`Escenario: ${r.escenario}`);
      console.log(`Status: ${r.status}`);
      console.log(`Body: ${JSON.stringify(r.body, null, 2)}`);
      console.log('------------------------------------');
    }

    // Assertions as required by instructions
    expect(results.find(r => r.escenario.includes('(c)'))?.status).toBe(404);
    expect(results.find(r => r.escenario.includes('(a)'))?.status).toBe(200);
    expect(results.find(r => r.escenario.includes('(b)'))?.status).toBe(200);
    expect(results.find(r => r.escenario.includes('(d)'))?.status).toBe(200);
  });
});
