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
import { getFinancialTruth } from '../src/modules/finances/financial-truth-service.js';
import { getOwnerDashboardData } from '../src/modules/transfers/owner-dashboard-service.js';

describe('P5-A â€” Paridad Z vs verdad financiera (SEV-201)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_z_truth_parity_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_z_truth_parity.db');
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

  it('Demuestra paridad campo por campo entre Cierre Z, /api/reports/z-report/summary, financial-truth y owner-numbers', async () => {
    // 1. Abrir jornada (Tasa BCV 40.00 Bs/USD, apertura: $50 USD y 1.000 Bs)
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

    // 2. Crear Orden 1: 5 Texas Mex ($6.90 x 5 = $34.50 = 3450 centavos)
    const resOrder1 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 1',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_texas_mex', quantity: 5 }]
      }
    });
    expect(resOrder1.statusCode).toBe(201);
    const order1 = resOrder1.json().order;
    expect(order1.gross_food_subtotal_usd_cents).toBe(3450);

    // 3. Aplicar descuento por cupÃ³n (BIENVENIDA1 = -$1.00 = -100 centavos)
    const resCoupon = await app.inject({
      method: 'POST',
      url: `/api/orders/${order1.id}/apply-coupon`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { couponCode: 'BIENVENIDA1' }
    });
    if (resCoupon.statusCode !== 200) {
      console.log('COUPON ERROR:', resCoupon.json());
    }
    expect(resCoupon.statusCode).toBe(200);
    const updatedOrder1 = resCoupon.json().order;
    expect(updatedOrder1.discount_usd_cents).toBe(100);
    expect(updatedOrder1.total_to_collect_usd_cents).toBe(3350); // $33.50 neto

    // 4. Pago mixto con los 6 mÃ©todos:
    // USD:
    // - cash_usd: $15.00 (1500 centavos)
    // - binance: $5.00 (500 centavos)
    // - zelle: $5.00 (500 centavos)
    // Total USD pagado: $25.00 (2500 centavos)
    // Bs (a tasa 40.00 Bs/$):
    // - cash_bs: 140.00 Bs (14.000 cÃ©ntimos Bs = $3.50)
    // - pago_movil: 200.00 Bs (20.000 cÃ©ntimos Bs = $5.00)
    // - punto_de_venta (UBII): 200.00 Bs (20.000 cÃ©ntimos Bs = $5.00)
    // Total Bs pagado: 540.00 Bs (54.000 cÃ©ntimos Bs = $13.50)
    // Total recibido: $25.00 + $13.50 = $38.50 (3850 centavos equivalentes)
    // Total orden a cobrar: $33.50 (3350 centavos)
    // Excedente total: $5.00 (500 centavos)
    // DistribuciÃ³n del excedente:
    // - Vuelto entregado en efectivo USD: $3.00 (300 centavos)
    // - Propina retenida para el equipo: $2.00 (200 centavos, overpaymentDisposition: 'tip_in')
    const resPay1 = await app.inject({
      method: 'POST',
      url: `/api/orders/${order1.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'cash_usd', amountCents: 1500 },
          { method: 'binance', amountCents: 500, referenceCode: `BIN-${Date.now()}` },
          { method: 'zelle', amountCents: 500, referenceCode: `ZEL-${Date.now()}` },
          { method: 'cash_bs', amountCents: 14000 },
          { method: 'pago_movil', amountCents: 20000, referenceCode: `PM-${Date.now()}` },
          { method: 'punto_de_venta', amountCents: 20000, referenceCode: `UBII-${Date.now()}` }
        ],
        changeOutputs: {
          changeUsdCents: 300,
          changeBsCents: 0
        },
        overpaymentDisposition: 'tip_in'
      }
    });
    expect(resPay1.statusCode).toBe(200);

    // 5. Crear Orden 2 y anularla mediante incidente autorizado (para probar que Ã³rdenes anuladas no alteran la paridad)
    const resOrder2 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 2',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 2 }]
      }
    });
    expect(resOrder2.statusCode).toBe(201);
    const order2 = resOrder2.json().order;

    const resCancel2 = await app.inject({
      method: 'POST',
      url: `/api/orders/${order2.id}/incident`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        reason_code: 'cliente_se_arrepintio',
        responsible_area: 'cliente',
        resolution: 'void_paid',
        authorizer_pin: '123456'
      }
    });
    if (resCancel2.statusCode !== 200) {
      console.log('CANCEL INCIDENT ERROR:', resCancel2.json());
    }
    expect(resCancel2.statusCode).toBe(200);

    // 6. Consultar Verdad Financiera directamente
    const ft = getFinancialTruth(rawDb, { jornadaId });

    // 7. Consultar Resumen Cierre Z en vivo (/api/reports/z-report/summary)
    const resSummary = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/summary?jornadaId=${jornadaId}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(resSummary.statusCode).toBe(200);
    const zSummary = resSummary.json().summary;

    // 8. Consultar Panel de la DueÃ±a: owner-numbers (/api/finances/owner-numbers)
    const resOwnerNumbers = await app.inject({
      method: 'GET',
      url: '/api/finances/owner-numbers',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(resOwnerNumbers.statusCode).toBe(200);
    const ownerNumbers = resOwnerNumbers.json().data;

    // 9. Consultar Panel de la DueÃ±a: owner-dashboard (/api/fase4/owner-dashboard)
    const resOwnerDash = await app.inject({
      method: 'GET',
      url: '/api/fase4/owner-dashboard',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(resOwnerDash.statusCode).toBe(200);
    const ownerDash = resOwnerDash.json().dashboard;

    // 10. Ejecutar Cierre Z oficial de la jornada (POST /api/jornadas/:id/close)
    const resClose = await app.inject({
      method: 'POST',
      url: `/api/jornadas/${jornadaId}/close`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { adminPin: '123456' }
    });
    expect(resClose.statusCode).toBe(200);
    const zClose = resClose.json().zReport;

    // 11. ComparaciÃ³n mÃ©todo por mÃ©todo
    const expectedMethods = [
      'EFECTIVO_USD',
      'EFECTIVO_BS',
      'PAGO_MOVIL',
      'UBII',
      'BINANCE',
      'ZELLE'
    ];

    interface ParityRow {
      metodo: string;
      moneda: 'USD' | 'BS';
      zBruto: number;
      truthBruto: number;
      diffBruto: number;
      zNeto: number;
      truthNeto: number;
      diffNeto: number;
      countZ: number;
      countTruth: number;
      diffCount: number;
    }

    const parityTable: ParityRow[] = [];

    for (const method of expectedMethods) {
      const truthItem = ft.collectedByMethod.find(m => m.method === method);
      const zSummaryItem = zSummary.byMethod.find((m: any) => m.method === method);
      const zCloseItem = zClose.byMethod.find((m: any) => m.method === method);

      expect(truthItem).toBeDefined();
      expect(zSummaryItem).toBeDefined();
      expect(zCloseItem).toBeDefined();

      const isUsd = method === 'EFECTIVO_USD' || method === 'BINANCE' || method === 'ZELLE';
      const zBruto = isUsd ? (zCloseItem?.grossUsdCents ?? 0) : (zCloseItem?.grossBsCents ?? 0);
      const truthBruto = isUsd ? (truthItem?.grossUsdCents ?? 0) : (truthItem?.grossBsCents ?? 0);
      const zNeto = isUsd ? (zSummaryItem?.netUsdCents ?? zCloseItem?.grossUsdCents ?? 0) : (zSummaryItem?.netBsCents ?? zCloseItem?.grossBsCents ?? 0);
      const truthNeto = isUsd ? (truthItem?.netUsdCents ?? 0) : (truthItem?.netBsCents ?? 0);

      const diffBruto = zBruto - truthBruto;
      const diffNeto = zNeto - truthNeto;
      const diffCount = (zCloseItem?.count ?? 0) - (truthItem?.count ?? 0);

      parityTable.push({
        metodo: method,
        moneda: isUsd ? 'USD' : 'BS',
        zBruto,
        truthBruto,
        diffBruto,
        zNeto,
        truthNeto,
        diffNeto,
        countZ: zCloseItem?.count ?? 0,
        countTruth: truthItem?.count ?? 0,
        diffCount
      });

      // Aserciones de paridad estricta (Diferencia permitida: 0 centavos)
      expect(diffBruto).toBe(0);
      expect(diffNeto).toBe(0);
      expect(diffCount).toBe(0);
    }

    // Comparar campos globales del Cierre Z contra Verdad Financiera
    expect(zClose.netSalesUsdCents).toBe(ft.orders.netSalesUsdCents);
    expect(zClose.grossSalesUsdCents).toBe(ft.orders.grossSalesUsdCents);
    expect(zClose.discountUsdCents).toBe(ft.orders.discountsUsdCents);
    expect(zClose.deliveryFeesUsdCents).toBe(ft.orders.deliveryFeesUsdCents);
    expect(zClose.totalCollectedUsdCents).toBe(ft.orders.netSalesUsdCents + ft.orders.deliveryFeesUsdCents);
    expect(zClose.ordersCount).toBe(ft.orders.totalCount);

    // Comparar contra Dashboard de la DueÃ±a (owner-numbers)
    const salesTodayMetric = ownerNumbers.metrics.find((m: any) => m.key === 'sales_today');
    expect(salesTodayMetric?.value).toBe(ft.orders.netSalesUsdCents);
    expect(salesTodayMetric?.value).toBe(zClose.netSalesUsdCents);

    const cashTodayMetric = ownerNumbers.metrics.find((m: any) => m.key === 'cash_today');
    expect(cashTodayMetric?.value).toBe(ft.expectedCash.netCashUsdCents);
    expect(cashTodayMetric?.value).toBe(zSummary.expectedCashUsdCents);

    // Comparar contra Owner Dashboard (Fase 4: electronic USD y Bs)
    const totalOwnerDashSales = ownerDash.salesByLocation.reduce((acc: number, l: any) => acc + l.netSalesUsdCents, 0);
    expect(totalOwnerDashSales).toBe(ft.orders.netSalesUsdCents);
    expect(totalOwnerDashSales).toBe(zClose.netSalesUsdCents);

    // Imprimir tabla formateada
    console.log('\n=================== TABLA DE PARIDAD Z vs VERDAD FINANCIERA ===================');
    console.table(
      parityTable.map(r => ({
        'MÃ©todo': r.metodo,
        'Moneda': r.moneda,
        'Z Bruto': r.zBruto,
        'Verdad Bruto': r.truthBruto,
        'Dif Bruto': r.diffBruto,
        'Z Neto': r.zNeto,
        'Verdad Neto': r.truthNeto,
        'Dif Neto': r.diffNeto,
        'Ã“rdenes Z': r.countZ,
        'Ã“rdenes Verdad': r.countTruth,
        'Dif Conteo': r.diffCount
      }))
    );
    console.log('=================================================================================\n');
  });
});
