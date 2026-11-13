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
  enqueueOrderPrintJobs,
  resolveTicketTarget,
  PrintingWorker
} from '../src/modules/printing/worker.js';
import { recordHeartbeat, terminalRegistry } from '../src/modules/printing/terminal-registry.js';
import { renderTicketToEscPos, type TicketIR } from '@tocineta/shared';

describe('R2 — Enrutamiento de Nota y Comandas (r2-print-routing)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_print_routing_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_routing.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;
  let cajeraToken: string;
  let jornadaId: string;
  let sessionId: string;
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

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;

    // Abrir jornada
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
    jornadaId = resJornada.json().jornada.id;

    // Abrir sesión de caja
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
    sessionId = resSession.json().cashSession.id;

    // Crear orden base para pruebas directas de enqueue
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa Routing 1',
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

  beforeEach(() => {
    terminalRegistry.clear();
  });

  // Helper para registrar un terminal vivo con impresora Bluetooth
  function makeTerminalAlive(terminalId: string, mac = 'AA:BB:CC:DD:EE:FF') {
    recordHeartbeat(rawDb, terminalId, {
      label: `Caja Movil ${terminalId}`,
      btPrinter: {
        name: `MTP-II-${terminalId}`,
        mac
      }
    });
  }

  // (a) ambos destinos 'payer_device' y terminal viva: nota y comandas son client de ese terminal, con printer print_bt_*
  it("(a) ambos destinos 'payer_device' y terminal viva: nota y comandas son client de ese terminal con print_bt_*", () => {
    const termId = 'term_movil_01';
    makeTerminalAlive(termId);

    rawDb.prepare(`
      UPDATE business_settings
      SET receipt_destination = 'payer_device',
          kitchen_destination = 'payer_device',
          print_flow = 'manual',
          print_delivery_note = 1
      WHERE id = 'default'
    `).run();

    const notaTarget = resolveTicketTarget(rawDb, 'nota', termId);
    expect(notaTarget.target).toBe('client');
    expect(notaTarget.terminalId).toBe(termId);
    expect(notaTarget.printerId).toBe(`print_bt_${termId}`);

    const comandaTarget = resolveTicketTarget(rawDb, 'comanda', termId);
    expect(comandaTarget.target).toBe('client');
    expect(comandaTarget.terminalId).toBe(termId);
    expect(comandaTarget.printerId).toBe(`print_bt_${termId}`);

    const res = enqueueOrderPrintJobs(rawDb, testOrderId, { payerTerminalId: termId });
    expect(res.cajaJobId).toBeTruthy();
    expect(res.kitchenJobIds.length).toBeGreaterThan(0);

    const notaJob = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(res.cajaJobId) as any;
    expect(notaJob.target).toBe('client');
    expect(notaJob.target_terminal_id).toBe(termId);
    expect(notaJob.printer_id).toBe(`print_bt_${termId}`);

    for (const kId of res.kitchenJobIds) {
      const kJob = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(kId) as any;
      expect(kJob.target).toBe('client');
      expect(kJob.target_terminal_id).toBe(termId);
      expect(kJob.printer_id).toBe(`print_bt_${termId}`);
    }
  });

  // (b) mismos ajustes sin latido: nota y comandas caen a las impresoras fijas (server), idéntico a hoy
  it('(b) mismos ajustes sin latido (o sin terminal): nota y comandas caen a las impresoras fijas (server)', () => {
    const offlineTermId = 'term_muerta_99';
    // No registramos latido para offlineTermId

    rawDb.prepare(`
      UPDATE business_settings
      SET receipt_destination = 'payer_device',
          kitchen_destination = 'payer_device',
          receipt_printer_id = 'print_caja_usb',
          print_mode = 'one',
          print_delivery_note = 1
      WHERE id = 'default'
    `).run();

    const notaTarget = resolveTicketTarget(rawDb, 'nota', offlineTermId);
    expect(notaTarget.target).toBe('server');
    expect(notaTarget.terminalId).toBeNull();
    expect(notaTarget.printerId).toBe('print_caja_usb');

    const comandaTarget = resolveTicketTarget(rawDb, 'comanda', offlineTermId);
    expect(comandaTarget.target).toBe('server');
    expect(comandaTarget.terminalId).toBeNull();
    expect(comandaTarget.printerId).toBe('print_caja_usb');

    const res = enqueueOrderPrintJobs(rawDb, testOrderId, { payerTerminalId: offlineTermId });
    const notaJob = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(res.cajaJobId) as any;
    expect(notaJob.target).toBe('server');
    expect(notaJob.target_terminal_id).toBeNull();
    expect(notaJob.printer_id).toBe('print_caja_usb');

    for (const kId of res.kitchenJobIds) {
      const kJob = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(kId) as any;
      expect(kJob.target).toBe('server');
      expect(kJob.target_terminal_id).toBeNull();
      expect(kJob.printer_id).toBe('print_caja_usb');
    }
  });

  // (c) nota 'payer_device' + comandas 'fixed_printer' (USB): nota client, comandas server en la USB
  it("(c) nota 'payer_device' + comandas 'fixed_printer' (USB): nota client, comandas server en la USB", () => {
    const termId = 'term_movil_03';
    makeTerminalAlive(termId);

    rawDb.prepare(`
      UPDATE business_settings
      SET receipt_destination = 'payer_device',
          kitchen_destination = 'fixed_printer',
          receipt_printer_id = 'print_caja_usb',
          print_mode = 'one',
          print_delivery_note = 1
      WHERE id = 'default'
    `).run();

    const notaTarget = resolveTicketTarget(rawDb, 'nota', termId);
    expect(notaTarget.target).toBe('client');
    expect(notaTarget.terminalId).toBe(termId);
    expect(notaTarget.printerId).toBe(`print_bt_${termId}`);

    const comandaTarget = resolveTicketTarget(rawDb, 'comanda', termId);
    expect(comandaTarget.target).toBe('server');
    expect(comandaTarget.terminalId).toBeNull();
    expect(comandaTarget.printerId).toBe('print_caja_usb');

    const res = enqueueOrderPrintJobs(rawDb, testOrderId, { payerTerminalId: termId });
    const notaJob = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(res.cajaJobId) as any;
    expect(notaJob.target).toBe('client');
    expect(notaJob.target_terminal_id).toBe(termId);

    for (const kId of res.kitchenJobIds) {
      const kJob = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(kId) as any;
      expect(kJob.target).toBe('server');
      expect(kJob.target_terminal_id).toBeNull();
      expect(kJob.printer_id).toBe('print_caja_usb');
    }
  });

  // (d) ambos 'fixed_printer': todo server aunque haya terminal viva
  it("(d) ambos 'fixed_printer': todo server aunque haya terminal viva", () => {
    const termId = 'term_movil_04';
    makeTerminalAlive(termId);

    rawDb.prepare(`
      UPDATE business_settings
      SET receipt_destination = 'fixed_printer',
          kitchen_destination = 'fixed_printer',
          receipt_printer_id = 'print_caja_usb',
          print_mode = 'two',
          kitchen_printer_id = 'print_cocina',
          print_delivery_note = 1
      WHERE id = 'default'
    `).run();

    const notaTarget = resolveTicketTarget(rawDb, 'nota', termId);
    expect(notaTarget.target).toBe('server');
    expect(notaTarget.terminalId).toBeNull();
    expect(notaTarget.printerId).toBe('print_caja_usb');

    const comandaTarget = resolveTicketTarget(rawDb, 'comanda', termId);
    expect(comandaTarget.target).toBe('server');
    expect(comandaTarget.terminalId).toBeNull();
    expect(comandaTarget.printerId).toBe('print_cocina');

    const res = enqueueOrderPrintJobs(rawDb, testOrderId, { payerTerminalId: termId });
    const notaJob = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(res.cajaJobId) as any;
    expect(notaJob.target).toBe('server');
    expect(notaJob.target_terminal_id).toBeNull();

    for (const kId of res.kitchenJobIds) {
      const kJob = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(kId) as any;
      expect(kJob.target).toBe('server');
      expect(kJob.target_terminal_id).toBeNull();
      expect(kJob.printer_id).toBe('print_cocina');
    }
  });

  // (e) comandas 'fixed_printer' apuntando a la CLIENT_BT de otro terminal: comanda client con ese dueño aunque el pagador sea otro
  it("(e) comandas 'fixed_printer' apuntando a CLIENT_BT de otro terminal: comanda client con ese dueño aunque el pagador sea otro", () => {
    const payerTermId = 'term_cajera_01';
    const kitchenTermId = 'term_cocina_02';

    makeTerminalAlive(payerTermId);
    makeTerminalAlive(kitchenTermId);

    // kitchen_printer_id apunta a la impresora bluetooth del terminal de cocina
    const kitchenPrinterId = `print_bt_${kitchenTermId}`;

    rawDb.prepare(`
      UPDATE business_settings
      SET receipt_destination = 'payer_device',
          kitchen_destination = 'fixed_printer',
          receipt_printer_id = 'print_caja_usb',
          print_mode = 'two',
          kitchen_printer_id = ?,
          print_delivery_note = 1
      WHERE id = 'default'
    `).run(kitchenPrinterId);

    const comandaTarget = resolveTicketTarget(rawDb, 'comanda', payerTermId);
    expect(comandaTarget.target).toBe('client');
    expect(comandaTarget.terminalId).toBe(kitchenTermId);
    expect(comandaTarget.printerId).toBe(kitchenPrinterId);

    const res = enqueueOrderPrintJobs(rawDb, testOrderId, { payerTerminalId: payerTermId });
    const notaJob = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(res.cajaJobId) as any;
    expect(notaJob.target).toBe('client');
    expect(notaJob.target_terminal_id).toBe(payerTermId);

    for (const kId of res.kitchenJobIds) {
      const kJob = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(kId) as any;
      expect(kJob.target).toBe('client');
      expect(kJob.target_terminal_id).toBe(kitchenTermId);
      expect(kJob.printer_id).toBe(kitchenPrinterId);
    }
  });

  // (f) manual: todo 'pending' en cada caso; auto: 'en_cola'
  it("(f) manual: todo 'pending' en cada caso; auto: 'en_cola'", () => {
    const termId = 'term_flujo_06';
    makeTerminalAlive(termId);

    // Flujo manual
    rawDb.prepare(`
      UPDATE business_settings
      SET print_flow = 'manual',
          receipt_destination = 'payer_device',
          kitchen_destination = 'fixed_printer',
          receipt_printer_id = 'print_caja_usb',
          print_mode = 'one',
          print_delivery_note = 1
      WHERE id = 'default'
    `).run();

    const manualRes = enqueueOrderPrintJobs(rawDb, testOrderId, { payerTerminalId: termId });
    const manualNota = rawDb.prepare('SELECT status FROM print_jobs WHERE id = ?').get(manualRes.cajaJobId) as any;
    expect(manualNota.status).toBe('pending');

    for (const kId of manualRes.kitchenJobIds) {
      const kJob = rawDb.prepare('SELECT status FROM print_jobs WHERE id = ?').get(kId) as any;
      expect(kJob.status).toBe('pending');
    }

    // Flujo auto
    rawDb.prepare(`
      UPDATE business_settings
      SET print_flow = 'auto',
          receipt_destination = 'payer_device',
          kitchen_destination = 'payer_device',
          print_delivery_note = 1
      WHERE id = 'default'
    `).run();

    const autoRes = enqueueOrderPrintJobs(rawDb, testOrderId, { payerTerminalId: termId });
    const autoNota = rawDb.prepare('SELECT status FROM print_jobs WHERE id = ?').get(autoRes.cajaJobId) as any;
    expect(autoNota.status).toBe('en_cola');

    for (const kId of autoRes.kitchenJobIds) {
      const kJob = rawDb.prepare('SELECT status FROM print_jobs WHERE id = ?').get(kId) as any;
      expect(kJob.status).toBe('en_cola');
    }
  });

  // (g) processQueue no toma trabajos client (usa los transportes simulados existentes)
  it('(g) processQueue no toma trabajos client (usa los transportes simulados existentes)', async () => {
    const termId = 'term_worker_07';
    makeTerminalAlive(termId);

    const now = Date.now();
    const testIR: TicketIR = {
      title: 'Ticket Test Routing',
      widthColumns: 32,
      blocks: [{ type: 'title_double', text: 'TEST ROUTING', align: 'center' }]
    };
    const testBytes = Buffer.from(renderTicketToEscPos(testIR));

    const serverJobId = `pjob_srv_${Date.now()}`;
    const clientJobId = `pjob_cli_${Date.now()}`;

    // Job para servidor (física USB) en_cola
    rawDb.prepare(`
      INSERT INTO print_jobs (
        id, printer_id, order_id, job_type, payload_bytes, ticket_ir_json,
        station, status, attempts, created_at_ms, target, target_terminal_id
      ) VALUES (?, 'print_caja_usb', NULL, 'TEST', ?, ?, 'caja', 'en_cola', 0, ?, 'server', NULL)
    `).run(serverJobId, testBytes, JSON.stringify(testIR), now);

    // Job para cliente (bluetooth móvil) en_cola
    rawDb.prepare(`
      INSERT INTO print_jobs (
        id, printer_id, order_id, job_type, payload_bytes, ticket_ir_json,
        station, status, attempts, created_at_ms, target, target_terminal_id
      ) VALUES (?, ?, NULL, 'TEST', ?, ?, 'caja', 'en_cola', 0, ?, 'client', ?)
    `).run(clientJobId, `print_bt_${termId}`, testBytes, JSON.stringify(testIR), now, termId);

    const worker = app.printingWorker ?? new PrintingWorker(rawDb);
    await worker.processQueue();

    // El trabajo server debe haber sido procesado a 'impreso'
    const srvRow = rawDb.prepare('SELECT status, attempts FROM print_jobs WHERE id = ?').get(serverJobId) as any;
    expect(srvRow.status).toBe('impreso');
    expect(srvRow.attempts).toBe(1);

    // El trabajo client debe permanecer intacto en 'en_cola' y no haber sido procesado por el worker
    const cliRow = rawDb.prepare('SELECT status, attempts FROM print_jobs WHERE id = ?').get(clientJobId) as any;
    expect(cliRow.status).toBe('en_cola');
    expect(cliRow.attempts).toBe(0);
  });

  // Integración HTTP: POST /api/orders/:id/pay lee x-terminal-id (8-64 chars) y enruta correctamente
  it('Integración HTTP: POST /api/orders/:id/pay lee header x-terminal-id y encola como client', async () => {
    const httpTermId = 'term_http_caja_08';
    makeTerminalAlive(httpTermId);

    rawDb.prepare(`
      UPDATE business_settings
      SET receipt_destination = 'payer_device',
          kitchen_destination = 'payer_device',
          print_flow = 'auto',
          print_delivery_note = 1
      WHERE id = 'default'
    `).run();

    // Crear una orden nueva
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa HTTP Pay',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_texas_mex', quantity: 1 }]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;
    rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, order.id);

    // Pagar enviando x-terminal-id
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'x-terminal-id': httpTermId
      },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 690 }]
      }
    });
    expect(resPay.statusCode).toBe(200);

    // Verificar que los trabajos generados tengan target client y terminalId = httpTermId
    const jobs = rawDb.prepare('SELECT * FROM print_jobs WHERE order_id = ?').all(order.id) as any[];
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.target).toBe('client');
      expect(j.target_terminal_id).toBe(httpTermId);
      expect(j.printer_id).toBe(`print_bt_${httpTermId}`);
    }
  });

  it('Integración HTTP: Si x-terminal-id es inválido (< 8 caracteres), se ignora y cae a null (fixed_printer)', async () => {
    rawDb.prepare(`
      UPDATE business_settings
      SET receipt_destination = 'payer_device',
          kitchen_destination = 'payer_device',
          receipt_printer_id = 'print_caja_usb',
          print_mode = 'one',
          print_flow = 'auto',
          print_delivery_note = 1
      WHERE id = 'default'
    `).run();

    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa Invalid Header',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_texas_mex', quantity: 1 }]
      }
    });
    const order = resOrder.json().order;
    rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, order.id);

    // x-terminal-id con solo 3 caracteres (inválido según regla de 8-64 chars)
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'x-terminal-id': 'abc'
      },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 690 }]
      }
    });
    expect(resPay.statusCode).toBe(200);

    const jobs = rawDb.prepare('SELECT * FROM print_jobs WHERE order_id = ?').all(order.id) as any[];
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.target).toBe('server');
      expect(j.target_terminal_id).toBeNull();
      expect(j.printer_id).toBe('print_caja_usb');
    }
  });
});
