import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SystemHealthResponseSchema } from '@tocineta/shared';
import { buildServer } from '../src/server.js';
import { initSqlite } from '../src/db/connection.js';

describe('GET /api/system-health', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_syshealth_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'syshealth.db');

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    initSqlite(tempDb);
    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('returns 200 OK with full system diagnostics, disk stats, and memory', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system-health'
    });

    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.payload);
    const parsed = SystemHealthResponseSchema.parse(body);

    expect(parsed.status).toBe('ok');
    expect(parsed.architecture).toBe('single_process');
    expect(parsed.systemTime.timezone).toBe('America/Caracas');
    expect(parsed.database.driver).toBe('better-sqlite3');
    expect(parsed.database.pragmas.journalMode.toLowerCase()).toBe('wal');
    expect(parsed.database.pragmas.synchronous).toBe(2);
    expect(parsed.database.pragmas.foreignKeys).toBe(1);
    expect(parsed.system.memory.rssMb).toBeGreaterThan(0);
    expect(parsed.system.nodeVersion.startsWith('v24')).toBe(true);
  });
});
