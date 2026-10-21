/**
 * SISTEMA OPERATIVO LOCAL TOCINETA SONRÍE
 * Hito M17 - Suite de Endurecimiento UX, Ergonomía Táctil y Robustez KDS/Caja/POS
 *
 * Bloque 1: Tests E2E Reales de Backend (app.inject contra Fastify y SQLite)
 * Bloque 2: Tests de Contrato de Código Fuente Frontend [SMOKE CHECK - SOURCE CONTRACT]
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

describe('Hito M17 - Endurecimiento UX, Táctil y Robustez Operativa (@tocineta/server & @tocineta/web)', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_m17_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_m17.db');
  let rawDb: Database.Database;

  let cajeraToken: string;
  let mesoneroToken: string;

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
      VALUES ('jor_m17_test', 'usr_cajera_principal', ?, 'abierta', 5000)
    `).run(Date.now());

    rawDb.prepare(`
      INSERT INTO cash_sessions (id, jornada_id, user_id, opened_at_ms, status)
      VALUES ('cs_m17_test', 'jor_m17_test', 'usr_cajera_principal', ?, 'abierta')
    `).run(Date.now());

    // Login cajera
    const resCajera = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_cajera_principal', pin: '1111' }
    });
    cajeraToken = JSON.parse(resCajera.payload).token;

    // Login mesonero
    const resMesonero = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_mesonero_carlos', pin: '2222' }
    });
    mesoneroToken = JSON.parse(resMesonero.payload).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================================================
  // BLOQUE 1: TESTS E2E REALES DE BACKEND
  // ==========================================================================
  describe('Bloque 1: Endurecimiento E2E de Backend (Fastify + SQLite)', () => {

    it('Test Backend 1 (H-01 API): Validación de longitud de PIN por rol en /api/auth/change-pin', async () => {
      // 1. Establecer must_change_pin = 1 para usr_mesonero_carlos
      rawDb.prepare(`UPDATE users SET must_change_pin = 1 WHERE id = 'usr_mesonero_carlos'`).run();

      // Login de mesonero con mustChangePin === true
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { userId: 'usr_mesonero_carlos', pin: '2222' }
      });
      expect(loginRes.statusCode).toBe(200);
      const loginData = JSON.parse(loginRes.payload);
      expect(loginData.user.mustChangePin).toBe(true);
      const mToken = loginData.token;

      // 2. Mesonero intenta enviar nuevo PIN de 6 dígitos -> 400 Bad Request
      const failChangeRes = await app.inject({
        method: 'POST',
        url: '/api/auth/change-pin',
        headers: { authorization: `Bearer ${mToken}` },
        payload: { currentPin: '2222', newPin: '123456' }
      });
      expect(failChangeRes.statusCode).toBe(400);
      const failData = JSON.parse(failChangeRes.payload);
      expect(failData.error).toContain('4 dígitos');

      // 3. Mesonero envía nuevo PIN de 4 dígitos -> 200 OK y must_change_pin pasa a 0
      const okChangeRes = await app.inject({
        method: 'POST',
        url: '/api/auth/change-pin',
        headers: { authorization: `Bearer ${mToken}` },
        payload: { currentPin: '2222', newPin: '4321' }
      });
      expect(okChangeRes.statusCode).toBe(200);
      expect(JSON.parse(okChangeRes.payload).success).toBe(true);

      const dbUser = rawDb.prepare(`SELECT must_change_pin FROM users WHERE id = 'usr_mesonero_carlos'`).get() as any;
      expect(dbUser.must_change_pin).toBe(0);

      // 4. Usuario admin envía PIN de 6 dígitos -> 200 OK
      const adminLoginRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { userId: 'usr_admin_olinelcys', pin: '123456' }
      });
      expect(adminLoginRes.statusCode).toBe(200);
      const adminToken = JSON.parse(adminLoginRes.payload).token;

      const adminChangeRes = await app.inject({
        method: 'POST',
        url: '/api/auth/change-pin',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { currentPin: '123456', newPin: '654321' }
      });
      expect(adminChangeRes.statusCode).toBe(200);
      expect(JSON.parse(adminChangeRes.payload).success).toBe(true);
    });

    describe('Test Backend 2 (H-03 API): Invariante KDS de Despacho Incompleto', () => {

      it('Caso A (Orden compuesta incompleta): /deliver retorna 409 Conflict hasta que todas las estaciones de cocina estén listas', async () => {
        // 1. Crear orden compuesta: 1x Hamburguesa Miami (hamburguesas) + 1x Doritos Dog (hot_dogs)
        const orderRes = await app.inject({
          method: 'POST',
          url: '/api/orders',
          headers: { authorization: `Bearer ${mesoneroToken}` },
          payload: {
            idempotencyKey: `idemp_comp_${Date.now()}`,
            fulfillmentType: 'salon',
            tableNumber: 'MESA-A',
            lines: [
              { productId: 'prod_miami', quantity: 1 },
              { productId: 'prod_doritos_dog_snacks', quantity: 1 }
            ]
          }
        });
        expect(orderRes.statusCode).toBe(201);
        const createdOrder = JSON.parse(orderRes.payload).order;
        const orderId = createdOrder.id;

        // Pagar la orden para que pase a KDS
        const payRes = await app.inject({
          method: 'POST',
          url: `/api/orders/${orderId}/pay`,
          headers: { authorization: `Bearer ${cajeraToken}` },
          payload: {
            tenders: [{ method: 'cash_usd', amountCents: createdOrder.total_to_collect_usd_cents }]
          }
        });
        expect(payRes.statusCode).toBe(200);

        // Obtener líneas de cocina
        const lines = rawDb.prepare(`SELECT id, station, status FROM order_lines WHERE order_id = ?`).all(orderId) as any[];
        const burgerLine = lines.find(l => l.station === 'hamburguesas');
        const dogLine = lines.find(l => l.station === 'hot_dogs');
        expect(burgerLine).toBeDefined();
        expect(dogLine).toBeDefined();

        // Marcar burgerLine como 'listo' y dogLine como 'preparando'
        await app.inject({
          method: 'POST',
          url: `/api/kds/lines/${burgerLine.id}/status`,
          payload: { status: 'listo' }
        });
        await app.inject({
          method: 'POST',
          url: `/api/kds/lines/${dogLine.id}/status`,
          payload: { status: 'preparando' }
        });

        // Consulta filtrada por estación hamburguesas
        const kdsRes = await app.inject({
          method: 'GET',
          url: '/api/kds/orders?station=hamburguesas'
        });
        expect(kdsRes.statusCode).toBe(200);
        const kdsOrders = JSON.parse(kdsRes.payload).orders;
        const matched = kdsOrders.find((o: any) => o.orderId === orderId);
        expect(matched).toBeDefined();
        expect(matched.allStationsReady).toBe(false);
        expect(matched.missingStations).toContain('hot_dogs');

        // Intentar entregar /deliver antes de que Hot Dogs esté listo -> 409 Conflict
        const deliverFailRes = await app.inject({
          method: 'POST',
          url: `/api/kds/orders/${orderId}/deliver`,
          payload: {}
        });
        expect(deliverFailRes.statusCode).toBe(409);
        const deliverFailData = JSON.parse(deliverFailRes.payload);
        expect(deliverFailData.error).toBe('ORDER_STATIONS_INCOMPLETE');

        // Marcar dogLine como 'listo'
        await app.inject({
          method: 'POST',
          url: `/api/kds/lines/${dogLine.id}/status`,
          payload: { status: 'listo' }
        });

        // Ahora /deliver debe retornar 200 OK
        const deliverOkRes = await app.inject({
          method: 'POST',
          url: `/api/kds/orders/${orderId}/deliver`,
          payload: {}
        });
        expect(deliverOkRes.statusCode).toBe(200);
        expect(JSON.parse(deliverOkRes.payload).success).toBe(true);
      });

      it('Caso B (Orden uniestación completa — CRÍTICO): Orden de 1 sola hamburguesa marcada lista permite /deliver con 200 OK', async () => {
        const orderRes = await app.inject({
          method: 'POST',
          url: '/api/orders',
          headers: { authorization: `Bearer ${mesoneroToken}` },
          payload: {
            idempotencyKey: `idemp_single_${Date.now()}`,
            fulfillmentType: 'salon',
            tableNumber: 'MESA-B',
            lines: [{ productId: 'prod_miami', quantity: 1 }]
          }
        });
        const createdOrder = JSON.parse(orderRes.payload).order;
        const orderId = createdOrder.id;

        const payRes = await app.inject({
          method: 'POST',
          url: `/api/orders/${orderId}/pay`,
          headers: { authorization: `Bearer ${cajeraToken}` },
          payload: { tenders: [{ method: 'cash_usd', amountCents: createdOrder.total_to_collect_usd_cents }] }
        });
        expect(payRes.statusCode).toBe(200);

        const lines = rawDb.prepare(`SELECT id FROM order_lines WHERE order_id = ?`).all(orderId) as any[];
        await app.inject({
          method: 'POST',
          url: `/api/kds/lines/${lines[0].id}/status`,
          payload: { status: 'listo' }
        });

        const kdsRes = await app.inject({
          method: 'GET',
          url: '/api/kds/orders'
        });
        const matched = JSON.parse(kdsRes.payload).orders.find((o: any) => o.orderId === orderId);
        expect(matched).toBeDefined();
        expect(matched.allStationsReady).toBe(true);
        expect(matched.missingStations).toHaveLength(0);

        const deliverRes = await app.inject({
          method: 'POST',
          url: `/api/kds/orders/${orderId}/deliver`,
          payload: {}
        });
        expect(deliverRes.statusCode).toBe(200);
      });

      it('Caso C (Regla de estaciones en Bebidas y Cortesías): caja_bebidas no bloquea /deliver; cortesía en hot_dogs sí bloquea si está pendiente', async () => {
        // Subcaso C1: 1x Hamburguesa Miami (listo) + 1x Malta (caja_bebidas en pendiente) -> 200 OK
        const orderC1Res = await app.inject({
          method: 'POST',
          url: '/api/orders',
          headers: { authorization: `Bearer ${mesoneroToken}` },
          payload: {
            idempotencyKey: `idemp_c1_${Date.now()}`,
            fulfillmentType: 'salon',
            tableNumber: 'MESA-C1',
            lines: [
              { productId: 'prod_miami', quantity: 1 },
              { productId: 'prod_malta_lata_250', quantity: 1 }
            ]
          }
        });
        const createdC1 = JSON.parse(orderC1Res.payload).order;
        const orderC1Id = createdC1.id;
        const payC1Res = await app.inject({
          method: 'POST',
          url: `/api/orders/${orderC1Id}/pay`,
          headers: { authorization: `Bearer ${cajeraToken}` },
          payload: { tenders: [{ method: 'cash_usd', amountCents: createdC1.total_to_collect_usd_cents }] }
        });
        expect(payC1Res.statusCode).toBe(200);

        const c1Lines = rawDb.prepare(`SELECT id, station FROM order_lines WHERE order_id = ?`).all(orderC1Id) as any[];
        const burgerC1 = c1Lines.find(l => l.station === 'hamburguesas');
        await app.inject({
          method: 'POST',
          url: `/api/kds/lines/${burgerC1.id}/status`,
          payload: { status: 'listo' }
        });

        // La malta sigue pendiente en caja_bebidas, pero /deliver debe completarse 200 OK
        const deliverC1Res = await app.inject({
          method: 'POST',
          url: `/api/kds/orders/${orderC1Id}/deliver`,
          payload: {}
        });
        expect(deliverC1Res.statusCode).toBe(200);

        // Subcaso C2: 1x Hamburguesa Miami (listo) + 1x COURTESY_ITEM en hot_dogs (pendiente) -> 409 Conflict
        const orderC2Res = await app.inject({
          method: 'POST',
          url: '/api/orders',
          headers: { authorization: `Bearer ${mesoneroToken}` },
          payload: {
            idempotencyKey: `idemp_c2_${Date.now()}`,
            fulfillmentType: 'salon',
            tableNumber: 'MESA-C2',
            couponCode: 'SNACKSGRATIS',
            lines: [{ productId: 'prod_miami', quantity: 1 }]
          }
        });
        const createdC2 = JSON.parse(orderC2Res.payload).order;
        const orderC2Id = createdC2.id;
        const payC2Res = await app.inject({
          method: 'POST',
          url: `/api/orders/${orderC2Id}/pay`,
          headers: { authorization: `Bearer ${cajeraToken}` },
          payload: { tenders: [{ method: 'cash_usd', amountCents: createdC2.total_to_collect_usd_cents }] }
        });
        expect(payC2Res.statusCode).toBe(200);

        const c2Lines = rawDb.prepare(`SELECT id, station, line_role FROM order_lines WHERE order_id = ?`).all(orderC2Id) as any[];
        const burgerC2 = c2Lines.find(l => l.station === 'hamburguesas');
        const courtesyC2 = c2Lines.find(l => l.line_role === 'COURTESY_ITEM');
        expect(courtesyC2).toBeDefined();
        expect(courtesyC2.station).toBe('hot_dogs');

        await app.inject({
          method: 'POST',
          url: `/api/kds/lines/${burgerC2.id}/status`,
          payload: { status: 'listo' }
        });

        // Como la cortesía está en hot_dogs y sigue pendiente, debe dar 409
        const deliverC2FailRes = await app.inject({
          method: 'POST',
          url: `/api/kds/orders/${orderC2Id}/deliver`,
          payload: {}
        });
        expect(deliverC2FailRes.statusCode).toBe(409);
        expect(JSON.parse(deliverC2FailRes.payload).error).toBe('ORDER_STATIONS_INCOMPLETE');

        // Al marcar la cortesía como 'listo', /deliver debe ser 200 OK
        await app.inject({
          method: 'POST',
          url: `/api/kds/lines/${courtesyC2.id}/status`,
          payload: { status: 'listo' }
        });
        const deliverC2OkRes = await app.inject({
          method: 'POST',
          url: `/api/kds/orders/${orderC2Id}/deliver`,
          payload: {}
        });
        expect(deliverC2OkRes.statusCode).toBe(200);

        // Subcaso C2 extra: Si la cortesía tiene station = 'caja_bebidas', no debe bloquear
        const orderC3Res = await app.inject({
          method: 'POST',
          url: '/api/orders',
          headers: { authorization: `Bearer ${mesoneroToken}` },
          payload: {
            idempotencyKey: `idemp_c3_${Date.now()}`,
            fulfillmentType: 'salon',
            tableNumber: 'MESA-C3',
            lines: [{ productId: 'prod_miami', quantity: 1 }]
          }
        });
        const createdC3 = JSON.parse(orderC3Res.payload).order;
        const orderC3Id = createdC3.id;
        // Inyectar manualmente una cortesía con station = 'caja_bebidas'
        rawDb.prepare(`
          INSERT INTO order_lines (id, order_id, product_id, line_role, station, quantity, unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, created_at_ms, status)
          VALUES ('line_courtesy_bebida', ?, 'prod_malta_lata_250', 'COURTESY_ITEM', 'caja_bebidas', 1, 0, 0, 0, ?, 'pendiente')
        `).run(orderC3Id, Date.now());

        const payC3Res = await app.inject({
          method: 'POST',
          url: `/api/orders/${orderC3Id}/pay`,
          headers: { authorization: `Bearer ${cajeraToken}` },
          payload: { tenders: [{ method: 'cash_usd', amountCents: createdC3.total_to_collect_usd_cents }] }
        });
        expect(payC3Res.statusCode).toBe(200);

        const c3Burger = rawDb.prepare(`SELECT id FROM order_lines WHERE order_id = ? AND station = 'hamburguesas'`).get(orderC3Id) as any;
        await app.inject({
          method: 'POST',
          url: `/api/kds/lines/${c3Burger.id}/status`,
          payload: { status: 'listo' }
        });

        // La cortesía en caja_bebidas NO debe bloquear /deliver
        const deliverC3Res = await app.inject({
          method: 'POST',
          url: `/api/kds/orders/${orderC3Id}/deliver`,
          payload: {}
        });
        expect(deliverC3Res.statusCode).toBe(200);
      });
    });

    it('Test Backend 3 (H-09 API): Revertir estado de línea (listo -> preparando) regresa la orden a en_preparacion y audita KDS_LINE_STATUS_REVERTED', async () => {
      const orderRes = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          idempotencyKey: `idemp_rev_${Date.now()}`,
          fulfillmentType: 'salon',
          tableNumber: 'MESA-REV',
          lines: [
            { productId: 'prod_miami', quantity: 1 },
            { productId: 'prod_doritos_dog_snacks', quantity: 1 }
          ]
        }
      });
      const createdRev = JSON.parse(orderRes.payload).order;
      const orderId = createdRev.id;

      const payRevRes = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderId}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: { tenders: [{ method: 'cash_usd', amountCents: createdRev.total_to_collect_usd_cents }] }
      });
      expect(payRevRes.statusCode).toBe(200);

      const lines = rawDb.prepare(`SELECT id FROM order_lines WHERE order_id = ?`).all(orderId) as any[];

      // Avanzar todas las líneas a 'listo'
      for (const l of lines) {
        await app.inject({
          method: 'POST',
          url: `/api/kds/lines/${l.id}/status`,
          payload: { status: 'listo' }
        });
      }

      // La orden padre debe estar en 'listo'
      const ordBefore = rawDb.prepare(`SELECT fulfillment_status FROM orders WHERE id = ?`).get(orderId) as any;
      expect(ordBefore.fulfillment_status).toBe('listo');

      // Revertir 1 línea a 'preparando'
      const revertRes = await app.inject({
        method: 'POST',
        url: `/api/kds/lines/${lines[0].id}/status`,
        payload: { status: 'preparando' }
      });
      expect(revertRes.statusCode).toBe(200);

      // 1. La línea debe estar en 'preparando'
      const lineAfter = rawDb.prepare(`SELECT status FROM order_lines WHERE id = ?`).get(lines[0].id) as any;
      expect(lineAfter.status).toBe('preparando');

      // 2. La orden padre debe regresar automáticamente a 'en_preparacion'
      const ordAfter = rawDb.prepare(`SELECT fulfillment_status FROM orders WHERE id = ?`).get(orderId) as any;
      expect(ordAfter.fulfillment_status).toBe('en_preparacion');

      // 3. audit_events debe registrar KDS_LINE_STATUS_REVERTED
      const auditEvt = rawDb.prepare(`
        SELECT action, payload_json FROM audit_events 
        WHERE action = 'KDS_LINE_STATUS_REVERTED' AND entity_id = ?
      `).get(lines[0].id) as any;
      expect(auditEvt).toBeDefined();
      expect(auditEvt.action).toBe('KDS_LINE_STATUS_REVERTED');
    });
  });

  // ==========================================================================
  // BLOQUE 2: TESTS DE CONTRATO DE CÓDIGO FUENTE FRONTEND
  // ==========================================================================
  describe('Bloque 2: [SMOKE CHECK - SOURCE CONTRACT] Verificación de Contratos Frontend', () => {

    it('[SMOKE CHECK - SOURCE CONTRACT] 1. components/AppLayout.tsx contiene requiredPinLength, admin y supervisor', () => {
      console.log('Ruta de ejecución Smoke:', __dirname, process.cwd());
      const src = readWebSource('components/AppLayout.tsx');
      expect(src).toContain('requiredPinLength');
      expect(src).toContain("'admin'");
      expect(src).toContain("'supervisor'");
    });

    it('[SMOKE CHECK - SOURCE CONTRACT] 2. features/cashier/CashierView.tsx contiene isError y Reintentar conexión', () => {
      const src = readWebSource('features/cashier/CashierView.tsx');
      expect(src).toContain('isError');
      expect(src).toContain('Reintentar conexión');
    });

    it('[SMOKE CHECK - SOURCE CONTRACT] 3. features/pos/PosComandero.tsx contiene min-h-[48px] y total dual USD/Bs', () => {
      const src = readWebSource('features/pos/PosComandero.tsx');
      const minHMatches = src.match(/min-h-\[48px\]/g) || [];
      expect(minHMatches.length).toBeGreaterThanOrEqual(2);
      expect(src).toMatch(/usdToBsCents/);
    });

    it('[SMOKE CHECK - SOURCE CONTRACT] 4. features/cashier/MultiMethodCalculator.tsx contiene Exacto USD y Exacto Bs.', () => {
      const src = readWebSource('features/cashier/MultiMethodCalculator.tsx');
      expect(src).toContain('Exacto USD');
      expect(src).toContain('Exacto Bs.');
    });

    it('[SMOKE CHECK - SOURCE CONTRACT] 5. features/kds/KdsView.tsx contiene allStationsReady, Revertir y min-h-[48px]', () => {
      const src = readWebSource('features/kds/KdsView.tsx');
      expect(src).toContain('allStationsReady');
      expect(src).toContain('Revertir');
      expect(src).toContain('min-h-[48px]');
    });
  });
});
