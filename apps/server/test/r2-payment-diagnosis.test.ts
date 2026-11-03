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
import { getFinancialTruth } from '../src/modules/finances/financial-truth-service.js';
import { getJornadaReportData } from '../src/modules/reports/reports-service.js';

describe('T-07 FASE A: Diagnóstico quirúrgico de pagos multimétodo, verdad financiera y PDF (@tocineta/server)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_t07_diag_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_t07_diag.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;

  let cajeraToken = '';
  let jornadaId = '';
  let sessionId = '';
  const RATE_MICRO_BS = 40_000_000; // 40.00 Bs / USD

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

    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;

    // D11: La cajera abre la jornada diaria y su sesión de caja (una sola sesión activa por jornada y sede)
    const resJornada = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        rateMicroBs: RATE_MICRO_BS,
        rateStr: '40.00',
        initialCashUsdCents: 1000,
        initialCashBsCents: 50000,
        notes: 'Jornada Diagnostico T-07'
      }
    });
    expect(resJornada.statusCode).toBe(200);
    const jorBody = resJornada.json();
    jornadaId = jorBody.jornada?.id || jorBody.id;

    // Abrir o confirmar sesión de caja (D1 / D11)
    const resSession = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        jornadaId,
        openingCashUsdCents: 1000,
        openingCashBsCents: 50000
      }
    });
    expect(resSession.statusCode).toBe(200);
    sessionId = resSession.json().cashSession.id;
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

  it('Diagnóstico completo de los 18 métodos y alias + pago manual de $50 USD', async () => {
    const methodsToTest = [
      // 9 métodos canónicos en mayúsculas
      { inputMethod: 'EFECTIVO_USD', isCanonical: true },
      { inputMethod: 'EFECTIVO_BS', isCanonical: true },
      { inputMethod: 'PAGO_MOVIL', isCanonical: true },
      { inputMethod: 'PUNTO_DE_VENTA', isCanonical: true },
      { inputMethod: 'UBII', isCanonical: true },
      { inputMethod: 'TRANSFERENCIA', isCanonical: true },
      { inputMethod: 'ZELLE', isCanonical: true },
      { inputMethod: 'BINANCE', isCanonical: true },
      { inputMethod: 'OTROS', isCanonical: true },
      // 9 alias en minúscula/inglés del frontend
      { inputMethod: 'cash_usd', isCanonical: false },
      { inputMethod: 'cash_bs', isCanonical: false },
      { inputMethod: 'pago_movil', isCanonical: false },
      { inputMethod: 'punto_de_venta', isCanonical: false },
      { inputMethod: 'ubii', isCanonical: false },
      { inputMethod: 'transferencia', isCanonical: false },
      { inputMethod: 'zelle', isCanonical: false },
      { inputMethod: 'binance', isCanonical: false },
      { inputMethod: 'otros', isCanonical: false }
    ];

    interface DiagRow {
      metodoEnviado: string;
      dbMethod: string;
      currency: string;
      paymentsAmountCents: number;
      paymentsUsdEquivCents: number;
      ledgerBucket: string;
      ledgerDebitUsdCents: number;
      ledgerCreditUsdCents: number;
      ftMethodGrossUsd: number;
      ftMethodGrossBs: number;
      ftTotalCollectedUsd: number;
      zSummaryMethodUsd: number;
      zSummaryMethodBs: number;
      zSummaryTotalCollectedUsd: number;
      pdfMethodUsd: string;
      pdfMethodBs: string;
      pdfTotalRecaudadoUsd: string;
      pdfTotalRecaudadoBs: string;
      status: string;
    }

    const diagTable: DiagRow[] = [];

    let orderSeq = 1;
    for (const item of methodsToTest) {
      const { inputMethod } = item;
      const isUsd = ['EFECTIVO_USD', 'BINANCE', 'ZELLE', 'OTROS', 'cash_usd', 'binance', 'zelle', 'otros'].includes(inputMethod);
      const isSinRef = ['EFECTIVO_USD', 'EFECTIVO_BS', 'cash_usd', 'cash_bs'].includes(inputMethod);

      // Crear orden de 5000 centavos ($50.00 USD)
      const resOrder = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tableNumber: `${orderSeq}`,
          fulfillmentType: 'salon',
          customerName: `Diag ${inputMethod}`,
          lines: [{ productId: 'prod_classic_dog', quantity: 1 }]
        }
      });
      expect(resOrder.statusCode).toBe(201);
      const order = resOrder.json().order;
      orderSeq++;

      // Forzar total a $50.00 USD (5000 centavos)
      rawDb.prepare(`
        UPDATE orders 
        SET total_to_collect_usd_cents = 5000, 
            net_food_sales_usd_cents = 5000, 
            gross_food_subtotal_usd_cents = 5000,
            cash_session_id = ?
        WHERE id = ?
      `).run(sessionId, order.id);

      // El monto a pagar: para USD es 5000 centavos ($50.00). Para Bs es 200,000 céntimos de Bs ($50 * 40 Bs/$)
      const tenderAmountCents = isUsd ? 5000 : 200_000;
      const refCode = isSinRef ? undefined : `REF-${inputMethod}-${Date.now()}`;

      const resPay = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [
            {
              method: inputMethod,
              amountCents: tenderAmountCents,
              referenceCode: refCode
            }
          ]
        }
      });

      const payBody = resPay.json();
      const statusOk = resPay.statusCode === 200 && payBody.success;

      // 1. Filas en payments
      const paymentRow = rawDb.prepare(`
        SELECT method, currency, amount_cents, usd_equivalent_cents 
        FROM payments 
        WHERE order_id = ? 
        ORDER BY created_at_ms DESC LIMIT 1
      `).get(order.id) as any;

      // 2. Filas en ledger_entries (asiento de cobro)
      const ledgerDebit = rawDb.prepare(`
        SELECT account_bucket, debit_usd_cents, credit_usd_cents 
        FROM ledger_entries 
        WHERE order_id = ? AND debit_usd_cents > 0
        ORDER BY created_at_ms DESC LIMIT 1
      `).get(order.id) as any;

      // 3. getFinancialTruth
      const ft = getFinancialTruth(rawDb, { jornadaId });
      const normMethod = (paymentRow?.method || '').toUpperCase();
      const ftMethodBreakdown = ft.collectedByMethod.find(m => m.method === normMethod);
      const ftTotalCollectedUsd = ft.orders.netSalesUsdCents + ft.orders.deliveryFeesUsdCents;

      // 4. z-summary
      const resZSummary = await app.inject({
        method: 'GET',
        url: `/api/reports/z-report/summary?jornadaId=${jornadaId}`,
        headers: { authorization: `Bearer ${cajeraToken}` }
      });
      const zSummary = resZSummary.json().summary;
      const zMethod = zSummary?.byMethod?.find((m: any) => m.method === normMethod);

      // 5. Totales que reports-service.ts inyecta en el PDF
      const reportData = getJornadaReportData(rawDb, jornadaId);
      // Analizar cómo generateJornadaPdfReport mapea cada método:
      let pdfMethodUsd = 'N/A';
      let pdfMethodBs = 'N/A (OMITIDO)';

      if (normMethod === 'EFECTIVO_USD') {
        pdfMethodUsd = `$${(reportData.cashUsdCents / 100).toFixed(2)}`;
        pdfMethodBs = 'OMITIDO EN PDF'; // renderRow('Efectivo Dólares (USD)', `$${...}`) -> 3er arg omitido
      } else if (normMethod === 'EFECTIVO_BS') {
        pdfMethodUsd = `$${((reportData.cashBsCents * 1_000_000) / (reportData.rateMicroBs * 100)).toFixed(2)}`;
        pdfMethodBs = `Bs ${(reportData.cashBsCents / 100).toFixed(2)}`;
      } else if (normMethod === 'PAGO_MOVIL') {
        pdfMethodUsd = `$${((reportData.pagoMovilBsCents * 1_000_000) / (reportData.rateMicroBs * 100)).toFixed(2)}`;
        pdfMethodBs = `Bs ${(reportData.pagoMovilBsCents / 100).toFixed(2)}`;
      } else if (normMethod === 'PUNTO_DE_VENTA') {
        pdfMethodUsd = `$${((reportData.puntoDeVentaBsCents * 1_000_000) / (reportData.rateMicroBs * 100)).toFixed(2)}`;
        pdfMethodBs = `Bs ${(reportData.puntoDeVentaBsCents / 100).toFixed(2)}`;
      } else if (normMethod === 'UBII') {
        pdfMethodUsd = `$${((reportData.ubiiNetBsCents * 1_000_000) / (reportData.rateMicroBs * 100)).toFixed(2)}`;
        pdfMethodBs = `Bs ${(reportData.ubiiGrossBsCents / 100).toFixed(2)}`;
      } else if (normMethod === 'TRANSFERENCIA') {
        pdfMethodUsd = `$${((reportData.transferenciaBsCents * 1_000_000) / (reportData.rateMicroBs * 100)).toFixed(2)}`;
        pdfMethodBs = `Bs ${(reportData.transferenciaBsCents / 100).toFixed(2)}`;
      } else if (normMethod === 'BINANCE') {
        pdfMethodUsd = `$${(reportData.binanceUsdCents / 100).toFixed(2)}`;
        pdfMethodBs = 'OMITIDO EN PDF'; // renderRow('Binance Pay (USDT)', `$${...}`) -> 3er arg omitido
      } else if (normMethod === 'ZELLE') {
        pdfMethodUsd = `$${(reportData.zelleUsdCents / 100).toFixed(2)}`;
        pdfMethodBs = 'OMITIDO EN PDF'; // renderRow('Zelle (USD)', `$${...}`) -> 3er arg omitido
      } else if (normMethod === 'OTROS') {
        pdfMethodUsd = `$${(reportData.otrosUsdCents / 100).toFixed(2)}`;
        pdfMethodBs = 'OMITIDO EN PDF'; // renderRow('Otros Métodos (USD)', `$${...}`) -> 3er arg omitido
      }

      const pdfTotalRecaudadoUsd = `$${(reportData.totalCollectedUsdCents / 100).toFixed(2)}`;
      const pdfTotalRecaudadoBs = `Bs ${((reportData.totalCollectedUsdCents * reportData.rateMicroBs) / 100_000_000).toFixed(2)}`;

      diagTable.push({
        metodoEnviado: inputMethod,
        dbMethod: paymentRow?.method || 'ERROR',
        currency: paymentRow?.currency || 'ERROR',
        paymentsAmountCents: paymentRow?.amount_cents ?? -1,
        paymentsUsdEquivCents: paymentRow?.usd_equivalent_cents ?? -1,
        ledgerBucket: ledgerDebit?.account_bucket || 'ERROR',
        ledgerDebitUsdCents: ledgerDebit?.debit_usd_cents ?? -1,
        ledgerCreditUsdCents: ledgerDebit?.credit_usd_cents ?? -1,
        ftMethodGrossUsd: ftMethodBreakdown?.grossUsdCents ?? -1,
        ftMethodGrossBs: ftMethodBreakdown?.grossBsCents ?? -1,
        ftTotalCollectedUsd,
        zSummaryMethodUsd: zMethod?.totalUsdCents ?? -1,
        zSummaryMethodBs: zMethod?.totalBsCents ?? -1,
        zSummaryTotalCollectedUsd: zSummary?.totalCollectedUsdCents ?? -1,
        pdfMethodUsd,
        pdfMethodBs,
        pdfTotalRecaudadoUsd,
        pdfTotalRecaudadoBs,
        status: statusOk ? 'OK (200)' : `ERROR (${resPay.statusCode})`
      });
    }

    // Caso Especial: PAGO DE $50 USD AGREGADO A MANO (directamente en `payments` o sobrepago sin reflejo en órdenes)
    // Se inserta un pago manual de $50 USD (5000 centavos) con método OTROS asociado a una orden con net_food_sales = 0
    const resManualOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'MANUAL-50',
        fulfillmentType: 'salon',
        customerName: 'Cliente Pago Manual',
        lines: [{ productId: 'prod_classic_dog', quantity: 1 }]
      }
    });
    const manualOrder = resManualOrder.json().order;
    // La orden queda marcada como pagada pero su net_food_sales_usd_cents es 0 (simula pago manual externo o cobro agregado a mano en payments)
    rawDb.prepare(`
      UPDATE orders 
      SET payment_status = 'pagado', 
          total_to_collect_usd_cents = 0, 
          net_food_sales_usd_cents = 0, 
          gross_food_subtotal_usd_cents = 0,
          cash_session_id = ?
      WHERE id = ?
    `).run(sessionId, manualOrder.id);

    // Insertar fila manual en payments
    const manualPaymentId = `pay_manual_${Date.now()}`;
    rawDb.prepare(`
      INSERT INTO payments (
        id, order_id, method, currency, amount_cents, rate_micro_bs,
        usd_equivalent_cents, reference_code, recorded_by_user_id, created_at_ms
      ) VALUES (?, ?, 'OTROS', 'USD', 5000, ?, 5000, 'MANUAL-50-REF', 'usr_cajera', ?)
    `).run(manualPaymentId, manualOrder.id, RATE_MICRO_BS, Date.now());

    // Verificar qué ve Financial Truth, Z-Summary y PDF para este pago manual:
    const ftManual = getFinancialTruth(rawDb, { jornadaId });
    const otrosInFt = ftManual.collectedByMethod.find(m => m.method === 'OTROS');
    const repManual = getJornadaReportData(rawDb, jornadaId);

    console.log('\n========================================================================================');
    console.log('--- TABLA COMPARATIVA DE MÉTODOS Y ALIAS ($50 USD / 200.000 céntimos Bs) ---');
    console.log('========================================================================================');
    console.table(diagTable.map(r => ({
      'Método': r.metodoEnviado,
      'DB Method': r.dbMethod,
      'Moneda': r.currency,
      'Payments (cents)': r.paymentsAmountCents,
      'Payments (USD equiv)': r.paymentsUsdEquivCents,
      'Ledger Bucket': r.ledgerBucket,
      'Ledger Debit': r.ledgerDebitUsdCents,
      'FT Gross USD': r.ftMethodGrossUsd,
      'FT Gross Bs': r.ftMethodGrossBs,
      'PDF Method USD': r.pdfMethodUsd,
      'PDF Method Bs': r.pdfMethodBs,
      'PDF Total USD': r.pdfTotalRecaudadoUsd,
      'PDF Total Bs': r.pdfTotalRecaudadoBs,
      'HTTP Status': r.status
    })));

    console.log('\n========================================================================================');
    console.log('--- DIAGNÓSTICO: CASO DE PAGO DE $50 USD AGREGADO A MANO ---');
    console.log('========================================================================================');
    console.log('Fila en payments: method=OTROS, currency=USD, amount_cents=5000, usd_equivalent_cents=5000');
    console.log(`getFinancialTruth collectedByMethod OTROS: grossUsdCents=${otrosInFt?.grossUsdCents}, count=${otrosInFt?.count}`);
    console.log(`getFinancialTruth ft.orders.netSalesUsdCents: ${ftManual.orders.netSalesUsdCents}`);
    console.log(`reports-service getJornadaReportData otrosUsdCents: ${repManual.otrosUsdCents} (Aparece en sección 2 del PDF como $${(repManual.otrosUsdCents / 100).toFixed(2)})`);
    console.log(`reports-service getJornadaReportData totalCollectedUsdCents: ${repManual.totalCollectedUsdCents} (NO suma el pago manual porque viene de orders.netSalesUsdCents)`);
    console.log(`PDF Sección 2 OTROS: renderRow('Otros Métodos (USD)', '$50.00') -> Tercer parámetro valBs OMITIDO (NO convierte a Bs)`);
    console.log('========================================================================================\n');

    // Comprobaciones clave
    expect(diagTable.length).toBe(18);
    expect(diagTable.every(r => r.status === 'OK (200)')).toBe(true);
    expect(otrosInFt?.grossUsdCents).toBeGreaterThanOrEqual(10000); // 5000 del orden anterior + 5000 manual
  });
});
