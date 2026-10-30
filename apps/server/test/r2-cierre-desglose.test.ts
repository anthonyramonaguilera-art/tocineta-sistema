import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { loginAs, ensureTestSupervisor } from './test-helpers.js';
import { getFinancialTruth } from '../src/modules/finances/financial-truth-service.js';
import { buildZReportTicketIR } from '../src/modules/printing/templates.js';

describe('G-CLI-8: Desglose del cierre Z por todos los métodos de pago', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_cierre_desglose_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_desglose.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken = '';
  let cajeraToken = '';

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
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
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

  it('1. Orden con pago mixto (Pago Móvil + Punto de Venta + Efectivo USD) contiene los tres métodos en byMethod', async () => {
    // Abrir jornada con tasa 40.00 Bs/$
    const resJornada = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        rateMicroBs: 40_000_000,
        rateStr: '40.00',
        initialCashUsdCents: 10000,
        initialCashBsCents: 200000
      }
    });
    const jornadaId = resJornada.json().jornada.id;

    // Abrir sesión de caja
    await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        openingCashUsdCents: 10000,
        openingCashBsCents: 200000
      }
    });

    // Crear orden
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        fulfillmentType: 'salon',
        tableNumber: 'Mesa 1',
        customerName: 'Cliente Desglose',
        lines: [
          { productId: 'prod_classic_dog', quantity: 1 }
        ]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const orderData = resOrder.json().order;
    const orderId = orderData.id;
    const totalToCollect = orderData.total_to_collect_usd_cents;

    // Dividir totalToCollect en 3 partes: Pago Móvil (40%), Punto de Venta (30%), Efectivo USD (30%)
    const pmUsd = Math.round(totalToCollect * 0.4);
    const pdvUsd = Math.round(totalToCollect * 0.3);
    const cashUsd = totalToCollect - pmUsd - pdvUsd;

    const pmBsCents = Math.round((pmUsd * 40_000_000) / 1_000_000);
    const pdvBsCents = Math.round((pdvUsd * 40_000_000) / 1_000_000);

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'pago_movil', amountCents: pmBsCents, referenceCode: '123456' },
          { method: 'ubii', amountCents: pdvBsCents },
          { method: 'cash_usd', amountCents: cashUsd }
        ]
      }
    });
    expect(resPay.statusCode).toBe(200);

    // Verificar Verdad Financiera
    const ft = getFinancialTruth(rawDb, { jornadaId });
    const methods = ft.collectedByMethod.map(m => m.method);

    expect(methods).toContain('PAGO_MOVIL');
    expect(methods).toContain('UBII');
    expect(methods).toContain('EFECTIVO_USD');

    // Métodos sin movimientos no aparecen en collectedByMethod (diseño documentado: exclusión de ceros)
    expect(methods).not.toContain('BINANCE');
    expect(methods).not.toContain('ZELLE');

    // Ejecutar Cierre Z (admin)
    const resClosure = await app.inject({
      method: 'POST',
      url: `/api/jornadas/${jornadaId}/close`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        pin: '123456',
        countedCashUsdCents: 18000,
        countedCashBsCents: 200000
      }
    });
    expect(resClosure.statusCode).toBe(200);
    const zReport = resClosure.json().zReport;

    expect(zReport.byMethod).toBeDefined();
    expect(zReport.byMethod.length).toBeGreaterThanOrEqual(3);

    const reportMethods = zReport.byMethod.map((m: any) => m.method);
    expect(reportMethods).toContain('PAGO_MOVIL');
    expect(reportMethods).toContain('UBII');
    expect(reportMethods).toContain('EFECTIVO_USD');

    // Verificar invariante: la suma de grossUsdCents en byMethod debe coincidir con totalCollectedUsdCents / cobrado
    const sumGrossUsd = zReport.byMethod.reduce((acc: number, m: any) => acc + m.grossUsdCents, 0);
    expect(sumGrossUsd).toBe(zReport.totalCollectedUsdCents);

    // Verificar generación de Ticket IR con sección COBRADO POR MÉTODO
    const ticketIR = buildZReportTicketIR(zReport);
    const hasCobradoPorMetodo = ticketIR.blocks.some((b: any) => b.text && b.text.includes('COBRADO POR MÉTODO'));
    expect(hasCobradoPorMetodo).toBe(true);
  });

  it('2. Cierre sin UBII sigue funcionando exactamente igual', async () => {
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
    const jornadaId = resJornada.json().jornada.id;

    await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        openingCashUsdCents: 5000,
        openingCashBsCents: 100000
      }
    });

    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        fulfillmentType: 'salon',
        tableNumber: 'Mesa 2',
        customerName: 'Cliente Sin Punto',
        lines: [
          { productId: 'prod_classic_dog', quantity: 1 }
        ]
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
          { method: 'cash_usd', amountCents: resOrder.json().order.total_to_collect_usd_cents }
        ]
      }
    });
    expect(resPay.statusCode).toBe(200);

    const resClosure = await app.inject({
      method: 'POST',
      url: `/api/jornadas/${jornadaId}/close`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        pin: '123456',
        countedCashUsdCents: 5500,
        countedCashBsCents: 100000
      }
    });
    expect(resClosure.statusCode).toBe(200);
    const zReport = resClosure.json().zReport;
    expect(zReport.byMethod).toBeDefined();
    expect(zReport.byMethod.some((m: any) => m.method === 'UBII')).toBe(false);
  });
});
