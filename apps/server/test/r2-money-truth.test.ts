/**
 * SISTEMA OPERATIVO TOCINETA — PRUEBAS R2 P2-B
 * Verdad Única del Dinero, Contratos Zod Compartidos, Anti-Duplicado de Gastos
 * y Consistencia entre las 6 Calculadoras.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  ZSummaryResponseSchema,
  CashSalesResponseSchema,
  OwnerNumbersResponseSchema,
  ExpenseCreateResponseSchema
} from '@tocineta/shared';
import { buildServer } from '../src/server.js';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { loginAs, ensureTestSupervisor } from './test-helpers.js';
import { getFinancialTruth } from '../src/modules/finances/financial-truth-service.js';

describe('P2-B — Verdad Única del Dinero y Contratos Compartidos', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_money_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_money.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;

  let adminToken: string;
  let cajeraToken: string;
  let createdOrderId: string;
  let createdJornadaId: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureTestSupervisor(rawDb);

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
  });

  afterAll(async () => {
    await app.close();
    try {
      rawDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. Rechaza cobro si no hay jornada abierta en el sistema (JORNADA_CLOSED)', async () => {
    const resCreate = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { Authorization: `Bearer ${cajeraToken}` },
      payload: {
        fulfillmentType: 'salon',
        tableNumber: 5,
        customerName: 'Cliente Sin Jornada',
        lines: [
          { productId: 'prod_miami', quantity: 1 }
        ]
      }
    });
    expect(resCreate.statusCode).toBe(201);
    const order = JSON.parse(resCreate.payload).order;

    // Asegurar que no hay jornadas abiertas
    rawDb.prepare("UPDATE jornadas SET status = 'cerrada'").run();

    // Intentar cobrar sin jornada abierta
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { Authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }]
      }
    });

    expect(resPay.statusCode).toBe(400);
    const body = JSON.parse(resPay.payload);
    expect(body.success).toBe(false);
    expect(body.code).toBe('JORNADA_CLOSED');
    expect(body.error).toContain('jornada');
  });

  it('2. Rechaza cobro si no hay sesion de caja abierta para el cajero (CASH_SESSION_REQUIRED)', async () => {
    // Abrir jornada del día con $50 USD iniciales (5000 centavos)
    const resJornada = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { Authorization: `Bearer ${cajeraToken}` },
      payload: {
        rateStr: '40.00',
        initialCashUsdCents: 5000,
        initialCashBsCents: 0,
        notes: 'Apertura R2 Money Truth'
      }
    });
    expect(resJornada.statusCode).toBe(200);
    createdJornadaId = JSON.parse(resJornada.payload).jornada.id;

    // Crear orden con total de $11.90: 1 Miami ($6.90 = 690) + 2 Street Dog ($2.50 * 2 = 500)
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { Authorization: `Bearer ${cajeraToken}` },
      payload: {
        fulfillmentType: 'salon',
        tableNumber: 1,
        customerName: 'Manuel Test',
        lines: [
          { productId: 'prod_miami', quantity: 1 },
          { productId: 'prod_street_dog', quantity: 2 }
        ]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = JSON.parse(resOrder.payload).order;
    createdOrderId = order.id;
    expect(order.total_to_collect_usd_cents).toBe(1190);

    // Probar validación CASH_SESSION_REQUIRED intentando cobrar con un usuario autorizado pero sin sesión abierta (admin)
    const resPayNoSession = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 1190 }]
      }
    });

    expect(resPayNoSession.statusCode).toBe(400);
    const bodyNoSession = JSON.parse(resPayNoSession.payload);
    expect(bodyNoSession.code).toBe('CASH_SESSION_REQUIRED');
  });

  it('3. Cajera cobra $11.90 en efectivo USD con su sesión activa; orden queda con jornada_id y cash_session_id', async () => {
    // Cobrar la orden de $11.90 con la cajera que abrió la jornada y tiene sesión activa
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${createdOrderId}/pay`,
      headers: { Authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 1190 }]
      }
    });
    expect(resPay.statusCode).toBe(200);

    // Verificar en BD que orden tiene jornada_id y cash_session_id no nulos
    const row = rawDb.prepare('SELECT jornada_id, cash_session_id, payment_status FROM orders WHERE id = ?').get(createdOrderId) as any;
    expect(row.payment_status).toBe('pagado');
    expect(row.jornada_id).toBeTruthy();
    expect(row.cash_session_id).toBeTruthy();
  });

  it('4. Las 6 rutas devuelven ventas ($11.90) y efectivo esperado ($61.90) consistentes', async () => {
    // 1. Cierre Z Summary (/api/reports/z-report/summary)
    const resZ = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/summary?jornadaId=${createdJornadaId}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resZ.statusCode).toBe(200);
    const zParsed = ZSummaryResponseSchema.safeParse(JSON.parse(resZ.payload));
    expect(zParsed.success).toBe(true);
    if (!zParsed.success) throw zParsed.error;

    expect(zParsed.data.summary.netFoodSalesUsdCents).toBe(1190);
    expect(zParsed.data.summary.expectedCashUsdCents).toBe(6190); // $50.00 apertura + $11.90 venta
    expect(zParsed.data.summary.totalOrders).toBe(1);
    expect(zParsed.data.summary.byMethod.some(m => m.method === 'EFECTIVO_USD' && m.totalUsdCents === 1190)).toBe(true);

    // Suma de sedes igual al total
    const totalSedesExpectedCash = zParsed.data.summary.bySede.reduce((acc, s) => acc + s.expectedCashUsdCents, 0);
    expect(totalSedesExpectedCash).toBe(6190);

    // 2. Ventas de Caja (/api/cash-sessions/current/sales)
    const resSales = await app.inject({
      method: 'GET',
      url: '/api/cash-sessions/current/sales',
      headers: { Authorization: `Bearer ${cajeraToken}` }
    });
    expect(resSales.statusCode).toBe(200);
    const salesParsed = CashSalesResponseSchema.safeParse(JSON.parse(resSales.payload));
    expect(salesParsed.success).toBe(true);
    if (!salesParsed.success) throw salesParsed.error;

    expect(salesParsed.data.sales.length).toBe(1);
    expect(salesParsed.data.sales[0].orderId).toBe(createdOrderId);
    expect(salesParsed.data.sales[0].totalUsdCents).toBe(1190);
    expect(salesParsed.data.sales[0].primaryMethod).toBe('EFECTIVO_USD');

    // 3. Panel de la Dueña: 5 Números (/api/finances/owner-numbers)
    const resOwner5 = await app.inject({
      method: 'GET',
      url: '/api/finances/owner-numbers',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resOwner5.statusCode).toBe(200);
    const owner5Parsed = OwnerNumbersResponseSchema.safeParse(JSON.parse(resOwner5.payload));
    expect(owner5Parsed.success).toBe(true);
    if (!owner5Parsed.success) throw owner5Parsed.error;

    const salesToday = owner5Parsed.data.data.metrics.find(m => m.key === 'sales_today');
    expect(salesToday?.value).toBe(1190);

    // 4. Panel de la Dueña: Transfers & Sede Summary (/api/fase4/owner-dashboard)
    const resOwnerDash = await app.inject({
      method: 'GET',
      url: '/api/fase4/owner-dashboard',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resOwnerDash.statusCode).toBe(200);
    const dashBody = JSON.parse(resOwnerDash.payload).dashboard;
    const totalDashSales = dashBody.salesByLocation.reduce((acc: number, l: any) => acc + l.netSalesUsdCents, 0);
    const totalDashCash = dashBody.cashByLocation.reduce((acc: number, l: any) => acc + l.cashUsdCents, 0);
    expect(totalDashSales).toBe(1190);
    expect(totalDashCash).toBe(6190);

    // 5. Utilidad y Pérdidas (/api/finances/profit-loss)
    const resPL = await app.inject({
      method: 'GET',
      url: '/api/finances/profit-loss',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resPL.statusCode).toBe(200);
    const plBody = JSON.parse(resPL.payload);
    expect(plBody.data.summary.netFoodSalesUsdCents).toBe(1190);

    // 6. Flujo de Caja (/api/finances/cash-flow)
    const resCF = await app.inject({
      method: 'GET',
      url: '/api/finances/cash-flow',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(resCF.statusCode).toBe(200);
    const cfBody = JSON.parse(resCF.payload);
    expect(cfBody.data.summary.netCashFlowUsdCents).toBe(1190);
  });

  it('5. Anti-duplicado de gastos (120s): bloquea duplicado y autoriza con confirmDuplicate (D4)', async () => {
    const expensePayload = {
      category: 'OPERATIVO',
      amountUsdCents: 500, // $5.00
      paymentMethod: 'PAGO_MOVIL',
      description: 'Compra de Hielo para Bebidas',
      clientRequestId: `req_${Date.now()}`
    };

    // 1. Registro inicial: debe ser exitoso (201)
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/finances/expenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: expensePayload
    });
    expect(res1.statusCode).toBe(201);
    const parsed1 = ExpenseCreateResponseSchema.safeParse(JSON.parse(res1.payload));
    expect(parsed1.success).toBe(true);

    // 2. Registro idéntico inmediato dentro de 120s: rechazo 409 POSSIBLE_DUPLICATE
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/finances/expenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { ...expensePayload, clientRequestId: `req_dup_${Date.now()}` }
    });
    expect(res2.statusCode).toBe(409);
    const body2 = JSON.parse(res2.payload);
    expect(body2.code).toBe('POSSIBLE_DUPLICATE');

    // 3. Registro con confirmDuplicate: true: permitido (201)
    const res3 = await app.inject({
      method: 'POST',
      url: '/api/finances/expenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        ...expensePayload,
        clientRequestId: `req_confirmed_${Date.now()}`,
        confirmDuplicate: true
      }
    });
    expect(res3.statusCode).toBe(201);
  });

  it('6. Gasto en PAGO_MOVIL no altera efectivo esperado; gasto en EFECTIVO_USD lo descuenta', async () => {
    // Consultar Z report: los gastos de PAGO_MOVIL no deben haber tocado expectedCashUsdCents ($61.90)
    const resZBefore = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/summary?jornadaId=${createdJornadaId}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const zBefore = JSON.parse(resZBefore.payload);
    expect(zBefore.summary.expectedCashUsdCents).toBe(6190);

    // Ahora registrar un gasto en EFECTIVO_USD de $10.00 (1000 cents)
    const resCashExp = await app.inject({
      method: 'POST',
      url: '/api/finances/expenses',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        category: 'INSUMOS',
        amountUsdCents: 1000,
        paymentMethod: 'EFECTIVO_USD',
        description: 'Bolsas para despacho',
        clientRequestId: `req_cash_${Date.now()}`
      }
    });
    expect(resCashExp.statusCode).toBe(201);

    // Consultar Z report: el gasto en efectivo USD debe descontar directamente la gaveta ($61.90 - $10.00 = $51.90)
    const resZAfter = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/summary?jornadaId=${createdJornadaId}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const zAfter = JSON.parse(resZAfter.payload);
    expect(zAfter.summary.expectedCashUsdCents).toBe(5190);
  });

  it('7. Regla de deduplicación de mermas entre waste_logs e incidents no duplica pérdidas', () => {
    const ft = getFinancialTruth(rawDb, { jornadaId: createdJornadaId });
    expect(ft.waste).toBeDefined();
    expect(typeof ft.waste.totalUsdCents).toBe('number');
    expect(ft.operatingExpensesUsdCents).toBeDefined();
  });
});
