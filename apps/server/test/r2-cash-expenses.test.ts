import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as zlib from 'node:zlib';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { loginAs, ensureTestSupervisor } from './test-helpers.js';
import { getFinancialTruth } from '../src/modules/finances/financial-truth-service.js';
import { performBlindCount } from '../src/modules/closures/closures-service.js';
import { getJornadaReportData, generateJornadaPdfReport } from '../src/modules/reports/reports-service.js';

describe('T-03: Salida de caja chica para cajera (POST/GET /api/cash-expenses)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_t03_expenses_${Date.now()}`);
  const tempDb = path.join(tempDir, 't03_expenses.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;
  let adminUser: any;
  let cajeraToken: string;
  let cajeraUser: any;
  let mesoneroToken: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureTestSupervisor(rawDb);
    rawDb.prepare('UPDATE users SET must_change_pin = 0').run();

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    const adminLogin = await loginAs(app, 'admin', rawDb);
    adminToken = adminLogin.token;
    adminUser = adminLogin.user;

    const cajeraLogin = await loginAs(app, 'cajera', rawDb);
    cajeraToken = cajeraLogin.token;
    cajeraUser = cajeraLogin.user;

    mesoneroToken = (await loginAs(app, 'mesonero', rawDb)).token;
  });

  afterAll(async () => {
    if (app) {
      app.server.closeAllConnections?.();
      await app.close();
    }
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

  beforeEach(() => {
    rawDb.prepare("UPDATE cash_sessions SET status = 'cerrada' WHERE status = 'abierta'").run();
    rawDb.prepare("UPDATE jornadas SET status = 'cerrada' WHERE status = 'abierta'").run();
  });

  it('1. Cajera registra salida de 5 USD -> 201 y el efectivo USD esperado baja 5.00', async () => {
    // 1. Abrir jornada con $50.00 USD apertura (crea sesión automática para cajera)
    const resJornada = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        rateMicroBs: 40_000_000,
        initialCashUsdCents: 5000,
        initialCashBsCents: 0
      }
    });
    expect(resJornada.statusCode).toBe(200);
    const jornadaId = resJornada.json().jornada.id;

    const sessionRow = rawDb.prepare("SELECT id FROM cash_sessions WHERE user_id = ? AND status = 'abierta'").get(cajeraUser.id) as any;
    expect(sessionRow).toBeDefined();
    const sessionId = sessionRow.id;

    // Verificar efectivo esperado antes de la salida: $50.00 USD
    const ftBefore = getFinancialTruth(rawDb, { jornadaId });
    expect(ftBefore.expectedCash.netCashUsdCents).toBe(5000);

    // 2. Cajera registra salida de caja chica de $5.00 USD (500 cents)
    const resExpense = await app.inject({
      method: 'POST',
      url: '/api/cash-expenses',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        amountUsdCents: 500,
        category: 'hielo_pan_insumos',
        description: '2 bolsas de hielo para refrescos'
      }
    });

    expect(resExpense.statusCode).toBe(201);
    const expenseData = resExpense.json();
    expect(expenseData.success).toBe(true);
    expect(expenseData.expense.amountUsdCents).toBe(500);
    expect(expenseData.expense.paymentMethod).toBe('EFECTIVO_USD');
    expect(expenseData.expense.jornadaId).toBe(jornadaId);

    // 3. Verificar que el efectivo USD esperado baje 5.00 USD (a 4500 cents = $45.00)
    const ftAfter = getFinancialTruth(rawDb, { jornadaId });
    expect(ftAfter.expectedCash.netCashUsdCents).toBe(4500);
    expect(ftAfter.operatingExpensesUsdCents).toBe(500);

    // 4. Verificar que performBlindCount reconozca la salida en el cuadre de caja
    // Si la cajera cuenta 4500 cents físicos ($45.00), el arqueo debe cuadrar a 0 cents de diferencia
    const blindResult = performBlindCount(
      rawDb,
      sessionId,
      { cashUsdCents: 4500, cashBsCents: 0, ubiiVoucherBsCents: 0 },
      cajeraUser
    );
    expect(blindResult.status).toBe('CLOSED');

    const updatedSession = rawDb.prepare('SELECT status, expected_cash_usd_cents, diff_usd_cents FROM cash_sessions WHERE id = ?').get(sessionId) as any;
    expect(updatedSession.status).toBe('cerrada');
    expect(updatedSession.expected_cash_usd_cents).toBe(4500);
    expect(updatedSession.diff_usd_cents).toBe(0);

    // 5. Verificar GET /api/cash-expenses
    const resList = await app.inject({
      method: 'GET',
      url: '/api/cash-expenses',
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resList.statusCode).toBe(200);
    const listData = resList.json();
    expect(listData.success).toBe(true);
    expect(listData.expenses.length).toBe(1);
    expect(listData.expenses[0].amountUsdCents).toBe(500);
    expect(listData.expenses[0].description).toBe('2 bolsas de hielo para refrescos');

    // 6. Verificar que aparezca en el Cierre Z y su PDF
    const zReportData = getJornadaReportData(rawDb, jornadaId);
    expect(zReportData.expensesUsdCents).toBe(500);
    expect(zReportData.expectedCashUsdCents).toBe(4500);

    const pdfBuffer = await generateJornadaPdfReport(rawDb, jornadaId);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(1000);

    const streamStart = pdfBuffer.indexOf('stream\n') !== -1 ? pdfBuffer.indexOf('stream\n') + 7 : pdfBuffer.indexOf('stream\r\n') + 8;
    const streamEnd = pdfBuffer.indexOf('endstream');
    const compressed = pdfBuffer.subarray(streamStart, streamEnd);
    let pdfText = '';
    try {
      pdfText = zlib.inflateSync(compressed).toString('latin1');
    } catch {
      pdfText = pdfBuffer.toString('latin1');
    }
    const hexTarget = Buffer.from('Salidas de caja chica').toString('hex');
    expect(pdfText.toLowerCase()).toContain(hexTarget.toLowerCase());
  });

  it('2. Sin sesion de caja abierta -> 409 CASH_SESSION_REQUIRED', async () => {
    // Abrir jornada con usuario ADMIN (crea sesión de admin, no de cajera)
    const resJornada = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        rateMicroBs: 40_000_000,
        initialCashUsdCents: 5000,
        initialCashBsCents: 0
      }
    });
    expect(resJornada.statusCode).toBe(200);

    // Asegurar que no hay sesión abierta para cajera
    const cajeraSession = rawDb.prepare("SELECT id FROM cash_sessions WHERE user_id = ? AND status = 'abierta'").get(cajeraUser.id);
    expect(cajeraSession).toBeUndefined();

    // Cajera intenta registrar gasto sin tener sesión abierta -> 409 CASH_SESSION_REQUIRED
    const resExpense = await app.inject({
      method: 'POST',
      url: '/api/cash-expenses',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        amountUsdCents: 400,
        category: 'hielo_pan_insumos',
        description: 'Servilletas de emergencia'
      }
    });

    expect(resExpense.statusCode).toBe(409);
    const body = resExpense.json();
    expect(body.code).toBe('CASH_SESSION_REQUIRED');
    expect(body.error).toContain('Debe abrir su sesión de caja');
  });

  it('3. Sin jornada abierta -> 409 JORNADA_CLOSED', async () => {
    // Ninguna jornada abierta
    const resExpense = await app.inject({
      method: 'POST',
      url: '/api/cash-expenses',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        amountUsdCents: 300,
        category: 'otros_menores',
        description: 'Pila para balanza'
      }
    });

    expect(resExpense.statusCode).toBe(409);
    const body = resExpense.json();
    expect(body.code).toBe('JORNADA_CLOSED');
    expect(body.error).toContain('No hay una jornada abierta');
  });

  it('4. Usuario mesonero -> 403 (bloqueado por politica de roles)', async () => {
    // Abrir jornada y sesion
    await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { rateMicroBs: 40_000_000, initialCashUsdCents: 5000, initialCashBsCents: 0 }
    });

    const resPost = await app.inject({
      method: 'POST',
      url: '/api/cash-expenses',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        amountUsdCents: 200,
        category: 'otros_menores',
        description: 'Intento de gasto de mesonero'
      }
    });
    expect(resPost.statusCode).toBe(403);

    const resGet = await app.inject({
      method: 'GET',
      url: '/api/cash-expenses',
      headers: { authorization: `Bearer ${mesoneroToken}` }
    });
    expect(resGet.statusCode).toBe(403);
  });

  it('5. Duplicado en <120 s -> 409 DUPLICATE_EXPENSE, confirmDuplicate: true -> 201', async () => {
    // Abrir jornada y sesion para cajera
    await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { rateMicroBs: 40_000_000, initialCashUsdCents: 5000, initialCashBsCents: 0 }
    });

    const payload = {
      amountUsdCents: 600,
      category: 'servilletas_bolsas',
      description: 'Paquete de bolsas para delivery'
    };

    // Primer registro -> 201
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/cash-expenses',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload
    });
    expect(res1.statusCode).toBe(201);

    // Segundo registro identico inmediato (<120 s) -> 409 DUPLICATE_EXPENSE
    const resDuplicate = await app.inject({
      method: 'POST',
      url: '/api/cash-expenses',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload
    });
    expect(resDuplicate.statusCode).toBe(409);
    const dupBody = resDuplicate.json();
    expect(dupBody.code).toBe('DUPLICATE_EXPENSE');
    expect(dupBody.error).toContain('POSSIBLE_DUPLICATE');

    // Tercer registro con confirmDuplicate: true -> 201
    const resConfirmed = await app.inject({
      method: 'POST',
      url: '/api/cash-expenses',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        ...payload,
        confirmDuplicate: true
      }
    });
    expect(resConfirmed.statusCode).toBe(201);
  });
});
