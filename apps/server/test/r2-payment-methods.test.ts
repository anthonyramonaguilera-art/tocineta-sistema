import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { loginAs, ensureTestSupervisor } from './test-helpers.js';
import { getFinancialTruth } from '../src/modules/finances/financial-truth-service.js';

describe('A-1 · Servidor: métodos de pago coherentes + migración 0039 (@tocineta/server)', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_a1_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_a1.db');
  let rawDb: InstanceType<typeof Database>;

  let cajeraToken: string;
  let supervisorToken: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    runMigrations(rawDb, path.join(__dirname, '../src/db/migrations'));
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureTestSupervisor(rawDb);

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
    supervisorToken = (await loginAs(app, 'supervisor', rawDb)).token;

    rawDb.prepare("UPDATE business_settings SET print_mode = 'two' WHERE id = 'default'").run();

    // Abrir jornada con tasa 40.00 Bs/$
    await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        rateStr: '40.00',
        initialCashUsdCents: 5000,
        initialCashBsCents: 200000,
        notes: 'Jornada A-1 Tests'
      }
    });

    // Abrir sesión de caja
    await app.inject({
      method: 'POST',
      url: '/api/cashier/sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        openingCashUsdCents: 5000,
        openingCashBsCents: 200000
      }
    });
  });

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

  async function createTestOrder(totalUsdCents = 100): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 1',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 1 }]
      }
    });
    expect(res.statusCode).toBe(201);
    const order = JSON.parse(res.payload).order;
    // Forzamos el total si es necesario para facilitar la matemática del test
    rawDb.prepare('UPDATE orders SET total_to_collect_usd_cents = ?, net_food_sales_usd_cents = ?, gross_food_subtotal_usd_cents = ? WHERE id = ?')
      .run(totalUsdCents, totalUsdCents, totalUsdCents, order.id);
    return order.id;
  }

  // 1. Migración 0039 en BD limpia
  it('La migración 0039 aplica sobre una BD limpia y acepta un insert con TRANSFERENCIA', () => {
    const memDb = new Database(':memory:');
    runMigrations(memDb, path.join(__dirname, '../src/db/migrations'));
    seedInitialUsers(memDb);

    // Insertar jornada y orden dummy requeridas por foreign key
    const now = Date.now();
    memDb.prepare(`
      INSERT INTO jornadas (id, opened_by_user_id, initial_cash_usd_cents, initial_cash_bs_cents, opened_at_ms)
      VALUES ('jor_test_0039', 'usr_admin', 0, 0, ?)
    `).run(now);

    memDb.prepare(`
      INSERT INTO orders (id, order_number, location_id, jornada_id, created_by_user_id, rate_micro_bs, total_to_collect_usd_cents, created_at_ms, updated_at_ms)
      VALUES ('ord_test_0039', 9999, 'loc_alta_vista', 'jor_test_0039', 'usr_admin', 40000000, 1000, ?, ?)
    `).run(now, now);

    // Debe permitir TRANSFERENCIA
    const stmt = memDb.prepare(`
      INSERT INTO payments (
        id, order_id, method, currency, amount_cents, rate_micro_bs,
        usd_equivalent_cents, recorded_by_user_id, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    expect(() => {
      stmt.run(
        'pay_test_transf',
        'ord_test_0039',
        'TRANSFERENCIA',
        'BS',
        40000,
        40000000,
        1000,
        'usr_cajera',
        now
      );
    }).not.toThrow();

    // Debe rechazar un método inválido
    expect(() => {
      stmt.run(
        'pay_test_bad',
        'ord_test_0039',
        'CREDITO_INVALIDO',
        'USD',
        1000,
        40000000,
        1000,
        'usr_cajera',
        now
      );
    }).toThrow();

    memDb.close();
  });

  // 2. Un test por método: method, currency, usd_equivalent_cents
  const testMatrix: Array<{
    inputMethod: string;
    amountCents: number;
    expectedDbMethod: string;
    expectedCurrency: 'USD' | 'BS';
    expectedUsdEquivalent: number;
  }> = [
    { inputMethod: 'cash_usd', amountCents: 100, expectedDbMethod: 'EFECTIVO_USD', expectedCurrency: 'USD', expectedUsdEquivalent: 100 },
    { inputMethod: 'efectivo_usd', amountCents: 100, expectedDbMethod: 'EFECTIVO_USD', expectedCurrency: 'USD', expectedUsdEquivalent: 100 },
    { inputMethod: 'cash_bs', amountCents: 4000, expectedDbMethod: 'EFECTIVO_BS', expectedCurrency: 'BS', expectedUsdEquivalent: 100 },
    { inputMethod: 'efectivo_bs', amountCents: 4000, expectedDbMethod: 'EFECTIVO_BS', expectedCurrency: 'BS', expectedUsdEquivalent: 100 },
    { inputMethod: 'pago_movil', amountCents: 4000, expectedDbMethod: 'PAGO_MOVIL', expectedCurrency: 'BS', expectedUsdEquivalent: 100 },
    { inputMethod: 'punto_de_venta', amountCents: 4000, expectedDbMethod: 'PUNTO_DE_VENTA', expectedCurrency: 'BS', expectedUsdEquivalent: 100 },
    { inputMethod: 'ubii', amountCents: 4000, expectedDbMethod: 'UBII', expectedCurrency: 'BS', expectedUsdEquivalent: 100 },
    { inputMethod: 'transferencia', amountCents: 4000, expectedDbMethod: 'TRANSFERENCIA', expectedCurrency: 'BS', expectedUsdEquivalent: 100 },
    { inputMethod: 'binance', amountCents: 100, expectedDbMethod: 'BINANCE', expectedCurrency: 'USD', expectedUsdEquivalent: 100 },
    { inputMethod: 'zelle', amountCents: 100, expectedDbMethod: 'ZELLE', expectedCurrency: 'USD', expectedUsdEquivalent: 100 },
    { inputMethod: 'otros', amountCents: 100, expectedDbMethod: 'OTROS', expectedCurrency: 'USD', expectedUsdEquivalent: 100 },
  ];

  for (const item of testMatrix) {
    it(`Método "${item.inputMethod}": guarda method=${item.expectedDbMethod}, currency=${item.expectedCurrency}, usd_equivalent_cents=${item.expectedUsdEquivalent}`, async () => {
      const orderId = await createTestOrder(100);

      const resPay = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderId}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [
            {
              method: item.inputMethod,
              amountCents: item.amountCents,
              referenceCode: 'REF-123'
            }
          ]
        }
      });

      expect(resPay.statusCode).toBe(200);
      const data = JSON.parse(resPay.payload);
      expect(data.success).toBe(true);
      expect(data.payments.length).toBe(1);

      const p = data.payments[0];
      expect(p.method).toBe(item.expectedDbMethod);
      expect(p.currency).toBe(item.expectedCurrency);
      expect(p.usd_equivalent_cents).toBe(item.expectedUsdEquivalent);

      // Verificar en la BD directamente
      const row = rawDb.prepare('SELECT * FROM payments WHERE id = ?').get(p.id) as any;
      expect(row.method).toBe(item.expectedDbMethod);
      expect(row.currency).toBe(item.expectedCurrency);
      expect(row.usd_equivalent_cents).toBe(item.expectedUsdEquivalent);
    });
  }

  // 3. Cobro mixto USD + Bs: suma del libro == totalPaidUsdEquivalent
  it('Un cobro mixto USD + Bs: la suma del libro == totalPaidUsdEquivalent de la liquidación', async () => {
    const orderId = await createTestOrder(1000); // $10.00

    // Pagamos $5.00 en cash_usd + 20,000 céntimos Bs en pago_movil ($5.00 a tasa 40.00 Bs/$)
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'cash_usd', amountCents: 500 },
          { method: 'pago_movil', amountCents: 20000, referenceCode: 'PM-MIXTO' }
        ]
      }
    });

    expect(resPay.statusCode).toBe(200);
    const data = JSON.parse(resPay.payload);
    expect(data.success).toBe(true);

    const settlement = data.settlement;
    const totalPaidUsdEquivalent = settlement.paidUsdCents + Math.round((settlement.paidBsCents * 1_000_000) / settlement.rateMicroBs);
    expect(totalPaidUsdEquivalent).toBe(1000);

    // Sumar débitos de los pagos en el libro contable para esta orden
    const ledgerRows = rawDb.prepare(`
      SELECT account_bucket, debit_usd_cents
      FROM ledger_entries
      WHERE order_id = ? AND debit_usd_cents > 0
    `).all(orderId) as Array<{ account_bucket: string; debit_usd_cents: number }>;

    const totalLedgerDebits = ledgerRows.reduce((sum, r) => sum + r.debit_usd_cents, 0);
    expect(totalLedgerDebits).toBe(totalPaidUsdEquivalent);
  });

  // 4. Método desconocido -> 400 y no se inserta nada
  it('Método desconocido → 400 y no se inserta nada', async () => {
    const orderId = await createTestOrder(500);

    const paymentsBefore = rawDb.prepare('SELECT count(*) as count FROM payments').get() as { count: number };
    const ledgerBefore = rawDb.prepare('SELECT count(*) as count FROM ledger_entries').get() as { count: number };

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'credit', amountCents: 500 }
        ]
      }
    });

    expect(resPay.statusCode).toBe(400);
    const data = JSON.parse(resPay.payload);
    expect(data.error).toContain('Método de pago no soportado: credit');

    // Comprobar que NADA fue insertado en payments ni en ledger_entries
    const paymentsAfter = rawDb.prepare('SELECT count(*) as count FROM payments').get() as { count: number };
    const ledgerAfter = rawDb.prepare('SELECT count(*) as count FROM ledger_entries').get() as { count: number };
    expect(paymentsAfter.count).toBe(paymentsBefore.count);
    expect(ledgerAfter.count).toBe(ledgerBefore.count);

    // La orden sigue sin pagar
    const orderRow = rawDb.prepare('SELECT payment_status FROM orders WHERE id = ?').get(orderId) as any;
    expect(orderRow.payment_status).toBe('sin_pago');
  });

  // 5. punto_de_venta y ubii aparecen en líneas separadas del resumen Z; transferencia también
  it('punto_de_venta y ubii aparecen en líneas separadas del resumen Z; transferencia también', async () => {
    // 1. Cobrar con punto_de_venta
    const o1 = await createTestOrder(250);
    await app.inject({
      method: 'POST',
      url: `/api/orders/${o1}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'punto_de_venta', amountCents: 10000, referenceCode: 'POS-01' }]
      }
    });

    // 2. Cobrar con ubii
    const o2 = await createTestOrder(200);
    await app.inject({
      method: 'POST',
      url: `/api/orders/${o2}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'ubii', amountCents: 8000, referenceCode: 'UBII-01' }]
      }
    });

    // 3. Cobrar con transferencia
    const o3 = await createTestOrder(300);
    await app.inject({
      method: 'POST',
      url: `/api/orders/${o3}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'transferencia', amountCents: 12000, referenceCode: 'TRANSF-01' }]
      }
    });

    // 4. Consultar Resumen Z de la Jornada
    const resSummary = await app.inject({
      method: 'GET',
      url: '/api/reports/z-report/summary',
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(resSummary.statusCode).toBe(200);
    const summary = JSON.parse(resSummary.payload).summary;

    // Verificar campos específicos en la raíz del resumen
    expect(summary.puntoDeVentaBsCents).toBeGreaterThanOrEqual(10000);
    expect(summary.ubiiGrossBsCents).toBeGreaterThanOrEqual(8000);
    expect(summary.transferenciaBsCents).toBeGreaterThanOrEqual(12000);

    // Verificar desglose por método (byMethod)
    const byMethod = summary.byMethod as Array<{ method: string; totalBsCents: number; label: string }>;
    const posRow = byMethod.find(m => m.method === 'PUNTO_DE_VENTA');
    const ubiiRow = byMethod.find(m => m.method === 'UBII');
    const transfRow = byMethod.find(m => m.method === 'TRANSFERENCIA');

    expect(posRow).toBeDefined();
    expect(posRow?.totalBsCents).toBeGreaterThanOrEqual(10000);
    expect(posRow?.label).toBe('Punto de Venta');

    expect(ubiiRow).toBeDefined();
    expect(ubiiRow?.totalBsCents).toBeGreaterThanOrEqual(8000);
    expect(ubiiRow?.label).toBe('Ubii');

    expect(transfRow).toBeDefined();
    expect(transfRow?.totalBsCents).toBeGreaterThanOrEqual(12000);
    expect(transfRow?.label).toBe('Transferencia');

    // Deben ser 3 filas distintas
    expect(posRow?.method).not.toBe(ubiiRow?.method);
    expect(posRow?.method).not.toBe(transfRow?.method);
    expect(ubiiRow?.method).not.toBe(transfRow?.method);
  });
});
