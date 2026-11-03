import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

describe('S-4: Decisión D15 - Arqueo ciego para cajera, guiado para admin/supervisor y descargas protegidas', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_s4_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_s4.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;

  let adminToken = '';
  let supervisorToken = '';
  let cajeraToken = '';
  let cajeraUserId = '';
  let jornadaId = '';
  let sessionId = '';

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { dbPath: tempDb });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureTestSupervisor(rawDb);

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    const adminAuth = await loginAs(app, 'admin', rawDb);
    adminToken = adminAuth.token;
    const supAuth = await loginAs(app, 'supervisor', rawDb);
    supervisorToken = supAuth.token;
    const cajeraAuth = await loginAs(app, 'cajera', rawDb);
    cajeraToken = cajeraAuth.token;
    cajeraUserId = cajeraAuth.user.id;

    // 1. Cajera abre la jornada (lo cual automáticamente le abre su cash session según D1)
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
    expect(resJornada.statusCode).toBe(200);
    jornadaId = resJornada.json().jornada.id;

    const openSession = rawDb.prepare(
      "SELECT id FROM cash_sessions WHERE user_id = ? AND status = 'abierta'"
    ).get(cajeraUserId) as { id: string };
    expect(openSession).toBeDefined();
    sessionId = openSession.id;

    // 2. Crear una orden y pagarla en efectivo para generar totales y esperados
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
    const orderId = resOrder.json().order.id;

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'cash_usd', amountCents: 1000 }
        ],
        changeOutputs: {
          changeUsdCents: 335,
          changeBsCents: 0
        }
      }
    });
    expect(resPay.statusCode).toBe(200);
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      const dbCtx = getDatabaseContext();
      if (dbCtx?.rawDb) {
        dbCtx.rawDb.close();
      }
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('a) Cajera con sesión abierta pide /api/reports/z-report/summary -> NO recibe expectedCashUsdCents, byMethod, ledgerEntries ni bySede; sí recibe ordersCount', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/summary?jornadaId=${jornadaId}`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.summary).toBeDefined();

    // Redacted fields MUST be undefined
    expect(body.summary.expectedCashUsdCents).toBeUndefined();
    expect(body.summary.expectedCashBsCents).toBeUndefined();
    expect(body.summary.byMethod).toBeUndefined();
    expect(body.summary.ledgerEntries).toBeUndefined();
    expect(body.summary.bySede).toBeUndefined();
    expect(body.summary.incidents).toBeUndefined();

    // Allowed fields MUST be defined
    expect(body.summary.ordersCount).toBeDefined();
    expect(body.summary.totalOrders).toBeDefined();
    expect(body.summary.receivablesUsdCents).toBeDefined();
    expect(body.summary.jornada).toBeDefined();
  });

  it('b) Admin y supervisor piden el mismo endpoint -> reciben el summary completo guiado', async () => {
    // Admin
    const resAdmin = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/summary?jornadaId=${jornadaId}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(resAdmin.statusCode).toBe(200);
    const bodyAdmin = resAdmin.json();
    expect(bodyAdmin.summary.expectedCashUsdCents).toBeDefined();
    expect(bodyAdmin.summary.byMethod).toBeDefined();
    expect(Array.isArray(bodyAdmin.summary.byMethod)).toBe(true);
    expect(bodyAdmin.summary.ledgerEntries).toBeDefined();
    expect(bodyAdmin.summary.bySede).toBeDefined();
    expect(bodyAdmin.summary.ordersCount).toBeDefined();

    // Supervisor
    const resSup = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/summary?jornadaId=${jornadaId}`,
      headers: { authorization: `Bearer ${supervisorToken}` }
    });
    expect(resSup.statusCode).toBe(200);
    const bodySup = resSup.json();
    expect(bodySup.summary.expectedCashUsdCents).toBeDefined();
    expect(bodySup.summary.byMethod).toBeDefined();
    expect(Array.isArray(bodySup.summary.byMethod)).toBe(true);
    expect(bodySup.summary.ledgerEntries).toBeDefined();
    expect(bodySup.summary.bySede).toBeDefined();
    expect(bodySup.summary.ordersCount).toBeDefined();
  });

  it('d) Cajera intenta descargar PDF/Excel con sesión abierta -> 403 REPORT_FORBIDDEN_FOR_ROLE; de otra jornada donde no participó -> 403', async () => {
    // Descarga jornada/:id/pdf con sesión abierta
    const resPdf = await app.inject({
      method: 'GET',
      url: `/api/reports/jornada/${jornadaId}/pdf`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resPdf.statusCode).toBe(403);
    expect(resPdf.json()).toEqual({
      success: false,
      code: 'REPORT_FORBIDDEN_FOR_ROLE',
      error: 'Solo puedes descargar el reporte de tu turno despues de cerrarlo'
    });

    // Descarga jornada/:id/excel con sesión abierta
    const resExcel = await app.inject({
      method: 'GET',
      url: `/api/reports/jornada/${jornadaId}/excel`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resExcel.statusCode).toBe(403);
    expect(resExcel.json()).toEqual({
      success: false,
      code: 'REPORT_FORBIDDEN_FOR_ROLE',
      error: 'Solo puedes descargar el reporte de tu turno despues de cerrarlo'
    });

    // Descarga z-report/pdf con sesión abierta
    const resZPdf = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/pdf?jornadaId=${jornadaId}`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resZPdf.statusCode).toBe(403);
    expect(resZPdf.json().code).toBe('REPORT_FORBIDDEN_FOR_ROLE');

    // Descarga z-report/excel con sesión abierta
    const resZExcel = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/excel?jornadaId=${jornadaId}`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resZExcel.statusCode).toBe(403);
    expect(resZExcel.json().code).toBe('REPORT_FORBIDDEN_FOR_ROLE');

    // De otra jornada donde no participó -> 403
    const resOther = await app.inject({
      method: 'GET',
      url: `/api/reports/jornada/jor_otra_inexistente/pdf`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resOther.statusCode).toBe(403);
    expect(resOther.json().code).toBe('REPORT_FORBIDDEN_FOR_ROLE');
  });

  it('c) Cajera cierra su sesión con blind-count y vuelve a pedir el summary -> ahora recibe el summary completo; y descargas devuelven 200 con audit_event', async () => {
    // Cerrar sesión con blind-count
    const resClose = await app.inject({
      method: 'POST',
      url: `/api/cash-sessions/${sessionId}/blind-count`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        counts: [
          { method: 'EFECTIVO_USD', countedCents: 5665 },
          { method: 'EFECTIVO_BS', countedCents: 100000 },
          { method: 'PAGO_MOVIL', countedCents: 0 },
          { method: 'PUNTO_DE_VENTA', countedCents: 0 },
          { method: 'UBII', countedCents: 0 },
          { method: 'TRANSFERENCIA', countedCents: 0 },
          { method: 'ZELLE', countedCents: 0 },
          { method: 'BINANCE', countedCents: 0 },
          { method: 'OTROS', countedCents: 0 }
        ]
      }
    });
    expect(resClose.statusCode).toBe(200);
    expect(resClose.json().status).toBe('CLOSED');

    // Vuelve a pedir summary -> ahora completo
    const resSummaryAfter = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/summary?jornadaId=${jornadaId}`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resSummaryAfter.statusCode).toBe(200);
    const bodyAfter = resSummaryAfter.json();
    expect(bodyAfter.summary.expectedCashUsdCents).toBeDefined();
    expect(bodyAfter.summary.byMethod).toBeDefined();
    expect(Array.isArray(bodyAfter.summary.byMethod)).toBe(true);
    expect(bodyAfter.summary.ledgerEntries).toBeDefined();
    expect(bodyAfter.summary.bySede).toBeDefined();

    // Descarga PDF tras cerrar sesión -> 200
    const resDownloadPdf = await app.inject({
      method: 'GET',
      url: `/api/reports/jornada/${jornadaId}/pdf`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resDownloadPdf.statusCode).toBe(200);
    expect(resDownloadPdf.headers['content-type']).toBe('application/pdf');

    // Descarga Excel tras cerrar sesión -> 200
    const resDownloadExcel = await app.inject({
      method: 'GET',
      url: `/api/reports/jornada/${jornadaId}/excel`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resDownloadExcel.statusCode).toBe(200);

    // Descarga Z-report PDF tras cerrar sesión -> 200
    const resDownloadZPdf = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/pdf?jornadaId=${jornadaId}`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resDownloadZPdf.statusCode).toBe(200);

    // Descarga Z-report Excel tras cerrar sesión -> 200
    const resDownloadZExcel = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/excel?jornadaId=${jornadaId}`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resDownloadZExcel.statusCode).toBe(200);

    // Verificar que se haya emitido el evento de auditoría 'REPORT_DOWNLOADED'
    const auditEvents = rawDb.prepare(`
      SELECT * FROM audit_events WHERE action = 'REPORT_DOWNLOADED'
    `).all();
    expect(auditEvents.length).toBeGreaterThanOrEqual(4);
  });
});
