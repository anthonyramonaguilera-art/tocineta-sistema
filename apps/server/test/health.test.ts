import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { HealthResponseSchema } from '@tocineta/shared';
import { buildServer } from '../src/server.js';
import { initSqlite } from '../src/db/connection.js';

describe('GET /api/health', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_health_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'health.db');

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

  it('returns 200 OK with expected WAL PRAGMAs and Caracas local time', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health'
    });

    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.payload);
    const parsed = HealthResponseSchema.parse(body);

    expect(parsed.status).toBe('ok');
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.db).toBe('wal_full');
    expect(parsed.journalMode.toLowerCase()).toBe('wal');
    expect(parsed.synchronous).toBe(2); // 2 = FULL
    expect(parsed.foreignKeys).toBe(1); // 1 = ON
    expect(typeof parsed.localTimeCaracas).toBe('string');
    expect(parsed.localTimeCaracas.length).toBeGreaterThan(5);
    expect(parsed.timestampUtcMs).toBeGreaterThan(0);
  });
});
