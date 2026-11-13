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
import { seedCatalog } from '../src/db/seed-catalog.js';
import { ensureBusinessSettingsDefensive } from '../src/db/business-settings.js';
import { loginAs } from './test-helpers.js';
import { PrintingWorker } from '../src/modules/printing/worker.js';
import { recordHeartbeat, terminalRegistry } from '../src/modules/printing/terminal-registry.js';

describe('R2 — Enrutamiento E2E de Impresión Móvil y Fija (r2-print-e2e-routing)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_print_e2e_routing_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_e2e_routing.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;
  let cajeraToken: string;
  let jornadaId: string;
  let sessionId: string;

  beforeAll(async () => {
    process.env.PRINTER_DEV_SIMULATION = 'true';
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureBusinessSettingsDefensive(rawDb);

    rawDb.prepare(`
      UPDATE printers
      SET codepage = 2, connection_type = 'SPOOLER_RAW_USB', address = 'POS-80-USB'
      WHERE id = 'print_caja_usb'
    `).run();

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
    rawDb.prepare('DELETE FROM print_jobs').run();
  });

  function registerTerminal(termId: string, mac: string) {
    recordHeartbeat(rawDb, termId, {
      label: `Caja Movil ${termId}`,
      btPrinter: {
        name: `MTP-II-${termId}`,
        mac
      }
    });
  }

  async function createOrder(tableNumber: string): Promise<any> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber,
        fulfillmentType: 'salon',
        lines: [
          { productId: 'prod_texas_mex', quantity: 1 },
          { productId: 'prod_street_dog', quantity: 1 }
        ]
      }
    });
    expect(res.statusCode).toBe(201);
    const order = res.json().order;
    rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, order.id);
    return order;
  }

  async function payOrder(orderId: string, totalCents: number, terminalId?: string) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${cajeraToken}`
    };
    if (terminalId) {
      headers['x-terminal-id'] = terminalId;
    }
    return app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers,
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: totalCents }]
      }
    });
  }

  // Escenario 1 (ajustes por defecto, ambos 'payer_device'): dos terminales (term_a y term_b) con latido
  // y su impresora Bluetooth; dos cobros simultáneos (Promise.all, órdenes distintas, header x-terminal-id distinto).
  // Verifica que la nota y las comandas de cada orden son client de SU terminal, que el claim cruzado da 403
  // y que cada terminal completa sus trabajos.
  it('Escenario 1 (ajustes por defecto, ambos \'payer_device\'): dos terminales con latido y su impresora Bluetooth; dos cobros simultáneos con Promise.all; nota y comandas client de su terminal; claim cruzado da 403; cada terminal completa sus trabajos', async () => {
    rawDb.prepare(`
      UPDATE business_settings
      SET receipt_destination = 'payer_device',
          kitchen_destination = 'payer_device',
          print_flow = 'auto',
          print_delivery_note = 1
      WHERE id = 'default'
    `).run();

    const termA = 'term_movil_a';
    const termB = 'term_movil_b';
    registerTerminal(termA, 'AA:00:00:00:00:01');
    registerTerminal(termB, 'AA:00:00:00:00:02');

    const orderA = await createOrder('Mesa Escenario 1-A');
    const orderB = await createOrder('Mesa Escenario 1-B');

    const [resPayA, resPayB] = await Promise.all([
      payOrder(orderA.id, orderA.total_to_collect_usd_cents, termA),
      payOrder(orderB.id, orderB.total_to_collect_usd_cents, termB)
    ]);

    expect(resPayA.statusCode).toBe(200);
    expect(resPayB.statusCode).toBe(200);

    const jobsA = rawDb.prepare('SELECT * FROM print_jobs WHERE order_id = ?').all(orderA.id) as any[];
    const jobsB = rawDb.prepare('SELECT * FROM print_jobs WHERE order_id = ?').all(orderB.id) as any[];

    expect(jobsA.length).toBeGreaterThanOrEqual(2);
    expect(jobsB.length).toBeGreaterThanOrEqual(2);

    // Nota y comandas de orderA son client de termA
    for (const j of jobsA) {
      expect(j.target).toBe('client');
      expect(j.target_terminal_id).toBe(termA);
      expect(j.printer_id).toBe(`print_bt_${termA}`);
    }

    // Nota y comandas de orderB son client de termB
    for (const j of jobsB) {
      expect(j.target).toBe('client');
      expect(j.target_terminal_id).toBe(termB);
      expect(j.printer_id).toBe(`print_bt_${termB}`);
    }

    // Claim cruzado da 403: termB intentando reclamar trabajo de termA
    const crossRes1 = await app.inject({
      method: 'POST',
      url: `/api/print-jobs/${jobsA[0].id}/claim`,
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'x-terminal-id': termB
      }
    });
    expect(crossRes1.statusCode).toBe(403);
    expect(crossRes1.json().code).toBe('FORBIDDEN_TERMINAL');

    // Claim cruzado da 403: termA intentando reclamar trabajo de termB
    const crossRes2 = await app.inject({
      method: 'POST',
      url: `/api/print-jobs/${jobsB[0].id}/claim`,
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'x-terminal-id': termA
      }
    });
    expect(crossRes2.statusCode).toBe(403);
    expect(crossRes2.json().code).toBe('FORBIDDEN_TERMINAL');

    // Cada terminal completa sus trabajos
    for (const job of jobsA) {
      const claimRes = await app.inject({
        method: 'POST',
        url: `/api/print-jobs/${job.id}/claim`,
        headers: {
          authorization: `Bearer ${cajeraToken}`,
          'x-terminal-id': termA
        }
      });
      expect(claimRes.statusCode).toBe(200);

      const compRes = await app.inject({
        method: 'POST',
        url: `/api/print-jobs/${job.id}/complete`,
        headers: {
          authorization: `Bearer ${cajeraToken}`,
          'x-terminal-id': termA
        },
        payload: { ok: true }
      });
      expect(compRes.statusCode).toBe(200);
      expect(compRes.json().status).toBe('impreso');

      const inDb = rawDb.prepare('SELECT status FROM print_jobs WHERE id = ?').get(job.id) as any;
      expect(inDb.status).toBe('impreso');
    }

    for (const job of jobsB) {
      const claimRes = await app.inject({
        method: 'POST',
        url: `/api/print-jobs/${job.id}/claim`,
        headers: {
          authorization: `Bearer ${cajeraToken}`,
          'x-terminal-id': termB
        }
      });
      expect(claimRes.statusCode).toBe(200);

      const compRes = await app.inject({
        method: 'POST',
        url: `/api/print-jobs/${job.id}/complete`,
        headers: {
          authorization: `Bearer ${cajeraToken}`,
          'x-terminal-id': termB
        },
        payload: { ok: true }
      });
      expect(compRes.statusCode).toBe(200);
      expect(compRes.json().status).toBe('impreso');

      const inDb = rawDb.prepare('SELECT status FROM print_jobs WHERE id = ?').get(job.id) as any;
      expect(inDb.status).toBe('impreso');
    }
  });

  // Escenario 2 (nota 'payer_device', comandas 'fixed_printer' = USB): las notas son client de cada terminal;
  // las comandas son server, salen en serie por la USB con la pausa de 250 ms (reloj simulado).
  it('Escenario 2 (nota \'payer_device\', comandas \'fixed_printer\' = USB): las notas son client de cada terminal; las comandas son server, salen en serie por la USB con la pausa de 250 ms (reloj simulado)', async () => {
    rawDb.prepare(`
      UPDATE business_settings
      SET receipt_destination = 'payer_device',
          kitchen_destination = 'fixed_printer',
          receipt_printer_id = 'print_caja_usb',
          kitchen_printer_id = 'print_caja_usb',
          print_flow = 'auto',
          print_delivery_note = 1
      WHERE id = 'default'
    `).run();

    const termA = 'term_movil_a';
    const termB = 'term_movil_b';
    registerTerminal(termA, 'AA:00:00:00:00:01');
    registerTerminal(termB, 'AA:00:00:00:00:02');

    const orderA = await createOrder('Mesa Escenario 2-A');
    const orderB = await createOrder('Mesa Escenario 2-B');

    await payOrder(orderA.id, orderA.total_to_collect_usd_cents, termA);
    await payOrder(orderB.id, orderB.total_to_collect_usd_cents, termB);

    const jobsA = rawDb.prepare('SELECT * FROM print_jobs WHERE order_id = ?').all(orderA.id) as any[];
    const jobsB = rawDb.prepare('SELECT * FROM print_jobs WHERE order_id = ?').all(orderB.id) as any[];

    // Las notas son client de cada terminal
    const notaA = jobsA.find(j => j.job_type === 'NOTA_ENTREGA');
    expect(notaA.target).toBe('client');
    expect(notaA.target_terminal_id).toBe(termA);

    const notaB = jobsB.find(j => j.job_type === 'NOTA_ENTREGA');
    expect(notaB.target).toBe('client');
    expect(notaB.target_terminal_id).toBe(termB);

    // Las comandas son server dirigidas a la USB
    const comandasA = jobsA.filter(j => j.job_type === 'TICKET_COCINA');
    expect(comandasA.length).toBeGreaterThan(0);
    for (const c of comandasA) {
      expect(c.target).toBe('server');
      expect(c.target_terminal_id).toBeNull();
      expect(c.printer_id).toBe('print_caja_usb');
    }

    const comandasB = jobsB.filter(j => j.job_type === 'TICKET_COCINA');
    expect(comandasB.length).toBeGreaterThan(0);
    for (const c of comandasB) {
      expect(c.target).toBe('server');
      expect(c.target_terminal_id).toBeNull();
      expect(c.printer_id).toBe('print_caja_usb');
    }

    // Salen en serie por la USB con la pausa de 250 ms (reloj simulado)
    vi.useFakeTimers();
    const worker = app.printingWorker ?? new PrintingWorker(rawDb, { mockTransports: true });

    const queuePromise = worker.processQueue();
    await vi.advanceTimersByTimeAsync(3000);
    await queuePromise;
    vi.useRealTimers();

    const printedComandas = rawDb.prepare(`
      SELECT * FROM print_jobs 
      WHERE job_type = 'TICKET_COCINA' AND order_id IN (?, ?)
      ORDER BY completed_at_ms ASC
    `).all(orderA.id, orderB.id) as any[];

    expect(printedComandas.length).toBeGreaterThanOrEqual(2);
    for (const c of printedComandas) {
      expect(c.status).toBe('impreso');
      expect(c.completed_at_ms).toBeTruthy();
    }

    // Verificar pausa de al menos 240 ms entre trabajos consecutivos a la misma impresora USB
    for (let i = 1; i < printedComandas.length; i++) {
      const prev = printedComandas[i - 1];
      const curr = printedComandas[i];
      const diff = curr.completed_at_ms - prev.completed_at_ms;
      expect(diff).toBeGreaterThanOrEqual(240);
    }

    // Las notas siguen intactas como client y en_cola
    const notaARefreshed = rawDb.prepare('SELECT status, target FROM print_jobs WHERE id = ?').get(notaA.id) as any;
    expect(notaARefreshed.target).toBe('client');
    expect(notaARefreshed.status).toBe('en_cola');
  });

  // Escenario 3 (ambos 'fixed_printer'): comportamiento original, todo server aunque haya terminales vivos.
  it('Escenario 3 (ambos \'fixed_printer\'): comportamiento original, todo server aunque haya terminales vivos', async () => {
    rawDb.prepare(`
      UPDATE business_settings
      SET receipt_destination = 'fixed_printer',
          kitchen_destination = 'fixed_printer',
          receipt_printer_id = 'print_caja_usb',
          kitchen_printer_id = 'print_caja_usb',
          print_flow = 'auto',
          print_delivery_note = 1
      WHERE id = 'default'
    `).run();

    const termA = 'term_movil_a';
    registerTerminal(termA, 'AA:00:00:00:00:01');

    const order = await createOrder('Mesa Escenario 3');
    await payOrder(order.id, order.total_to_collect_usd_cents, termA);

    const jobs = rawDb.prepare('SELECT * FROM print_jobs WHERE order_id = ?').all(order.id) as any[];
    expect(jobs.length).toBeGreaterThanOrEqual(2);

    for (const j of jobs) {
      expect(j.target).toBe('server');
      expect(j.target_terminal_id).toBeNull();
      expect(j.printer_id).toBe('print_caja_usb');
    }
  });

  // Escenario 4: el terminal deja de enviar latido; el siguiente cobro envía nota y comandas a las impresoras fijas.
  it('Escenario 4: el terminal deja de enviar latido; el siguiente cobro envía nota y comandas a las impresoras fijas', async () => {
    rawDb.prepare(`
      UPDATE business_settings
      SET receipt_destination = 'payer_device',
          kitchen_destination = 'payer_device',
          receipt_printer_id = 'print_caja_usb',
          kitchen_printer_id = 'print_caja_usb',
          print_flow = 'auto',
          print_delivery_note = 1
      WHERE id = 'default'
    `).run();

    const termDead = 'term_offline_99';
    registerTerminal(termDead, 'AA:00:00:00:00:99');

    // Simular que el terminal deja de enviar latido (último latido supera el TTL de 90s)
    const reg = terminalRegistry.get(termDead);
    if (reg) {
      reg.lastSeenMs = Date.now() - 100_000;
    }

    const order = await createOrder('Mesa Escenario 4');
    await payOrder(order.id, order.total_to_collect_usd_cents, termDead);

    const jobs = rawDb.prepare('SELECT * FROM print_jobs WHERE order_id = ?').all(order.id) as any[];
    expect(jobs.length).toBeGreaterThanOrEqual(2);

    for (const j of jobs) {
      expect(j.target).toBe('server');
      expect(j.target_terminal_id).toBeNull();
      expect(j.printer_id).toBe('print_caja_usb');
    }
  });

  // Escenario 5: un trabajo client reclamado y nunca completado vuelve a en_cola tras el vencimiento.
  it('Escenario 5: un trabajo client reclamado y nunca completado vuelve a en_cola tras el vencimiento', async () => {
    rawDb.prepare(`
      UPDATE business_settings
      SET receipt_destination = 'payer_device',
          kitchen_destination = 'payer_device',
          print_flow = 'auto',
          print_delivery_note = 1
      WHERE id = 'default'
    `).run();

    const termA = 'term_movil_a';
    registerTerminal(termA, 'AA:00:00:00:00:01');

    const order = await createOrder('Mesa Escenario 5');
    await payOrder(order.id, order.total_to_collect_usd_cents, termA);

    const notaJob = rawDb.prepare('SELECT * FROM print_jobs WHERE order_id = ? AND job_type = \'NOTA_ENTREGA\'').get(order.id) as any;
    expect(notaJob.status).toBe('en_cola');

    // Terminal A reclama el trabajo
    const claimRes = await app.inject({
      method: 'POST',
      url: `/api/print-jobs/${notaJob.id}/claim`,
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'x-terminal-id': termA
      }
    });
    expect(claimRes.statusCode).toBe(200);

    const claimedJob = rawDb.prepare('SELECT status, attempts, claimed_at_ms FROM print_jobs WHERE id = ?').get(notaJob.id) as any;
    expect(claimedJob.status).toBe('imprimiendo');
    expect(claimedJob.attempts).toBe(1);
    expect(claimedJob.claimed_at_ms).toBeTruthy();

    // Vencimiento con reloj simulado tras 70s (> 60s TTL)
    const worker = app.printingWorker ?? new PrintingWorker(rawDb);
    const reclaimResult = worker.reclaimStaleClientJobs(Date.now() + 70_000);

    expect(reclaimResult.reclaimedToQueue).toBeGreaterThanOrEqual(1);

    const expiredJob = rawDb.prepare('SELECT status, claimed_at_ms, error_message FROM print_jobs WHERE id = ?').get(notaJob.id) as any;
    expect(expiredJob.status).toBe('en_cola');
    expect(expiredJob.claimed_at_ms).toBeNull();
    expect(expiredJob.error_message).toContain('expirado');
  });

  // Escenario 6: comandas 'fixed_printer' apuntando a la Bluetooth de term_b mientras cobra term_a:
  // la comanda es client de term_b y la nota es client de term_a.
  it('Escenario 6: comandas \'fixed_printer\' apuntando a la Bluetooth de term_b mientras cobra term_a: la comanda es client de term_b y la nota es client de term_a', async () => {
    const termA = 'term_movil_a';
    const termB = 'term_movil_b';
    registerTerminal(termA, 'AA:00:00:00:00:01');
    registerTerminal(termB, 'AA:00:00:00:00:02');

    const printerBtB = `print_bt_${termB}`;

    // kitchen_destination = 'fixed_printer' apuntando a printerBtB en modo two
    rawDb.prepare(`
      UPDATE business_settings
      SET receipt_destination = 'payer_device',
          kitchen_destination = 'fixed_printer',
          receipt_printer_id = 'print_caja_usb',
          print_mode = 'two',
          kitchen_printer_id = ?,
          print_flow = 'auto',
          print_delivery_note = 1
      WHERE id = 'default'
    `).run(printerBtB);

    const order = await createOrder('Mesa Escenario 6');
    await payOrder(order.id, order.total_to_collect_usd_cents, termA);

    const jobs = rawDb.prepare('SELECT * FROM print_jobs WHERE order_id = ?').all(order.id) as any[];
    const nota = jobs.find(j => j.job_type === 'NOTA_ENTREGA');
    const comandas = jobs.filter(j => j.job_type === 'TICKET_COCINA');

    // Nota es client de term_a
    expect(nota.target).toBe('client');
    expect(nota.target_terminal_id).toBe(termA);
    expect(nota.printer_id).toBe(`print_bt_${termA}`);

    // Comanda es client de term_b
    expect(comandas.length).toBeGreaterThan(0);
    for (const c of comandas) {
      expect(c.target).toBe('client');
      expect(c.target_terminal_id).toBe(termB);
      expect(c.printer_id).toBe(printerBtB);
    }
  });

  // Escenario 7: se cambia el selector de comandas en Ajustes (PATCH) entre dos cobros
  // y el segundo cobro ya usa el destino nuevo, sin reiniciar el servidor.
  it('Escenario 7: se cambia el selector de comandas en Ajustes (PATCH) entre dos cobros y el segundo cobro ya usa el destino nuevo, sin reiniciar el servidor', async () => {
    const termA = 'term_movil_a';
    registerTerminal(termA, 'AA:00:00:00:00:01');

    // Inicialmente kitchen_destination = 'payer_device'
    rawDb.prepare(`
      UPDATE business_settings
      SET receipt_destination = 'payer_device',
          kitchen_destination = 'payer_device',
          receipt_printer_id = 'print_caja_usb',
          kitchen_printer_id = 'print_caja_usb',
          print_flow = 'auto',
          print_delivery_note = 1
      WHERE id = 'default'
    `).run();

    // Primer cobro con termA
    const order1 = await createOrder('Mesa Escenario 7-1');
    await payOrder(order1.id, order1.total_to_collect_usd_cents, termA);

    const comandas1 = rawDb.prepare(`
      SELECT * FROM print_jobs WHERE order_id = ? AND job_type = 'TICKET_COCINA'
    `).all(order1.id) as any[];
    expect(comandas1.length).toBeGreaterThan(0);
    for (const c of comandas1) {
      expect(c.target).toBe('client');
      expect(c.target_terminal_id).toBe(termA);
    }

    // Cambiar selector de comandas a 'fixed_printer' vía PATCH /api/business-settings
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/business-settings',
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {
        kitchen_destination: 'fixed_printer',
        kitchen_printer_id: 'print_caja_usb'
      }
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().settings.kitchen_destination).toBe('fixed_printer');

    // Segundo cobro con termA sin reiniciar el servidor
    const order2 = await createOrder('Mesa Escenario 7-2');
    await payOrder(order2.id, order2.total_to_collect_usd_cents, termA);

    const nota2 = rawDb.prepare(`
      SELECT * FROM print_jobs WHERE order_id = ? AND job_type = 'NOTA_ENTREGA'
    `).get(order2.id) as any;
    expect(nota2.target).toBe('client');
    expect(nota2.target_terminal_id).toBe(termA);

    const comandas2 = rawDb.prepare(`
      SELECT * FROM print_jobs WHERE order_id = ? AND job_type = 'TICKET_COCINA'
    `).all(order2.id) as any[];
    expect(comandas2.length).toBeGreaterThan(0);
    for (const c of comandas2) {
      expect(c.target).toBe('server');
      expect(c.target_terminal_id).toBeNull();
      expect(c.printer_id).toBe('print_caja_usb');
    }
  });
});
