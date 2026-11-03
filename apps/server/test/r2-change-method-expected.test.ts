import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { buildServer } from '../src/server.js';
import { loginAs, ensureTestSupervisor } from './test-helpers.js';
import { getFinancialTruth } from '../src/modules/finances/financial-truth-service.js';
import { computeExpectedByMethod } from '../src/modules/closures/method-expected.js';
import { _resetAuthorizerGuardState } from '../src/modules/auth/authorizer-guard.js';

describe('TAREA B2: Vuelto por Pago Móvil no descuenta efectivo Bs esperado', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_t07_b2_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_t07_b2.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;

  let cajeraToken = '';
  let jornadaId = '';
  let sessionId = '';
  const RATE_MICRO_BS = 40_000_000; // 40.00 Bs / USD
  const INITIAL_CASH_USD_CENTS = 1000; // $10.00
  const INITIAL_CASH_BS_CENTS = 50000; // 500.00 Bs

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { dbPath: tempDb });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureTestSupervisor(rawDb);
    rawDb.prepare('UPDATE users SET must_change_pin = 0').run();

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
  }, 30000);

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

  beforeEach(async () => {
    _resetAuthorizerGuardState();
    rawDb.prepare("UPDATE cash_sessions SET status = 'cerrada' WHERE status = 'abierta'").run();
    rawDb.prepare("UPDATE jornadas SET status = 'cerrada' WHERE status = 'abierta'").run();

    const resJornada = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        rateMicroBs: RATE_MICRO_BS,
        rateStr: '40.00',
        initialCashUsdCents: INITIAL_CASH_USD_CENTS,
        initialCashBsCents: INITIAL_CASH_BS_CENTS,
        notes: 'Jornada Test B2'
      }
    });
    expect(resJornada.statusCode).toBe(200);
    const jorBody = resJornada.json();
    jornadaId = jorBody.jornada?.id || jorBody.id;

    const resSession = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        jornadaId,
        openingCashUsdCents: INITIAL_CASH_USD_CENTS,
        openingCashBsCents: INITIAL_CASH_BS_CENTS
      }
    });
    expect(resSession.statusCode).toBe(200);
    sessionId = resSession.json().cashSession.id;
  });

  it('Caso a: method pago_movil: EFECTIVO_BS esperado = apertura Bs (no baja 400); EFECTIVO_USD esperado = apertura USD + 2000 - 600; ft.changeDelivered desglosado', async () => {
    // Orden de $13.90: 2 tocineta dog parmesano (2 * 350 = 700) + 1 texas mex (690) = 1390 centavos
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 1',
        fulfillmentType: 'salon',
        lines: [
          { productId: 'prod_tocineta_dog_parmesano', quantity: 2 },
          { productId: 'prod_texas_mex', quantity: 1 }
        ]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;
    expect(order.total_to_collect_usd_cents).toBe(1390);

    // Pago con $20.00 cash_usd y vuelto mixto con Pago Móvil: $6.00 USD + 4.00 Bs por Pago Móvil (400 céntimos Bs)
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 2000 }],
        changeOutputs: {
          method: 'pago_movil',
          changeUsdCents: 600,
          changeBsCents: 400,
          referenceCode: 'PM-REF-123'
        }
      }
    });
    expect(resPay.statusCode).toBe(200);

    // 1. Verificación en computeExpectedByMethod
    const expected = computeExpectedByMethod(rawDb, sessionId);
    const expectedBs = expected.find(m => m.method === 'EFECTIVO_BS')?.expectedCents;
    const expectedUsd = expected.find(m => m.method === 'EFECTIVO_USD')?.expectedCents;

    // EFECTIVO_BS esperado debe mantenerse en apertura Bs (50000), NO debe bajar a 49600
    expect(expectedBs).toBe(INITIAL_CASH_BS_CENTS);

    // EFECTIVO_USD esperado = apertura USD + 2000 - 600 = 1000 + 1400 = 2400
    expect(expectedUsd).toBe(INITIAL_CASH_USD_CENTS + 2000 - 600);

    // 2. Verificación en financial-truth-service
    const ft = getFinancialTruth(rawDb, { jornadaId });
    expect(ft.expectedCash.netCashBsCents).toBe(INITIAL_CASH_BS_CENTS);
    expect(ft.expectedCash.netCashUsdCents).toBe(INITIAL_CASH_USD_CENTS + 2000 - 600);
    expect(ft.changeDelivered).toEqual({
      usdCents: 600,
      bsCashCents: 0,
      bsBankCents: 400
    });
  });

  it('Caso b: method cash_bs: EFECTIVO_BS esperado = apertura Bs - 400; ft.changeDelivered.bsCashCents = 400, bsBankCents = 0', async () => {
    // Orden de $13.90
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 2',
        fulfillmentType: 'salon',
        lines: [
          { productId: 'prod_tocineta_dog_parmesano', quantity: 2 },
          { productId: 'prod_texas_mex', quantity: 1 }
        ]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    // Pago con $20.00 cash_usd y vuelto en efectivo Bs: $6.00 USD + 4.00 Bs en efectivo
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 2000 }],
        changeOutputs: {
          method: 'cash_bs',
          changeUsdCents: 600,
          changeBsCents: 400
        }
      }
    });
    expect(resPay.statusCode).toBe(200);

    // 1. Verificación en computeExpectedByMethod
    const expected = computeExpectedByMethod(rawDb, sessionId);
    const expectedBs = expected.find(m => m.method === 'EFECTIVO_BS')?.expectedCents;
    const expectedUsd = expected.find(m => m.method === 'EFECTIVO_USD')?.expectedCents;
    expect(expectedBs).toBe(INITIAL_CASH_BS_CENTS - 400);
    expect(expectedUsd).toBe(INITIAL_CASH_USD_CENTS + 2000 - 600);

    // 2. Verificación en financial-truth-service
    const ft = getFinancialTruth(rawDb, { jornadaId });
    expect(ft.expectedCash.netCashBsCents).toBe(INITIAL_CASH_BS_CENTS - 400);
    expect(ft.expectedCash.netCashUsdCents).toBe(INITIAL_CASH_USD_CENTS + 2000 - 600);
    expect(ft.changeDelivered.usdCents).toBe(600);
    expect(ft.changeDelivered.bsCashCents).toBe(400);
    expect(ft.changeDelivered.bsBankCents).toBe(0);
  });
});
