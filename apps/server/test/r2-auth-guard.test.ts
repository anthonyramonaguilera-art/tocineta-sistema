import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as http from 'node:http';
import { Writable } from 'node:stream';
import { buildServer } from '../src/server.js';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { hashToken } from '../src/routes/auth.js';
import { hashPin } from '../src/modules/auth/pin.js';
import { safeReqSerializer, SAFE_LOGGER_REDACT } from '../src/plugins/auth-guard.js';
import { loginAs } from './test-helpers.js';

describe('R2 Auth Guard & Secure Logs', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_guard_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_guard.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  const originalEnforce = process.env.ENFORCE_AUTH;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    rawDb.prepare('UPDATE users SET must_change_pin = 0').run();

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      app.server.closeAllConnections?.();
      await app.close();
    }
    if (originalEnforce === undefined) {
      delete process.env.ENFORCE_AUTH;
    } else {
      process.env.ENFORCE_AUTH = originalEnforce;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(() => {
    process.env.ENFORCE_AUTH = 'true';
  });

  afterEach(() => {
    if (originalEnforce === undefined) {
      delete process.env.ENFORCE_AUTH;
    } else {
      process.env.ENFORCE_AUTH = originalEnforce;
    }
  });

  it('POST /api/fase3/setup-wizard/init-prod sin token -> 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fase3/setup-wizard/init-prod'
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.payload);
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('POST /api/fase3/setup-wizard/init-prod con token de mesero -> 403; con token de cajera -> 403', async () => {
    const mesero = await loginAs(app, 'mesero', rawDb);
    const resMesero = await app.inject({
      method: 'POST',
      url: '/api/fase3/setup-wizard/init-prod',
      headers: mesero.headers
    });
    expect(resMesero.statusCode).toBe(403);
    expect(JSON.parse(resMesero.payload).code).toBe('FORBIDDEN');

    const cajera = await loginAs(app, 'cajera', rawDb);
    const resCajera = await app.inject({
      method: 'POST',
      url: '/api/fase3/setup-wizard/init-prod',
      headers: cajera.headers
    });
    expect(resCajera.statusCode).toBe(403);
    expect(JSON.parse(resCajera.payload).code).toBe('FORBIDDEN');
  });

  it('GET /api/orders con sesión REVOCADA -> 401; EXPIRADA -> 401; is_active=0 -> 401', async () => {
    // 1. Sesión revocada
    const revoked = await loginAs(app, 'cajera', rawDb);
    rawDb
      .prepare('UPDATE sessions SET revoked_at_ms = ? WHERE token_hash = ?')
      .run(Date.now(), hashToken(revoked.token));

    const resRevoked = await app.inject({
      method: 'GET',
      url: '/api/orders',
      headers: revoked.headers
    });
    expect(resRevoked.statusCode).toBe(401);
    expect(JSON.parse(resRevoked.payload).code).toBe('UNAUTHENTICATED');

    // 2. Sesión expirada
    const expired = await loginAs(app, 'cajera', rawDb);
    rawDb
      .prepare('UPDATE sessions SET expires_at_ms = ? WHERE token_hash = ?')
      .run(Date.now() - 10000, hashToken(expired.token));

    const resExpired = await app.inject({
      method: 'GET',
      url: '/api/orders',
      headers: expired.headers
    });
    expect(resExpired.statusCode).toBe(401);
    expect(JSON.parse(resExpired.payload).code).toBe('UNAUTHENTICATED');

    // 3. Usuario inactivo (is_active = 0)
    const inactive = await loginAs(app, 'cajera', rawDb);
    rawDb.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(inactive.user.id);

    try {
      const resInactive = await app.inject({
        method: 'GET',
        url: '/api/orders',
        headers: inactive.headers
      });
      expect(resInactive.statusCode).toBe(401);
      expect(JSON.parse(resInactive.payload).code).toBe('UNAUTHENTICATED');
    } finally {
      rawDb.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(inactive.user.id);
    }
  });

  it('POST /api/orders/x/pay con token de mesero -> 403', async () => {
    const mesero = await loginAs(app, 'mesero', rawDb);
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders/x/pay',
      headers: mesero.headers
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).code).toBe('FORBIDDEN');
  });

  it('POST /api/auth/login y GET /api/menu/pos sin token -> NO 401/403', async () => {
    const resLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', pin: '123456' }
    });
    expect(resLogin.statusCode).not.toBe(401);
    expect(resLogin.statusCode).not.toBe(403);

    const resMenu = await app.inject({
      method: 'GET',
      url: '/api/menu/pos'
    });
    expect(resMenu.statusCode).not.toBe(401);
    expect(resMenu.statusCode).not.toBe(403);
  });

  it("Usuario con must_change_pin=1 llamando GET /api/orders -> 403 'PIN_CHANGE_REQUIRED'; llamando POST /api/auth/change-pin -> no bloqueado por el guard", async () => {
    const userSession = await loginAs(app, 'mesero', rawDb);
    rawDb.prepare('UPDATE users SET must_change_pin = 1 WHERE id = ?').run('usr_mesero');

    try {
      const resOrders = await app.inject({
        method: 'GET',
        url: '/api/orders',
        headers: userSession.headers
      });
      expect(resOrders.statusCode).toBe(403);
      const ordersBody = JSON.parse(resOrders.payload);
      expect(ordersBody.code).toBe('PIN_CHANGE_REQUIRED');

      const resChangePin = await app.inject({
        method: 'POST',
        url: '/api/auth/change-pin',
        headers: userSession.headers,
        payload: { currentPin: '2222', newPin: '8888' }
      });
      // El guard no debe bloquearlo con 403/PIN_CHANGE_REQUIRED
      expect(resChangePin.statusCode).not.toBe(403);
    } finally {
      rawDb.prepare('UPDATE users SET must_change_pin = 0 WHERE id = ?').run('usr_mesero');
      const { hash: pinHash, salt: pinSalt } = hashPin('2222');
      rawDb.prepare('UPDATE users SET pin_hash = ?, pin_salt = ? WHERE id = ?').run(pinHash, pinSalt, 'usr_mesero');
    }
  });

  it("Con ENFORCE_AUTH sin definir: GET /api/orders sin token NO devuelve 401 y emite 'auth-would-block'", async () => {
    delete process.env.ENFORCE_AUTH;

    const logs: string[] = [];
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        logs.push(chunk.toString());
        callback();
      }
    });

    const auditApp = await buildServer({
      disableStatic: true,
      logger: { level: 'warn', stream: logStream }
    });

    try {
      const res = await auditApp.inject({
        method: 'GET',
        url: '/api/orders'
      });
      expect(res.statusCode).not.toBe(401);
      const logText = logs.join('');
      expect(logText).toContain('auth-would-block');
    } finally {
      await auditApp.close();
    }
  });

  it('Logs: petición a /ws?token=SECRETO no deja SECRETO en stream de logs ni en server_errors', async () => {
    delete process.env.ENFORCE_AUTH;

    const logs: string[] = [];
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        logs.push(chunk.toString());
        callback();
      }
    });

    const safeLogApp = await buildServer({
      disableStatic: true,
      logger: {
        level: 'info',
        stream: logStream,
        redact: SAFE_LOGGER_REDACT,
        serializers: { req: safeReqSerializer }
      }
    });
    await safeLogApp.ready();

    try {
      await safeLogApp.inject({
        method: 'GET',
        url: '/ws?token=SECRETO_DE_PRUEBA'
      });

      // Provocar también un error de servidor con query string secreta
      await safeLogApp.inject({
        method: 'POST',
        url: '/api/fase3/setup-wizard/init-prod?token=SECRETO_DE_PRUEBA',
        headers: { authorization: 'Bearer SECRETO_DE_PRUEBA' },
        payload: { token: 'SECRETO_DE_PRUEBA', pin: '1234' }
      });

      const logText = logs.join('');
      expect(logText).not.toContain('SECRETO_DE_PRUEBA');

      const dbCtx = initSqlite(tempDb);
      const errorRows = dbCtx.rawDb
        .prepare("SELECT * FROM server_errors WHERE url LIKE '%SECRETO_DE_PRUEBA%' OR body_json LIKE '%SECRETO_DE_PRUEBA%'")
        .all();
      expect(errorRows).toEqual([]);
    } finally {
      await safeLogApp.close();
    }
  });

  it('WebSocket: con ENFORCE_AUTH=true conexión a /ws sin token es rechazada y con ?token= válido es aceptada', async () => {
    process.env.ENFORCE_AUTH = 'true';

    // 1. Sin token -> rechazada con HTTP 401 UNAUTHENTICATED por el guard en onRequest
    const resNoToken = await app.inject({
      method: 'GET',
      url: '/ws'
    });
    expect(resNoToken.statusCode).toBe(401);
    expect(JSON.parse(resNoToken.payload).code).toBe('UNAUTHENTICATED');

    // 2. Con token válido y must_change_pin = 0 -> aceptada por el guard (no 401 ni 403)
    rawDb.prepare('UPDATE users SET must_change_pin = 0 WHERE id = ?').run('usr_cajera');
    const cajera = await loginAs(app, 'cajera', rawDb);

    const resWithToken = await app.inject({
      method: 'GET',
      url: `/ws?token=${cajera.token}`
    });
    // El guard onRequest valida la sesión del WebSocket via query param y no bloquea
    expect(resWithToken.statusCode).not.toBe(401);
    expect(resWithToken.statusCode).not.toBe(403);
  });
});
