import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';

describe('Hito M5 - Módulo de Caja, Calculadora Multimétodo, Vueltos Mixtos y Ledger Inmutable (@tocineta/server)', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_m5_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_m5.db');
  let rawDb: Database.Database;

  let adminToken: string;
  let cajeraToken: string;
  let supervisorToken: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    runMigrations(rawDb, path.join(__dirname, '../src/db/migrations'));
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    // Login Admin
    const resAdmin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_admin_olinelcys', pin: '123456' }
    });
    adminToken = JSON.parse(resAdmin.payload).token;

    // Login Cajera
    const resCajera = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_cajera_principal', pin: '4321' }
    });
    cajeraToken = JSON.parse(resCajera.payload).token;

    // Login Supervisor
    const resSup = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_supervisor_turno', pin: '654321' }
    });
    supervisorToken = JSON.parse(resSup.payload).token;
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

  // --------------------------------------------------------------------------
  // 1. APERTURA DE JORNADA Y SESIÓN DE CAJA
  // --------------------------------------------------------------------------
  describe('Apertura de Jornada y Sesión de Caja', () => {
    it('Fija la tasa del día en micro-Bs y abre la jornada con fondo de caja inicial', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/jornadas/open',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          rateStr: '36.60', // 36,600,000 micro-Bs
          initialCashUsdCents: 5000, // $50.00
          initialCashBsCents: 183000, // 1830 Bs
          notes: 'Turno tarde food truck'
        }
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.success).toBe(true);
      expect(data.jornada.status).toBe('abierta');
      expect(data.jornada.initial_cash_usd_cents).toBe(5000);
      expect(data.jornada.current_rate_micro_bs).toBe(36600000);
    });

    it('Abre la sesión de caja vinculada a la cajera y a la jornada activa', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/cash-sessions/open',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          openingCashUsdCents: 5000,
          openingCashBsCents: 183000
        }
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.success).toBe(true);
      expect(data.cashSession.status).toBe('abierta');
      expect(data.cashSession.user_id).toBe('usr_cajera_principal');
    });
  });

  // --------------------------------------------------------------------------
  // 2. PRUEBA DE ACEPTACIÓN #5: CUENTA $13.90, PAGO $20.00 USD, VUELTO MIXTO
  // --------------------------------------------------------------------------
  describe('Prueba de Aceptación #5: Cobro con Vuelto Mixto y Asientos Exactos', () => {
    it('Cuenta de $13.90 pagada con $20.00 y vuelto mixto de $6.00 USD + $0.10 en Bs (366 céntimos) cuadra al centavo en ledger_entries', async () => {
      // 1. Crear la orden de $13.90 (Combo Para Ti)
      const resOrder = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tableNumber: 'Mesa 5',
          fulfillmentType: 'salon',
          lines: [
            {
              productId: 'prod_combo_para_ti', // $13.90 = 1390 cents
              quantity: 1,
              comboChildren: [
                { productId: 'prod_texas_mex', quantity: 1 },
                { productId: 'prod_miami', quantity: 1 },
                { productId: 'prod_refresco_1lt', quantity: 1, flavorChoice: 'Pepsi' }
              ]
            }
          ]
        }
      });

      expect(resOrder.statusCode).toBe(201);
      const order = JSON.parse(resOrder.payload).order;
      expect(order.total_to_collect_usd_cents).toBe(1390);
      expect(order.payment_status).toBe('sin_pago');
      expect(order.fulfillment_status).toBe('enviado');

      // 2. Cobrar la orden en Caja:
      // - Cliente entrega $20.00 Efectivo USD (2000 cents)
      // - Vuelto entregado: $6.00 Efectivo USD (600 cents) + $0.10 en Bs (366 céntimos Bs a tasa 36.60)
      const resPay = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [
            {
              method: 'cash_usd',
              amountCents: 2000
            }
          ],
          changeOutputs: {
            method: 'MIXTO',
            changeUsdCents: 600,
            changeBsCents: 366
          }
        }
      });

      expect(resPay.statusCode).toBe(200);
      const payData = JSON.parse(resPay.payload);
      expect(payData.success).toBe(true);

      // Verificar orden actualizada
      expect(payData.order.payment_status).toBe('pagado');
      expect(payData.order.fulfillment_status).toBe('en_preparacion');

      // Verificar registro en `payments`
      expect(payData.payments.length).toBe(1);
      expect(payData.payments[0].method).toBe('EFECTIVO_USD');
      expect(payData.payments[0].amount_cents).toBe(2000);
      expect(payData.payments[0].usd_equivalent_cents).toBe(2000);

      // Verificar registro en `change_deliveries`
      expect(payData.changeDeliveries.length).toBe(1);
      expect(payData.changeDeliveries[0].change_usd_cents).toBe(600);
      expect(payData.changeDeliveries[0].change_bs_cents).toBe(366);

      // Verificar asientos contables en `ledger_entries`
      const ledgerEntries = payData.ledgerEntries;
      expect(ledgerEntries.length).toBe(4);

      // A. Débito CASH_USD por el ingreso de $20.00
      const debitCash = ledgerEntries.find((l: any) => l.account_bucket === 'CASH_USD' && l.debit_usd_cents > 0);
      expect(debitCash).toBeDefined();
      expect(debitCash.debit_usd_cents).toBe(2000);
      expect(debitCash.credit_usd_cents).toBe(0);

      // B. Crédito FOOD_SALES por $13.90
      const creditSales = ledgerEntries.find((l: any) => l.account_bucket === 'FOOD_SALES');
      expect(creditSales).toBeDefined();
      expect(creditSales.credit_usd_cents).toBe(1390);
      expect(creditSales.debit_usd_cents).toBe(0);

      // C. Crédito CASH_USD por salida de vuelto de $6.00
      const creditChangeUsd = ledgerEntries.find((l: any) => l.account_bucket === 'CASH_USD' && l.credit_usd_cents > 0);
      expect(creditChangeUsd).toBeDefined();
      expect(creditChangeUsd.credit_usd_cents).toBe(600);

      // D. Crédito CASH_BS por salida de vuelto de $0.10 (366 céntimos Bs)
      const creditChangeBs = ledgerEntries.find((l: any) => l.account_bucket === 'CASH_BS' && l.credit_usd_cents > 0);
      expect(creditChangeBs).toBeDefined();
      expect(creditChangeBs.credit_usd_cents).toBe(10); // $0.10 USD equivalente

      // Suma total de Débitos debe ser idéntica a Suma total de Créditos (Partida Doble exacta)
      const totalDebits = ledgerEntries.reduce((sum: number, l: any) => sum + l.debit_usd_cents, 0);
      const totalCredits = ledgerEntries.reduce((sum: number, l: any) => sum + l.credit_usd_cents, 0);
      expect(totalDebits).toBe(2000);
      expect(totalCredits).toBe(2000);
      expect(totalDebits).toBe(totalCredits);

      // Verificar encolado de 2 print_jobs (Caja y Cocina)
      const pjobs = rawDb.prepare('SELECT * FROM print_jobs WHERE order_id = ?').all(order.id) as any[];
      expect(pjobs.length).toBe(2);
      expect(pjobs.some(j => j.printer_id === 'print_caja_usb' && j.job_type === 'NOTA_ENTREGA')).toBe(true);
      expect(pjobs.some(j => j.printer_id === 'print_cocina' && j.job_type === 'TICKET_COCINA')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 3. PRUEBA DE ACEPTACIÓN #7: ANTIFRAUDE PAGO MÓVIL EN DOS NIVELES
  // --------------------------------------------------------------------------
  describe('Prueba de Aceptación #7: Alerta Antifraude Pago Móvil en Dos Niveles', () => {
    it('Repetir referencia y monto de Pago Móvil bloquea el cobro (Nivel 1) hasta ingresar PIN de supervisor', async () => {
      // 1. Crear Orden A y pagar con Pago Móvil ref 'PM-987654' por 183000 céntimos Bs ($50.00)
      const resOrderA = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tableNumber: 'Mesa 1',
          lines: [{ productId: 'prod_doritos_dog_snacks', quantity: 1 }]
        }
      });
      const orderA = JSON.parse(resOrderA.payload).order;

      const resPayA = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderA.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [
            {
              method: 'pago_movil',
              amountCents: 12810, // ~3.50 * 36.60
              referenceCode: 'PM-987654'
            }
          ]
        }
      });
      expect(resPayA.statusCode).toBe(200);

      // 2. Crear Orden B e intentar pagar con la MISMA referencia y el MISMO monto
      const resOrderB = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tableNumber: 'Mesa 2',
          lines: [{ productId: 'prod_doritos_dog_snacks', quantity: 1 }]
        }
      });
      const orderB = JSON.parse(resOrderB.payload).order;

      // Intento sin PIN de supervisor -> Bloqueo Nivel 1
      const resPayFail = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderB.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [
            {
              method: 'pago_movil',
              amountCents: 12810,
              referenceCode: 'PM-987654'
            }
          ]
        }
      });

      expect(resPayFail.statusCode).toBe(400);
      const failData = JSON.parse(resPayFail.payload);
      expect(failData.code).toBe('FRAUD_BLOCK_DUPLICATE_PAYMENT');
      expect(failData.requiresSupervisorPin).toBe(true);

      // Intento con PIN erróneo -> 403 Forbidden
      const resPayWrongPin = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderB.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          supervisorPin: '999999',
          tenders: [
            {
              method: 'pago_movil',
              amountCents: 12810,
              referenceCode: 'PM-987654'
            }
          ]
        }
      });
      expect(resPayWrongPin.statusCode).toBe(403);

      // Intento con PIN de supervisor correcto (654321) -> Cobro Aprobado
      const resPayAuth = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderB.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          supervisorPin: '654321',
          tenders: [
            {
              method: 'pago_movil',
              amountCents: 12810,
              referenceCode: 'PM-987654'
            }
          ]
        }
      });
      expect(resPayAuth.statusCode).toBe(200);
      expect(JSON.parse(resPayAuth.payload).order.payment_status).toBe('pagado');
    });

    it('Misma referencia con DISTINTO monto genera advertencia (Nivel 2) y requiere confirmación explícita', async () => {
      const resOrderC = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tableNumber: 'Mesa 3',
          lines: [{ productId: 'prod_texas_mex', quantity: 1 }] // $6.90
        }
      });
      const orderC = JSON.parse(resOrderC.payload).order;

      // Intento con referencia previa 'PM-987654' pero monto de $6.90 (25254 céntimos Bs)
      const resWarn = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderC.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [
            {
              method: 'pago_movil',
              amountCents: 25254,
              referenceCode: 'PM-987654'
            }
          ]
        }
      });

      expect(resWarn.statusCode).toBe(400);
      const warnData = JSON.parse(resWarn.payload);
      expect(warnData.code).toBe('FRAUD_WARN_DUPLICATE_REFERENCE');
      expect(warnData.requiresConfirmation).toBe(true);

      // Confirmar advertencia explícitamente -> Cobro exitoso sin requerir PIN
      const resConfirmed = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderC.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          confirmWarning: true,
          tenders: [
            {
              method: 'pago_movil',
              amountCents: 25254,
              referenceCode: 'PM-987654'
            }
          ]
        }
      });

      expect(resConfirmed.statusCode).toBe(200);
      expect(JSON.parse(resConfirmed.payload).order.payment_status).toBe('pagado');
    });
  });

  // --------------------------------------------------------------------------
  // 4. TOLERANCIA DE REDONDEO DE 1 CENTAVO Y BLOQUEO DE SUBPAGO
  // --------------------------------------------------------------------------
  describe('Reglas Financieras: Redondeo de 1 Centavo y Bloqueo de Subpago', () => {
    it('Subpago mayor a 1 centavo bloquea la transacción con 400 Bad Request', async () => {
      const resOrder = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tableNumber: 'Mesa 7',
          lines: [{ productId: 'prod_texas_mex', quantity: 1 }] // $6.90 = 690 cents
        }
      });
      const order = JSON.parse(resOrder.payload).order;

      // Paga solo $5.00
      const resPay = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: 500 }]
        }
      });

      expect(resPay.statusCode).toBe(400);
      expect(JSON.parse(resPay.payload).error).toContain('SUBPAGO BLOQUEADO');
    });

    it('Tolerancia de 1 centavo USD por redondeo en pagos mixtos registra asiento explicit rounding_adjustment', async () => {
      const resOrder = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tableNumber: 'Mesa 8',
          lines: [{ productId: 'prod_doritos_dog_snacks', quantity: 1 }] // $3.50 = 350 cents
        }
      });
      const order = JSON.parse(resOrder.payload).order;

      // Paga $3.00 en USD (300 cents) y remanente $0.50 en Bs
      // A tasa 36.60, $0.50 = 1830 céntimos Bs
      // Supongamos que por redondeo paga 1800 céntimos (diferencia de 30 céntimos Bs, menor a 1 centavo USD que son 37 céntimos)
      const resPay = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [
            { method: 'cash_usd', amountCents: 300 },
            { method: 'cash_bs', amountCents: 1800 }
          ]
        }
      });

      expect(resPay.statusCode).toBe(200);
      const data = JSON.parse(resPay.payload);
      expect(data.settlement.roundingAdjustmentUsdCents).toBe(1);

      // Verificar que se registró el asiento rounding_adjustment
      const roundingEntry = data.ledgerEntries.find((l: any) => l.account_bucket === 'ROUNDING_ADJUSTMENT');
      expect(roundingEntry).toBeDefined();
      expect(roundingEntry.debit_usd_cents).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // 5. CAMBIO DE TASA BCV A MITAD DE LA NOCHE
  // --------------------------------------------------------------------------
  describe('Inmutabilidad de Tasas y Asientos Contables Previos', () => {
    it('Cambiar la tasa BCV a medianoche no altera ningún asiento ni tasa de órdenes cobradas anteriormente', async () => {
      // 1. Verificar tasa de la primera orden ($13.90) en payments y ledger
      const prevPayment = rawDb.prepare(`
        SELECT p.rate_micro_bs, l.rate_micro_bs as ledger_rate
        FROM payments p
        JOIN ledger_entries l ON p.order_id = l.order_id
        WHERE p.amount_cents = 2000
        LIMIT 1
      `).get() as any;
      expect(prevPayment.rate_micro_bs).toBe(36600000);
      expect(prevPayment.ledger_rate).toBe(36600000);

      // 2. Admin cambia la tasa a medianoche a 42.50 Bs/$ (42500000 micro-Bs)
      const resRate = await app.inject({
        method: 'POST',
        url: '/api/menu/exchange-rate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { rateStr: '42.50' }
      });
      expect(resRate.statusCode).toBe(200);

      // 3. Verificar que los asientos y pagos previos conservan intacta la tasa de 36.60
      const verifyPrev = rawDb.prepare(`
        SELECT p.rate_micro_bs, l.rate_micro_bs as ledger_rate
        FROM payments p
        JOIN ledger_entries l ON p.order_id = l.order_id
        WHERE p.amount_cents = 2000
        LIMIT 1
      `).get() as any;
      expect(verifyPrev.rate_micro_bs).toBe(36600000);
      expect(verifyPrev.ledger_rate).toBe(36600000);

      // 4. Intentar hacer un UPDATE en ledger_entries es rechazado por el trigger de inmutabilidad
      expect(() => {
        rawDb.prepare('UPDATE ledger_entries SET rate_micro_bs = 42500000 WHERE account_bucket = \'FOOD_SALES\'').run();
      }).toThrow(/LEDGER_IMMUTABLE/i);
    });
  });
});
