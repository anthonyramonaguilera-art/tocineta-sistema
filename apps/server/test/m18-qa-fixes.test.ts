/**
 * SISTEMA OPERATIVO LOCAL TOCINETA SONRÍE
 * Hito M18 — Suite de Pruebas de Calidad QA, RBAC, Desglose de Platos y Vuelto Mixto
 *
 * Metodología TDD Estricta:
 * 1. Test Backend 1 (A.1 RBAC en Cobro):
 *    - Mesonero intenta pagar -> 403 Forbidden con FORBIDDEN_ROLE_FOR_PAYMENT y audit_events UNAUTHORIZED_PAYMENT_ATTEMPT.
 *    - Cocinero intenta pagar -> 403 Forbidden.
 *    - Cajera invoca pagar -> 200 OK.
 *    - Compatibilidad: Cobro sin sesión previa toma cajero de sesión de caja activa.
 * 2. Test Backend 2 (B.1 Hidratación de Líneas y Conteo de Platos en GET /api/orders):
 *    - Orden con Hamburguesa Miami (Sin Pan) + Combo Clásico (2 perros) + Malta.
 *    - itemsCount === 3 (nunca 0) y lines contiene detalle y modificadores.
 * 3. Test Backend 3 (B.4 Simulación de Cola Térmica en macOS / PRINTER_DEV_SIMULATION):
 *    - Trabajo windows_raw en macOS o con PRINTER_DEV_SIMULATION=true se procesa sin error como 'impreso'.
 * 4. Test Smoke Contracts Frontend (A.2, B.1, B.2, B.3):
 *    - App.tsx / AppLayout.tsx: ALLOWED_TABS_BY_ROLE, DEFAULT_TAB_BY_ROLE, reset en logout, queryClient.clear, RoleGuard.
 *    - CashierView.tsx: Acordeón desplegable de orden y conteo real con itemsCount.
 *    - MultiMethodCalculator.tsx: Botón "Entregar todo el vuelto en Bolívares" y condicional unreturnedSurplusUsdCents > 1.
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
import { canUserProcessPayments } from '../src/modules/cashier/cashier-service.js';
import { PrintingWorker } from '../src/modules/printing/worker.js';
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

describe('Hito M18 — Suite de Calidad QA, RBAC en Caja, Detalle de Platos y Vuelto Mixto', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_m18_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_m18.db');
  let rawDb: Database.Database;

  let cajeraToken: string;
  let mesoneroToken: string;
  let cocineroToken: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { migrationsDir: path.join(__dirname, '../src/db/migrations') });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    // Abrir jornada de prueba
    rawDb.prepare(`
      INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status, initial_cash_usd_cents)
      VALUES ('jor_m18_test', 'usr_cajera', ?, 'abierta', 5000)
    `).run(Date.now());

    rawDb.prepare(`
      INSERT INTO cash_sessions (id, jornada_id, user_id, opened_at_ms, status)
      VALUES ('cs_m18_test', 'jor_m18_test', 'usr_cajera', ?, 'abierta')
    `).run(Date.now());

    // Login cajera
    cajeraToken = (await loginAs(app, 'cajera')).token;

    // Login mesonero
    mesoneroToken = (await loginAs(app, 'mesero')).token;

    // Login cocinero (Cocina Plancha)
    cocineroToken = (await loginAs(app, 'plancha')).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================================================
  // BLOQUE 1: BACKEND RBAC EN CAJA Y COBROS (HALLAZGO A.1)
  // ==========================================================================
  describe('Bloque 1: RBAC en Cobros y Operaciones de Caja', () => {
    it('Helper canUserProcessPayments retorna true solo para cajera, supervisor y admin', () => {
      expect(canUserProcessPayments('cajera')).toBe(true);
      expect(canUserProcessPayments('supervisor')).toBe(true);
      expect(canUserProcessPayments('admin')).toBe(true);
      expect(canUserProcessPayments('mesonero')).toBe(false);
      expect(canUserProcessPayments('cocinero')).toBe(false);
      expect(canUserProcessPayments('despachador')).toBe(false);
      expect(canUserProcessPayments(null)).toBe(false);
      expect(canUserProcessPayments(undefined)).toBe(false);
    });

    it('Usuario con rol mesonero (Carlos) intenta POST /api/orders/:id/pay -> 403 FORBIDDEN_ROLE_FOR_PAYMENT y registra auditoría', async () => {
      // 1. Crear una orden de prueba
      const now = Date.now();
      const orderId = `ord_rbac_mes_${now}`;
      rawDb.prepare(`
        INSERT INTO orders (
          id, jornada_id, order_number, fulfillment_type, payment_status, fulfillment_status,
          gross_food_subtotal_usd_cents, net_food_sales_usd_cents, total_to_collect_usd_cents,
          rate_micro_bs, created_by_user_id, created_at_ms, updated_at_ms
        ) VALUES (?, 'jor_m18_test', 901, 'salon', 'sin_pago', 'pendiente', 600, 600, 600, 40000000, 'usr_mesero', ?, ?)
      `).run(orderId, now, now);

      // 2. Mesonero intenta pagar con su token Bearer
      const res = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderId}/pay`,
        headers: { authorization: `Bearer ${mesoneroToken}`, 'x-user-id': 'usr_mesero' },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: 600 }]
        }
      });

      expect(res.statusCode).toBe(403);
      const data = JSON.parse(res.payload);
      expect(data.error).toBe('FORBIDDEN_ROLE_FOR_PAYMENT');
      expect(data.message).toBe('Tu rol no tiene permisos para procesar cobros en caja.');

      // 3. Verificar evento inmutable UNAUTHORIZED_PAYMENT_ATTEMPT en audit_events
      const audit = rawDb.prepare(`
        SELECT * FROM audit_events 
        WHERE action = 'UNAUTHORIZED_PAYMENT_ATTEMPT' AND entity_id = ?
        ORDER BY created_at_ms DESC LIMIT 1
      `).get(orderId) as any;
      expect(audit).toBeDefined();
      expect(audit.actor_user_id).toBe('usr_mesero');
    });

    it('Usuario con rol cocinero intenta POST /api/orders/:id/pay -> 403 Forbidden', async () => {
      const now = Date.now();
      const orderId = `ord_rbac_coc_${now}`;
      rawDb.prepare(`
        INSERT INTO orders (
          id, jornada_id, order_number, fulfillment_type, payment_status, fulfillment_status,
          gross_food_subtotal_usd_cents, net_food_sales_usd_cents, total_to_collect_usd_cents,
          rate_micro_bs, created_by_user_id, created_at_ms, updated_at_ms
        ) VALUES (?, 'jor_m18_test', 902, 'salon', 'sin_pago', 'pendiente', 800, 800, 800, 40000000, 'usr_plancha', ?, ?)
      `).run(orderId, now, now);

      const res = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderId}/pay`,
        headers: { authorization: `Bearer ${cocineroToken}`, 'x-user-id': 'usr_plancha' },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: 800 }]
        }
      });

      expect(res.statusCode).toBe(403);
      const data = JSON.parse(res.payload);
      expect(data.error).toBe('FORBIDDEN_ROLE_FOR_PAYMENT');
    });

    it('Usuario con rol cajera invoca POST /api/orders/:id/pay -> 200 OK y cobra la orden', async () => {
      const now = Date.now();
      const orderId = `ord_rbac_caj_${now}`;
      rawDb.prepare(`
        INSERT INTO orders (
          id, jornada_id, order_number, fulfillment_type, payment_status, fulfillment_status,
          gross_food_subtotal_usd_cents, net_food_sales_usd_cents, total_to_collect_usd_cents,
          rate_micro_bs, created_by_user_id, created_at_ms, updated_at_ms
        ) VALUES (?, 'jor_m18_test', 903, 'salon', 'sin_pago', 'pendiente', 1000, 1000, 1000, 40000000, 'usr_cajera', ?, ?)
      `).run(orderId, now, now);

      const res = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderId}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: 1000 }]
        }
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.success).toBe(true);
      expect(data.order.payment_status).toBe('pagado');
    });

    it('No-regresión: Petición /pay sin cabecera de sesión utiliza el cajero de la sesión activa y no rompe tests legacy', async () => {
      const now = Date.now();
      const orderId = `ord_rbac_leg_${now}`;
      rawDb.prepare(`
        INSERT INTO orders (
          id, jornada_id, order_number, fulfillment_type, payment_status, fulfillment_status,
          gross_food_subtotal_usd_cents, net_food_sales_usd_cents, total_to_collect_usd_cents,
          rate_micro_bs, created_by_user_id, created_at_ms, updated_at_ms
        ) VALUES (?, 'jor_m18_test', 904, 'salon', 'sin_pago', 'pendiente', 500, 500, 500, 40000000, 'usr_cajera', ?, ?)
      `).run(orderId, now, now);

      const res = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderId}/pay`,
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: 500 }]
        }
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.success).toBe(true);
    });
  });

  // ==========================================================================
  // BLOQUE 2: HIDRATACIÓN DE LÍNEAS Y CONTEO REAL EN GET /api/orders (HALLAZGO B.1)
  // ==========================================================================
  describe('Bloque 2: Hidratación de Líneas y Conteo Real de Platos en GET /api/orders', () => {
    it('GET /api/orders hidrata lines, modificadores, comboChildren y itemsCount === 3 para orden combinada', async () => {
      // Crear orden vía POST /api/orders
      // Hamburguesa Miami ($6.90) con Sin Pan
      // Combo Clásico ($7.90) con Doritos Dog + Brazil Dog
      // Malta ($1.50)
      const resCreate = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tableNumber: 'Mesa 4',
          fulfillmentType: 'salon',
          lines: [
            {
              productId: 'prod_miami',
              quantity: 1,
              modifiers: [
                { ingredientName: 'Sin Pan', modifierType: 'SIN_INGREDIENTE', extraPriceUsdCents: 0 }
              ]
            },
            {
              productId: 'prod_combo_clasico',
              quantity: 1,
              comboChildren: [
                { productId: 'prod_doritos_dog_snacks' },
                { productId: 'prod_brazil_dog' }
              ]
            },
            {
              productId: 'prod_malta_lata_250',
              quantity: 1
            }
          ]
        }
      });

      expect(resCreate.statusCode).toBe(201);
      const createdOrder = JSON.parse(resCreate.payload).order;
      const orderId = createdOrder.id;

      // Consultar GET /api/orders
      const resList = await app.inject({
        method: 'GET',
        url: '/api/orders'
      });

      expect(resList.statusCode).toBe(200);
      const listData = JSON.parse(resList.payload);
      expect(listData.orders).toBeDefined();

      const foundOrder = listData.orders.find((o: any) => o.id === orderId);
      expect(foundOrder).toBeDefined();

      // itemsCount debe ser exactamente 3 (nunca 0)
      expect(foundOrder.itemsCount).toBe(3);

      // lines debe estar hidratado con las 3 líneas principales facturables
      expect(Array.isArray(foundOrder.lines)).toBe(true);
      expect(foundOrder.lines.length).toBe(3);

      // Línea 1: Miami Burger con modificador Sin Pan
      const miamiLine = foundOrder.lines.find((l: any) => l.product_id === 'prod_miami');
      expect(miamiLine).toBeDefined();
      expect(miamiLine.quantity).toBe(1);
      expect(miamiLine.modifiers.length).toBeGreaterThanOrEqual(1);
      expect(miamiLine.modifiers.some((m: any) => m.name.includes('Sin Pan'))).toBe(true);

      // Línea 2: Combo Clásico con comboChildren (Doritos Dog + Brazil Dog)
      const comboLine = foundOrder.lines.find((l: any) => l.product_id === 'prod_combo_clasico');
      expect(comboLine).toBeDefined();
      expect(comboLine.quantity).toBe(1);
      expect(comboLine.comboChildren).toBeDefined();
      expect(comboLine.comboChildren.length).toBe(2);
      expect(comboLine.comboChildren.some((c: any) => c.product_id === 'prod_doritos_dog_snacks')).toBe(true);
      expect(comboLine.comboChildren.some((c: any) => c.product_id === 'prod_brazil_dog')).toBe(true);

      // Línea 3: Malta
      const maltaLine = foundOrder.lines.find((l: any) => l.product_id === 'prod_malta_lata_250');
      expect(maltaLine).toBeDefined();
      expect(maltaLine.quantity).toBe(1);
    });
  });

  // ==========================================================================
  // BLOQUE 3: SIMULACIÓN LIMPIA DE COLA TÉRMICA EN MACOS / DEV (HALLAZGO E)
  // ==========================================================================
  describe('Bloque 3: Compatibilidad de Impresión en macOS / Entorno de Simulación Limpia', () => {
    it('Trabajo windows_raw en macOS o con PRINTER_DEV_SIMULATION=true se procesa sin error como impreso', async () => {
      const worker = new PrintingWorker(rawDb);
      const now = Date.now();
      const jobId = `job_test_darwin_${now}`;
      const printerId = 'prn_test_darwin';

      // Insertar impresora con windows_raw
      rawDb.prepare(`
        INSERT OR IGNORE INTO printers (id, name, connection_type, address, is_active)
        VALUES (?, 'Impresora Windows RAW Dev', 'windows_raw', 'Tocineta_Thermal_Fake', 1)
      `).run(printerId);

      // Insertar trabajo de impresión en cola
      rawDb.prepare(`
        INSERT INTO print_jobs (
          id, printer_id, job_type, payload_bytes, ticket_ir_json, status, attempts, max_attempts, created_at_ms
        ) VALUES (?, ?, 'NOTA_ENTREGA', ?, '{"title":"TEST TICKET"}', 'en_cola', 0, 3, ?)
      `).run(jobId, printerId, Buffer.from('ESC/POS BYTES'), now);

      const jobRow = rawDb.prepare('SELECT pj.*, p.connection_type, p.address, p.name as printer_name FROM print_jobs pj JOIN printers p ON pj.printer_id = p.id WHERE pj.id = ?').get(jobId) as any;

      // Ejecutar el trabajo
      await worker.executePrintJob(jobRow);

      // El trabajo debe haber quedado en 'impreso' sin arrojar error ni requerir atención
      const updatedJob = rawDb.prepare('SELECT status, error_message, ticket_ir_json FROM print_jobs WHERE id = ?').get(jobId) as any;
      expect(updatedJob.status).toBe('impreso');
      expect(updatedJob.error_message).toBeNull();
      expect(updatedJob.ticket_ir_json).toBe('{"title":"TEST TICKET"}');
    });
  });

  // ==========================================================================
  // BLOQUE 4: VERIFICACIÓN DE CONTRATOS FUENTE EN FRONTEND (A.2, B.1, B.2, B.3)
  // ==========================================================================
  describe('Bloque 4: Verificación de Contratos de Código Fuente en Frontend (@tocineta/web)', () => {
    it('1. App.tsx y AppLayout.tsx definen mapas de tabs por rol, reset en logout y RoleGuard para Caja', () => {
      const appSource = readWebSource('App.tsx');
      const layoutSource = readWebSource('components/AppLayout.tsx');

      // Mapa canónico de tabs por rol
      expect(appSource).toContain('ALLOWED_TABS_BY_ROLE');
      expect(appSource).toContain('DEFAULT_TAB_BY_ROLE');
      expect(appSource).toContain('canUserProcessPayments');

      // queryClient.clear() debe ser invocado en logout o cambio de usuario
      expect(appSource + layoutSource).toContain('queryClient.clear()');

      // mesonero no debe tener acceso a cashier
      expect(appSource).toMatch(/mesonero:\s*\[[^\]]*'pos'[^\]]*\]/);
      expect(appSource).not.toMatch(/mesonero:\s*\[[^\]]*'cashier'/);

      // RoleGuard o redirección al intentar acceder a caja sin rol autorizado
      expect(appSource).toMatch(/canUserProcessPayments\s*\(/);
    });

    it('2. CashierView.tsx contiene acordeón desplegable y conteo real de platos con itemsCount', () => {
      const cashierSource = readWebSource('features/cashier/CashierView.tsx');

      // Conteo de platos usando itemsCount
      expect(cashierSource).toContain('itemsCount');

      // Acordeón desplegable para ver desglose de productos
      expect(cashierSource).toMatch(/toggleAccordion|expandedOrder|acorde|desglose/i);
      expect(cashierSource).toContain('comboChildren');
    });

    it('3. MultiMethodCalculator.tsx incluye botón rápido de Vuelto en Bolívares y oculta propina cuando vuelto es exacto', () => {
      const calcSource = readWebSource('features/cashier/MultiMethodCalculator.tsx');

      // Botón rápido en Bolívares
      expect(calcSource).toMatch(/Entregar todo el vuelto en Bolívares/i);
      expect(calcSource).toMatch(/Entregar todo el vuelto en USD/i);

      // Condición de excedente / propina
      expect(calcSource).toContain('unreturnedSurplusUsdCents');
      expect(calcSource).toMatch(/unreturnedSurplusUsdCents\s*>\s*1/);
    });
  });
});
