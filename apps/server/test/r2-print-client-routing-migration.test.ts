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

describe('R2 — Migración 0042 y Enrutamiento de Impresión Cliente/Servidor', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_client_routing_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_routing.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
  });

  afterAll(async () => {
    if (app) await app.close();
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

  it('1. Migración 0042: columnas y defaults en print_jobs', () => {
    const cols = rawDb.prepare('PRAGMA table_info(print_jobs)').all() as Array<{ name: string; dflt_value: string }>;
    const colNames = cols.map(c => c.name);

    expect(colNames).toContain('target');
    expect(colNames).toContain('target_terminal_id');
    expect(colNames).toContain('claimed_at_ms');

    const targetCol = cols.find(c => c.name === 'target');
    expect(targetCol?.dflt_value).toBe("'server'");

    // Insertar print_job sin target debe usar default 'server'
    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, payload_bytes, created_at_ms)
      VALUES ('job_test_default', 'print_caja_usb', 'TEST', X'00', ?)
    `).run(Date.now());

    const inserted = rawDb.prepare('SELECT target, target_terminal_id, claimed_at_ms FROM print_jobs WHERE id = ?').get('job_test_default') as any;
    expect(inserted.target).toBe('server');
    expect(inserted.target_terminal_id).toBeNull();
    expect(inserted.claimed_at_ms).toBeNull();
  });

  it('2. print_jobs: rechazo de valor inválido en target por CHECK constraint', () => {
    expect(() => {
      rawDb.prepare(`
        INSERT INTO print_jobs (id, printer_id, job_type, payload_bytes, target, created_at_ms)
        VALUES ('job_test_bad_target', 'print_caja_usb', 'TEST', X'00', 'cloud', ?)
      `).run(Date.now());
    }).toThrow();
  });

  it('3. print_jobs: índice idx_print_jobs_target existe', () => {
    const indexes = rawDb.prepare('PRAGMA index_list(print_jobs)').all() as Array<{ name: string }>;
    expect(indexes.some(idx => idx.name === 'idx_print_jobs_target')).toBe(true);
  });

  it('4. business_settings: columnas y defaults receipt_destination y kitchen_destination', () => {
    const cols = rawDb.prepare('PRAGMA table_info(business_settings)').all() as Array<{ name: string; dflt_value: string }>;
    const colNames = cols.map(c => c.name);

    expect(colNames).toContain('receipt_destination');
    expect(colNames).toContain('kitchen_destination');

    const receiptDest = cols.find(c => c.name === 'receipt_destination');
    const kitchenDest = cols.find(c => c.name === 'kitchen_destination');
    expect(receiptDest?.dflt_value).toBe("'payer_device'");
    expect(kitchenDest?.dflt_value).toBe("'payer_device'");

    const row = rawDb.prepare('SELECT receipt_destination, kitchen_destination FROM business_settings WHERE id = ?').get('default') as any;
    expect(row.receipt_destination).toBe('payer_device');
    expect(row.kitchen_destination).toBe('payer_device');
  });

  it('5. business_settings: rechazo de valores inválidos por CHECK constraint', () => {
    expect(() => {
      rawDb.prepare(`
        UPDATE business_settings SET receipt_destination = 'invalid_device' WHERE id = 'default'
      `).run();
    }).toThrow();

    expect(() => {
      rawDb.prepare(`
        UPDATE business_settings SET kitchen_destination = 'invalid_device' WHERE id = 'default'
      `).run();
    }).toThrow();
  });

  it('6. GET /api/business-settings devuelve receipt_destination y kitchen_destination en snake y camelCase', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/business-settings'
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.settings.receipt_destination).toBe('payer_device');
    expect(body.settings.receiptDestination).toBe('payer_device');
    expect(body.settings.kitchen_destination).toBe('payer_device');
    expect(body.settings.kitchenDestination).toBe('payer_device');
    expect(body.receipt_destination).toBe('payer_device');
    expect(body.receiptDestination).toBe('payer_device');
  });

  it('7. PATCH /api/business-settings valida receipt_destination y kitchen_destination', async () => {
    const resBadReceipt = await app.inject({
      method: 'PATCH',
      url: '/api/business-settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { receipt_destination: 'invalid_mode' }
    });
    expect(resBadReceipt.statusCode).toBe(400);
    expect(resBadReceipt.json().field).toBe('receipt_destination');

    const resBadKitchen = await app.inject({
      method: 'PATCH',
      url: '/api/business-settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { kitchenDestination: 'invalid_mode' }
    });
    expect(resBadKitchen.statusCode).toBe(400);
    expect(resBadKitchen.json().field).toBe('kitchen_destination');
  });

  it('8. PATCH /api/business-settings rechaza impresora inexistente o inactiva', async () => {
    const resGhostReceipt = await app.inject({
      method: 'PATCH',
      url: '/api/business-settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { receipt_printer_id: 'printer_fantasma_999' }
    });
    expect(resGhostReceipt.statusCode).toBe(400);
    expect(resGhostReceipt.json().field).toBe('receipt_printer_id');

    const resGhostKitchen = await app.inject({
      method: 'PATCH',
      url: '/api/business-settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { kitchen_printer_id: 'printer_fantasma_999' }
    });
    expect(resGhostKitchen.statusCode).toBe(400);
    expect(resGhostKitchen.json().field).toBe('kitchen_printer_id');

    // Desactivar una impresora existente y verificar que es rechazada
    rawDb.prepare('UPDATE printers SET is_active = 0 WHERE id = ?').run('print_cocina');
    const resInactive = await app.inject({
      method: 'PATCH',
      url: '/api/business-settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { kitchen_printer_id: 'print_cocina' }
    });
    expect(resInactive.statusCode).toBe(400);
    expect(resInactive.json().field).toBe('kitchen_printer_id');

    // Restaurar impresora activa
    rawDb.prepare('UPDATE printers SET is_active = 1 WHERE id = ?').run('print_cocina');
  });

  it('9. PATCH /api/business-settings persiste destinos e impresoras correctamente', async () => {
    const resPatch = await app.inject({
      method: 'PATCH',
      url: '/api/business-settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        receipt_destination: 'fixed_printer',
        kitchen_destination: 'fixed_printer',
        receipt_printer_id: 'print_caja_usb',
        kitchen_printer_id: 'print_cocina'
      }
    });

    expect(resPatch.statusCode).toBe(200);
    const body = resPatch.json();
    expect(body.settings.receipt_destination).toBe('fixed_printer');
    expect(body.settings.receiptDestination).toBe('fixed_printer');
    expect(body.settings.kitchen_destination).toBe('fixed_printer');
    expect(body.settings.kitchenDestination).toBe('fixed_printer');
    expect(body.settings.receipt_printer_id).toBe('print_caja_usb');
    expect(body.settings.kitchen_printer_id).toBe('print_cocina');

    // Verificar persistencia en base de datos
    const dbRow = rawDb.prepare('SELECT receipt_destination, kitchen_destination, receipt_printer_id, kitchen_printer_id FROM business_settings WHERE id = ?').get('default') as any;
    expect(dbRow.receipt_destination).toBe('fixed_printer');
    expect(dbRow.kitchen_destination).toBe('fixed_printer');
    expect(dbRow.receipt_printer_id).toBe('print_caja_usb');
    expect(dbRow.kitchen_printer_id).toBe('print_cocina');

    // Verificar posterior llamada GET
    const resGet = await app.inject({
      method: 'GET',
      url: '/api/business-settings'
    });
    expect(resGet.statusCode).toBe(200);
    expect(resGet.json().settings.receipt_destination).toBe('fixed_printer');
    expect(resGet.json().settings.kitchen_destination).toBe('fixed_printer');
  });
});
