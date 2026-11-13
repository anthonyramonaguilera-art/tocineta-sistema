import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildServer } from '../src/server.js';
import { initSqlite } from '../src/db/connection.js';
import { getApkDir, getServerIdPath } from '../src/config/paths.js';

describe('R2 - Distribución Estática de APK (/apk/*)', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_apk_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_apk.db');
  const originalDbPath = process.env.DB_PATH;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    process.env.DB_PATH = tempDb;

    initSqlite(tempDb);

    const apkDir = getApkDir();
    fs.writeFileSync(path.join(apkDir, 'version.txt'), '1.0.0 (1)', 'utf8');
    fs.writeFileSync(path.join(apkDir, 'tocineta-terminal.apk'), 'DUMMY_APK_CONTENT', 'utf8');
    fs.writeFileSync(getServerIdPath(), 'test-server-id-secret', 'utf8');

    app = await buildServer({ logger: false, disableStatic: false });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (originalDbPath === undefined) {
      delete process.env.DB_PATH;
    } else {
      process.env.DB_PATH = originalDbPath;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('GET /apk/version.txt responde 200 cuando el archivo existe', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/apk/version.txt'
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload.trim()).toBe('1.0.0 (1)');
  });

  it('GET /apk/tocineta-terminal.apk responde 200 con el binario cuando existe', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/apk/tocineta-terminal.apk'
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe('DUMMY_APK_CONTENT');
  });

  it('GET /apk/no-existe.apk responde 404 (y no index.html)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/apk/no-existe.apk'
    });

    expect(res.statusCode).toBe(404);
    expect(res.payload).not.toContain('<!doctype html>');
    expect(res.payload).not.toContain('<html');
    expect(res.payload).not.toContain('index.html');

    const json = JSON.parse(res.payload);
    expect(json.success).toBe(false);
  });

  it('GET /apk/../server-id.txt es bloqueado (403/404)', async () => {
    const resRaw = await app.inject({
      method: 'GET',
      url: '/apk/../server-id.txt'
    });

    expect([400, 403, 404]).toContain(resRaw.statusCode);
    expect(resRaw.payload).not.toContain('test-server-id-secret');
    expect(resRaw.payload).not.toContain('<!doctype html>');

    const resEncoded = await app.inject({
      method: 'GET',
      url: '/apk/%2e%2e/server-id.txt'
    });

    expect([400, 403, 404]).toContain(resEncoded.statusCode);
    expect(resEncoded.payload).not.toContain('test-server-id-secret');
    expect(resEncoded.payload).not.toContain('<!doctype html>');
  });
});
