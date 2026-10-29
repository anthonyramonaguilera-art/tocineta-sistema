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
import { seedCatalog } from '../src/db/seed-catalog.js';
import { loginAs } from './test-helpers.js';

describe('R2 — Printers API & Hardware Diagnostics', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_printers_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_printers.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;
  let cajeraToken: string;

  beforeAll(async () => {
    process.env.PRINTER_DEV_SIMULATION = 'true';
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    delete process.env.PRINTER_DEV_SIMULATION;
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

  it('1) Rechaza con 403 PATCH /api/printers/:id sin rol ADMIN', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/printers/print_caja_usb',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { codepage: 2 }
    });
    expect(res.statusCode).toBe(403);
  });

  it('2) PATCH /api/printers/:id guarda campos con rol ADMIN', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/printers/print_caja_usb',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        address: 'DP58U-Custom',
        codepage: 2,
        has_cutter: true,
        has_buzzer: false
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.printer.address).toBe('DP58U-Custom');
    expect(body.printer.codepage).toBe(2);
    expect(body.printer.has_cutter).toBe(1);
    expect(body.printer.has_buzzer).toBe(0);
  });

  it('3) GET /api/printers/windows devuelve arreglo (simulado vacío)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/printers/windows',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('4) POST /api/printers/:id/test devuelve simulated:true con simulación', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/printers/print_caja_usb/test',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.simulated).toBe(true);
  });
});
