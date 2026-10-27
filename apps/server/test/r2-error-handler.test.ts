import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { AppError } from '../src/lib/app-error.js';
import { assertIsolatedTestDatabase } from '../src/db/test-guard.js';
import { loginAs } from './test-helpers.js';

describe('P0-A — Manejador Global de Errores, Red de Seguridad y BD de Pruebas Aislada', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_p0a_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_p0a.db');
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

    app = await buildServer({ disableStatic: true, logger: false });

    // Rutas de prueba para forzar los distintos tipos de excepción
    app.get('/test/fk-error', async () => {
      rawDb.prepare(`
        INSERT INTO products (id, category_id, name, price_usd_cents, station, created_at_ms, updated_at_ms)
        VALUES ('prod_test_fk', 'cat_inexistente', 'Producto Test', 100, 'hamburguesas', 1000, 1000)
      `).run();
      return { ok: true };
    });

    app.get('/test/unique-error', async () => {
      rawDb.prepare(`INSERT INTO categories (id, name, station) VALUES ('cat_uniq_test', 'Cat 1', 'hamburguesas')`).run();
      rawDb.prepare(`INSERT INTO categories (id, name, station) VALUES ('cat_uniq_test', 'Cat 2', 'hamburguesas')`).run();
      return { ok: true };
    });

    app.get('/test/check-error', async () => {
      rawDb.prepare(`
        INSERT INTO categories (id, name, station)
        VALUES ('cat_test_chk', 'Cat Test', 'estacion_invalida_check')
      `).run();
      return { ok: true };
    });

    app.get('/test/notnull-error', async () => {
      rawDb.prepare(`INSERT OR IGNORE INTO categories (id, name, station) VALUES ('cat_nn_holder', 'Cat Holder', 'hamburguesas')`).run();
      rawDb.prepare(`
        INSERT INTO products (id, category_id, name, price_usd_cents)
        VALUES ('prod_test_nn', 'cat_nn_holder', NULL, 500)
      `).run();
      return { ok: true };
    });

    app.post(
      '/test/validation-error',
      {
        schema: {
          body: {
            type: 'object',
            required: ['nombreObligatorio'],
            properties: {
              nombreObligatorio: { type: 'string' }
            }
          }
        }
      },
      async () => {
        return { ok: true };
      }
    );

    app.post('/test/internal-error', async () => {
      throw new Error('Fallo crítico simulado en motor de base de datos');
    });

    app.get('/test/app-error', async () => {
      throw new AppError('CUPO_EXCEDIDO', 422, 'El límite diario del cliente ha sido superado', 'monto_limite');
    });

    await app.ready();

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      const dbCtx = getDatabaseContext();
      dbCtx.rawDb.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // 1. GUARDA DE BASE DE DATOS AISLADA
  // =========================================================================
  describe('1. Guarda de Seguridad de BD Aislada', () => {
    it('aborta explícitamente si se intenta ejecutar pruebas contra data/tocineta.db', () => {
      expect(() => assertIsolatedTestDatabase('data/tocineta.db')).toThrow(/TOCINETA GUARD/);
      expect(() => assertIsolatedTestDatabase('./data/tocineta.db')).toThrow(/TOCINETA GUARD/);
      expect(() => initSqlite('data/tocineta.db')).toThrow(/TOCINETA GUARD/);
    });

    it('permite bases de datos temporales, en memoria y respaldos', () => {
      expect(() => assertIsolatedTestDatabase(':memory:')).not.toThrow();
      expect(() => assertIsolatedTestDatabase(tempDb)).not.toThrow();
      expect(() => assertIsolatedTestDatabase('data/backups-r2/pre-r2-20261027/tocineta.db')).not.toThrow();
    });
  });

  // =========================================================================
  // 2. MAPEO DE ERRORES SQLITE Y VALIDACIÓN
  // =========================================================================
  describe('2. Mapeo de Errores SQLite y Validación', () => {
    it('mapea FOREIGN KEY constraint failed -> 409 REFERENCE_MISSING sin stack en respuesta', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/fk-error' });
      expect(res.statusCode).toBe(409);
      const data = res.json();
      expect(data.success).toBe(false);
      expect(data.code).toBe('REFERENCE_MISSING');
      expect(typeof data.error).toBe('string');
      expect(data.requestId).toBeDefined();
      expect(data.stack).toBeUndefined();
      expect(res.payload).not.toContain('FOREIGN KEY');
    });

    it('mapea UNIQUE constraint failed -> 409 DUPLICATE sin stack en respuesta', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/unique-error' });
      expect(res.statusCode).toBe(409);
      const data = res.json();
      expect(data.success).toBe(false);
      expect(data.code).toBe('DUPLICATE');
      expect(typeof data.error).toBe('string');
      expect(data.requestId).toBeDefined();
      expect(data.stack).toBeUndefined();
    });

    it('mapea CHECK constraint failed -> 422 INVALID_VALUE sin stack en respuesta', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/check-error' });
      expect(res.statusCode).toBe(422);
      const data = res.json();
      expect(data.success).toBe(false);
      expect(data.code).toBe('INVALID_VALUE');
      expect(typeof data.error).toBe('string');
      expect(data.requestId).toBeDefined();
      expect(data.stack).toBeUndefined();
    });

    it('mapea NOT NULL constraint failed -> 422 FIELD_REQUIRED con field = columna', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/notnull-error' });
      expect(res.statusCode).toBe(422);
      const data = res.json();
      expect(data.success).toBe(false);
      expect(data.code).toBe('FIELD_REQUIRED');
      expect(data.field).toBe('name');
      expect(data.error).toContain('name');
      expect(data.requestId).toBeDefined();
      expect(data.stack).toBeUndefined();
    });

    it('mapea errores de validación Fastify -> 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/test/validation-error',
        payload: {}
      });
      expect(res.statusCode).toBe(400);
      const data = res.json();
      expect(data.success).toBe(false);
      expect(data.code).toBe('VALIDATION_ERROR');
      expect(data.field).toBe('nombreObligatorio');
      expect(typeof data.error).toBe('string');
      expect(data.requestId).toBeDefined();
      expect(data.stack).toBeUndefined();
    });

    it('mapea AppError personalizado respetando code, httpStatus, message y field', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/app-error' });
      expect(res.statusCode).toBe(422);
      const data = res.json();
      expect(data.success).toBe(false);
      expect(data.code).toBe('CUPO_EXCEDIDO');
      expect(data.message).toBe('El límite diario del cliente ha sido superado');
      expect(data.error).toBe('El límite diario del cliente ha sido superado');
      expect(data.field).toBe('monto_limite');
      expect(data.requestId).toBeDefined();
      expect(data.stack).toBeUndefined();
    });

    it('mapea errores internos inesperados -> 500 INTERNAL con mensaje genérico y nunca envía stack ni SQL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/test/internal-error',
        payload: {
          pin: '123456',
          password: 'mi_clave_secreta',
          token: 'token_secreto_abc',
          datoPublico: 'informacion_normal'
        }
      });
      expect(res.statusCode).toBe(500);
      const data = res.json();
      expect(data.success).toBe(false);
      expect(data.code).toBe('INTERNAL');
      expect(data.message).toBe('Error interno del servidor');
      expect(data.error).toBe('Error interno del servidor');
      expect(data.requestId).toBeDefined();
      expect(data.stack).toBeUndefined();
      expect(res.payload).not.toContain('Fallo crítico simulado');

      // Verificar que el error quedó registrado en la tabla server_errors
      const row = rawDb.prepare('SELECT * FROM server_errors WHERE request_id = ?').get(data.requestId) as any;
      expect(row).toBeDefined();
      expect(row.method).toBe('POST');
      expect(row.url).toBe('/test/internal-error');
      expect(row.status).toBe(500);
      expect(row.code).toBe('INTERNAL');
      expect(row.message).toContain('Fallo crítico simulado');
      expect(row.stack).toContain('Fallo crítico simulado');

      // Verificar redacción de campos sensibles en el cuerpo almacenado
      const parsedBody = JSON.parse(row.body_json);
      expect(parsedBody.pin).toBe('***REDACTED***');
      expect(parsedBody.password).toBe('***REDACTED***');
      expect(parsedBody.token).toBe('***REDACTED***');
      expect(parsedBody.datoPublico).toBe('informacion_normal');
    });
  });

  // =========================================================================
  // 3. CONSULTA DE AUDITORÍA: GET /api/support/server-errors
  // =========================================================================
  describe('3. Consulta de Soporte: GET /api/support/server-errors', () => {
    it('rechaza con 401 si no hay token de autenticación', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/support/server-errors' });
      expect(res.statusCode).toBe(401);
    });

    it('rechaza con 403 si el rol no es admin (ej. cajera)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/support/server-errors',
        headers: { authorization: `Bearer ${cajeraToken}` }
      });
      expect(res.statusCode).toBe(403);
    });

    it('devuelve los errores con mensaje y stack para rol admin', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/support/server-errors?limit=50',
        headers: { authorization: `Bearer ${adminToken}` }
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.errors)).toBe(true);
      expect(data.errors.length).toBeGreaterThan(0);

      const internalErr = data.errors.find((e: any) => e.code === 'INTERNAL');
      expect(internalErr).toBeDefined();
      expect(internalErr.stack).toBeDefined();
      expect(internalErr.stack).toContain('Fallo crítico simulado');
    });
  });
});
