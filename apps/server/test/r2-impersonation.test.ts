import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { buildServer } from '../src/server.js';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { hashToken } from '../src/routes/auth.js';
import { loginAs } from './test-helpers.js';

describe('R2-B — Anti-Impersonation Tests (P1-B Gap 1)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_impersonation_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_impersonation.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let cajeraHeaders: { authorization: string };
  let cajeraUserId: string;
  let testOrderId: string;
  let jornadaId: string;
  let cashSessionId: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    rawDb.prepare('UPDATE users SET must_change_pin = 0').run();

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    // Login as cajera
    const login = await loginAs(app, 'cajera');
    cajeraHeaders = login.headers;
    cajeraUserId = login.user.id;

    // Open jornada
    const resJornada = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: cajeraHeaders,
      payload: {
        rateMicroBs: 40_000_000,
        rateStr: '40.00'
      }
    });
    expect(resJornada.statusCode).toBe(200);
    const jData = JSON.parse(resJornada.payload);
    jornadaId = jData.jornada.id;

    // Open cash session
    const resSession = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: cajeraHeaders,
      payload: {
        openingCashUsdCents: 1000,
        openingCashBsCents: 0
      }
    });
    expect(resSession.statusCode).toBe(200);
    const sData = JSON.parse(resSession.payload);
    cashSessionId = sData.cashSession.id;

    // Seed an order ready to pay
    const now = Date.now();
    testOrderId = `ord_test_imp_${now}`;
    rawDb.prepare(`
      INSERT INTO orders (
        id, jornada_id, order_number, fulfillment_type, payment_status, fulfillment_status,
        gross_food_subtotal_usd_cents, net_food_sales_usd_cents, total_to_collect_usd_cents,
        rate_micro_bs, created_by_user_id, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 101, 'salon', 'sin_pago', 'pendiente', 1000, 1000, 1000, 40000000, ?, ?, ?)
    `).run(testOrderId, jornadaId, cajeraUserId, now, now);
  });

  afterAll(async () => {
    if (app) {
      app.server.closeAllConnections?.();
      await app.close();
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // (a) con token de cajera y cabecera x-user-id: usr_admin, el actor registrado en la auditoría/ledger es la cajera
  it('(a) cabecera x-user-id: usr_admin es ignorada; se registra la cajera autenticada en pagos y auditoría', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/orders/${testOrderId}/pay`,
      headers: {
        ...cajeraHeaders,
        'x-user-id': 'usr_admin'
      },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 1000 }]
      }
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.success).toBe(true);

    // Verificar en pagos: recorded_by_user_id
    const payment = rawDb.prepare('SELECT recorded_by_user_id FROM payments WHERE order_id = ?').get(testOrderId) as any;
    expect(payment).toBeDefined();
    expect(payment.recorded_by_user_id).toBe(cajeraUserId);
    expect(payment.recorded_by_user_id).not.toBe('usr_admin');

    // Verificar en auditoría: actor_user_id
    const audit = rawDb.prepare(`
      SELECT actor_user_id FROM audit_events 
      WHERE entity_id = ? AND action = 'ORDER_PAID'
      ORDER BY created_at_ms DESC LIMIT 1
    `).get(testOrderId) as any;
    expect(audit).toBeDefined();
    expect(audit.actor_user_id).toBe(cajeraUserId);
    expect(audit.actor_user_id).not.toBe('usr_admin');
  });

  // (b) sin token -> 401 en pay/open/close/my-performance
  describe('(b) peticiones sin token devuelven 401 Unauthorized', () => {
    it('POST /api/orders/:id/pay sin token -> 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/orders/${testOrderId}/pay`,
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: 1000 }]
        }
      });
      expect(res.statusCode).toBe(401);
    });

    it('POST /api/jornadas/open sin token -> 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/jornadas/open',
        payload: {
          rateMicroBs: 40_000_000
        }
      });
      expect(res.statusCode).toBe(401);
    });

    it('POST /api/cash-sessions/open sin token -> 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/cash-sessions/open',
        payload: {
          openingCashUsdCents: 500
        }
      });
      expect(res.statusCode).toBe(401);
    });

    it('POST /api/jornadas/:id/close sin token ni PIN supervisor -> 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/jornadas/${jornadaId}/close`,
        payload: {}
      });
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/reports/my-performance sin token -> 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/my-performance'
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // (c) sesión expirada -> 401 en cashier, closures y reports
  describe('(c) sesión expirada devuelve 401 en cashier, closures y reports', () => {
    const expiredToken = 'expired_session_token_123456';
    const expiredHeaders = { authorization: `Bearer ${expiredToken}` };

    beforeAll(() => {
      const pastTime = Date.now() - 3600_000;
      rawDb.prepare(`
        INSERT INTO sessions (id, user_id, token_hash, role, created_at_ms, last_activity_ms, expires_at_ms)
        VALUES ('sess_expired_test', 'usr_cajera', ?, 'cajera', ?, ?, ?)
      `).run(hashToken(expiredToken), pastTime - 10000, pastTime - 10000, pastTime);
    });

    it('cashier: POST /api/cash-sessions/open con sesión expirada -> 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/cash-sessions/open',
        headers: expiredHeaders,
        payload: {
          openingCashUsdCents: 500
        }
      });
      expect(res.statusCode).toBe(401);
    });

    it('cashier: POST /api/orders/:id/pay con sesión expirada -> 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/orders/${testOrderId}/pay`,
        headers: expiredHeaders,
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: 1000 }]
        }
      });
      expect(res.statusCode).toBe(401);
    });

    it('closures: POST /api/cash-sessions/:id/blind-count con sesión expirada -> 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/cash-sessions/${cashSessionId}/blind-count`,
        headers: expiredHeaders,
        payload: {
          cashUsdCents: 1000,
          cashBsCents: 0,
          ubiiVoucherBsCents: 0
        }
      });
      expect(res.statusCode).toBe(401);
    });

    it('closures: POST /api/jornadas/:id/close con sesión expirada -> 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/jornadas/${jornadaId}/close`,
        headers: expiredHeaders,
        payload: {}
      });
      expect(res.statusCode).toBe(401);
    });

    it('reports: GET /api/reports/my-performance con sesión expirada -> 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/my-performance',
        headers: expiredHeaders
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // (d) body con cashierUserId de otro usuario es ignorado
  it('(d) body con cashierUserId/userId de otro usuario es ignorado y prevalece la sesión autenticada', async () => {
    // Seed another order
    const now = Date.now();
    const orderId = `ord_test_body_imp_${now}`;
    rawDb.prepare(`
      INSERT INTO orders (
        id, jornada_id, order_number, fulfillment_type, payment_status, fulfillment_status,
        gross_food_subtotal_usd_cents, net_food_sales_usd_cents, total_to_collect_usd_cents,
        rate_micro_bs, created_by_user_id, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 102, 'salon', 'sin_pago', 'pendiente', 800, 800, 800, 40000000, ?, ?, ?)
    `).run(orderId, jornadaId, cajeraUserId, now, now);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: cajeraHeaders,
      payload: {
        cashierUserId: 'usr_admin',
        userId: 'usr_admin',
        actorUserId: 'usr_admin',
        tenders: [{ method: 'cash_usd', amountCents: 800 }]
      }
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.success).toBe(true);

    // Verificar en pagos: recorded_by_user_id
    const payment = rawDb.prepare('SELECT recorded_by_user_id FROM payments WHERE order_id = ?').get(orderId) as any;
    expect(payment).toBeDefined();
    expect(payment.recorded_by_user_id).toBe(cajeraUserId);
    expect(payment.recorded_by_user_id).not.toBe('usr_admin');

    // Verificar en auditoría: actor_user_id
    const audit = rawDb.prepare(`
      SELECT actor_user_id FROM audit_events 
      WHERE entity_id = ? AND action = 'ORDER_PAID'
      ORDER BY created_at_ms DESC LIMIT 1
    `).get(orderId) as any;
    expect(audit).toBeDefined();
    expect(audit.actor_user_id).toBe(cajeraUserId);
    expect(audit.actor_user_id).not.toBe('usr_admin');
  });
});
