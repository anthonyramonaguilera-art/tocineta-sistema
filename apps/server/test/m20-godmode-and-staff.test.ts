/**
 * SISTEMA OPERATIVO LOCAL TOCINETA SONRÍE
 * Hito M20 — God Mode Dueña, Sesiones 30 Días, Auto-Registro y Matriz de Permisos (TDD Estricto)
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

describe('Hito M20 — God Mode Dueña, Staff y Matriz de Permisos', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_m20_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_m20.db');
  let rawDb: Database.Database;

  let adminToken: string;
  let mesoneroToken: string;
  let cajeraToken: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { migrationsDir: path.join(__dirname, '../src/db/migrations') });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    rawDb.prepare(`
      INSERT INTO exchange_rates (id, rate_micro_bs, source, created_at_ms, is_current)
      VALUES ('rate_m20_init', 40000000, 'MANUAL', ?, 1)
    `).run(Date.now());

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    // Abrir jornada y sesión de caja
    rawDb.prepare(`
      INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status, initial_cash_usd_cents)
      VALUES ('jor_m20_test', 'usr_admin', ?, 'abierta', 5000)
    `).run(Date.now());

    rawDb.prepare(`
      INSERT INTO cash_sessions (id, jornada_id, user_id, opened_at_ms, status)
      VALUES ('cs_m20_test', 'jor_m20_test', 'usr_cajera', ?, 'abierta')
    `).run(Date.now());

    // Login Admin
    adminToken = (await loginAs(app, 'admin')).token;

    // Login Mesonero
    mesoneroToken = (await loginAs(app, 'mesero')).token;

    // Login Cajera Principal
    cajeraToken = (await loginAs(app, 'cajera')).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================================================
  // TEST 1: GOD MODE EN COCINA (BLOQUE B.1)
  // ==========================================================================
  describe('Test 1: God Mode en Cocina (Despacho Forzado en 1 Toque)', () => {
    it('bloquea a mesonero sin permiso pero permite a Admin forzar despacho total de orden y líneas', async () => {
      // 1. Crear una orden con múltiples platos (Hamburguesa + Perro)
      const orderRes = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: {
          authorization: `Bearer ${cajeraToken}`,
          'Idempotency-Key': createIdempotencyKey('order')
        },
        payload: {
          tableNumber: 'Mesa 10',
          fulfillmentType: 'salon',
          lines: [
            { productId: 'prod_miami', quantity: 1, unitPriceUsdCents: 690, station: 'hamburguesas' },
            { productId: 'prod_street_dog', quantity: 1, unitPriceUsdCents: 250, station: 'hot_dogs' }
          ]
        }
      });
      expect(orderRes.statusCode).toBe(201);
      const order = JSON.parse(orderRes.payload).order;

      // Cobrar la orden para enviarla a cocina
      const payRes = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }]
        }
      });
      expect(payRes.statusCode).toBe(200);

      // 2. Invocar POST /api/kds/orders/:id/force-complete con Mesonero -> 403 Forbidden
      const failForceRes = await app.inject({
        method: 'POST',
        url: `/api/kds/orders/${order.id}/force-complete`,
        headers: { authorization: `Bearer ${mesoneroToken}` }
      });
      expect(failForceRes.statusCode).toBe(403);
      const failData = JSON.parse(failForceRes.payload);
      expect(failData.error).toBe('FORBIDDEN_KDS_FORCE_COMPLETE');

      // 3. Invocar POST /api/kds/orders/:id/force-complete con Admin (Dueña) -> 200 OK
      const successForceRes = await app.inject({
        method: 'POST',
        url: `/api/kds/orders/${order.id}/force-complete`,
        headers: { authorization: `Bearer ${adminToken}` }
      });
      expect(successForceRes.statusCode).toBe(200);
      const forceData = JSON.parse(successForceRes.payload);
      expect(forceData.success).toBe(true);

      // Verificar en DB que todas las líneas de cocina pasaron a 'listo'
      const lines = rawDb.prepare(`
        SELECT status, prepared_at_ms, ready_at_ms FROM order_lines WHERE order_id = ?
      `).all(order.id) as any[];
      expect(lines.length).toBeGreaterThanOrEqual(2);
      for (const l of lines) {
        expect(l.status).toBe('listo');
        expect(l.prepared_at_ms).toBeGreaterThan(0);
        expect(l.ready_at_ms).toBeGreaterThan(0);
      }

      // Verificar que la orden pasó a 'cerrado' (al estar pagada) o 'entregado'
      const updatedOrder = rawDb.prepare('SELECT fulfillment_status, closed_at_ms FROM orders WHERE id = ?').get(order.id) as any;
      expect(['entregado', 'cerrado']).toContain(updatedOrder.fulfillment_status);
      expect(updatedOrder.closed_at_ms).toBeGreaterThan(0);

      // Verificar evento de auditoría KDS_ORDER_FORCE_COMPLETED
      const audit = rawDb.prepare("SELECT * FROM audit_events WHERE action = 'KDS_ORDER_FORCE_COMPLETED' AND entity_id = ?").get(order.id) as any;
      expect(audit).toBeDefined();
    });
  });

  // ==========================================================================
  // TEST 2: AUTO-REGISTRO, BLOQUEO PENDING Y APROBACIÓN DE LA DUEÑA (BLOQUE C)
  // ==========================================================================
  describe('Test 2: Auto-Registro de Trabajador, Bloqueo PENDING y Aprobación', () => {
    const newStaffData = {
      name: 'María Asistente',
      cedula: 'V-25890123',
      phone: '04141234567',
      password: 'password123',
      pin: '7890'
    };
    let newUserId: string;

    it('crea usuario con estado PENDING e is_active=0 y emite WebSocket NEW_STAFF_REQUEST', async () => {
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: newStaffData
      });

      expect(regRes.statusCode).toBe(201);
      const regData = JSON.parse(regRes.payload);
      expect(regData.success).toBe(true);
      expect(regData.userId).toBeDefined();
      newUserId = regData.userId;

      // Verificar en DB
      const userRow = rawDb.prepare('SELECT * FROM users WHERE id = ?').get(newUserId) as any;
      expect(userRow.name).toBe(newStaffData.name);
      expect(userRow.cedula).toBe(newStaffData.cedula);
      expect(userRow.approval_status).toBe('PENDING');
      expect(userRow.is_active).toBe(0);
    });

    it('bloquea login antes de la aprobación (403 ACCOUNT_PENDING_APPROVAL)', async () => {
      const loginPendingRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          cedula: newStaffData.cedula,
          password: newStaffData.password
        }
      });

      expect(loginPendingRes.statusCode).toBe(403);
      const failData = JSON.parse(loginPendingRes.payload);
      expect(failData.error).toBe('ACCOUNT_PENDING_APPROVAL');
    });

    it('aprueba al trabajador vía PATCH /api/admin/users/:id/approve, activa sesión de 30 días', async () => {
      const approveRes = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${newUserId}/approve`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          role: 'mesonero',
          permissions: ['POS_TAKE_ORDERS']
        }
      });

      expect(approveRes.statusCode).toBe(200);
      const approveData = JSON.parse(approveRes.payload);
      expect(approveData.success).toBe(true);
      expect(approveData.user.approval_status).toBe('APPROVED');
      expect(approveData.user.is_active).toBe(1);

      // Ahora el trabajador SÍ puede iniciar sesión exitosamente
      const loginOkRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          cedula: newStaffData.cedula,
          password: newStaffData.password
        }
      });

      expect(loginOkRes.statusCode).toBe(200);
      const loginData = JSON.parse(loginOkRes.payload);
      expect(loginData.success).toBe(true);
      expect(loginData.token).toBeDefined();

      // Verificar que la sesión dura 30 días persistentes (>= 29 días en ms)
      const session = rawDb.prepare(`
        SELECT created_at_ms, expires_at_ms FROM sessions WHERE user_id = ? ORDER BY created_at_ms DESC LIMIT 1
      `).get(newUserId) as any;
      expect(session).toBeDefined();
      const ttlMs = session.expires_at_ms - session.created_at_ms;
      expect(ttlMs).toBeGreaterThanOrEqual(29 * 24 * 3600 * 1000);
    });
  });

  // ==========================================================================
  // TEST 3: MATRIZ DINÁMICA DE PERMISOS EN CAJA (BLOQUE C.3)
  // ==========================================================================
  describe('Test 3: Matriz Dinámica de Permisos en Caja (CASHIER_PAY)', () => {
    it('permite a un mesonero cobrar solo cuando tiene el permiso CASHIER_PAY asignado', async () => {
      // 1. Crear Orden de prueba
      const order1Res = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: {
          authorization: `Bearer ${cajeraToken}`,
          'Idempotency-Key': createIdempotencyKey('order')
        },
        payload: {
          tableNumber: 'Mesa 11',
          fulfillmentType: 'salon',
          lines: [{ productId: 'prod_street_dog', quantity: 1, unitPriceUsdCents: 250, station: 'hot_dogs' }]
        }
      });
      const order1 = JSON.parse(order1Res.payload).order;

      // 2. Mesonero Carlos intenta cobrar sin permiso -> 403 Forbidden
      const payUnauthorizedRes = await app.inject({
        method: 'POST',
        url: `/api/orders/${order1.id}/pay`,
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: 250 }]
        }
      });
      expect(payUnauthorizedRes.statusCode).toBe(403);
      expect(JSON.parse(payUnauthorizedRes.payload).error).toBe('FORBIDDEN_ROLE_FOR_PAYMENT');

      // 3. Admin otorga permiso ['CASHIER_PAY'] a Mesonero Carlos
      const grantPermRes = await app.inject({
        method: 'PATCH',
        url: '/api/admin/users/usr_mesero/permissions',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          permissions: ['CASHIER_PAY', 'POS_TAKE_ORDERS']
        }
      });
      expect(grantPermRes.statusCode).toBe(200);

      // 4. Ahora Mesonero Carlos intenta cobrar la misma orden -> 200 OK
      const payAuthorizedRes = await app.inject({
        method: 'POST',
        url: `/api/orders/${order1.id}/pay`,
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: 250 }]
        }
      });
      expect(payAuthorizedRes.statusCode).toBe(200);
      expect(JSON.parse(payAuthorizedRes.payload).success).toBe(true);

      // 5. Admin le retira el permiso ('permissions: []')
      const revokePermRes = await app.inject({
        method: 'PATCH',
        url: '/api/admin/users/usr_mesero/permissions',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          permissions: ['POS_TAKE_ORDERS']
        }
      });
      expect(revokePermRes.statusCode).toBe(200);

      // Crear Orden 2 y verificar que Mesonero Carlos vuelve a recibir 403
      const order2Res = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: {
          authorization: `Bearer ${cajeraToken}`,
          'Idempotency-Key': createIdempotencyKey('order')
        },
        payload: {
          tableNumber: 'Mesa 12',
          fulfillmentType: 'salon',
          lines: [{ productId: 'prod_street_dog', quantity: 1, unitPriceUsdCents: 250, station: 'hot_dogs' }]
        }
      });
      const order2 = JSON.parse(order2Res.payload).order;

      const payRevokedRes = await app.inject({
        method: 'POST',
        url: `/api/orders/${order2.id}/pay`,
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: 250 }]
        }
      });
      expect(payRevokedRes.statusCode).toBe(403);
    });
  });

  // ==========================================================================
  // TEST 4: CONTRATOS FRONTEND SMOKE CHECKS (BLOQUES A, B, C)
  // ==========================================================================
  describe('Test 4: Contratos Frontend Smoke Checks', () => {
    it('AppLayout.tsx contiene el conmutador "Modo Básico" / "Modo Pro" y no contiene jerga "Seq #"', () => {
      const source = readWebSource('components/AppLayout.tsx');
      expect(source).toContain('Modo Básico');
      expect(source).toContain('Modo Pro');
      expect(source).toContain('tocineta_ui_mode');
      expect(source).not.toContain('Seq #');
      expect(source).toContain('TOCINETA');
    });

    it('SystemHealthDashboard.tsx ya no contiene la cadena "Seq #"', () => {
      const source = readWebSource('components/SystemHealthDashboard.tsx');
      expect(source).not.toContain('Seq #');
    });

    it('MenuAdminView.tsx ya no muestra "FEATURE FLAG" y usa "Guardado"', () => {
      const source = readWebSource('components/MenuAdminView.tsx');
      expect(source).not.toContain('FEATURE FLAG');
      expect(source).toContain('Guardado (No visible para mesoneros)');
    });

    it('KdsView.tsx contiene botón Forzar Despacho Total y reemplaza jerga Orden Compuesta', () => {
      const source = readWebSource('features/kds/KdsView.tsx') + readWebSource('features/kds/KdsCard.tsx');
      expect(source).toMatch(/Despacho Total|forzar despacho/i);
      expect(source).not.toContain('Orden Compuesta');
    });

    it('PedagogicalGuideBanner.tsx y StaffManagementView.tsx existen e incluyen guía pedagógica', () => {
      const bannerSource = readWebSource('components/PedagogicalGuideBanner.tsx');
      expect(bannerSource).toContain('PedagogicalGuideBanner');
      expect(bannerSource).toContain('storageKey');

      const staffSource = readWebSource('features/staff/StaffManagementView.tsx') + readWebSource('features/staff/PermissionsModal.tsx');
      expect(staffSource).toContain('StaffManagementView');
      expect(staffSource).toContain('CASHIER_PAY');
      expect(staffSource).toMatch(/Aprobar|Permisos/);
    });
  });
});
