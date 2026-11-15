import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { loginAs } from './test-helpers.js';
import { resolveRoutePolicy } from '../src/config/route-policy.js';

describe('C2a — Business Logo Upload Endpoint', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_logo_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_logo.db');
  let rawDb: Database.Database;
  let adminToken: string;
  let cashierToken: string;

  const validPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    process.env.DB_PATH = tempDb;
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    ensureOfficialLocations(rawDb);

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    const adminLogin = await loginAs(app, 'admin', rawDb);
    adminToken = adminLogin.token;

    const cashierLogin = await loginAs(app, 'cajera', rawDb);
    cashierToken = cashierLogin.token;
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

  it('está clasificada como ADMIN en ROUTE_POLICY', () => {
    const policy = resolveRoutePolicy('POST', '/api/business-settings/logo');
    expect(policy.matched).toBe(true);
    expect(policy.level).toBe('ADMIN');
  });

  it('rechaza peticiones de usuarios sin rol admin (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/business-settings/logo',
      headers: { authorization: `Bearer ${cashierToken}` },
      payload: { base64: validPngBase64 }
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.success).toBe(false);
  });

  it('rechaza si no se envía el cuerpo o base64 (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/business-settings/logo',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {}
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
  });

  it('rechaza formatos no soportados como SVG o texto (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/business-settings/logo',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { base64: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain('Formato de imagen no soportado');
  });

  it('rechaza imágenes que superen los 2 MB (400)', async () => {
    const largeBuffer = Buffer.alloc(2 * 1024 * 1024 + 100);
    const largeBase64 = `data:image/png;base64,${largeBuffer.toString('base64')}`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/business-settings/logo',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { base64: largeBase64 }
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain('2 MB');
  });

  it('sube un logo válido con rol admin, actualiza business_settings y devuelve URL (200)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/business-settings/logo',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { base64: validPngBase64 }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.logo_url).toMatch(/^\/uploads\/business-logo-\d+\.png\?t=\d+$/);

    // Verificar en BD
    const row = rawDb.prepare('SELECT logo_url FROM business_settings WHERE id = ?').get('default') as any;
    expect(row.logo_url).toBe(body.logo_url);
  });
});
