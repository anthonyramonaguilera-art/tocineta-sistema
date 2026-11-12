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
  openCashSession,
  getStationCashSession
} from '../src/modules/cashier/cashier-service.js';
import { performBlindCount } from '../src/modules/closures/closures-service.js';
import { computeExpectedByMethod } from '../src/modules/closures/method-expected.js';

describe('Sesion de caja por estacion', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_cashier_station_session_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_cashier_station_session.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;
  let cajeraToken: string;
  let cajeraUser: any;
  let adminSessionId: string;

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
    const cajeraAuth = await loginAs(app, 'cajera', rawDb);
    cajeraToken = cajeraAuth.token;
    cajeraUser = cajeraAuth.user;
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

  it('1. Admin abre jornada y sesion de caja: getStationCashSession devuelve la sesion del admin para la cajera', () => {
    const adminSession = openCashSession(rawDb, {
      userId: CANONICAL_CREDENTIALS.admin.userId,
      locationId: 'loc_alta_vista',
      openingCashUsdCents: 0,
      openingCashBsCents: 0
    });
    expect(adminSession).toBeDefined();
    expect(adminSession.id).toBeDefined();
    adminSessionId = adminSession.id;

    const stationSession = getStationCashSession(rawDb, CANONICAL_CREDENTIALS.cajera.userId);
    expect(stationSession).toBeDefined();
    expect(stationSession.id).toBe(adminSession.id);
  });

  it('2. Un usuario con rol mesonero sin sesion propia: getStationCashSession devuelve null', () => {
    const session = getStationCashSession(rawDb, CANONICAL_CREDENTIALS.mesonero.userId);
    expect(session).toBeNull();
  });

  it('3. Sin jornada abierta (o con la jornada cerrada): getStationCashSession para la cajera devuelve null', () => {
    rawDb.prepare("UPDATE jornadas SET status = 'cerrada'").run();
    const session = getStationCashSession(rawDb, CANONICAL_CREDENTIALS.cajera.userId);
    expect(session).toBeNull();
    rawDb.prepare("UPDATE jornadas SET status = 'abierta'").run();
  });

  it('4. Con la sesion del admin abierta, la cajera cobra una orden: el pago se registra (200) y orders.cash_session_id = id de la sesion del admin', async () => {
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
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }
        ]
      }
    });
    expect(resPay.statusCode).toBe(200);

    const orderInDb = rawDb.prepare('SELECT cash_session_id, payment_status FROM orders WHERE id = ?').get(order.id) as any;
    expect(orderInDb.payment_status).toBe('pagado');
    expect(orderInDb.cash_session_id).toBe(adminSessionId);
  });

  it('5. Regla T-04a: abrir sesion para la cajera en la misma sede (loc_alta_vista) lanza 409 CASH_SESSION_ALREADY_OPEN', () => {
    let error: any;
    try {
      openCashSession(rawDb, {
        userId: CANONICAL_CREDENTIALS.cajera.userId,
        locationId: 'loc_alta_vista'
      });
    } catch (err: any) {
      error = err;
    }
    expect(error).toBeDefined();
    expect(error.code).toBe('CASH_SESSION_ALREADY_OPEN');
    expect(error.statusCode).toBe(409);
  });

  it('6. performBlindCount ejecutado por la cajera sobre la sesion del admin devuelve status CLOSED', () => {
    const expected = computeExpectedByMethod(rawDb, adminSessionId);
    const result = performBlindCount(
      rawDb,
      adminSessionId,
      {
        counts: expected.map(e => ({
          method: e.method,
          countedCents: e.expectedCents
        }))
      },
      cajeraUser
    );
    expect(result.status).toBe('CLOSED');

    const closedSession = rawDb.prepare('SELECT status FROM cash_sessions WHERE id = ?').get(adminSessionId) as any;
    expect(closedSession.status).toBe('cerrada');
  });
});
