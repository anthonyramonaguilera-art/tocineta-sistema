import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
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

describe('R2 Session Validation Canonical (BUG-07)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_session_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_session.db');
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

  describe('POST /api/delivery/settle-driver', () => {
    it('sesión revocada -> 401', async () => {
      const auth = await loginAs(app, 'cajera', rawDb);
      rawDb
        .prepare('UPDATE sessions SET revoked_at_ms = ? WHERE token_hash = ?')
        .run(Date.now(), hashToken(auth.token));

      const res = await app.inject({
        method: 'POST',
        url: '/api/delivery/settle-driver',
        headers: auth.headers,
        payload: { driverId: 'drv_test' }
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNAUTHENTICATED');
    });

    it('sesión expirada -> 401', async () => {
      const auth = await loginAs(app, 'cajera', rawDb);
      rawDb
        .prepare('UPDATE sessions SET expires_at_ms = ? WHERE token_hash = ?')
        .run(Date.now() - 5000, hashToken(auth.token));

      const res = await app.inject({
        method: 'POST',
        url: '/api/delivery/settle-driver',
        headers: auth.headers,
        payload: { driverId: 'drv_test' }
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNAUTHENTICATED');
    });

    it('usuario desactivado (is_active = 0) -> 401', async () => {
      const auth = await loginAs(app, 'cajera', rawDb);
      rawDb.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(auth.user.id);

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/delivery/settle-driver',
          headers: auth.headers,
          payload: { driverId: 'drv_test' }
        });
        expect(res.statusCode).toBe(401);
        const body = JSON.parse(res.payload);
        expect(body.code).toBe('UNAUTHENTICATED');
      } finally {
        rawDb.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(auth.user.id);
      }
    });

    it('sesión válida de rol permitido (cajera) -> no 401', async () => {
      const auth = await loginAs(app, 'cajera', rawDb);
      const res = await app.inject({
        method: 'POST',
        url: '/api/delivery/settle-driver',
        headers: auth.headers,
        payload: { driverId: 'drv_test' }
      });
      expect(res.statusCode).not.toBe(401);
    });
  });

  describe('POST /api/updater/verify', () => {
    it('sesión revocada -> 401', async () => {
      const auth = await loginAs(app, 'admin', rawDb);
      rawDb
        .prepare('UPDATE sessions SET revoked_at_ms = ? WHERE token_hash = ?')
        .run(Date.now(), hashToken(auth.token));

      const res = await app.inject({
        method: 'POST',
        url: '/api/updater/verify',
        headers: auth.headers,
        payload: { manifestJson: '{}', signatureBase64: 'abc' }
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNAUTHENTICATED');
    });

    it('sesión expirada -> 401', async () => {
      const auth = await loginAs(app, 'admin', rawDb);
      rawDb
        .prepare('UPDATE sessions SET expires_at_ms = ? WHERE token_hash = ?')
        .run(Date.now() - 5000, hashToken(auth.token));

      const res = await app.inject({
        method: 'POST',
        url: '/api/updater/verify',
        headers: auth.headers,
        payload: { manifestJson: '{}', signatureBase64: 'abc' }
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNAUTHENTICATED');
    });

    it('usuario desactivado (is_active = 0) -> 401', async () => {
      const auth = await loginAs(app, 'admin', rawDb);
      rawDb.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(auth.user.id);

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/updater/verify',
          headers: auth.headers,
          payload: { manifestJson: '{}', signatureBase64: 'abc' }
        });
        expect(res.statusCode).toBe(401);
        const body = JSON.parse(res.payload);
        expect(body.code).toBe('UNAUTHENTICATED');
      } finally {
        rawDb.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(auth.user.id);
      }
    });

    it('sesión válida de rol permitido (admin) -> no 401', async () => {
      const auth = await loginAs(app, 'admin', rawDb);
      const res = await app.inject({
        method: 'POST',
        url: '/api/updater/verify',
        headers: auth.headers,
        payload: { manifestJson: '{}', signatureBase64: 'abc' }
      });
      expect(res.statusCode).not.toBe(401);
    });
  });
});
