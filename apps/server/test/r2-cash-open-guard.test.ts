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
import { countDuplicateOpenSessions } from '../src/modules/cashier/cashier-service.js';

describe('T-04a: Control de apertura de sesión de caja única por jornada y sede', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_t04_guard_${Date.now()}`);
  const tempDb = path.join(tempDir, 't04_guard.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;
  let cajeraToken: string;

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
    // Cerrar cualquier jornada y sesión previa para garantizar aislamiento total por test
    rawDb.prepare("UPDATE cash_sessions SET status = 'cerrada' WHERE status = 'abierta'").run();
    rawDb.prepare("UPDATE jornadas SET status = 'cerrada' WHERE status = 'abierta'").run();
  });

  it('1. Mismo usuario llama 2 veces a abrir caja -> recibe la misma sesión (200)', async () => {
    // Abrir jornada previa
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

    // Primera llamada a abrir caja por cajera
    const resOpen1 = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        openingCashUsdCents: 5000,
        openingCashBsCents: 1000
      }
    });
    expect(resOpen1.statusCode).toBe(200);
    const session1 = resOpen1.json().cashSession;
    expect(session1.id).toBeDefined();
    expect(session1.status).toBe('abierta');

    // Segunda llamada con el mismo usuario (idempotente)
    const resOpen2 = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        openingCashUsdCents: 5000,
        openingCashBsCents: 1000
      }
    });
    expect(resOpen2.statusCode).toBe(200);
    const session2 = resOpen2.json().cashSession;
    expect(session2.id).toBe(session1.id);
  });

  it('2. Segundo usuario distinto en la misma jornada y sede intenta abrir caja -> 409 CASH_SESSION_ALREADY_OPEN con nombre del primer usuario', async () => {
    // Abrir jornada y caja con cajera (sede: loc_alta_vista por defecto)
    const resOpenCajera = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        openingCashUsdCents: 5000,
        openingCashBsCents: 1000
      }
    });
    expect(resOpenCajera.statusCode).toBe(200);

    // Segundo usuario (admin) intenta abrir caja en la misma sede y jornada
    const resOpenAdmin = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        openingCashUsdCents: 3000,
        openingCashBsCents: 500
      }
    });

    expect(resOpenAdmin.statusCode).toBe(409);
    const body = resOpenAdmin.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('CASH_SESSION_ALREADY_OPEN');
    expect(body.error).toContain('CAJERA');
    expect(body.message).toContain('CAJERA');
    expect(body.message).toBe('La caja ya está abierta por CAJERA. Debe cerrarse antes de abrir otra.');
  });

  it('3. Tras cerrar la sesión del primer usuario, el segundo usuario puede abrir caja con éxito', async () => {
    // Cajera abre sesión
    const resOpenCajera = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        openingCashUsdCents: 5000,
        openingCashBsCents: 1000
      }
    });
    expect(resOpenCajera.statusCode).toBe(200);
    const cajeraSessionId = resOpenCajera.json().cashSession.id;

    // Cerrar sesión de cajera
    rawDb.prepare("UPDATE cash_sessions SET status = 'cerrada' WHERE id = ?").run(cajeraSessionId);

    // Ahora admin puede abrir caja con éxito
    const resOpenAdmin = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        openingCashUsdCents: 6000,
        openingCashBsCents: 2000
      }
    });
    expect(resOpenAdmin.statusCode).toBe(200);
    const adminSession = resOpenAdmin.json().cashSession;
    expect(adminSession.id).toBeDefined();
    expect(adminSession.id).not.toBe(cajeraSessionId);
    expect(adminSession.status).toBe('abierta');
  });

  it('4. Sin jornada abierta previa, abrir caja abre la jornada y la sesión como hoy, persistiendo location_id correctamente', async () => {
    // Asegurar que no hay jornada abierta
    const openJornadas = rawDb.prepare("SELECT count(*) as cnt FROM jornadas WHERE status = 'abierta'").get() as any;
    expect(openJornadas.cnt).toBe(0);

    const resOpen = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        openingCashUsdCents: 4500,
        openingCashBsCents: 1200,
        locationId: 'loc_alta_vista'
      }
    });
    expect(resOpen.statusCode).toBe(200);
    const session = resOpen.json().cashSession;
    expect(session.id).toBeDefined();
    expect(session.status).toBe('abierta');

    // Verificar que se abrió una jornada automáticamente
    const jornadaInDb = rawDb.prepare("SELECT * FROM jornadas WHERE id = ?").get(session.jornada_id) as any;
    expect(jornadaInDb).toBeDefined();
    expect(jornadaInDb.status).toBe('abierta');

    // Verificar que location_id quedó persistido en la BD para esa sesión
    const sessionInDb = rawDb.prepare("SELECT * FROM cash_sessions WHERE id = ?").get(session.id) as any;
    expect(sessionInDb).toBeDefined();
    expect(sessionInDb.location_id).toBe('loc_alta_vista');
  });

  it('5. countDuplicateOpenSessions cuenta correctamente pares (jornada_id, location_id) duplicados', () => {
    // Al inicio no hay duplicados
    expect(countDuplicateOpenSessions(rawDb)).toBe(0);

    // Abrir una jornada
    const now = Date.now();
    const jorId = `jor_dup_test_${now}`;
    rawDb.prepare(`
      INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status, initial_cash_usd_cents, initial_cash_bs_cents)
      VALUES (?, 'usr_admin', ?, 'abierta', 0, 0)
    `).run(jorId, now);

    // Insertar 2 sesiones abiertas con la misma jornada y sede
    rawDb.prepare(`
      INSERT INTO cash_sessions (id, jornada_id, user_id, opened_at_ms, status, location_id, opening_cash_usd_cents, opening_cash_bs_cents)
      VALUES ('cs_dup_1', ?, 'usr_admin', ?, 'abierta', 'loc_alta_vista', 0, 0)
    `).run(jorId, now);

    rawDb.prepare(`
      INSERT INTO cash_sessions (id, jornada_id, user_id, opened_at_ms, status, location_id, opening_cash_usd_cents, opening_cash_bs_cents)
      VALUES ('cs_dup_2', ?, 'usr_cajera', ?, 'abierta', 'loc_alta_vista', 0, 0)
    `).run(jorId, now);

    expect(countDuplicateOpenSessions(rawDb)).toBe(1);

    // Cerrar una
    rawDb.prepare("UPDATE cash_sessions SET status = 'cerrada' WHERE id = 'cs_dup_1'").run();
    expect(countDuplicateOpenSessions(rawDb)).toBe(0);
  });
});
