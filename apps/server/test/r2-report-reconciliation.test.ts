import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
import { loginAs, ensureTestSupervisor } from './test-helpers.js';
import { getJornadaReportData } from '../src/modules/reports/reports-service.js';
import { buildPaymentSectionRows } from '../src/modules/reports/report-rows.js';
import { _resetAuthorizerGuardState } from '../src/modules/auth/authorizer-guard.js';

describe('TAREA B1: Conciliación de Medios de Pago y Conversión Integral a USD y Bs', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_reconciliation_${Date.now()}`);
  const tempDb = path.join(tempDir, 'reconciliation.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;
  let cajeraToken: string;
  let jornadaId: string;
  const RATE_MICRO_BS = 40_000_000; // 40.00 Bs/USD
  const SUPERVISOR_PIN = '123456';

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

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
  }, 30000);

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
        initialCashUsdCents: 5000,
        initialCashBsCents: 100000
      }
    });
    expect(resJornada.statusCode).toBe(200);
    jornadaId = resJornada.json().jornada.id;
  });

  it('Escenario 1: Zelle $50 exacto muestra USD "50.00" y Bs "2000.00", diff 0, y ningún método tiene bs vacío', async () => {
    // Orden de 20 street dogs = $50.00 (5000 centavos)
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 1',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 20 }]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    // Pagar 100% con Zelle
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'zelle', amountCents: 5000, referenceCode: 'ZEL-TEST-1' }]
      }
    });
    expect(resPay.statusCode).toBe(200);

    const reportData = getJornadaReportData(rawDb, jornadaId);
    expect(reportData.reconciliationDiffUsdCents).toBe(0);

    const rows = buildPaymentSectionRows(reportData);
    const zelleRow = rows.find(r => r.label === 'Zelle (USD)');
    expect(zelleRow).toBeDefined();
    expect(zelleRow?.usd).toBe('50.00');
    expect(zelleRow?.bs).toBe('2000.00');

    // Verificar que NINGUNO de los 9 métodos ni ninguna fila devuelva bs vacío
    const methodLabels = [
      'Efectivo Dólares (USD)',
      'Efectivo Bolívares (Bs)',
      'Pago Móvil (Banesco)',
      'Punto de Venta (Bs)',
      'Punto de Venta Ubii (Bruto)',
      ' - Comisión Punto Ubii (0.75%)',
      ' - Neto Bancario Ubii Esperado',
      'Transferencia Bancaria (Bs)',
      'Binance Pay (USDT)',
      'Zelle (USD)',
      'Otros Métodos (USD)'
    ];

    for (const label of methodLabels) {
      const row = rows.find(r => r.label === label);
      expect(row, `Fila no encontrada: ${label}`).toBeDefined();
      expect(row?.bs, `bs vacío en fila ${label}`).not.toBe('');
      expect(row?.usd, `usd vacío en fila ${label}`).not.toBe('');
    }
  });

  it('Escenario 2: orden $48 pagada con $50 efectivo USD y vuelto $2 USD -> diff 0', async () => {
    // 13 * 350 + 1 * 250 = 4550 + 250 = 4800 ($48.00)
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 2',
        fulfillmentType: 'salon',
        lines: [
          { productId: 'prod_tocineta_dog_parmesano', quantity: 13 },
          { productId: 'prod_street_dog', quantity: 1 }
        ]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;
    expect(order.total_to_collect_usd_cents).toBe(4800);

    // Pagar $50 USD en efectivo, vuelto $2 USD
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 5000 }],
        changeOutputs: { changeUsdCents: 200, changeBsCents: 0 }
      }
    });
    expect(resPay.statusCode).toBe(200);

    const reportData = getJornadaReportData(rawDb, jornadaId);
    expect(reportData.changeUsdCents).toBe(200);
    expect(reportData.methodsNetUsdEquivCents).toBe(4800);
    expect(reportData.totalCollectedUsdCents).toBe(4800);
    expect(reportData.surplusUsdCents).toBe(0);
    expect(reportData.ledgerSurplusUsdCents).toBe(0);
    expect(reportData.reconciliationDiffUsdCents).toBe(0);

    const rows = buildPaymentSectionRows(reportData);
    const vueltoRow = rows.find(r => r.label === '(-) Vuelto efectivo USD');
    expect(vueltoRow).toBeDefined();
    expect(vueltoRow?.usd).toBe('2.00');
    expect(vueltoRow?.bs).toBe('80.00');
  });

  it('Escenario 3: sobrepago tip_in $2 -> diff 0', async () => {
    // Orden $48.00 pagada con $50 USD y sobrepago tip_in $2.00
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 3',
        fulfillmentType: 'salon',
        lines: [
          { productId: 'prod_tocineta_dog_parmesano', quantity: 13 },
          { productId: 'prod_street_dog', quantity: 1 }
        ]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 5000 }],
        overpaymentDisposition: 'tip_in'
      }
    });
    expect(resPay.statusCode).toBe(200);

    const reportData = getJornadaReportData(rawDb, jornadaId);
    expect(reportData.methodsNetUsdEquivCents).toBe(5000);
    expect(reportData.totalCollectedUsdCents).toBe(4800);
    expect(reportData.surplusUsdCents).toBe(200);
    expect(reportData.ledgerSurplusUsdCents).toBe(200);
    expect(reportData.reconciliationDiffUsdCents).toBe(0);

    const rows = buildPaymentSectionRows(reportData);
    const surplusRow = rows.find(r => r.label === '(+) Excedente aceptado (propina/ajuste)');
    expect(surplusRow).toBeDefined();
    expect(surplusRow?.usd).toBe('2.00');
    expect(surplusRow?.bs).toBe('80.00');
  });

  it('Escenario 4: vuelto mixto con Pago Móvil -> diff 0', async () => {
    // Orden $30.00 (12 street dogs)
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 4',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 12 }]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;
    expect(order.total_to_collect_usd_cents).toBe(3000);

    // Pago con $50 USD (5000 cents), vuelto $10 USD (1000 cents) y $10 en Pago Móvil (40.000 céntimos Bs)
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 5000 }],
        changeOutputs: {
          method: 'pago_movil',
          changeUsdCents: 1000,
          changeBsCents: 40000,
          referenceCode: 'PM-CHG-999'
        }
      }
    });
    expect(resPay.statusCode).toBe(200);

    const reportData = getJornadaReportData(rawDb, jornadaId);
    expect(reportData.changeUsdCents).toBe(1000);
    expect(reportData.changeBsBankCents).toBe(40000);
    expect(reportData.methodsNetUsdEquivCents).toBe(3000);
    expect(reportData.totalCollectedUsdCents).toBe(3000);
    expect(reportData.reconciliationDiffUsdCents).toBe(0);

    const rows = buildPaymentSectionRows(reportData);
    const pmChangeRow = rows.find(r => r.label === '(-) Vuelto por Pago Movil');
    expect(pmChangeRow).toBeDefined();
    expect(pmChangeRow?.usd).toBe('10.00');
    expect(pmChangeRow?.bs).toBe('400.00');
  });

  it('Escenario 5: pago mixto en Bs -> |diff| <= tolerance', async () => {
    // Orden $25.00 (10 street dogs = 2500 cents)
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 5',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 10 }]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    // Pago mixto: 500.00 Bs por Pago Móvil (50000 céntimos) + 500.00 Bs por Punto de Venta (50000 céntimos)
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'pago_movil', amountCents: 50000, referenceCode: 'PM-MIXTO-1' },
          { method: 'punto_de_venta', amountCents: 50000, referenceCode: 'POS-MIXTO-1' }
        ]
      }
    });
    expect(resPay.statusCode).toBe(200);

    const reportData = getJornadaReportData(rawDb, jornadaId);
    expect(reportData.reconciliationToleranceCents).toBeGreaterThanOrEqual(2);
    expect(Math.abs(reportData.reconciliationDiffUsdCents)).toBeLessThanOrEqual(reportData.reconciliationToleranceCents);

    const rows = buildPaymentSectionRows(reportData);
    const diffRow = rows.find(r => r.label === 'Diferencia de conciliacion');
    expect(diffRow).toBeDefined();
    expect(diffRow?.usd).toBeDefined();
    expect(diffRow?.bs).toBeDefined();
  });

  it('Escenario 6: orden pagada y luego anulada -> diff 0', async () => {
    // Orden $25.00 pagada con Zelle y luego anulada con PIN supervisor
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 6',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 10 }]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'zelle', amountCents: 2500, referenceCode: 'ZEL-CANCEL-1' }]
      }
    });
    expect(resPay.statusCode).toBe(200);

    // Anular la orden pagada
    const resVoid = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        supervisorPin: SUPERVISOR_PIN,
        reason: 'Cliente canceló el pedido'
      }
    });
    expect(resVoid.statusCode).toBe(200);

    const reportData = getJornadaReportData(rawDb, jornadaId);
    expect(reportData.totalCollectedUsdCents).toBe(0);
    expect(reportData.methodsNetUsdEquivCents).toBe(0);
    expect(reportData.surplusUsdCents).toBe(0);
    expect(reportData.ledgerSurplusUsdCents).toBe(0);
    expect(reportData.reconciliationDiffUsdCents).toBe(0);

    const rows = buildPaymentSectionRows(reportData);
    const diffRow = rows.find(r => r.label === 'Diferencia de conciliacion');
    expect(diffRow?.usd).toBe('0.00');
    expect(diffRow?.bs).toBe('0.00');
  });

  it('Escenario 7 (Delivery): delivery_fee con cash_collected_by_driver=1 concilia en caja y muestra fila informativa', async () => {
    // Orden delivery: $25.00 comida + $5.00 delivery = $30.00 total
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Delivery Casa 1',
        fulfillmentType: 'delivery',
        lines: [{ productId: 'prod_street_dog', quantity: 10 }]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    // Actualizar delivery_fee_usd_cents = 500 en orden
    rawDb.prepare('UPDATE orders SET delivery_fee_usd_cents = 500 WHERE id = ?').run(order.id);

    // Insertar registro de delivery con cash_collected_by_driver = 1 (el motorizado cobró el delivery)
    rawDb.prepare(`
      INSERT INTO deliveries (
        id, order_id, driver_id, motorizado_name, delivery_fee_usd_cents,
        cash_collected_by_driver, food_cash_amount_usd_cents, settled_to_motorizado, created_at_ms
      ) VALUES (?, ?, 'drv_carlos_mora', 'REPARTIDOR 1', 500, 1, 0, 0, ?)
    `).run(`del_test_${Date.now()}`, order.id, Date.now());

    // El cliente pagó la comida en caja ($25.00 = 2500 cents Zelle)
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'zelle', amountCents: 2500, referenceCode: 'ZEL-DELIVERY-1' }]
      }
    });
    expect(resPay.statusCode).toBe(200);

    const reportData = getJornadaReportData(rawDb, jornadaId);
    expect(reportData.deliveryFeesUsdCents).toBe(500);
    expect(reportData.totalCollectedUsdCents).toBe(3000);
    expect(reportData.driverDirectDeliveryUsdCents).toBe(500);
    expect(reportData.methodsNetUsdEquivCents).toBe(2500);
    expect(reportData.surplusUsdCents).toBe(0);
    expect(reportData.ledgerSurplusUsdCents).toBe(0);
    expect(reportData.reconciliationDiffUsdCents).toBe(0);

    const rows = buildPaymentSectionRows(reportData);
    const driverDeliveryRow = rows.find(r => r.label === 'Delivery cobrado directo por motorizados');
    expect(driverDeliveryRow).toBeDefined();
    expect(driverDeliveryRow?.usd).toBe('5.00');
    expect(driverDeliveryRow?.bs).toBe('200.00');

    const boxSalesRow = rows.find(r => r.label === 'Ventas cobradas en caja (incl. delivery cobrado en caja)');
    expect(boxSalesRow?.usd).toBe('25.00');
    expect(boxSalesRow?.bs).toBe('1000.00');

    const diffRow = rows.find(r => r.label === 'Diferencia de conciliacion');
    expect(diffRow?.usd).toBe('0.00');
    expect(diffRow?.bs).toBe('0.00');
  });
});
