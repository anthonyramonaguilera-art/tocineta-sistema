import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { ensureBusinessSettingsDefensive } from '../src/db/business-settings.js';
import { loginAs } from './test-helpers.js';
import { PrintingWorker } from '../src/modules/printing/worker.js';
import { renderTicketToEscPos, type TicketIR } from '@tocineta/shared';

describe('R2 — Rutas del Dispositivo (Impresión Móvil) (@tocineta/server)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_print_device_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_device_routes.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let cajeraToken: string;
  let worker: PrintingWorker;
  const originalEnforce = process.env.ENFORCE_AUTH;

  const terminal1 = 'term_movil_01';
  const terminal2 = 'term_movil_02';

  const sampleIR: TicketIR = {
    widthColumns: 32,
    blocks: [
      { type: 'title_double', text: 'TOCINETA TEST', align: 'center' },
      { type: 'separator', style: 'dashed' },
      { type: 'text', text: 'Ñandú con Café $5', align: 'left' }
    ]
  };

  beforeAll(async () => {
    process.env.ENFORCE_AUTH = 'true';
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    ensureBusinessSettingsDefensive(rawDb);
    rawDb.prepare('UPDATE users SET must_change_pin = 0').run();

    // Configurar impresora de caja USB con codepage 2 y cocina con codepage 16
    rawDb.prepare(`
      UPDATE printers
      SET codepage = 2, connection_type = 'SPOOLER_RAW_USB', address = 'POS-80-USB'
      WHERE id = 'print_caja_usb'
    `).run();

    rawDb.prepare(`
      INSERT OR IGNORE INTO printers (id, name, connection_type, address, columns, codepage, has_cutter, has_buzzer, is_active, owner_terminal_id)
      VALUES ('print_bt_1', 'BT 1', 'CLIENT_BT', 'AA:BB:CC:DD:EE:01', 32, 16, 0, 0, 1, ?)
    `).run(terminal1);

    rawDb.prepare(`
      INSERT OR IGNORE INTO printers (id, name, connection_type, address, columns, codepage, has_cutter, has_buzzer, is_active, owner_terminal_id)
      VALUES ('print_bt_2', 'BT 2', 'CLIENT_BT', 'AA:BB:CC:DD:EE:02', 32, 16, 0, 0, 1, ?)
    `).run(terminal2);

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
    worker = new PrintingWorker(rawDb, { mockTransports: true });
  });

  afterAll(async () => {
    if (worker) worker.stop();
    if (app) await app.close();
    if (originalEnforce === undefined) {
      delete process.env.ENFORCE_AUTH;
    } else {
      process.env.ENFORCE_AUTH = originalEnforce;
    }
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

  beforeEach(() => {
    rawDb.prepare('DELETE FROM print_jobs').run();
  });

  it('1. GET /api/terminals/me/print-jobs sin header x-terminal-id da 403 con FORBIDDEN_TERMINAL', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/terminals/me/print-jobs',
      headers: { authorization: `Bearer ${cajeraToken}` }
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe('FORBIDDEN_TERMINAL');
  });

  it('2. GET /api/terminals/me/print-jobs devuelve solo trabajos client en_cola de ese terminal en los últimos 15 min', async () => {
    const now = Date.now();
    const payloadBytes = Buffer.from(renderTicketToEscPos(sampleIR, { codepage: 16 }));

    // Trabajo 1: Terminal 1, client, en_cola, hace 2 min -> DEBE APARECER
    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, ticket_ir_json, created_at_ms)
      VALUES ('job_ok_1', 'print_bt_1', 'NOTA_ENTREGA', 'caja', 'en_cola', 'client', ?, ?, ?, ?)
    `).run(terminal1, payloadBytes, JSON.stringify(sampleIR), now - 2 * 60 * 1000);

    // Trabajo 2: Terminal 1, client, imprimiendo -> NO DEBE APARECER
    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, ticket_ir_json, created_at_ms)
      VALUES ('job_printing', 'print_bt_1', 'NOTA_ENTREGA', 'caja', 'imprimiendo', 'client', ?, ?, ?, ?)
    `).run(terminal1, payloadBytes, JSON.stringify(sampleIR), now - 3 * 60 * 1000);

    // Trabajo 3: Terminal 2, client, en_cola -> NO DEBE APARECER (otro terminal)
    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, ticket_ir_json, created_at_ms)
      VALUES ('job_term2', 'print_bt_2', 'NOTA_ENTREGA', 'caja', 'en_cola', 'client', ?, ?, ?, ?)
    `).run(terminal2, payloadBytes, JSON.stringify(sampleIR), now - 1 * 60 * 1000);

    // Trabajo 4: Terminal 1, client, en_cola pero creado hace 20 min -> NO DEBE APARECER (> 15 min)
    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, ticket_ir_json, created_at_ms)
      VALUES ('job_expired', 'print_bt_1', 'NOTA_ENTREGA', 'caja', 'en_cola', 'client', ?, ?, ?, ?)
    `).run(terminal1, payloadBytes, JSON.stringify(sampleIR), now - 20 * 60 * 1000);

    // Trabajo 5: Terminal 1, server, en_cola -> NO DEBE APARECER (target = server)
    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, ticket_ir_json, created_at_ms)
      VALUES ('job_server', 'print_caja_usb', 'NOTA_ENTREGA', 'caja', 'en_cola', 'server', ?, ?, ?, ?)
    `).run(terminal1, payloadBytes, JSON.stringify(sampleIR), now - 1 * 60 * 1000);

    const res = await app.inject({
      method: 'GET',
      url: '/api/terminals/me/print-jobs',
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'x-terminal-id': terminal1
      }
    });

    expect(res.statusCode).toBe(200);
    const jobs = res.json();
    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('job_ok_1');
    expect(jobs[0].job_type).toBe('NOTA_ENTREGA');
    expect(jobs[0].station).toBe('caja');
  });

  it('3. POST /api/print-jobs/:id/claim desde otro terminal da 403 con FORBIDDEN_TERMINAL', async () => {
    const payloadBytes = Buffer.from(renderTicketToEscPos(sampleIR, { codepage: 16 }));
    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, ticket_ir_json, created_at_ms)
      VALUES ('job_claim_auth', 'print_bt_1', 'NOTA_ENTREGA', 'caja', 'en_cola', 'client', ?, ?, ?, ?)
    `).run(terminal1, payloadBytes, JSON.stringify(sampleIR), Date.now());

    // Intentar claim desde terminal2
    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job_claim_auth/claim',
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'x-terminal-id': terminal2
      }
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe('FORBIDDEN_TERMINAL');
  });

  it('4. POST /api/print-jobs/:id/claim exitoso y doble claim da 409', async () => {
    const payloadBytes = Buffer.from('ESC_POS_RAW_BYTES_TEST');
    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, ticket_ir_json, created_at_ms, attempts)
      VALUES ('job_claim_double', 'print_bt_1', 'NOTA_ENTREGA', 'caja', 'en_cola', 'client', ?, ?, ?, ?, 0)
    `).run(terminal1, payloadBytes, JSON.stringify(sampleIR), Date.now());

    // Primer claim: Éxito (200)
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job_claim_double/claim',
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'x-terminal-id': terminal1
      }
    });

    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.id).toBe('job_claim_double');
    expect(body1.jobType).toBe('NOTA_ENTREGA');
    expect(body1.payloadBase64).toBe(payloadBytes.toString('base64'));

    // Verificar en DB que cambió a imprimiendo e incrementó attempts
    const jobInDb = rawDb.prepare('SELECT status, attempts, claimed_at_ms FROM print_jobs WHERE id = ?').get('job_claim_double') as any;
    expect(jobInDb.status).toBe('imprimiendo');
    expect(jobInDb.attempts).toBe(1);
    expect(jobInDb.claimed_at_ms).toBeGreaterThan(0);

    // Segundo claim: Conflicto (409)
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job_claim_double/claim',
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'x-terminal-id': terminal1
      }
    });

    expect(res2.statusCode).toBe(409);
    const body2 = res2.json();
    expect(body2.code).toBe('CONFLICT');
  });

  it('5. POST /api/print-jobs/:id/complete ok y con fallo', async () => {
    const payloadBytes = Buffer.from('PAYLOAD_BYTES');
    const now = Date.now();

    // Caso 5.1: ok = true
    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, created_at_ms, attempts, max_attempts)
      VALUES ('job_comp_ok', 'print_bt_1', 'NOTA_ENTREGA', 'caja', 'imprimiendo', 'client', ?, ?, ?, 1, 3)
    `).run(terminal1, payloadBytes, now);

    const resOk = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job_comp_ok/complete',
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'x-terminal-id': terminal1
      },
      payload: { ok: true }
    });

    expect(resOk.statusCode).toBe(200);
    expect(resOk.json().status).toBe('impreso');

    const jobOkDb = rawDb.prepare('SELECT status, completed_at_ms FROM print_jobs WHERE id = ?').get('job_comp_ok') as any;
    expect(jobOkDb.status).toBe('impreso');
    expect(jobOkDb.completed_at_ms).toBeGreaterThan(0);

    // Caso 5.2: Fallo con attempts < max_attempts -> vuelve a en_cola
    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, created_at_ms, attempts, max_attempts)
      VALUES ('job_comp_fail_retry', 'print_bt_1', 'NOTA_ENTREGA', 'caja', 'imprimiendo', 'client', ?, ?, ?, 1, 3)
    `).run(terminal1, payloadBytes, now);

    const resFailRetry = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job_comp_fail_retry/complete',
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'x-terminal-id': terminal1
      },
      payload: { ok: false, error: 'Sin papel térmico' }
    });

    expect(resFailRetry.statusCode).toBe(200);
    expect(resFailRetry.json().status).toBe('en_cola');

    const jobRetryDb = rawDb.prepare('SELECT status, error_message FROM print_jobs WHERE id = ?').get('job_comp_fail_retry') as any;
    expect(jobRetryDb.status).toBe('en_cola');
    expect(jobRetryDb.error_message).toBe('Sin papel térmico');

    // Caso 5.3: Fallo con attempts >= max_attempts -> pasa a requiere_atencion
    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, created_at_ms, attempts, max_attempts)
      VALUES ('job_comp_fail_max', 'print_bt_1', 'NOTA_ENTREGA', 'caja', 'imprimiendo', 'client', ?, ?, ?, 3, 3)
    `).run(terminal1, payloadBytes, now);

    const resFailMax = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job_comp_fail_max/complete',
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'x-terminal-id': terminal1
      },
      payload: { ok: false, error: 'Cabezal sobrecalentado' }
    });

    expect(resFailMax.statusCode).toBe(200);
    expect(resFailMax.json().status).toBe('requiere_atencion');

    const jobMaxDb = rawDb.prepare('SELECT status, error_message FROM print_jobs WHERE id = ?').get('job_comp_fail_max') as any;
    expect(jobMaxDb.status).toBe('requiere_atencion');
    expect(jobMaxDb.error_message).toBe('Cabezal sobrecalentado');

    // Caso 5.4: Si el estado no es imprimiendo (p. ej. en_cola) -> 409
    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, created_at_ms)
      VALUES ('job_comp_conflict', 'print_bt_1', 'NOTA_ENTREGA', 'caja', 'en_cola', 'client', ?, ?, ?)
    `).run(terminal1, payloadBytes, now);

    const resConflict = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job_comp_conflict/complete',
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'x-terminal-id': terminal1
      },
      payload: { ok: true }
    });
    expect(resConflict.statusCode).toBe(409);
    expect(resConflict.json().code).toBe('CONFLICT');
  });

  it('6. Vencimiento con reloj simulado (reclaimStaleClientJobs cada 15 s)', async () => {
    const payloadBytes = Buffer.from('PAYLOAD_BYTES');
    const realNow = 1_000_000_000; // Tiempo simulado base

    // Job A: claimed hace 70 s (< now - 60000), attempts = 1, max_attempts = 3 -> debe volver a en_cola
    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, created_at_ms, claimed_at_ms, attempts, max_attempts)
      VALUES ('job_stale_retry', 'print_bt_1', 'NOTA_ENTREGA', 'caja', 'imprimiendo', 'client', ?, ?, ?, ?, 1, 3)
    `).run(terminal1, payloadBytes, realNow - 100000, realNow - 70000);

    // Job B: claimed hace 70 s (< now - 60000), attempts = 3, max_attempts = 3 -> debe pasar a requiere_atencion
    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, created_at_ms, claimed_at_ms, attempts, max_attempts)
      VALUES ('job_stale_attention', 'print_bt_1', 'NOTA_ENTREGA', 'caja', 'imprimiendo', 'client', ?, ?, ?, ?, 3, 3)
    `).run(terminal1, payloadBytes, realNow - 100000, realNow - 70000);

    // Job C: claimed hace solo 30 s (> now - 60000) -> NO debe vencer todavía
    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, created_at_ms, claimed_at_ms, attempts, max_attempts)
      VALUES ('job_not_stale', 'print_bt_1', 'NOTA_ENTREGA', 'caja', 'imprimiendo', 'client', ?, ?, ?, ?, 1, 3)
    `).run(terminal1, payloadBytes, realNow - 50000, realNow - 30000);

    // Ejecutar vencimiento con el reloj simulado realNow
    const result = worker.reclaimStaleClientJobs(realNow);
    expect(result.reclaimedToQueue).toBe(1);
    expect(result.escalatedToAttention).toBe(1);

    const jobA = rawDb.prepare('SELECT status, claimed_at_ms, error_message FROM print_jobs WHERE id = ?').get('job_stale_retry') as any;
    expect(jobA.status).toBe('en_cola');
    expect(jobA.claimed_at_ms).toBeNull();

    const jobB = rawDb.prepare('SELECT status, claimed_at_ms, error_message FROM print_jobs WHERE id = ?').get('job_stale_attention') as any;
    expect(jobB.status).toBe('requiere_atencion');
    expect(jobB.claimed_at_ms).toBeNull();

    const jobC = rawDb.prepare('SELECT status FROM print_jobs WHERE id = ?').get('job_not_stale') as any;
    expect(jobC.status).toBe('imprimiendo');
  });

  it('7. Reroute genera bytes con el codepage del destino y devuelve 409 si no hay impresora de servidor', async () => {
    // 7.1 Re-enrutar con éxito generando bytes con el codepage de la impresora destino (print_caja_usb tiene codepage = 2)
    const clientIR: TicketIR = {
      widthColumns: 32,
      blocks: [
        { type: 'title_double', text: 'NOTA REROUTE', align: 'center' },
        { type: 'text', text: 'á é í ó ú ñ', align: 'left' }
      ]
    };

    // Generar bytes cliente con codepage 16
    const clientPayloadBytes = Buffer.from(renderTicketToEscPos(clientIR, { codepage: 16 }));
    // Generar los bytes esperados con codepage 2 (destino del servidor)
    const expectedServerBytes = Buffer.from(renderTicketToEscPos(clientIR, { codepage: 2 }));

    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, ticket_ir_json, created_at_ms)
      VALUES ('job_to_reroute', 'print_bt_1', 'NOTA_ENTREGA', 'caja', 'en_cola', 'client', ?, ?, ?, ?)
    `).run(terminal1, clientPayloadBytes, JSON.stringify(clientIR), Date.now());

    const resReroute = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job_to_reroute/reroute',
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'x-terminal-id': terminal1
      },
      payload: { to: 'server' }
    });

    expect(resReroute.statusCode).toBe(200);
    const rerouteBody = resReroute.json();
    expect(rerouteBody.success).toBe(true);
    expect(rerouteBody.target).toBe('server');
    expect(rerouteBody.printerId).toBe('print_caja_usb');
    expect(rerouteBody.status).toBe('en_cola');

    // Verificar en DB
    const reroutedJob = rawDb.prepare('SELECT target, target_terminal_id, printer_id, payload_bytes, status FROM print_jobs WHERE id = ?').get('job_to_reroute') as any;
    expect(reroutedJob.target).toBe('server');
    expect(reroutedJob.target_terminal_id).toBeNull();
    expect(reroutedJob.printer_id).toBe('print_caja_usb');
    expect(reroutedJob.status).toBe('en_cola');
    // Verificar que los bytes fueron re-renderizados con el codepage del servidor (codepage 2)
    expect(Buffer.from(reroutedJob.payload_bytes)).toEqual(expectedServerBytes);

    // Verificar que se registró el evento de auditoría PRINT_JOB_REROUTED
    const auditRow = rawDb.prepare("SELECT * FROM audit_events WHERE action = 'PRINT_JOB_REROUTED' AND entity_id = ?").get('job_to_reroute') as any;
    expect(auditRow).toBeDefined();

    // 7.2 Si la elegida es CLIENT_BT (no hay impresora de servidor), responde 409 con NO_SERVER_PRINTER
    // Modificar receipt_printer_id para apuntar a una impresora CLIENT_BT
    rawDb.prepare(`
      INSERT INTO printers (id, name, connection_type, address, columns, codepage, has_cutter, has_buzzer, is_active)
      VALUES ('print_bt_only', 'Bluetooth Only', 'CLIENT_BT', 'AA:BB:CC:DD:EE:00', 32, 16, 0, 0, 1)
    `).run();

    rawDb.prepare("UPDATE business_settings SET receipt_printer_id = 'print_bt_only' WHERE id = 'default'").run();

    rawDb.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, station, status, target, target_terminal_id, payload_bytes, ticket_ir_json, created_at_ms)
      VALUES ('job_reroute_bt_only', 'print_bt_1', 'NOTA_ENTREGA', 'caja', 'en_cola', 'client', ?, ?, ?, ?)
    `).run(terminal1, clientPayloadBytes, JSON.stringify(clientIR), Date.now());

    const resNoServer = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job_reroute_bt_only/reroute',
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'x-terminal-id': terminal1
      },
      payload: { to: 'server' }
    });

    expect(resNoServer.statusCode).toBe(409);
    const noServerBody = resNoServer.json();
    expect(noServerBody.code).toBe('NO_SERVER_PRINTER');

    // Restaurar business_settings
    rawDb.prepare("UPDATE business_settings SET receipt_printer_id = 'print_caja_usb' WHERE id = 'default'").run();
  });
});
