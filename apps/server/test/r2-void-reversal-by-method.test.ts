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
import { getFinancialTruth } from '../src/modules/finances/financial-truth-service.js';
import { performBlindCount } from '../src/modules/closures/closures-service.js';
import { _resetAuthorizerGuardState } from '../src/modules/auth/authorizer-guard.js';

describe('T-02: Reversión de ticket/venta por método y PIN obligatorio al anular', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_t02_void_${Date.now()}`);
  const tempDb = path.join(tempDir, 't02_void.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;
  let cajeraToken: string;
  let jornadaId: string;
  let sessionId: string;
  const ADMIN_PIN = '123456';
  const WRONG_PIN = '999999';

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

  beforeEach(async () => {
    _resetAuthorizerGuardState();

    // Cerrar cualquier jornada y sesión previa para garantizar aislamiento total por test
    rawDb.prepare("UPDATE cash_sessions SET status = 'cerrada' WHERE status = 'abierta'").run();
    rawDb.prepare("UPDATE jornadas SET status = 'cerrada' WHERE status = 'abierta'").run();

    // Abrir jornada fresca para el test (Apertura: $50 USD = 5000c, 1000c Bs, tasa 40.00)
    const resJornada = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        rateMicroBs: 40_000_000,
        initialCashUsdCents: 5000,
        initialCashBsCents: 1000
      }
    });
    expect(resJornada.statusCode).toBe(200);
    jornadaId = resJornada.json().jornada.id;

    const session = rawDb.prepare("SELECT * FROM cash_sessions WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
    expect(session).toBeDefined();
    sessionId = session.id;
  });

  it('1. Orden pagada 100% con PAGO_MOVIL: tras anular, efectivo USD esperado = 0 (NO negativo) y bucket de pago móvil neto = 0', async () => {
    // Crear orden 1 (prod_street_dog = $2.50 = 250c USD, a tasa 40 = 10,000c Bs)
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 10',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 1 }]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    // Cobrar orden 100% con Pago Móvil
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'pago_movil', amountCents: 10000, referenceCode: `PM-${Date.now()}` }
        ]
      }
    });
    expect(resPay.statusCode).toBe(200);

    // Verificar ledger tras pago: BANK_BS debited 250, CASH_USD 0
    const ledgerBefore = rawDb.prepare('SELECT account_bucket, debit_usd_cents, credit_usd_cents FROM ledger_entries WHERE order_id = ?').all(order.id) as any[];
    const cashUsdBefore = ledgerBefore.filter(l => l.account_bucket === 'CASH_USD');
    expect(cashUsdBefore.length).toBe(0);

    // Anular la orden pagada con PIN de admin válido
    const resVoid = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        supervisorPin: ADMIN_PIN,
        reason: 'CLIENTE_ARREPENTIDO'
      }
    });
    expect(resVoid.statusCode).toBe(200);
    expect(resVoid.json().success).toBe(true);

    // Verificar ledger tras anulación:
    const ledgerAfter = rawDb.prepare('SELECT account_bucket, debit_usd_cents, credit_usd_cents FROM ledger_entries WHERE order_id = ?').all(order.id) as any[];
    
    // CASH_USD no debe tener débitos ni créditos netos (neto = 0, jamás negativo)
    const cashUsdEntries = ledgerAfter.filter(l => l.account_bucket === 'CASH_USD');
    const cashUsdDebit = cashUsdEntries.reduce((acc, l) => acc + l.debit_usd_cents, 0);
    const cashUsdCredit = cashUsdEntries.reduce((acc, l) => acc + l.credit_usd_cents, 0);
    expect(cashUsdDebit - cashUsdCredit).toBe(0);
    expect(cashUsdEntries.length).toBe(0); // Ni siquiera se debió tocar CASH_USD para una orden en Bs

    // BANK_BS debe netear exactamente a 0 (debit original 250, credit reversión 250)
    const bankBsEntries = ledgerAfter.filter(l => l.account_bucket === 'BANK_BS');
    const bankBsDebit = bankBsEntries.reduce((acc, l) => acc + l.debit_usd_cents, 0);
    const bankBsCredit = bankBsEntries.reduce((acc, l) => acc + l.credit_usd_cents, 0);
    expect(bankBsDebit).toBe(250);
    expect(bankBsCredit).toBe(250);
    expect(bankBsDebit - bankBsCredit).toBe(0);

    // FOOD_SALES debe netear a 0
    const foodSalesEntries = ledgerAfter.filter(l => l.account_bucket === 'FOOD_SALES');
    const foodDebit = foodSalesEntries.reduce((acc, l) => acc + l.debit_usd_cents, 0);
    const foodCredit = foodSalesEntries.reduce((acc, l) => acc + l.credit_usd_cents, 0);
    expect(foodDebit - foodCredit).toBe(0);

    // Arqueo ciego como admin: el efectivo USD esperado debe ser exactamente el monto de apertura (5000c = $50.00), NO negativo
    const blindCount = performBlindCount(
      rawDb,
      sessionId,
      { cashUsdCents: 5000, cashBsCents: 1000, ubiiVoucherBsCents: 0 },
      { id: 'usr_admin', name: 'Admin', role: 'admin' }
    );
    expect(blindCount.session?.expectedCashUsdCents).toBe(5000);
    expect(blindCount.session?.diffUsdCents).toBe(0);
    expect(blindCount.session?.expectedCashBsCents).toBe(1000);
    expect(blindCount.session?.diffBsCents).toBe(0);
  });

  it('2. Orden pagada mixta (CASH_USD + CASH_BS con vuelto): tras anular, todos los buckets netean a 0', async () => {
    // Crear orden 2 (prod_smash_clasica $3.50 + prod_refresco_1lt $1.80 = $5.30 = 530c USD)
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 12',
        fulfillmentType: 'salon',
        lines: [
          { productId: 'prod_smash_clasica', quantity: 1 },
          { productId: 'prod_refresco_1lt', quantity: 1 }
        ]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;
    expect(order.total_to_collect_usd_cents).toBe(530);

    // Cobro mixto:
    // Paga $5.00 CASH_USD (500c) + 4000c Bs (equivale a $1.00 USD = 100c) -> Total pagado = $6.00 (600c)
    // Vuelto: $0.70 CASH_USD (70c USD) entregado
    // Total neto cobrado = 600 - 70 = 530c USD (exacto)
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'cash_usd', amountCents: 500 },
          { method: 'cash_bs', amountCents: 4000 }
        ],
        changeOutputs: {
          changeUsdCents: 70,
          changeBsCents: 0
        }
      }
    });
    expect(resPay.statusCode).toBe(200);

    // Anular orden con PIN de admin
    const resVoid = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        supervisorPin: ADMIN_PIN,
        reason: 'ERROR_MONTO_DIGITADO'
      }
    });
    expect(resVoid.statusCode).toBe(200);

    // Verificar que CADA bucket contable de esa orden netea exactamente a 0
    const entries = rawDb.prepare('SELECT account_bucket, debit_usd_cents, credit_usd_cents FROM ledger_entries WHERE order_id = ?').all(order.id) as any[];
    const bucketTotals = new Map<string, { debit: number; credit: number }>();
    for (const e of entries) {
      const b = e.account_bucket;
      if (!bucketTotals.has(b)) {
        bucketTotals.set(b, { debit: 0, credit: 0 });
      }
      const item = bucketTotals.get(b)!;
      item.debit += e.debit_usd_cents;
      item.credit += e.credit_usd_cents;
    }

    for (const [bucket, totals] of bucketTotals.entries()) {
      const net = totals.debit - totals.credit;
      expect(net).toBe(0);
    }
  });

  it('3. Anular orden pagada sin PIN -> 400 SUPERVISOR_PIN_REQUIRED', async () => {
    // Crear orden 3 y pagarla
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 3',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 1 }]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 250 }]
      }
    });
    expect(resPay.statusCode).toBe(200);

    // Intentar anular sin supervisorPin
    const resVoidNoPin = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        reason: 'PRUEBA_SIN_PIN'
      }
    });
    expect(resVoidNoPin.statusCode).toBe(400);
    const dataNoPin = resVoidNoPin.json();
    expect(dataNoPin.success).toBe(false);
    expect(dataNoPin.code).toBe('SUPERVISOR_PIN_REQUIRED');
    expect(dataNoPin.error).toContain('PIN de supervisor');

    // Intentar anular con string vacío
    const resVoidEmptyPin = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        supervisorPin: '   ',
        reason: 'PRUEBA_PIN_ESPACIOS'
      }
    });
    expect(resVoidEmptyPin.statusCode).toBe(400);
    expect(resVoidEmptyPin.json().code).toBe('SUPERVISOR_PIN_REQUIRED');
  });

  it('4. Anular con PIN de admin válido -> 200; con PIN inválido x5 -> 423', async () => {
    // Crear orden 4 y pagarla
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 4',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 1 }]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 250 }]
      }
    });
    expect(resPay.statusCode).toBe(200);

    // 4 intentos con PIN inválido -> 403 INVALID_AUTHORIZER_PIN
    for (let i = 1; i <= 4; i++) {
      const resWrong = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/void`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          supervisorPin: WRONG_PIN,
          reason: 'TEST_WRONG_PIN'
        }
      });
      expect(resWrong.statusCode).toBe(403);
      expect(resWrong.json().code).toBe('INVALID_AUTHORIZER_PIN');
    }

    // 5to intento con PIN inválido -> 423 AUTHORIZER_LOCKED con remainingMs
    const resAttempt5 = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        supervisorPin: WRONG_PIN,
        reason: 'TEST_WRONG_PIN'
      }
    });
    expect(resAttempt5.statusCode).toBe(423);
    const lockData = resAttempt5.json();
    expect(lockData.code).toBe('AUTHORIZER_LOCKED');
    expect(lockData.remainingMs).toBeGreaterThan(0);

    // 6to intento (incluso con PIN correcto mientras esté bloqueado) -> 423
    const resAttempt6 = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        supervisorPin: ADMIN_PIN,
        reason: 'TEST_WHILE_LOCKED'
      }
    });
    expect(resAttempt6.statusCode).toBe(423);
    expect(resAttempt6.json().code).toBe('AUTHORIZER_LOCKED');

    // Desbloquear estado para probar éxito con PIN de admin válido
    _resetAuthorizerGuardState();

    const resValid = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        supervisorPin: ADMIN_PIN,
        reason: 'ANULACION_AUTORIZADA'
      }
    });
    expect(resValid.statusCode).toBe(200);
    expect(resValid.json().success).toBe(true);
  });

  it('5. Paridad: después de anular, Z-summary, financial-truth y performBlindCount coinciden a 0 centavos', async () => {
    // 1. Crear y cobrar una orden válida que permanece activa
    const resActive = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 20',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 2 }] // $5.00 = 500c
      }
    });
    expect(resActive.statusCode).toBe(201);
    const activeOrder = resActive.json().order;

    const resPayActive = await app.inject({
      method: 'POST',
      url: `/api/orders/${activeOrder.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 500 }]
      }
    });
    expect(resPayActive.statusCode).toBe(200);

    // 2. Crear y cobrar una segunda orden que luego se anula completamente
    const resToVoid = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 21',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 4 }] // $10.00 = 1000c
      }
    });
    expect(resToVoid.statusCode).toBe(201);
    const voidOrder = resToVoid.json().order;

    const resPayVoid = await app.inject({
      method: 'POST',
      url: `/api/orders/${voidOrder.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'pago_movil', amountCents: 40000, referenceCode: `PM-PARITY-${Date.now()}` }
        ]
      }
    });
    expect(resPayVoid.statusCode).toBe(200);

    // Anular orden 2 con PIN de admin
    const resVoid2 = await app.inject({
      method: 'POST',
      url: `/api/orders/${voidOrder.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        supervisorPin: ADMIN_PIN,
        reason: 'PRUEBA_PARIDAD_ANULACION'
      }
    });
    expect(resVoid2.statusCode).toBe(200);

    // 3. Consultar Verdad Financiera
    const ft = getFinancialTruth(rawDb, { jornadaId });

    // 4. Consultar Z-Summary (/api/reports/z-report/summary)
    const resSummary = await app.inject({
      method: 'GET',
      url: `/api/reports/z-report/summary?jornadaId=${jornadaId}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(resSummary.statusCode).toBe(200);
    const zSummary = resSummary.json().summary;

    // 5. Consultar Arqueo Ciego (performBlindCount con rol admin para ver desglose auditado)
    const blindCount = performBlindCount(
      rawDb,
      sessionId,
      { cashUsdCents: 5500, cashBsCents: 1000, ubiiVoucherBsCents: 0 },
      { id: 'usr_admin', name: 'Admin', role: 'admin' }
    );

    // Verificaciones de Paridad Exacta (diferencia = 0 centavos):
    // A. Ventas netas totales
    expect(ft.orders.netSalesUsdCents).toBe(zSummary.netFoodSalesUsdCents);
    expect(ft.orders.netSalesUsdCents).toBe(500); // Solo la orden activa de $5.00

    // B. Total cobrado
    const totalCollectedTruth = ft.orders.netSalesUsdCents + ft.orders.deliveryFeesUsdCents;
    expect(totalCollectedTruth).toBe(zSummary.totalCollectedUsdCents);
    expect(totalCollectedTruth).toBe(500);

    // C. Efectivo USD cobrado
    const cashUsdMethodTruth = ft.collectedByMethod.find(m => m.method === 'EFECTIVO_USD');
    expect(cashUsdMethodTruth?.grossUsdCents || 0).toBe(zSummary.cashUsdCents);
    expect(zSummary.cashUsdCents).toBe(500);

    // D. Pago Móvil recaudado neto (la orden anulada fue en Pago Móvil, por tanto no debe sumar)
    const pagoMovilMethodTruth = ft.collectedByMethod.find(m => m.method === 'PAGO_MOVIL');
    expect(pagoMovilMethodTruth?.grossBsCents || 0).toBe(0);
    expect(zSummary.pagoMovilBsCents).toBe(0);

    // E. Efectivo USD esperado en caja (Caja de apertura 5000 + 500 cobrado = 5500)
    expect(blindCount.session?.expectedCashUsdCents).toBe(5500);
    expect(ft.expectedCash.netCashUsdCents).toBe(5500);
    expect(blindCount.session?.diffUsdCents).toBe(0);

    // Paridad absoluta: 0 centavos de descuadre
    expect(Math.abs((blindCount.session?.expectedCashUsdCents || 0) - ft.expectedCash.netCashUsdCents)).toBe(0);
    expect(Math.abs(totalCollectedTruth - zSummary.totalCollectedUsdCents)).toBe(0);
  });

  it('6. Orden pagada con ZELLE: tras anular, el bucket BANK_USD netea exactamente a 0', async () => {
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa Zelle',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 1 }] // $2.50 = 250c
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'zelle', amountCents: 250, referenceCode: `ZELLE-${Date.now()}` }
        ]
      }
    });
    expect(resPay.statusCode).toBe(200);

    const resVoid = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        supervisorPin: ADMIN_PIN,
        reason: 'ANULACION_ZELLE'
      }
    });
    expect(resVoid.statusCode).toBe(200);
    expect(resVoid.json().success).toBe(true);

    const ledgerAfter = rawDb.prepare('SELECT account_bucket, debit_usd_cents, credit_usd_cents FROM ledger_entries WHERE order_id = ?').all(order.id) as any[];
    const bankUsdEntries = ledgerAfter.filter(l => l.account_bucket === 'BANK_USD');
    const bankUsdDebit = bankUsdEntries.reduce((acc, l) => acc + l.debit_usd_cents, 0);
    const bankUsdCredit = bankUsdEntries.reduce((acc, l) => acc + l.credit_usd_cents, 0);

    expect(bankUsdEntries.length).toBe(2); // Débito original y Crédito de reversión
    expect(bankUsdDebit).toBe(250);
    expect(bankUsdCredit).toBe(250);
    expect(bankUsdDebit - bankUsdCredit).toBe(0);
  });

  it('7. Intentar anular por segunda vez una orden ya anulada responde 409 con code ORDER_ALREADY_ANNULLED y no inserta filas adicionales en ledger_entries', async () => {
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa Idempotencia',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 1 }]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 250 }]
      }
    });
    expect(resPay.statusCode).toBe(200);

    // Primera anulación -> 200 OK
    const resVoid1 = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        supervisorPin: ADMIN_PIN,
        reason: 'PRIMERA_ANULACION'
      }
    });
    expect(resVoid1.statusCode).toBe(200);
    expect(resVoid1.json().success).toBe(true);

    const ledgerCountAfterFirstVoid = (rawDb.prepare('SELECT count(*) as cnt FROM ledger_entries WHERE order_id = ?').get(order.id) as any).cnt;
    expect(ledgerCountAfterFirstVoid).toBeGreaterThan(0);

    // Segunda anulación -> 409 Conflict
    const resVoid2 = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        supervisorPin: ADMIN_PIN,
        reason: 'SEGUNDA_ANULACION'
      }
    });
    expect(resVoid2.statusCode).toBe(409);
    const body2 = resVoid2.json();
    expect(body2.success).toBe(false);
    expect(body2.code).toBe('ORDER_ALREADY_ANNULLED');

    // No debe insertar filas adicionales en ledger_entries
    const ledgerCountAfterSecondVoid = (rawDb.prepare('SELECT count(*) as cnt FROM ledger_entries WHERE order_id = ?').get(order.id) as any).cnt;
    expect(ledgerCountAfterSecondVoid).toBe(ledgerCountAfterFirstVoid);
  });

  it('8. Anular una orden NO pagada (sin_pago) sin PIN responde 200 y deja 0 filas en ledger_entries', async () => {
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa Sin Pago',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 1 }]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;
    expect(order.payment_status).toBe('sin_pago');

    // Anulación limpia sin PIN de supervisor
    const resVoid = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        reason: 'CLIENTE_DESISTIO'
      }
    });
    expect(resVoid.statusCode).toBe(200);
    expect(resVoid.json().success).toBe(true);

    const updatedOrder = rawDb.prepare('SELECT * FROM orders WHERE id = ?').get(order.id) as any;
    expect(updatedOrder.payment_status).toBe('anulado');
    expect(updatedOrder.fulfillment_status).toBe('anulado');

    // Cero filas en ledger_entries para órdenes no pagadas
    const ledgerCount = (rawDb.prepare('SELECT count(*) as cnt FROM ledger_entries WHERE order_id = ?').get(order.id) as any).cnt;
    expect(ledgerCount).toBe(0);

    // Intentar anular de nuevo la orden no pagada también responde 409
    const resVoidAgain = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        reason: 'REINTENTO_DESISTIO'
      }
    });
    expect(resVoidAgain.statusCode).toBe(409);
    expect(resVoidAgain.json().code).toBe('ORDER_ALREADY_ANNULLED');
  });
});
