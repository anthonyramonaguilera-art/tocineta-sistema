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
import { hashPin } from '../src/modules/auth/pin.js';
import { loginAs, ensureTestSupervisor } from './test-helpers.js';

describe('T-06a: Historial de cierres de caja por jornada (@tocineta/server)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_t06a_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_t06a.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;

  let adminToken = '';
  let cajeraAToken = '';
  let cajeraBToken = '';
  let mesoneroToken = '';

  const JORNADA_1_ID = 'jor_test_01';
  const JORNADA_2_ID = 'jor_test_02';
  const JORNADA_3_ID = 'jor_test_03';
  const JORNADA_4_ID = 'jor_test_04_open';

  const SESSION_1_ID = 'cs_test_01';
  const SESSION_2_ID = 'cs_test_02';
  const SESSION_3A_ID = 'cs_test_03a';
  const SESSION_3B_ID = 'cs_test_03b';
  const SESSION_4_ID = 'cs_test_04';

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { dbPath: tempDb });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureTestSupervisor(rawDb);

    // Crear segunda cajera (Cajera B)
    const { hash: pinHashB, salt: pinSaltB } = hashPin('1112');
    const now = Date.now();
    rawDb.prepare(`
      INSERT INTO users (
        id, name, username, role, pin_hash, pin_salt, pin_length,
        must_change_pin, is_active, failed_attempts, lockout_stage, created_at_ms, updated_at_ms
      ) VALUES (?, 'CAJERA B', 'cajera_b', 'cajera', ?, ?, 4, 0, 1, 0, 0, ?, ?)
    `).run('usr_cajera_b', pinHashB, pinSaltB, now, now);

    app = await buildServer({ disableStatic: true });

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    cajeraAToken = (await loginAs(app, 'cajera', rawDb)).token;
    mesoneroToken = (await loginAs(app, 'mesonero', rawDb)).token;

    const resLoginB = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_cajera_b', pin: '1112' }
    });
    cajeraBToken = resLoginB.json().token;

    // Poblar datos de prueba: 3 jornadas cerradas + 1 abierta
    // Jornada 1: Cerrada at 1_100_000. Cajera A solamente.
    rawDb.prepare(`
      INSERT INTO jornadas (id, location_id, opened_by_user_id, closed_by_user_id, opened_at_ms, closed_at_ms, status)
      VALUES (?, 'loc_alta_vista', 'usr_admin', 'usr_admin', 1000000, 1100000, 'cerrada')
    `).run(JORNADA_1_ID);

    rawDb.prepare(`
      INSERT INTO cash_sessions (id, location_id, jornada_id, user_id, opened_at_ms, closed_at_ms, status)
      VALUES (?, 'loc_alta_vista', ?, 'usr_cajera', 1000000, 1050000, 'cerrada')
    `).run(SESSION_1_ID, JORNADA_1_ID);

    rawDb.prepare(`
      INSERT INTO cash_session_method_counts (id, cash_session_id, method, currency, expected_cents, counted_cents, diff_cents, attempt, created_at_ms)
      VALUES ('csmc_1_1', ?, 'EFECTIVO_USD', 'USD', 1000, 1000, 0, 1, 1050000),
             ('csmc_1_2', ?, 'EFECTIVO_BS', 'BS', 50000, 50000, 0, 1, 1050000)
    `).run(SESSION_1_ID, SESSION_1_ID);

    rawDb.prepare(`
      INSERT INTO orders (id, order_number, location_id, jornada_id, cash_session_id, created_by_user_id, net_food_sales_usd_cents, rate_micro_bs, payment_status, fulfillment_status, created_at_ms, updated_at_ms)
      VALUES ('ord_1', 1, 'loc_alta_vista', ?, ?, 'usr_cajera', 1000, 40000000, 'pagado', 'entregado', 1020000, 1020000)
    `).run(JORNADA_1_ID, SESSION_1_ID);

    // Jornada 2: Cerrada at 2_100_000. Cajera B solamente con descuadre en último attempt.
    rawDb.prepare(`
      INSERT INTO jornadas (id, location_id, opened_by_user_id, closed_by_user_id, opened_at_ms, closed_at_ms, status)
      VALUES (?, 'loc_alta_vista', 'usr_admin', 'usr_admin', 2000000, 2100000, 'cerrada')
    `).run(JORNADA_2_ID);

    rawDb.prepare(`
      INSERT INTO cash_sessions (id, location_id, jornada_id, user_id, opened_at_ms, closed_at_ms, status)
      VALUES (?, 'loc_alta_vista', ?, 'usr_cajera_b', 2000000, 2050000, 'cerrada')
    `).run(SESSION_2_ID, JORNADA_2_ID);

    // Intento 1 con descuadre, Intento 2 persiste descuadre (diff_cents != 0)
    rawDb.prepare(`
      INSERT INTO cash_session_method_counts (id, cash_session_id, method, currency, expected_cents, counted_cents, diff_cents, attempt, created_at_ms)
      VALUES ('csmc_2_1', ?, 'EFECTIVO_USD', 'USD', 2000, 1800, -200, 1, 2040000),
             ('csmc_2_2', ?, 'EFECTIVO_USD', 'USD', 2000, 1900, -100, 2, 2050000),
             ('csmc_2_3', ?, 'EFECTIVO_BS', 'BS', 80000, 80000, 0, 2, 2050000)
    `).run(SESSION_2_ID, SESSION_2_ID, SESSION_2_ID);

    rawDb.prepare(`
      INSERT INTO orders (id, order_number, location_id, jornada_id, cash_session_id, created_by_user_id, net_food_sales_usd_cents, rate_micro_bs, payment_status, fulfillment_status, created_at_ms, updated_at_ms)
      VALUES ('ord_2', 2, 'loc_alta_vista', ?, ?, 'usr_cajera_b', 1500, 40000000, 'pagado', 'entregado', 2020000, 2020000)
    `).run(JORNADA_2_ID, SESSION_2_ID);

    // Jornada 3: Cerrada at 3_100_000. Cajera A y Cajera B.
    // Cajera A tuvo descuadre en attempt 1, pero se corrigió en attempt 2 (diff=0 -> hasDiff=false)
    rawDb.prepare(`
      INSERT INTO jornadas (id, location_id, opened_by_user_id, closed_by_user_id, opened_at_ms, closed_at_ms, status)
      VALUES (?, 'loc_alta_vista', 'usr_admin', 'usr_admin', 3000000, 3100000, 'cerrada')
    `).run(JORNADA_3_ID);

    rawDb.prepare(`
      INSERT INTO cash_sessions (id, location_id, jornada_id, user_id, opened_at_ms, closed_at_ms, status)
      VALUES (?, 'loc_alta_vista', ?, 'usr_cajera', 3000000, 3040000, 'cerrada'),
             (?, 'loc_alta_vista', ?, 'usr_cajera_b', 3050000, 3090000, 'cerrada')
    `).run(SESSION_3A_ID, JORNADA_3_ID, SESSION_3B_ID, JORNADA_3_ID);

    rawDb.prepare(`
      INSERT INTO cash_session_method_counts (id, cash_session_id, method, currency, expected_cents, counted_cents, diff_cents, attempt, created_at_ms)
      VALUES ('csmc_3a_1', ?, 'EFECTIVO_USD', 'USD', 3000, 2500, -500, 1, 3030000),
             ('csmc_3a_2', ?, 'EFECTIVO_USD', 'USD', 3000, 3000, 0, 2, 3040000),
             ('csmc_3b_1', ?, 'PUNTO_DE_VENTA', 'BS', 100000, 100000, 0, 1, 3090000)
    `).run(SESSION_3A_ID, SESSION_3A_ID, SESSION_3B_ID);

    // Órdenes: 2 pagadas válidas (2000 + 3000 = 5000 cents), 1 anulada (debe ignorarse)
    rawDb.prepare(`
      INSERT INTO orders (id, order_number, location_id, jornada_id, cash_session_id, created_by_user_id, net_food_sales_usd_cents, rate_micro_bs, payment_status, fulfillment_status, created_at_ms, updated_at_ms)
      VALUES ('ord_3_1', 3, 'loc_alta_vista', ?, ?, 'usr_cajera', 2000, 40000000, 'pagado', 'entregado', 3020000, 3020000),
             ('ord_3_2', 4, 'loc_alta_vista', ?, ?, 'usr_cajera_b', 3000, 40000000, 'pagado', 'entregado', 3060000, 3060000),
             ('ord_3_void', 5, 'loc_alta_vista', ?, ?, 'usr_cajera', 9999, 40000000, 'anulado', 'anulado', 3030000, 3030000)
    `).run(JORNADA_3_ID, SESSION_3A_ID, JORNADA_3_ID, SESSION_3B_ID, JORNADA_3_ID, SESSION_3A_ID);

    // Jornada 4: ABIERTA (opened at 4_000_000, closed_at_ms NULL, status 'abierta')
    rawDb.prepare(`
      INSERT INTO jornadas (id, location_id, opened_by_user_id, opened_at_ms, status)
      VALUES (?, 'loc_alta_vista', 'usr_admin', 4000000, 'abierta')
    `).run(JORNADA_4_ID);

    rawDb.prepare(`
      INSERT INTO cash_sessions (id, location_id, jornada_id, user_id, opened_at_ms, status)
      VALUES (?, 'loc_alta_vista', ?, 'usr_cajera', 4000000, 'abierta')
    `).run(SESSION_4_ID, JORNADA_4_ID);
  });

  afterAll(async () => {
    await app.close();
    try {
      const dbCtx = getDatabaseContext();
      dbCtx.rawDb.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('a) Cajera A solo ve sus propias jornadas y solo sus propias sesiones', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jornadas/history',
      headers: { authorization: `Bearer ${cajeraAToken}` }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBe(true);

    const jornadaIds = body.items.map((i: any) => i.jornadaId);
    // Cajera A tiene sesiones en Jornada 3 y Jornada 1. NO en Jornada 2.
    expect(jornadaIds).toContain(JORNADA_3_ID);
    expect(jornadaIds).toContain(JORNADA_1_ID);
    expect(jornadaIds).not.toContain(JORNADA_2_ID);

    // En Jornada 3, Cajera A SOLO debe ver su propia sesión (SESSION_3A_ID), NO la de Cajera B
    const item3 = body.items.find((i: any) => i.jornadaId === JORNADA_3_ID);
    expect(item3).toBeDefined();
    expect(item3.sessions).toHaveLength(1);
    expect(item3.sessions[0].sessionId).toBe(SESSION_3A_ID);
  });

  it('b) Admin ve todas las jornadas cerradas con todas las sesiones', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jornadas/history',
      headers: { authorization: `Bearer ${adminToken}` }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const jornadaIds = body.items.map((i: any) => i.jornadaId);

    // Admin ve las 3 jornadas cerradas
    expect(jornadaIds).toEqual([JORNADA_3_ID, JORNADA_2_ID, JORNADA_1_ID]);

    // En Jornada 3, Admin ve ambas sesiones
    const item3 = body.items.find((i: any) => i.jornadaId === JORNADA_3_ID);
    expect(item3.sessions).toHaveLength(2);
    const sessionIds = item3.sessions.map((s: any) => s.sessionId);
    expect(sessionIds).toContain(SESSION_3A_ID);
    expect(sessionIds).toContain(SESSION_3B_ID);

    // Totales de órdenes en Jornada 3 (2 pagadas, sin contar anulada)
    expect(item3.ordersCount).toBe(2);
    expect(item3.netSalesUsdCents).toBe(5000);
  });

  it('c) limit=2 + nextBefore devuelve la página siguiente sin repetir', async () => {
    // Primera página: limit=2
    const res1 = await app.inject({
      method: 'GET',
      url: '/api/jornadas/history?limit=2',
      headers: { authorization: `Bearer ${adminToken}` }
    });

    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.items).toHaveLength(2);
    expect(body1.items[0].jornadaId).toBe(JORNADA_3_ID);
    expect(body1.items[1].jornadaId).toBe(JORNADA_2_ID);
    expect(body1.nextBefore).toBe(2100000);

    // Segunda página: before=2100000
    const res2 = await app.inject({
      method: 'GET',
      url: `/api/jornadas/history?limit=2&before=${body1.nextBefore}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });

    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.items).toHaveLength(1);
    expect(body2.items[0].jornadaId).toBe(JORNADA_1_ID);
    expect(body2.nextBefore).toBeNull();

    // Sin repetición
    const page1Ids = body1.items.map((i: any) => i.jornadaId);
    const page2Ids = body2.items.map((i: any) => i.jornadaId);
    for (const id of page2Ids) {
      expect(page1Ids).not.toContain(id);
    }
  });

  it('d) limit=999 se acota a 50 sin error', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jornadas/history?limit=999',
      headers: { authorization: `Bearer ${adminToken}` }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeLessThanOrEqual(50);
    expect(body.items).toHaveLength(3);
  });

  it('e) Jornada abierta no aparece en el historial', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jornadas/history',
      headers: { authorization: `Bearer ${adminToken}` }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const jornadaIds = body.items.map((i: any) => i.jornadaId);
    expect(jornadaIds).not.toContain(JORNADA_4_ID);
  });

  it('f) hasDiff true solo si algún diff_cents != 0 en el último attempt', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jornadas/history',
      headers: { authorization: `Bearer ${adminToken}` }
    });

    const body = res.json();

    // Jornada 1: Cajera A cerró sin descuadre -> hasDiff false
    const item1 = body.items.find((i: any) => i.jornadaId === JORNADA_1_ID);
    expect(item1.sessions[0].hasDiff).toBe(false);

    // Jornada 2: Cajera B con descuadre en attempt 2 -> hasDiff true
    const item2 = body.items.find((i: any) => i.jornadaId === JORNADA_2_ID);
    expect(item2.sessions[0].hasDiff).toBe(true);

    // Jornada 3:
    // Session 3a (Cajera A): attempt 1 tenía diff, pero attempt 2 (último) cuadró exacto (diff=0) -> hasDiff false
    // Session 3b (Cajera B): attempt 1 cuadró exacto -> hasDiff false
    const item3 = body.items.find((i: any) => i.jornadaId === JORNADA_3_ID);
    const session3a = item3.sessions.find((s: any) => s.sessionId === SESSION_3A_ID);
    const session3b = item3.sessions.find((s: any) => s.sessionId === SESSION_3B_ID);

    expect(session3a.hasDiff).toBe(false);
    expect(session3b.hasDiff).toBe(false);
  });

  it('g) Validación de parámetros inválidos retorna 400', async () => {
    // limit no numérico
    const resInvalidLimit = await app.inject({
      method: 'GET',
      url: '/api/jornadas/history?limit=invalido',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(resInvalidLimit.statusCode).toBe(400);

    // limit negativo
    const resNegativeLimit = await app.inject({
      method: 'GET',
      url: '/api/jornadas/history?limit=-5',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(resNegativeLimit.statusCode).toBe(400);

    // before no numérico
    const resInvalidBefore = await app.inject({
      method: 'GET',
      url: '/api/jornadas/history?before=invalido',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(resInvalidBefore.statusCode).toBe(400);
  });
});
