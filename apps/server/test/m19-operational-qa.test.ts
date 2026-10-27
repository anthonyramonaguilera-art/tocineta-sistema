/**
 * SISTEMA OPERATIVO LOCAL TOCINETA SONRÍE
 * Hito M19 — Suite de Pruebas Operativas Críticas (TDD Estricto)
 *
 * 1. Test 1 (A.1 Pedidos Personalizados Complejos):
 *    - Enviar a POST /api/orders un pedido que combine:
 *      1x Hamburguesa Miami con modificador de ingrediente base (Sin Cebolla),
 *      instrucción global (Sin Pan / Envuelta en Lechuga, Poca Salsa),
 *      Barra Libre (Maíz, Cebolla Caramelizada) y Extra Pago (Carne Extra $1.00)
 *      + 1x Combo Clásico personalizado.
 *    - Verificar que responde 200/201 OK (cero errores 400/500 de Zod o FK),
 *      que se persisten todos los modificadores y que al cobrarse aparece completo en GET /api/kds/orders.
 *
 * 2. Test 2 (B.1 Pago Móvil con y sin Referencia):
 *    - Cobrar una orden por pago_movil enviando reference: '' o 'SIN-REF' -> responde 200 OK (no bloqueante).
 *    - Cobrar una orden por pago_movil enviando reference: '987654' -> guarda la referencia y si se repite con el mismo monto dispara FRAUD_BLOCK_DUPLICATE_PAYMENT.
 *
 * 3. Test 3 (C.2 Auto-Sync BCV con Mock Fetch):
 *    - Invocar syncBcvRateFromInternet(rawDb, mockFetchReturningRate(45.25)) -> actualiza la tasa activa a 45250000 micro-Bs y registra BCV_RATE_AUTO_UPDATED en audit_events.
 *    - Invocar syncBcvRateFromInternet(rawDb, mockFetchOfflineError) -> no lanza excepción y conserva intacta la tasa local previa.
 *
 * 4. Test 4 (Contratos Frontend Smoke Checks):
 *    - PosComandero.tsx contiene el botón "Enviar y Cobrar Ahora", abre <MultiMethodCalculator en modal sin salir del Comandero, y solo encola en outbox ante errores reales de red.
 *    - CashierView.tsx muestra el desglose de platos siempre visible y NO renderiza <DrinksChecklist.
 *    - MultiMethodCalculator.tsx muestra el equivalente en USD junto al saldo restante en Bs (Equiv).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { buildServer } from '../src/server.js';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { syncBcvRateFromInternet } from '../src/modules/menu/bcv-auto-sync.js';
import { createIdempotencyKey } from '@tocineta/shared';
import { loginAs } from './test-helpers.js';

function readWebSource(relPath: string): string {
  const candidates = [
    path.resolve(__dirname, '../../web/src', relPath),
    path.resolve(process.cwd(), '../web/src', relPath),
    path.resolve(process.cwd(), 'apps/web/src', relPath),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`No se encontró ${relPath} en ${candidates.join(', ')}`);
  return fs.readFileSync(found, 'utf8');
}

describe('Hito M19 — Suite de Pruebas Operativas Críticas', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_m19_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_m19.db');
  let rawDb: Database.Database;

  let cajeraToken: string;
  let adminToken: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { migrationsDir: path.join(__dirname, '../src/db/migrations') });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    // Sembrar tasa de cambio inicial para pruebas (40.00 Bs/$)
    rawDb.prepare(`
      INSERT INTO exchange_rates (id, rate_micro_bs, source, created_at_ms, is_current)
      VALUES ('rate_initial_test', 40000000, 'MANUAL', ?, 1)
    `).run(Date.now());

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    // Abrir jornada y sesión de caja de prueba
    rawDb.prepare(`
      INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status, initial_cash_usd_cents)
      VALUES ('jor_m19_test', 'usr_cajera', ?, 'abierta', 5000)
    `).run(Date.now());

    rawDb.prepare(`
      INSERT INTO cash_sessions (id, jornada_id, user_id, opened_at_ms, status)
      VALUES ('cs_m19_test', 'jor_m19_test', 'usr_cajera', ?, 'abierta')
    `).run(Date.now());

    // Login cajera
    cajeraToken = (await loginAs(app, 'cajera')).token;

    // Login admin
    adminToken = (await loginAs(app, 'admin')).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================================================
  // TEST 1: PEDIDOS PERSONALIZADOS COMPLEJOS (BLOQUE A.1)
  // ==========================================================================
  describe('Test 1: Pedidos Personalizados Complejos y KDS', () => {
    it('crea exitosamente un pedido combinado con instrucciones globales, barra libre, extras y combos', async () => {
      const orderPayload = {
        tableNumber: 'Mesa 5',
        fulfillmentType: 'salon',
        lines: [
          {
            productId: 'prod_miami',
            quantity: 1,
            unitPriceUsdCents: 690,
            station: 'hamburguesas',
            modifiers: [
              // Modificador de ingrediente base
              {
                ingredient_id: 'ing_bl_cebolla',
                ingredient_name: 'Cebolla',
                modifier_name: 'Cebolla',
                modifier_type: 'BASE_INGREDIENT',
                state: 'sin'
              },
              // Instrucciones globales (ID sintético / string)
              {
                ingredient_id: 'GLOBAL_SIN_PAN',
                ingredient_name: 'Sin Pan / Envuelta en Lechuga',
                modifier_name: 'Sin Pan / Envuelta en Lechuga',
                modifier_type: 'GLOBAL_INSTRUCTION',
                state: 'sin'
              },
              {
                ingredient_id: 'GLOBAL_POCA_SALSA',
                ingredient_name: 'Poca Salsa',
                modifier_name: 'Poca Salsa',
                modifier_type: 'GLOBAL_INSTRUCTION',
                state: 'poco'
              },
              // Barra Libre
              {
                ingredient_id: 'ing_bl_maiz',
                ingredient_name: 'Maíz',
                modifier_name: 'Maíz',
                modifier_type: 'BARRA_LIBRE',
                state: 'normal'
              },
              {
                ingredient_id: 'ing_bl_cebolla_caramelizada',
                ingredient_name: 'Cebolla Caramelizada',
                modifier_name: 'Cebolla Caramelizada',
                modifier_type: 'BARRA_LIBRE',
                state: 'normal'
              },
              // Extra Pago ($1.00 = 100 centavos)
              {
                ingredient_id: 'prod_carne_extra',
                ingredient_name: 'Carne Extra',
                modifier_name: 'Carne Extra',
                modifier_type: 'PAID_EXTRA',
                state: 'extra',
                extra_price_usd_cents: 100
              }
            ]
          },
          // 1x Combo Clásico personalizado con hijo
          {
            productId: 'prod_combo_clasico',
            quantity: 1,
            unitPriceUsdCents: 790,
            station: 'hot_dogs',
            comboChildren: [
              {
                productId: 'prod_street_dog',
                quantity: 1,
                station: 'hot_dogs',
                modifiers: [
                  {
                    ingredient_id: 'ing_base_pan_perro',
                    ingredient_name: 'Pan de perro',
                    modifier_name: 'Pan de perro',
                    modifier_type: 'BASE_INGREDIENT',
                    state: 'sin'
                  }
                ]
              }
            ]
          }
        ]
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: {
          authorization: `Bearer ${cajeraToken}`,
          'Idempotency-Key': createIdempotencyKey('order')
        },
        payload: orderPayload
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.payload);
      expect(data.success).toBe(true);
      expect(data.order).toBeDefined();
      const createdOrderId = data.order.id;

      // Verificar que los modificadores se persistieron en order_line_modifiers con modifier_name y state
      const mods = rawDb.prepare(`
        SELECT modifier_name, modifier_type, state, extra_price_usd_cents
        FROM order_line_modifiers
        WHERE order_line_id IN (SELECT id FROM order_lines WHERE order_id = ?)
      `).all(createdOrderId) as any[];

      expect(mods.length).toBeGreaterThanOrEqual(6);
      const sinPanMod = mods.find(m => m.modifier_name?.includes('Sin Pan') || m.modifier_name?.includes('Lechuga'));
      expect(sinPanMod).toBeDefined();

      const carneExtraMod = mods.find(m => m.modifier_name === 'Carne Extra');
      expect(carneExtraMod).toBeDefined();
      expect(carneExtraMod.extra_price_usd_cents).toBe(100);

      // Cobrar la orden para verificar que pasa a KDS
      const payRes = await app.inject({
        method: 'POST',
        url: `/api/orders/${createdOrderId}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: data.order.total_to_collect_usd_cents }]
        }
      });
      expect(payRes.statusCode).toBe(200);

      // Verificar en KDS (GET /api/kds/orders)
      const kdsRes = await app.inject({
        method: 'GET',
        url: '/api/kds/orders',
        headers: { authorization: `Bearer ${cajeraToken}` }
      });
      expect(kdsRes.statusCode).toBe(200);
      const kdsData = JSON.parse(kdsRes.payload);
      const kdsOrder = kdsData.orders?.find((o: any) => (o.orderId || o.id) === createdOrderId);
      expect(kdsOrder).toBeDefined();
    });
  });

  // ==========================================================================
  // TEST 2: PAGO MÓVIL CON Y SIN REFERENCIA (BLOQUE B.1)
  // ==========================================================================
  describe('Test 2: Pago Móvil No Bloqueante con Referencia Opcional', () => {
    it('permite cobrar con referencia vacía o "SIN-REF" sin disparar antifraude', async () => {
      // Crear orden A
      const orderARes = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: {
          authorization: `Bearer ${cajeraToken}`,
          'Idempotency-Key': createIdempotencyKey('order')
        },
        payload: {
          tableNumber: 'Mesa 1',
          fulfillmentType: 'salon',
          lines: [{ productId: 'prod_street_dog', quantity: 1, unitPriceUsdCents: 250, station: 'hot_dogs' }]
        }
      });
      expect(orderARes.statusCode).toBe(201);
      const orderA = JSON.parse(orderARes.payload).order;

      // Cobrar con reference: '' -> Responde 200 OK
      const payARes = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderA.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'pago_movil', amountCents: 10000, referenceCode: '' }]
        }
      });
      expect(payARes.statusCode).toBe(200);

      // Crear orden B con el mismo monto
      const orderBRes = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: {
          authorization: `Bearer ${cajeraToken}`,
          'Idempotency-Key': createIdempotencyKey('order')
        },
        payload: {
          tableNumber: 'Mesa 2',
          fulfillmentType: 'salon',
          lines: [{ productId: 'prod_street_dog', quantity: 1, unitPriceUsdCents: 250, station: 'hot_dogs' }]
        }
      });
      expect(orderBRes.statusCode).toBe(201);
      const orderB = JSON.parse(orderBRes.payload).order;

      // Cobrar con reference: 'SIN-REF' -> Responde 200 OK (no se bloquea por duplicidad)
      const payBRes = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderB.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'pago_movil', amountCents: 10000, referenceCode: 'SIN-REF' }]
        }
      });
      expect(payBRes.statusCode).toBe(200);
    });

    it('aplica validación antifraude estricta cuando viene una referencia numérica real duplicada con el mismo monto', async () => {
      const realRef = '987654';

      // Orden C
      const orderCRes = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: {
          authorization: `Bearer ${cajeraToken}`,
          'Idempotency-Key': createIdempotencyKey('order')
        },
        payload: {
          tableNumber: 'Mesa 3',
          fulfillmentType: 'salon',
          lines: [{ productId: 'prod_street_dog', quantity: 1, unitPriceUsdCents: 250, station: 'hot_dogs' }]
        }
      });
      expect(orderCRes.statusCode).toBe(201);
      const orderC = JSON.parse(orderCRes.payload).order;

      // Pago 1 con referencia real
      const payCRes = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderC.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'pago_movil', amountCents: 10000, referenceCode: realRef }]
        }
      });
      expect(payCRes.statusCode).toBe(200);

      // Orden D con mismo monto
      const orderDRes = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: {
          authorization: `Bearer ${cajeraToken}`,
          'Idempotency-Key': createIdempotencyKey('order')
        },
        payload: {
          tableNumber: 'Mesa 4',
          fulfillmentType: 'salon',
          lines: [{ productId: 'prod_street_dog', quantity: 1, unitPriceUsdCents: 250, station: 'hot_dogs' }]
        }
      });
      const orderD = JSON.parse(orderDRes.payload).order;

      // Intento de reutilizar la misma referencia con el mismo monto sin PIN de supervisor
      const payDRes = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderD.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'pago_movil', amountCents: 10000, referenceCode: realRef }]
        }
      });

      expect(payDRes.statusCode).toBe(400);
      const failData = JSON.parse(payDRes.payload);
      expect(failData.code).toBe('FRAUD_BLOCK_DUPLICATE_PAYMENT');
      expect(failData.requiresSupervisorPin).toBe(true);
    });
  });

  // ==========================================================================
  // TEST 3: AUTO-SYNC BCV CON MOCK FETCH (BLOQUE C.2)
  // ==========================================================================
  describe('Test 3: Auto-Sync Tasa BCV por Internet', () => {
    it('actualiza la tasa oficial y registra evento de auditoría cuando internet devuelve nueva tasa', async () => {
      const mockFetchReturningRate = async () => ({
        ok: true,
        json: async () => ({ promedio: 45.25 })
      });

      const result = await syncBcvRateFromInternet(rawDb, mockFetchReturningRate as any);

      expect(result.updated).toBe(true);
      expect(result.rateMicroBs).toBe(45250000);

      // Verificar en DB
      const currentRateRow = rawDb.prepare('SELECT rate_micro_bs, source FROM exchange_rates WHERE is_current = 1').get() as any;
      expect(currentRateRow.rate_micro_bs).toBe(45250000);
      expect(currentRateRow.source).toBe('AUTO_INTERNET');

      // Verificar audit_events
      const audit = rawDb.prepare("SELECT * FROM audit_events WHERE action = 'BCV_RATE_AUTO_UPDATED' ORDER BY created_at_ms DESC LIMIT 1").get() as any;
      expect(audit).toBeDefined();
      expect(audit.action).toBe('BCV_RATE_AUTO_UPDATED');
    });

    it('conserva intacta la tasa previa y no lanza excepción ante fallo de red (offline)', async () => {
      const currentBefore = rawDb.prepare('SELECT rate_micro_bs FROM exchange_rates WHERE is_current = 1').get() as any;

      const mockFetchOfflineError = async () => {
        throw new TypeError('Failed to fetch (offline)');
      };

      const result = await syncBcvRateFromInternet(rawDb, mockFetchOfflineError as any);

      expect(result.updated).toBe(false);

      const currentAfter = rawDb.prepare('SELECT rate_micro_bs FROM exchange_rates WHERE is_current = 1').get() as any;
      expect(currentAfter.rate_micro_bs).toBe(currentBefore.rate_micro_bs);
    });
  });

  // ==========================================================================
  // TEST 4: CONTRATOS FRONTEND SMOKE CHECKS (BLOQUES A, B, C)
  // ==========================================================================
  describe('Test 4: Contratos Frontend Smoke Checks', () => {
    it('PosComandero.tsx contiene el botón "Enviar y Cobrar Ahora", modal express y regla estricta de outbox', () => {
      const source = readWebSource('features/pos/PosComandero.tsx');

      expect(source).toContain('Enviar y Cobrar Ahora');
      expect(source).toContain('<MultiMethodCalculator');
      expect(source).toContain('clearOutbox');
      expect(source).toContain('Limpiar cola');
      // Debe descartar / no encolar cuando el servidor devuelve 4xx o 500
      expect(source).toMatch(/!res\.ok|isRealNetworkError/);
    });

    it('CashierView.tsx muestra el desglose de platos siempre visible y no renderiza DrinksChecklist', () => {
      const source = readWebSource('features/cashier/CashierView.tsx');

      expect(source).toContain('Detalle de ítems');
      expect(source).toContain('100% VISIBLE SIEMPRE POR DEFECTO');
      expect(source).not.toContain('<DrinksChecklist');
    });

    it('MultiMethodCalculator.tsx muestra el equivalente en USD junto al saldo restante en Bs y en filas de tender', () => {
      const source = readWebSource('features/cashier/MultiMethodCalculator.tsx');

      expect(source).toContain('Falta por cobrar:');
      expect(source).toContain('⇄');
      expect(source).toContain('Equiv');
      expect(source).toContain('Equivale a');
    });
  });
});
