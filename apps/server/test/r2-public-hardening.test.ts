import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { buildServer } from '../src/server.js';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { verifyPin } from '../src/modules/auth/pin.js';
import { resetRateLimitStore } from '../src/plugins/public-rate-limit.js';

describe('R2 Public Hardening & Rate Limiting (S-1)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_hardening_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_hardening.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  const originalEnforce = process.env.ENFORCE_AUTH;
  const originalCors = process.env.CORS_ALLOWED_ORIGINS;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    rawDb.prepare('UPDATE users SET must_change_pin = 0').run();

    process.env.CORS_ALLOWED_ORIGINS = 'https://custom.tocineta.com';
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
    if (originalCors === undefined) {
      delete process.env.CORS_ALLOWED_ORIGINS;
    } else {
      process.env.CORS_ALLOWED_ORIGINS = originalCors;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(() => {
    process.env.ENFORCE_AUTH = 'true';
    if (typeof resetRateLimitStore === 'function') {
      resetRateLimitStore();
    }
  });

  describe('a) Credenciales no predecibles en auto-registro', () => {
    it('register sin pin -> 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          name: 'Mesonero Sin Pin',
          cedula: 'V-88001001'
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().success).toBe(false);
    });

    it('register con pin "0000" -> 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          name: 'Mesonero Ceros',
          cedula: 'V-88001002',
          pin: '0000'
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().success).toBe(false);
    });

    it('register con pin "1234" (trivial) -> 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          name: 'Mesonero Trivial',
          cedula: 'V-88001003',
          pin: '1234'
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().success).toBe(false);
    });

    it('pin válido no trivial -> éxito, verifyPin NO acepta "0000" ni últimos 4 de cédula, is_active=0', async () => {
      const cedula = 'V-88009944';
      const validPin = '5824';

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          name: 'Mesonero Valido',
          cedula,
          pin: validPin,
          phone: '04141234567'
        }
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.userId).toBeDefined();

      const user = rawDb.prepare('SELECT * FROM users WHERE id = ?').get(data.userId) as any;
      expect(user).toBeDefined();
      expect(user.is_active).toBe(0);
      expect(user.approval_status).toBe('PENDING');

      // verifyPin NO acepta '0000'
      expect(verifyPin('0000', user.pin_salt, user.pin_hash)).toBe(false);
      // verifyPin NO acepta los últimos 4 dígitos de la cédula ('9944')
      expect(verifyPin('9944', user.pin_salt, user.pin_hash)).toBe(false);
      // verifyPin acepta el pin enviado
      expect(verifyPin(validPin, user.pin_salt, user.pin_hash)).toBe(true);

      // Cédula duplicada -> 409
      const dup = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          name: 'Mesonero Duplicado',
          cedula,
          pin: '7391'
        }
      });
      expect(dup.statusCode).toBe(409);
    });
  });

  describe('b) Límite de tasa en auto-registro', () => {
    it('6.º register en 10 min desde la misma IP -> 429 RATE_LIMITED', async () => {
      const testIp = '198.51.100.77';

      for (let i = 1; i <= 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/register',
          headers: { 'x-forwarded-for': testIp },
          payload: {
            name: `Staff ${i}`,
            cedula: `V-7700000${i}`,
            pin: '5824'
          }
        });
        expect([201, 400, 409]).toContain(res.statusCode);
      }

      // 6to envío desde la misma IP
      const res6 = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'x-forwarded-for': testIp },
        payload: {
          name: 'Staff 6',
          cedula: 'V-77000006',
          pin: '5824'
        }
      });

      expect(res6.statusCode).toBe(429);
      const json = res6.json();
      expect(json.success).toBe(false);
      expect(json.code).toBe('RATE_LIMITED');
      expect(typeof json.retryAfterMs).toBe('number');
      expect(json.retryAfterMs).toBeGreaterThan(0);
    });
  });

  describe('c) client-errors tamaño y tasa', () => {
    it('client-errors con body > 16 KB -> 413', async () => {
      const largePayload = {
        viewName: 'CrashView',
        errorMessage: 'X'.repeat(17000)
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/client-errors',
        payload: largePayload
      });

      expect(res.statusCode).toBe(413);
    });

    it('61 envíos en un minuto -> 429', async () => {
      const testIp = '198.51.100.88';

      for (let i = 1; i <= 60; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/client-errors',
          headers: { 'x-forwarded-for': testIp },
          payload: {
            viewName: 'LoginView',
            errorMessage: `Error #${i}`
          }
        });
        expect(res.statusCode).toBe(201);
      }

      // 61vo envío en la misma ventana de 1 minuto
      const res61 = await app.inject({
        method: 'POST',
        url: '/api/client-errors',
        headers: { 'x-forwarded-for': testIp },
        payload: {
          viewName: 'LoginView',
          errorMessage: 'Error #61'
        }
      });

      expect(res61.statusCode).toBe(429);
      const json = res61.json();
      expect(json.success).toBe(false);
      expect(json.code).toBe('RATE_LIMITED');
      expect(typeof json.retryAfterMs).toBe('number');
      expect(json.retryAfterMs).toBeGreaterThan(0);
    });
  });

  describe('d) Restricción de CORS', () => {
    it('Origin: "https://evil.example" no recibe access-control-allow-origin', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'https://evil.example'
        }
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('Origin: "http://192.168.1.50:3000" sí recibe cabecera CORS', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'http://192.168.1.50:3000'
        }
      });
      expect(res.headers['access-control-allow-origin']).toBe('http://192.168.1.50:3000');
    });

    it('Origin: "http://localhost:5173" sí recibe cabecera CORS', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'http://localhost:5173'
        }
      });
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    it('Origin listado en process.env.CORS_ALLOWED_ORIGINS sí recibe cabecera CORS', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'https://custom.tocineta.com'
        }
      });
      expect(res.headers['access-control-allow-origin']).toBe('https://custom.tocineta.com');
    });
  });
});
