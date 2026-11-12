import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { loginAs, ensureTestSupervisor } from './test-helpers.js';
import { createExpense } from '../src/modules/finances/expenses-service.js';
import { computeExpectedByMethod } from '../src/modules/closures/method-expected.js';
import { getFinancialTruth } from '../src/modules/finances/financial-truth-service.js';
import { closeJornadaZ } from '../src/modules/closures/closures-service.js';

describe('Test de integridad de caja chica (arqueo y Cierre Z)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_petty_cash_${Date.now()}`);
  const tempDb = path.join(tempDir, 'petty_flow.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string, adminUser: any, cajeraToken: string, jornadaId: string, sessionId: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    rawDb = initSqlite(tempDb).rawDb;
    await runMigrations(rawDb, { dbPath: tempDb });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureTestSupervisor(rawDb);
    rawDb.prepare('UPDATE users SET must_change_pin = 0').run();
    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();
    const admin = await loginAs(app, 'admin', rawDb);
    adminToken = admin.token;
    adminUser = admin.user;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    try { getDatabaseContext()?.rawDb?.close(); } catch {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it('1. Admin abre caja con $50 y cajera registra salida EFECTIVO_USD de $5', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { rateMicroBs: 40_000_000, initialCashUsdCents: 5000, initialCashBsCents: 200_000 }
    });
    expect(res.statusCode).toBe(200);
    jornadaId = res.json().jornada.id;
    sessionId = (rawDb.prepare("SELECT id FROM cash_sessions WHERE jornada_id = ? AND status = 'abierta'").get(jornadaId) as any).id;

    const expRes = await app.inject({
      method: 'POST',
      url: '/api/cash-expenses',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { amountUsdCents: 500, category: 'INSUMOS', description: 'Hielo para bebidas', paymentMethod: 'EFECTIVO_USD' }
    });
    expect([200, 201]).toContain(expRes.statusCode);
  });

  it('2. computeExpectedByMethod: EFECTIVO_USD = 5000 + ventas - vueltos - 500', () => {
    const methods = computeExpectedByMethod(rawDb, sessionId);
    expect(methods.find(m => m.method === 'EFECTIVO_USD')!.expectedCents).toBe(5000 - 500);
  });

  it('3. Salida en EFECTIVO_BS baja esperado de BS y no cambia EFECTIVO_USD', async () => {
    const before = computeExpectedByMethod(rawDb, sessionId);
    const usdBefore = before.find(m => m.method === 'EFECTIVO_USD')!.expectedCents;
    const bsBefore = before.find(m => m.method === 'EFECTIVO_BS')!.expectedCents;

    const res = await app.inject({
      method: 'POST',
      url: '/api/cash-expenses',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { amountUsdCents: 200, paymentMethod: 'EFECTIVO_BS', category: 'TRANSPORTE', description: 'Pasaje moto' }
    });
    expect([200, 201]).toContain(res.statusCode);

    const after = computeExpectedByMethod(rawDb, sessionId);
    expect(after.find(m => m.method === 'EFECTIVO_USD')!.expectedCents).toBe(usdBefore);
    expect(after.find(m => m.method === 'EFECTIVO_BS')!.expectedCents).toBeLessThan(bsBefore);
  });

  it('4. Gasto con categoria MERMAS_DESPERDICIOS no reduce efectivo esperado', () => {
    const before = computeExpectedByMethod(rawDb, sessionId);
    createExpense(rawDb, {
      jornadaId,
      locationId: 'loc_alta_vista',
      category: 'MERMAS_DESPERDICIOS',
      amountUsdCents: 300,
      paymentMethod: 'EFECTIVO_USD',
      description: 'Pan dañado en cocina',
      authorizedByUserId: adminUser.id
    });
    const after = computeExpectedByMethod(rawDb, sessionId);
    expect(after.find(m => m.method === 'EFECTIVO_USD')!.expectedCents).toBe(before.find(m => m.method === 'EFECTIVO_USD')!.expectedCents);
    expect(after.find(m => m.method === 'EFECTIVO_BS')!.expectedCents).toBe(before.find(m => m.method === 'EFECTIVO_BS')!.expectedCents);
  });

  it('5. getFinancialTruth refleja operatingExpenses y desglose de efectivo', () => {
    const ft = getFinancialTruth(rawDb, { jornadaId });
    expect(ft.operatingExpensesUsdCents).toBe(700);
    expect(ft.expectedCash.expensesPaidInCashUsdCents).toBe(500);
    expect(ft.expectedCash.expensesPaidInCashBsCents).toBe(8000);
  });

  it('6. Cierre Z coincide al centavo con SUM(amount_usd_cents) de operating_expenses', () => {
    const res = closeJornadaZ(rawDb, jornadaId, adminUser);
    expect(res.success).toBe(true);
    const sum = rawDb.prepare("SELECT COALESCE(SUM(amount_usd_cents), 0) as total FROM operating_expenses WHERE jornada_id = ? AND category != 'MERMAS_DESPERDICIOS'").get(jornadaId) as any;
    expect(res.zReport.expensesUsdCents).toBe(sum.total);
    expect(res.zReport.expensesUsdCents).toBe(700);
  });

  it('7. Duplicado en <120s responde 409 POSSIBLE_DUPLICATE y con confirmDuplicate pasa', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { rateMicroBs: 40_000_000, initialCashUsdCents: 1000, initialCashBsCents: 0 }
    });
    const payload = { amountUsdCents: 450, category: 'INSUMOS', description: 'Bolsas para delivery' };
    const r1 = await app.inject({ method: 'POST', url: '/api/cash-expenses', headers: { authorization: `Bearer ${cajeraToken}` }, payload });
    expect([200, 201]).toContain(r1.statusCode);

    const r2 = await app.inject({ method: 'POST', url: '/api/cash-expenses', headers: { authorization: `Bearer ${cajeraToken}` }, payload });
    expect(r2.statusCode).toBe(409);
    expect(JSON.stringify(r2.json())).toContain('POSSIBLE_DUPLICATE');

    const r3 = await app.inject({ method: 'POST', url: '/api/cash-expenses', headers: { authorization: `Bearer ${cajeraToken}` }, payload: { ...payload, confirmDuplicate: true } });
    expect([200, 201]).toContain(r3.statusCode);
  });

  it('8. ledger_entries bucket OPERATING_EXPENSE no aumenta por createExpense', () => {
    const bucketBefore = (rawDb.prepare("SELECT COUNT(*) as c FROM ledger_entries WHERE account_bucket = 'OPERATING_EXPENSE'").get() as any).c;
    const totalBefore = (rawDb.prepare('SELECT COUNT(*) as c FROM ledger_entries').get() as any).c;

    createExpense(rawDb, {
      locationId: 'loc_alta_vista',
      category: 'LIMPIEZA',
      amountUsdCents: 150,
      paymentMethod: 'EFECTIVO_USD',
      description: 'Cloro y desinfectante',
      authorizedByUserId: adminUser.id
    });

    const bucketAfter = (rawDb.prepare("SELECT COUNT(*) as c FROM ledger_entries WHERE account_bucket = 'OPERATING_EXPENSE'").get() as any).c;
    const totalAfter = (rawDb.prepare('SELECT COUNT(*) as c FROM ledger_entries').get() as any).c;
    expect(bucketAfter).toBe(bucketBefore);
    expect(totalAfter).toBe(totalBefore);
  });
});
