import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { buildServer } from '../src/server.js';
import { loginAs, ensureTestSupervisor } from './test-helpers.js';
import {
  getJornadaReportData,
  generateJornadaExcelReport,
  generateJornadaPdfReport
} from '../src/modules/reports/reports-service.js';

describe('T-05a: Arqueo Ciego Multimétodo y Migración 0040 (@tocineta/server)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_t05a_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_t05a.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;

  let adminToken = '';
  let supervisorToken = '';
  let cajeraToken = '';
  let mesoneroToken = '';
  let jornadaId = '';

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { dbPath: tempDb });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureTestSupervisor(rawDb);

    app = await buildServer({ disableStatic: true });

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    supervisorToken = (await loginAs(app, 'supervisor', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
    mesoneroToken = (await loginAs(app, 'mesonero', rawDb)).token;

    // Abrir jornada del día con tasa 40.00 Bs / USD y fondo inicial ($10 USD y 500.00 Bs)
    const resJornada = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        rateMicroBs: 40_000_000,
        rateStr: '40.00',
        initialCashUsdCents: 1000,
        initialCashBsCents: 50000
      }
    });
    jornadaId = resJornada.json().jornada.id;
  });

  afterAll(async () => {
    await app.close();
    try {
      const dbCtx = getDatabaseContext();
      dbCtx.rawDb.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. Sesión con cobros en 5 métodos distintos (incluyendo UBII y PUNTO_DE_VENTA separados) -> conteo exacto cierra en intento 1 y devuelve methodCounts con diffCents = 0', async () => {
    // Abrir sesión de caja
    const resSession = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        jornadaId,
        openingCashUsdCents: 1000, // $10.00
        openingCashBsCents: 50000  // 500.00 Bs
      }
    });
    // POST /api/cash-sessions/open devuelve 200 (estándar del sistema), no 201.
    // Corregido en T-05a.
    expect(resSession.statusCode).toBe(200);
    const sessionId = resSession.json().cashSession.id;

    // Crear 5 órdenes individuales y cobrarlas en 5 métodos distintos
    const createAndPay = async (tenders: Array<{ method: string; amountCents: number; referenceCode?: string }>) => {
      const resOrder = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          fulfillmentType: 'salon',
          tableNumber: '1',
          customerName: 'Cliente Multimétodo',
          lines: [{ productId: 'prod_classic_dog', quantity: 1 }] // $2.50 = 250 centavos
        }
      });
      const order = resOrder.json().order;
      rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, order.id);

      const payRes = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: { tenders }
      });
      expect(payRes.statusCode).toBe(200);
      return order.id;
    };

    // 1: Efectivo USD ($2.50 = 250 cents)
    await createAndPay([{ method: 'cash_usd', amountCents: 250 }]);
    // 2: Efectivo Bs (100.00 Bs = 10,000 cents a tasa 40.00)
    await createAndPay([{ method: 'cash_bs', amountCents: 10000 }]);
    // 3: Pago Móvil (100.00 Bs = 10,000 cents)
    await createAndPay([{ method: 'pago_movil', amountCents: 10000, referenceCode: 'PM-901' }]);
    // 4: Punto de Venta bancario clásico (100.00 Bs = 10,000 cents)
    await createAndPay([{ method: 'punto_de_venta', amountCents: 10000, referenceCode: 'POS-902' }]);
    // 5: Punto de Venta Ubii (100.00 Bs = 10,000 cents)
    await createAndPay([{ method: 'ubii', amountCents: 10000, referenceCode: 'UBII-903' }]);

    // Conteo exacto en intento 1
    // Esperados:
    // EFECTIVO_USD = 1000 + 250 = 1250
    // EFECTIVO_BS  = 50000 + 10000 = 60000
    // PAGO_MOVIL   = 10000
    // PUNTO_DE_VENTA = 10000
    // UBII         = 10000
    // Los demás    = 0
    const resBlind = await app.inject({
      method: 'POST',
      url: `/api/cash-sessions/${sessionId}/blind-count`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        counts: [
          { method: 'EFECTIVO_USD', countedCents: 1250 },
          { method: 'EFECTIVO_BS', countedCents: 60000 },
          { method: 'PAGO_MOVIL', countedCents: 10000 },
          { method: 'PUNTO_DE_VENTA', countedCents: 10000 },
          { method: 'UBII', countedCents: 10000 },
          { method: 'TRANSFERENCIA', countedCents: 0 },
          { method: 'ZELLE', countedCents: 0 },
          { method: 'BINANCE', countedCents: 0 },
          { method: 'OTROS', countedCents: 0 }
        ]
      }
    });

    expect(resBlind.statusCode).toBe(200);
    const body = resBlind.json();
    expect(body.status).toBe('CLOSED');
    expect(body.methodCounts).toBeDefined();
    expect(body.methodCounts.length).toBe(9);

    // Todos los diffCents deben ser 0
    for (const mc of body.methodCounts) {
      expect(mc.diffCents).toBe(0);
    }

    // Verificar explícitamente separación entre UBII y PUNTO_DE_VENTA
    const ubii = body.methodCounts.find((m: any) => m.method === 'UBII');
    const pos = body.methodCounts.find((m: any) => m.method === 'PUNTO_DE_VENTA');
    expect(ubii).toBeDefined();
    expect(ubii.expectedCents).toBe(10000);
    expect(ubii.countedCents).toBe(10000);
    expect(ubii.diffCents).toBe(0);

    expect(pos).toBeDefined();
    expect(pos.expectedCents).toBe(10000);
    expect(pos.countedCents).toBe(10000);
    expect(pos.diffCents).toBe(0);

    // Verificar en BD que se guardó intento 1 en cash_session_method_counts
    const rows = rawDb.prepare('SELECT * FROM cash_session_method_counts WHERE cash_session_id = ?').all(sessionId) as any[];
    expect(rows.length).toBe(9);
    for (const r of rows) {
      expect(r.attempt).toBe(1);
      expect(r.diff_cents).toBe(0);
    }

    // Verificar estado de sesión en BD
    const sessionRow = rawDb.prepare('SELECT status, recount_used FROM cash_sessions WHERE id = ?').get(sessionId) as any;
    expect(sessionRow.status).toBe('cerrada');
    expect(sessionRow.recount_used).toBe(0);
  });

  it('2. Diferencia en PAGO_MOVIL en intento 1 -> devuelve RECOUNT_REQUIRED sin filtrar expectedCents; en intento 2 cierra y registra attempt = 2 con la diferencia exacta', async () => {
    // Abrir nueva sesión de caja
    const resSession = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        jornadaId,
        openingCashUsdCents: 0,
        openingCashBsCents: 0
      }
    });
    const sessionId = resSession.json().cashSession.id;

    // Crear orden y cobrar con Pago Móvil por 20,000 centavos (200.00 Bs = $5.00)
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        fulfillmentType: 'salon',
        tableNumber: '2',
        customerName: 'Cliente Reconteo',
        lines: [{ productId: 'prod_classic_dog', quantity: 2 }]
      }
    });
    const orderId = resOrder.json().order.id;
    rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, orderId);

    await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'pago_movil', amountCents: 20000, referenceCode: 'PM-DISC-1' }]
      }
    });

    // Intento 1: Cajera cuenta 18,000 en vez de 20,000 (descuadre de -2,000)
    const resBlind1 = await app.inject({
      method: 'POST',
      url: `/api/cash-sessions/${sessionId}/blind-count`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        counts: [
          { method: 'PAGO_MOVIL', countedCents: 18000 }
        ]
      }
    });

    expect(resBlind1.statusCode).toBe(200);
    const data1 = resBlind1.json();
    expect(data1.status).toBe('RECOUNT_REQUIRED');
    expect(data1.message).toBe('Por favor realiza una segunda verificación del conteo físico.');
    // Seguridad Anti-tanteo: no expone expectedCents ni diffCents ni methodCounts
    expect(data1.expectedCents).toBeUndefined();
    expect(data1.diffCents).toBeUndefined();
    expect(data1.methodCounts).toBeUndefined();
    expect(data1.session).toBeUndefined();

    // Comprobar filas de intento 1 guardadas en DB
    const rowsAttempt1 = rawDb.prepare(
      'SELECT * FROM cash_session_method_counts WHERE cash_session_id = ? AND attempt = 1'
    ).all(sessionId) as any[];
    expect(rowsAttempt1.length).toBe(9);
    const pmAttempt1 = rowsAttempt1.find(r => r.method === 'PAGO_MOVIL');
    expect(pmAttempt1).toBeDefined();
    expect(pmAttempt1.expected_cents).toBe(20000);
    expect(pmAttempt1.counted_cents).toBe(18000);
    expect(pmAttempt1.diff_cents).toBe(-2000);

    // Intento 2: Segundo conteo definitivo (cuenta 19,000, descuadre final -1,000)
    const resBlind2 = await app.inject({
      method: 'POST',
      url: `/api/cash-sessions/${sessionId}/blind-count`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        counts: [
          { method: 'PAGO_MOVIL', countedCents: 19000 }
        ]
      }
    });

    expect(resBlind2.statusCode).toBe(200);
    const data2 = resBlind2.json();
    expect(data2.status).toBe('CLOSED');
    expect(data2.methodCounts).toBeDefined();

    const pmFinal = data2.methodCounts.find((m: any) => m.method === 'PAGO_MOVIL');
    expect(pmFinal).toBeDefined();
    expect(pmFinal.expectedCents).toBe(20000);
    expect(pmFinal.countedCents).toBe(19000);
    expect(pmFinal.diffCents).toBe(-1000);

    // Comprobar filas de intento 2 guardadas en DB
    const rowsAttempt2 = rawDb.prepare(
      'SELECT * FROM cash_session_method_counts WHERE cash_session_id = ? AND attempt = 2'
    ).all(sessionId) as any[];
    expect(rowsAttempt2.length).toBe(9);
    const pmAttempt2 = rowsAttempt2.find(r => r.method === 'PAGO_MOVIL');
    expect(pmAttempt2).toBeDefined();
    expect(pmAttempt2.expected_cents).toBe(20000);
    expect(pmAttempt2.counted_cents).toBe(19000);
    expect(pmAttempt2.diff_cents).toBe(-1000);

    // Sesión cerrada
    const sessionRow = rawDb.prepare('SELECT status, recount_used FROM cash_sessions WHERE id = ?').get(sessionId) as any;
    expect(sessionRow.status).toBe('cerrada');
    expect(sessionRow.recount_used).toBe(1);
  });

  it('3. Enviar todo en 0 cuando hubo ventas -> 400 BLIND_COUNT_ALL_ZERO', async () => {
    // Abrir sesión con apertura en 0
    const resSession = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        jornadaId,
        openingCashUsdCents: 0,
        openingCashBsCents: 0
      }
    });
    const sessionId = resSession.json().cashSession.id;

    // Crear y cobrar orden en efectivo USD ($2.50 = 250 centavos)
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        fulfillmentType: 'salon',
        tableNumber: '3',
        customerName: 'Cliente Cero Con Ventas',
        lines: [{ productId: 'prod_classic_dog', quantity: 1 }]
      }
    });
    const orderId = resOrder.json().order.id;
    rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, orderId);

    await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 250 }]
      }
    });

    // Enviar arqueo con todos los conteos en 0
    const resBlind = await app.inject({
      method: 'POST',
      url: `/api/cash-sessions/${sessionId}/blind-count`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        counts: [
          { method: 'EFECTIVO_USD', countedCents: 0 },
          { method: 'EFECTIVO_BS', countedCents: 0 },
          { method: 'PAGO_MOVIL', countedCents: 0 }
        ]
      }
    });

    expect(resBlind.statusCode).toBe(400);
    const data = resBlind.json();
    expect(data.code).toBe('BLIND_COUNT_ALL_ZERO');

    // La sesión debe seguir abierta
    const sessionRow = rawDb.prepare('SELECT status FROM cash_sessions WHERE id = ?').get(sessionId) as any;
    expect(sessionRow.status).toBe('abierta');

    // Fix T-05a: el Test 4 necesita una sesión realmente sin movimientos.
    // Cerramos la sesión previa del Test 3 para no heredar su venta de $2.50.
    const resCleanClose = await app.inject({
      method: 'POST',
      url: `/api/cash-sessions/${sessionId}/blind-count`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        counts: [{ method: 'EFECTIVO_USD', countedCents: 250 }]
      }
    });
    expect(resCleanClose.statusCode).toBe(200);
  });

  it('4. Sesión sin movimientos (expected = 0) sin confirmEmpty -> 400; con confirmEmpty: true -> cierra en 200', async () => {
    // Abrir sesión con apertura en 0 y sin órdenes
    const resSession = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        jornadaId,
        openingCashUsdCents: 0,
        openingCashBsCents: 0
      }
    });
    const sessionId = resSession.json().cashSession.id;

    // 4a. Sin confirmEmpty -> 400 CONFIRM_EMPTY_REQUIRED
    const resBlindNoConfirm = await app.inject({
      method: 'POST',
      url: `/api/cash-sessions/${sessionId}/blind-count`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        counts: [
          { method: 'EFECTIVO_USD', countedCents: 0 },
          { method: 'EFECTIVO_BS', countedCents: 0 }
        ]
      }
    });

    expect(resBlindNoConfirm.statusCode).toBe(400);
    expect(resBlindNoConfirm.json().code).toBe('CONFIRM_EMPTY_REQUIRED');

    // La sesión sigue abierta
    let sessionRow = rawDb.prepare('SELECT status FROM cash_sessions WHERE id = ?').get(sessionId) as any;
    expect(sessionRow.status).toBe('abierta');

    // 4b. Con confirmEmpty: true -> cierra en 200
    const resBlindConfirmed = await app.inject({
      method: 'POST',
      url: `/api/cash-sessions/${sessionId}/blind-count`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        counts: [
          { method: 'EFECTIVO_USD', countedCents: 0 },
          { method: 'EFECTIVO_BS', countedCents: 0 }
        ],
        confirmEmpty: true
      }
    });

    expect(resBlindConfirmed.statusCode).toBe(200);
    expect(resBlindConfirmed.json().status).toBe('CLOSED');

    sessionRow = rawDb.prepare('SELECT status FROM cash_sessions WHERE id = ?').get(sessionId) as any;
    expect(sessionRow.status).toBe('cerrada');
  });

  it('5. Reportes Excel y PDF incluyen la tabla de arqueo por método leída de cash_session_method_counts', async () => {
    // Validar datos agregados del reporte
    const reportData = getJornadaReportData(rawDb, jornadaId);
    expect(reportData.sessionMethodCounts).toBeDefined();
    expect(reportData.sessionMethodCounts.length).toBeGreaterThan(0);

    // Generar reporte Excel
    const excelBuffer = await generateJornadaExcelReport(rawDb, jornadaId);
    expect(excelBuffer.length).toBeGreaterThan(500);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excelBuffer);
    const sheetNames = workbook.worksheets.map(w => w.name);
    expect(sheetNames).toContain('Resumen Jornada');
    expect(sheetNames).toContain('Libro Contable');
    expect(sheetNames).toContain('Incidentes y Mermas');
    expect(sheetNames).toContain('Arqueo por Método');

    const methodSheet = workbook.getWorksheet('Arqueo por Método');
    expect(methodSheet).toBeDefined();
    expect(methodSheet!.rowCount).toBeGreaterThan(1); // Cabecera + filas

    // Generar reporte PDF
    const pdfBuffer = await generateJornadaPdfReport(rawDb, jornadaId);
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    expect(pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
