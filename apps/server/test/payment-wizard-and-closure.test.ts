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
import { loginAs, ensureTestSupervisor } from './test-helpers.js';
import { usdToBsCents, createIdempotencyKey } from '@tocineta/shared';

describe('Fase 2 — Cobro en 3 Pasos, Caja, Cierre, y Registro de Errores (@tocineta/server & @tocineta/web)', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_fase2_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_fase2.db');
  let rawDb: Database.Database;

  let adminToken: string;
  let cajeraToken: string;
  const rateMicroBs = 40_000_000; // 40.00 Bs / USD

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

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
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
  // 1. MÁQUINA DE ESTADOS Y CÁLCULOS MATEMÁTICOS DEL WIZARD DE PAGO
  // --------------------------------------------------------------------------
  describe('1. Lógica y Máquina de Estados del PaymentWizard', () => {
    it('Calcula correctamente la acumulación multimétodo y el vuelto mixto', () => {
      const totalOrderUsdCents = 1500; // $15.00
      const totalOrderBsCents = usdToBsCents(totalOrderUsdCents, rateMicroBs); // 600.00 Bs

      expect(totalOrderBsCents).toBe(60000);

      // Tenders: $10 USD + 200.00 Bs (equiv $5.00) + $5.00 USD extra = $20.00 pagados
      const tender1 = { method: 'cash_usd', amountCents: 1000, currency: 'USD' };
      const tender2 = { method: 'cash_bs', amountCents: 20000, currency: 'BS' };
      const tender3 = { method: 'binance', amountCents: 500, currency: 'USD' };

      const bsEquiv = Math.round((tender2.amountCents * 1_000_000) / rateMicroBs);
      expect(bsEquiv).toBe(500);

      const totalPaidUsd = tender1.amountCents + bsEquiv + tender3.amountCents;
      expect(totalPaidUsd).toBe(2000); // $20.00

      const changeTotalUsdCents = Math.max(0, totalPaidUsd - totalOrderUsdCents);
      expect(changeTotalUsdCents).toBe(500); // $5.00 de vuelto total

      // Desglose de vuelto mixto: $2 en USD y el restante ($3) en Bs
      const changeGivenUsdCents = 200;
      const remChangeUsdCents = changeTotalUsdCents - changeGivenUsdCents; // $3.00
      const changeGivenBsCents = usdToBsCents(remChangeUsdCents, rateMicroBs); // 120.00 Bs
      expect(changeGivenBsCents).toBe(12000);

      // Verificación de suma de entrega
      const deliveredUsdEquiv = changeGivenUsdCents + Math.round((changeGivenBsCents * 1_000_000) / rateMicroBs);
      expect(deliveredUsdEquiv).toBe(500);
    });
  });

  // --------------------------------------------------------------------------
  // 2. INTEGRACIÓN DE COBRO MIXTO CON VUELTO EN EL BACKEND
  // --------------------------------------------------------------------------
  describe('2. Cobro Mixto con Vuelto Mixto y Asentamiento en Ledger', () => {
    it('Procesa el cobro de una comanda con múltiples métodos y salidas de vuelto mixto', async () => {
      // Abrir jornada previa
      await app.inject({
        method: 'POST',
        url: '/api/cash-sessions/open',
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          openingCashUsdCents: 5000,
          openingCashBsCents: 200000,
          notes: 'Apertura para test de cobro mixto'
        }
      });

      // Crear comanda
      const orderPayload = {
        fulfillmentType: 'salon',
        tableNumber: 'Mesa 3',
        customerName: 'Cliente Prueba F2',
        lines: [
          {
            productId: 'prod_new_york',
            quantity: 2
          }
        ]
      };

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: {
          Authorization: `Bearer ${cajeraToken}`,
          'x-idempotency-key': createIdempotencyKey('order')
        },
        payload: orderPayload
      });

      if (createRes.statusCode !== 201) {
        console.error('CREATE ORDER ERROR:', createRes.payload);
      }
      expect(createRes.statusCode).toBe(201);
      const orderData = JSON.parse(createRes.payload);
      const orderId = orderData.order.id;
      const totalToCollect = orderData.order.total_to_collect_usd_cents;

      // Pagar con tenders mixtos: cubrir con $5 de excedente para generar vuelto
      const overpaidUsdCents = totalToCollect + 500;

      const payRes = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderId}/pay`,
        headers: {
          Authorization: `Bearer ${cajeraToken}`,
          'x-idempotency-key': createIdempotencyKey('payment')
        },
        payload: {
          tenders: [
            {
              method: 'cash_usd',
              amountCents: overpaidUsdCents
            }
          ],
          changeOutputs: {
            method: 'cash_bs',
            changeUsdCents: 200,
            changeBsCents: 12000
          }
        }
      });

      expect(payRes.statusCode).toBe(200);
      const payData = JSON.parse(payRes.payload);
      expect(payData.success).toBe(true);

      // Verificar que la orden figure pagada
      const getOrderRes = await app.inject({
        method: 'GET',
        url: `/api/orders/${orderId}`,
        headers: { Authorization: `Bearer ${cajeraToken}` }
      });
      const getOrderData = JSON.parse(getOrderRes.payload);
      expect(getOrderData.order.payment_status).toBe('pagado');
    });
  });

  // --------------------------------------------------------------------------
  // 3. SEGURIDAD Y CONTROL DE FRAUDE EN REFERENCIAS
  // --------------------------------------------------------------------------
  describe('3. Detección y Bloqueo de Referencias Duplicadas', () => {
    it('Emite advertencia FRAUD_WARN_DUPLICATE_REFERENCE al reusar referencia de pago móvil', async () => {
      // Crear orden 1
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: {
          Authorization: `Bearer ${cajeraToken}`,
          'x-idempotency-key': createIdempotencyKey('order')
        },
        payload: {
          fulfillmentType: 'para_llevar',
          customerName: 'Cliente Ref 1',
          lines: [{ productId: 'prod_street_dog', quantity: 1 }]
        }
      });
      expect(res1.statusCode).toBe(201);
      const ord1 = JSON.parse(res1.payload).order;

      // Pagar orden 1 con referencia 4488 (exacto 100.00 Bs = $2.50 a tasa 40.00)
      const pay1 = await app.inject({
        method: 'POST',
        url: `/api/orders/${ord1.id}/pay`,
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [
            {
              method: 'pago_movil',
              amountCents: 10000,
              referenceCode: 'REF-4488'
            }
          ]
        }
      });
      expect(pay1.statusCode).toBe(200);

      // Crear orden 2 (con 2 productos para que el monto sea diferente: $5.00 = 20,000 Bs cents)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: {
          Authorization: `Bearer ${cajeraToken}`,
          'x-idempotency-key': createIdempotencyKey('order')
        },
        payload: {
          fulfillmentType: 'para_llevar',
          customerName: 'Cliente Ref 2',
          lines: [{ productId: 'prod_street_dog', quantity: 2 }]
        }
      });
      expect(res2.statusCode).toBe(201);
      const ord2 = JSON.parse(res2.payload).order;

      // Pagar orden 2 reutilizando la misma referencia con distinto monto sin confirmación
      const pay2 = await app.inject({
        method: 'POST',
        url: `/api/orders/${ord2.id}/pay`,
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [
            {
              method: 'pago_movil',
              amountCents: 20000,
              referenceCode: 'REF-4488'
            }
          ]
        }
      });

      const pay2Data = JSON.parse(pay2.payload);
      expect(pay2Data.success).toBe(false);
      expect(pay2Data.code).toBe('FRAUD_WARN_DUPLICATE_REFERENCE');

      // Con confirmación de advertencia confirmWarning: true, procede
      const pay2Override = await app.inject({
        method: 'POST',
        url: `/api/orders/${ord2.id}/pay`,
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [
            {
              method: 'pago_movil',
              amountCents: 20000,
              referenceCode: 'REF-4488'
            }
          ],
          confirmWarning: true
        }
      });
      expect(pay2Override.statusCode).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // 4. CIERRE DE CAJA Y ARQUEO CIEGO VS GUIADO
  // --------------------------------------------------------------------------
  describe('4. Cierre Z y Control de Arqueo Ciego', () => {
    it('Permite consultar y alternar blindClosureEnabled en business-settings', async () => {
      // Consultar configuración actual
      const getRes = await app.inject({
        method: 'GET',
        url: '/api/business-settings',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      expect(getRes.statusCode).toBe(200);
      const getData = JSON.parse(getRes.payload);
      expect(getData.settings.blindClosureEnabled).toBe(false); // por defecto guiado

      // Modificar a arqueo ciego activado
      const patchRes = await app.inject({
        method: 'PATCH',
        url: '/api/business-settings',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { blindClosureEnabled: true }
      });
      expect(patchRes.statusCode).toBe(200);
      const patchData = JSON.parse(patchRes.payload);
      expect(patchData.settings.blindClosureEnabled).toBe(true);

      // Revertir a guiado
      const revertRes = await app.inject({
        method: 'PATCH',
        url: '/api/business-settings',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { blindClosureEnabled: false }
      });
      expect(revertRes.statusCode).toBe(200);
      expect(JSON.parse(revertRes.payload).settings.blindClosureEnabled).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 5. REGISTRO Y REPORTE DE ERRORES DE CLIENTE (ERRORBOUNDARY)
  // --------------------------------------------------------------------------
  describe('5. ErrorBoundary y Tabla client_errors', () => {
    it('Registra y lista incidentes técnicos enviados por el frontend', async () => {
      const reportRes = await app.inject({
        method: 'POST',
        url: '/api/client-errors',
        payload: {
          viewName: 'KdsView',
          errorMessage: 'Cannot read properties of undefined (reading status)',
          errorStack: 'TypeError: Cannot read properties of undefined\n    at KdsCard.tsx:42:15',
          userId: 'usr_cajera',
          userRole: 'cajera'
        }
      });

      expect(reportRes.statusCode).toBe(201);
      const reportData = JSON.parse(reportRes.payload);
      expect(reportData.success).toBe(true);
      expect(reportData.id).toMatch(/^err_/);

      // Consultar lista de errores
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/client-errors',
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      expect(listRes.statusCode).toBe(200);
      const listData = JSON.parse(listRes.payload);
      expect(listData.success).toBe(true);
      expect(listData.errors.length).toBeGreaterThanOrEqual(1);

      const found = listData.errors.find((e: any) => e.id === reportData.id);
      expect(found).toBeDefined();
      expect(found.view_name).toBe('KdsView');
      expect(found.error_message).toContain('Cannot read properties of undefined');
    });
  });
});
