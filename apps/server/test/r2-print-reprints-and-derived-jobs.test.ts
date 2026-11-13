import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
import {
  reprintPrintJob,
  createRefirePrintJob,
  createOrderChangePrintJob,
  resolveAttentionJob
} from '../src/modules/printing/worker.js';
import { recordHeartbeat } from '../src/modules/printing/terminal-registry.js';
import { generateUuidV7 } from '@tocineta/shared';

describe('R2 — Reimpresiones y trabajos derivados respetan destino (r2-print-reprints-and-derived-jobs)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_print_reprints_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_reprints.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let supervisorToken: string;
  let cajeraToken: string;
  let testOrderId: string;

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

    supervisorToken = (await loginAs(app, 'supervisor', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;

    // Abrir jornada y sesión de caja
    const resJornada = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        rateMicroBs: 40_000_000,
        rateStr: '40.00',
        initialCashUsdCents: 5000,
        initialCashBsCents: 100000
      }
    });
    const jornadaId = resJornada.json().jornada.id;

    const resSession = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        jornadaId,
        openingCashUsdCents: 5000,
        openingCashBsCents: 100000
      }
    });
    const sessionId = resSession.json().cashSession.id;

    // Crear orden base para pruebas
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa Reprints',
        fulfillmentType: 'salon',
        lines: [
          { productId: 'prod_texas_mex', quantity: 1 },
          { productId: 'prod_street_dog', quantity: 1 }
        ]
      }
    });
    testOrderId = resOrder.json().order.id;
    rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, testOrderId);
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

  // Helper para registrar terminal y su impresora cliente
  function registerTestTerminal(terminalId: string, label: string = 'Terminal Test') {
    recordHeartbeat(rawDb, terminalId, {
      terminalId,
      label,
      btPrinter: {
        name: `Impresora BT ${terminalId}`,
        mac: 'AA:BB:CC:DD:EE:FF'
      }
    });
    return `print_bt_${terminalId}`;
  }

  // ==========================================================================
  // 1. REIMPRESIÓN DE UN TRABAJO CLIENT CONSERVA TARGET Y TERMINAL
  // ==========================================================================
  describe('Reimpresión (reprintPrintJob)', () => {
    it('la reimpresión de un trabajo client conserva target y target_terminal_id', () => {
      const termId = 'term_client_alpha';
      const printerId = registerTestTerminal(termId);

      const clientJobId = `pjob_${generateUuidV7()}`;
      const dummyIR = {
        title: 'Nota de Entrega Móvil',
        widthColumns: 32,
        blocks: [{ type: 'text', text: 'Nota de Entrega #001', align: 'center' }]
      };

      rawDb.prepare(`
        INSERT INTO print_jobs (
          id, printer_id, order_id, job_type, payload_bytes,
          ticket_ir_json, station, status, attempts, created_at_ms,
          target, target_terminal_id
        ) VALUES (?, ?, ?, 'NOTA_ENTREGA', ?, ?, 'caja', 'impreso', 1, ?, 'client', ?)
      `).run(clientJobId, printerId, testOrderId, Buffer.from('dummy'), JSON.stringify(dummyIR), Date.now(), termId);

      const res = reprintPrintJob(rawDb, {
        jobId: clientJobId,
        pin: '123456',
        reason: 'Ticket deteriorado'
      });

      expect(res.success).toBe(true);
      expect(res.newJobId).toBeDefined();

      const reprinted = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(res.newJobId) as any;
      expect(reprinted).toBeDefined();
      expect(reprinted.job_type).toBe('REIMPRESION');
      expect(reprinted.target).toBe('client');
      expect(reprinted.target_terminal_id).toBe(termId);
      expect(reprinted.printer_id).toBe(printerId);
      expect(reprinted.status).toBe('en_cola');
      expect(reprinted.reprint_count).toBe(1);
      expect(reprinted.reprint_reason).toBe('Ticket deteriorado');
    });

    it('reimpresión vía POST /api/print-jobs/:id/reprint conserva target y terminal para un cliente móvil', async () => {
      const termId = 'term_pos_bravo';
      const printerId = registerTestTerminal(termId);

      const clientJobId = `pjob_${generateUuidV7()}`;
      const dummyIR = {
        title: 'Nota Móvil 2',
        widthColumns: 32,
        blocks: [{ type: 'text', text: 'Nota #002', align: 'center' }]
      };

      rawDb.prepare(`
        INSERT INTO print_jobs (
          id, printer_id, order_id, job_type, payload_bytes,
          ticket_ir_json, station, status, attempts, created_at_ms,
          target, target_terminal_id
        ) VALUES (?, ?, ?, 'NOTA_ENTREGA', ?, ?, 'caja', 'impreso', 1, ?, 'client', ?)
      `).run(clientJobId, printerId, testOrderId, Buffer.from('dummy'), JSON.stringify(dummyIR), Date.now(), termId);

      const response = await app.inject({
        method: 'POST',
        url: `/api/print-jobs/${clientJobId}/reprint`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          pin: '654321',
          reason: 'Cliente extravió comprobante'
        }
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);

      const jobInDb = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(json.newJobId) as any;
      expect(jobInDb.target).toBe('client');
      expect(jobInDb.target_terminal_id).toBe(termId);
      expect(jobInDb.printer_id).toBe(printerId);
    });

    it('la reimpresión de un trabajo server conserva target = server y target_terminal_id = null', () => {
      const serverJobId = `pjob_${generateUuidV7()}`;
      const dummyIR = {
        title: 'Nota Fija',
        widthColumns: 32,
        blocks: [{ type: 'text', text: 'Nota Fija #003', align: 'center' }]
      };

      rawDb.prepare(`
        INSERT INTO print_jobs (
          id, printer_id, order_id, job_type, payload_bytes,
          ticket_ir_json, station, status, attempts, created_at_ms,
          target, target_terminal_id
        ) VALUES (?, 'print_caja_usb', ?, 'NOTA_ENTREGA', ?, ?, 'caja', 'impreso', 1, ?, 'server', NULL)
      `).run(serverJobId, testOrderId, Buffer.from('dummy'), JSON.stringify(dummyIR), Date.now());

      const res = reprintPrintJob(rawDb, {
        jobId: serverJobId,
        pin: '123456',
        reason: 'Copia administrativa'
      });

      expect(res.success).toBe(true);
      const reprinted = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(res.newJobId) as any;
      expect(reprinted.target).toBe('server');
      expect(reprinted.target_terminal_id).toBeNull();
      expect(reprinted.printer_id).toBe('print_caja_usb');
    });
  });

  // ==========================================================================
  // 2. LA REPOSICIÓN DE COCINA RESPETA EL SELECTOR DE COMANDAS
  // ==========================================================================
  describe('Reposición de Cocina (REPOSICION_COCINA y CAMBIO_ORDEN)', () => {
    const testTerminalId = 'term_cook_kds_01';

    beforeEach(() => {
      registerTestTerminal(testTerminalId, 'Tablet Cocina 1');
    });

    it('cuando kitchen_destination = "fixed_printer", la reposición va a la impresora fija (server)', () => {
      rawDb.prepare("UPDATE business_settings SET kitchen_destination = 'fixed_printer', print_mode = 'two' WHERE id = 'default'").run();

      const res = createRefirePrintJob(rawDb, testOrderId, 'Se quemó la hamburguesa', '654321', testTerminalId);
      expect(res.success).toBe(true);

      const job = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(res.newJobId) as any;
      expect(job.job_type).toBe('REPOSICION_COCINA');
      expect(job.target).toBe('server');
      expect(job.target_terminal_id).toBeNull();
      expect(job.printer_id).toBe('print_cocina');
    });

    it('cuando kitchen_destination = "payer_device", la reposición respeta el terminal activo (client)', () => {
      rawDb.prepare("UPDATE business_settings SET kitchen_destination = 'payer_device' WHERE id = 'default'").run();

      const res = createRefirePrintJob(rawDb, testOrderId, 'Plato devuelto por cliente', '654321', testTerminalId);
      expect(res.success).toBe(true);

      const job = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(res.newJobId) as any;
      expect(job.job_type).toBe('REPOSICION_COCINA');
      expect(job.target).toBe('client');
      expect(job.target_terminal_id).toBe(testTerminalId);
      expect(job.printer_id).toContain(testTerminalId);
    });

    it('si requesterTerminalId es nulo o no se proporciona, la reposición sale por la impresora fija de cocina', () => {
      rawDb.prepare("UPDATE business_settings SET kitchen_destination = 'payer_device', print_mode = 'two' WHERE id = 'default'").run();

      const res = createRefirePrintJob(rawDb, testOrderId, 'Reposición sin terminal específico', '654321', null);
      expect(res.success).toBe(true);

      const job = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(res.newJobId) as any;
      expect(job.job_type).toBe('REPOSICION_COCINA');
      expect(job.target).toBe('server');
      expect(job.target_terminal_id).toBeNull();
      expect(job.printer_id).toBe('print_cocina');
    });

    it('POST /api/print-jobs/refire lee header x-terminal-id y enruta a comanda client', async () => {
      rawDb.prepare("UPDATE business_settings SET kitchen_destination = 'payer_device' WHERE id = 'default'").run();

      const response = await app.inject({
        method: 'POST',
        url: '/api/print-jobs/refire',
        headers: {
          authorization: `Bearer ${supervisorToken}`,
          'x-terminal-id': testTerminalId
        },
        payload: {
          orderId: testOrderId,
          reason: 'Reposición urgente vía HTTP',
          pin: '654321'
        }
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);

      const job = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(json.newJobId) as any;
      expect(job.target).toBe('client');
      expect(job.target_terminal_id).toBe(testTerminalId);
    });

    it('CAMBIO_ORDEN respeta el selector de comanda y target client', () => {
      rawDb.prepare("UPDATE business_settings SET kitchen_destination = 'payer_device' WHERE id = 'default'").run();

      const res = createOrderChangePrintJob(
        rawDb,
        testOrderId,
        'MODIFICACION',
        'Cambio sin cebolla por alergia',
        '123456',
        testTerminalId
      );

      expect(res.success).toBe(true);
      const job = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(res.newJobId) as any;
      expect(job.job_type).toBe('CAMBIO_ORDEN');
      expect(job.target).toBe('client');
      expect(job.target_terminal_id).toBe(testTerminalId);
    });

    it('POST /api/orders/:id/incident con refire respeta el header x-terminal-id', async () => {
      rawDb.prepare("UPDATE business_settings SET kitchen_destination = 'payer_device' WHERE id = 'default'").run();

      const response = await app.inject({
        method: 'POST',
        url: `/api/orders/${testOrderId}/incident`,
        headers: {
          authorization: `Bearer ${supervisorToken}`,
          'x-terminal-id': testTerminalId
        },
        payload: {
          reasonCode: 'DEFECTO_PREPARACION',
          responsibleArea: 'cocina',
          resolution: 'refire',
          authorizerPin: '654321',
          description: 'Carne pasada de cocción'
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);

      const job = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(json.printJobId) as any;
      expect(job.job_type).toBe('REPOSICION_COCINA');
      expect(job.target).toBe('client');
      expect(job.target_terminal_id).toBe(testTerminalId);
    });
  });

  // ==========================================================================
  // 3. RETRY_NOW SOBRE UN TRABAJO CLIENT
  // ==========================================================================
  describe('Resolución de fallos (resolveAttentionJob)', () => {
    it('retry_now sobre un trabajo client vuelve a en_cola, limpia attempts, error y claimed_at_ms, conservando target y terminal', () => {
      const termId = 'term_pos_charlie';
      const printerId = registerTestTerminal(termId);

      const jobId = `pjob_${generateUuidV7()}`;
      rawDb.prepare(`
        INSERT INTO print_jobs (
          id, printer_id, order_id, job_type, payload_bytes,
          ticket_ir_json, station, status, attempts, error_message,
          claimed_at_ms, created_at_ms, target, target_terminal_id
        ) VALUES (?, ?, ?, 'NOTA_ENTREGA', ?, '{}', 'caja', 'requiere_atencion', 3, 'Timeout Bluetooth', ?, ?, 'client', ?)
      `).run(jobId, printerId, testOrderId, Buffer.from('bytes'), Date.now() - 60000, Date.now() - 120000, termId);

      const result = resolveAttentionJob(rawDb, jobId, 'retry_now');
      expect(result.success).toBe(true);
      expect(result.status).toBe('en_cola');

      const updated = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(jobId) as any;
      expect(updated.status).toBe('en_cola');
      expect(updated.attempts).toBe(0);
      expect(updated.error_message).toBeNull();
      expect(updated.claimed_at_ms).toBeNull();
      expect(updated.target).toBe('client');
      expect(updated.target_terminal_id).toBe(termId);
    });

    it('POST /api/print-jobs/:id/resolve con retry_now sobre client funciona por HTTP', async () => {
      const termId = 'term_pos_delta';
      const printerId = registerTestTerminal(termId);

      const jobId = `pjob_${generateUuidV7()}`;
      rawDb.prepare(`
        INSERT INTO print_jobs (
          id, printer_id, order_id, job_type, payload_bytes,
          ticket_ir_json, station, status, attempts, error_message,
          claimed_at_ms, created_at_ms, target, target_terminal_id
        ) VALUES (?, ?, ?, 'NOTA_ENTREGA', ?, '{}', 'caja', 'requiere_atencion', 3, 'Papel atascado en POS', ?, ?, 'client', ?)
      `).run(jobId, printerId, testOrderId, Buffer.from('bytes'), Date.now() - 30000, Date.now() - 60000, termId);

      const response = await app.inject({
        method: 'POST',
        url: `/api/print-jobs/${jobId}/resolve`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: { action: 'retry_now' }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.status).toBe('en_cola');

      const jobInDb = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(jobId) as any;
      expect(jobInDb.status).toBe('en_cola');
      expect(jobInDb.target).toBe('client');
      expect(jobInDb.target_terminal_id).toBe(termId);
      expect(jobInDb.claimed_at_ms).toBeNull();
    });

    it('mark_printed sobre un trabajo client marca impreso conservando target y terminal', () => {
      const termId = 'term_pos_echo';
      const printerId = registerTestTerminal(termId);

      const jobId = `pjob_${generateUuidV7()}`;
      rawDb.prepare(`
        INSERT INTO print_jobs (
          id, printer_id, order_id, job_type, payload_bytes,
          ticket_ir_json, station, status, attempts, error_message,
          claimed_at_ms, created_at_ms, target, target_terminal_id
        ) VALUES (?, ?, ?, 'NOTA_ENTREGA', ?, '{}', 'caja', 'requiere_atencion', 3, 'Error transitorio', ?, ?, 'client', ?)
      `).run(jobId, printerId, testOrderId, Buffer.from('bytes'), Date.now() - 10000, Date.now() - 20000, termId);

      const result = resolveAttentionJob(rawDb, jobId, 'mark_printed');
      expect(result.success).toBe(true);
      expect(result.status).toBe('impreso');

      const updated = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(jobId) as any;
      expect(updated.status).toBe('impreso');
      expect(updated.completed_at_ms).toBeGreaterThan(0);
      expect(updated.target).toBe('client');
      expect(updated.target_terminal_id).toBe(termId);
    });
  });
});
