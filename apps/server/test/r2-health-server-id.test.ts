import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { HealthResponseSchema } from '@tocineta/shared';
import { buildServer } from '../src/server.js';
import { initSqlite } from '../src/db/connection.js';
import { getServerIdPath } from '../src/config/paths.js';
import { resetServerIdCacheForTests } from '../src/lib/server-id.js';

describe('GET /api/health - serverId', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_server_id_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test.db');
  const originalDbPath = process.env.DB_PATH;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    process.env.DB_PATH = tempDb;
    initSqlite(tempDb);
    resetServerIdCacheForTests();
    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    resetServerIdCacheForTests();
    if (originalDbPath !== undefined) {
      process.env.DB_PATH = originalDbPath;
    } else {
      delete process.env.DB_PATH;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('devuelve 200 con serverId de 32 caracteres hexadecimales sin sesión y pasa HealthResponseSchema', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health'
    });

    expect(res.statusCode).toBe(200);
    const parsed = HealthResponseSchema.parse(res.json());
    expect(parsed.serverId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('dos llamadas seguidas a GET /api/health devuelven exactamente el mismo serverId', async () => {
    const res1 = await app.inject({
      method: 'GET',
      url: '/api/health'
    });
    const res2 = await app.inject({
      method: 'GET',
      url: '/api/health'
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const body1 = res1.json();
    const body2 = res2.json();

    expect(body1.serverId).toBe(body2.serverId);
    expect(body1.serverId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('si se borra el archivo en getServerIdPath() y se invoca resetServerIdCacheForTests(), la siguiente llamada genera y escribe en disco un serverId nuevo de 32 chars', async () => {
    const resPrev = await app.inject({
      method: 'GET',
      url: '/api/health'
    });
    const prevServerId = resPrev.json().serverId;

    const idPath = getServerIdPath();
    expect(fs.existsSync(idPath)).toBe(true);
    fs.unlinkSync(idPath);
    expect(fs.existsSync(idPath)).toBe(false);

    resetServerIdCacheForTests();

    const resNew = await app.inject({
      method: 'GET',
      url: '/api/health'
    });

    expect(resNew.statusCode).toBe(200);
    const bodyNew = resNew.json();
    const parsed = HealthResponseSchema.parse(bodyNew);

    expect(parsed.serverId).toMatch(/^[0-9a-f]{32}$/);
    expect(parsed.serverId).not.toBe(prevServerId);
    expect(fs.existsSync(idPath)).toBe(true);
    const diskContent = fs.readFileSync(idPath, 'utf-8').trim();
    expect(diskContent).toBe(parsed.serverId);
  });
});
