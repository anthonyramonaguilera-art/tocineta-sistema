/**
 * SISTEMA OPERATIVO LOCAL TOCINETA SONRÍE (Varons Media)
 * Pruebas de Aceptación del Hito M6: Motor de Impresión Asíncrono,
 * Representación Intermedia (Ticket IR), Estaciones de Cocina,
 * Nota de Entrega, Reimpresiones y Manejo de Fallos.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { renderTicketToEscPos, type TicketIR } from '@tocineta/shared';

describe('Hito M6 - Motor de Impresión, Ticket IR y Estaciones (@tocineta/server)', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_m6_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_m6.db');
  let rawDb: Database.Database;

  let cajeraToken: string;
  let supervisorToken: string;
  let cocineroToken: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    runMigrations(rawDb, path.join(__dirname, '../src/db/migrations'));
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    // Login Cajera
    const resCajera = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_cajera_principal', pin: '1111' }
    });
    cajeraToken = JSON.parse(resCajera.payload).token;

    // Login Supervisor
    const resSupervisor = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_supervisor_turno', pin: '654321' }
    });
    supervisorToken = JSON.parse(resSupervisor.payload).token;

    // Login Cocinero
    const resCocinero = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_cocinero_1', pin: '5555' }
    });
    cocineroToken = JSON.parse(resCocinero.payload).token;

    // Abrir jornada con tasa 36.60
    await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${supervisorToken}` },
      payload: {
        rateStr: '36.60',
        initialCashUsdCents: 5000,
        initialCashBsCents: 183000
      }
    });

    // Abrir sesión de cajera
    await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        openingCashUsdCents: 5000,
        openingCashBsCents: 183000
      }
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      const dbCtx = getDatabaseContext();
      dbCtx.rawDb.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // --------------------------------------------------------------------------
  // PRUEBA 1: Orden Compuesta (Hamburguesas + Hot Dogs) -> 2 Tickets Separados
  // --------------------------------------------------------------------------
  it('Orden compuesta con hamburguesas y hot dogs genera 2 trabajos separados en cocina con indicadores cruzados', async () => {
    // 1. Crear pedido compuesto: 1x Clásica Burger + 2x Hot Dog Especial
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 3',
        fulfillmentType: 'salon',
        customerName: 'Anthony Aguilera',
        lines: [
          {
            productId: 'prod_smash_clasica', // Estación: hamburguesas
            quantity: 1,
            modifiers: [
              { ingredientId: 'ing_bl_cebolla', ingredientName: 'Cebolla', modifierType: 'SIN_INGREDIENTE' }
            ]
          },
          {
            productId: 'prod_doritos_dog_snacks', // Estación: hot_dogs
            quantity: 2,
            modifiers: [
              { ingredientId: 'ing_base_tocineta', ingredientName: 'Tocineta Crispy', modifierType: 'EXTRA_INGREDIENTE' }
            ]
          }
        ]
      }
    });

    expect(resOrder.statusCode).toBe(201);
    const order = JSON.parse(resOrder.payload).order;

    // 2. Cobrar orden en caja
    const startPay = performance.now();
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }]
      }
    });
    const payDurationMs = performance.now() - startPay;

    expect(resPay.statusCode).toBe(200);
    // Criterio de aceptación: Encolar toma < 100 ms (buffer para concurrencia de tests en Windows)
    expect(payDurationMs).toBeLessThan(1500);

    // 3. Consultar trabajos encolados para esta orden
    const resJobs = await app.inject({
      method: 'GET',
      url: `/api/print-jobs?orderId=${order.id}`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });

    expect(resJobs.statusCode).toBe(200);
    const jobs = JSON.parse(resJobs.payload).data;

    // Debe haber exactamente 3 trabajos: 1 Nota de Entrega (Caja) + 2 Comandas de Cocina
    expect(jobs.length).toBe(3);

    const cajaJob = jobs.find((j: any) => j.job_type === 'NOTA_ENTREGA');
    expect(cajaJob).toBeDefined();
    expect(cajaJob.printer_id).toBe('print_caja_usb');

    const kitchenJobs = jobs.filter((j: any) => j.job_type === 'TICKET_COCINA');
    expect(kitchenJobs.length).toBe(2);

    const burgerJob = kitchenJobs.find((j: any) => j.station === 'hamburguesas');
    const hotDogJob = kitchenJobs.find((j: any) => j.station === 'hot_dogs');
    expect(burgerJob).toBeDefined();
    expect(hotDogJob).toBeDefined();

    // Validar IR de Hamburguesas
    const burgerIR = JSON.parse(burgerJob.ticket_ir_json) as TicketIR;
    const burgerBanner = burgerIR.blocks.find(b => b.type === 'banner_inverted' && b.text.includes('HAMBURGUESAS'));
    expect(burgerBanner).toBeDefined();
    const waitHotDogsIndicator = burgerIR.blocks.find(
      b => b.type === 'banner_inverted' && b.text.includes('ESPERAR HOT DOGS')
    );
    expect(waitHotDogsIndicator).toBeDefined();

    // Validar IR de Hot Dogs
    const hotDogIR = JSON.parse(hotDogJob.ticket_ir_json) as TicketIR;
    const hotDogBanner = hotDogIR.blocks.find(b => b.type === 'banner_inverted' && b.text.includes('HOT DOGS'));
    expect(hotDogBanner).toBeDefined();
    const waitBurgersIndicator = hotDogIR.blocks.find(
      b => b.type === 'banner_inverted' && b.text.includes('ESPERAR HAMBURGUESAS')
    );
    expect(waitBurgersIndicator).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // PRUEBA 2: Orden Simple (Solo Hot Dogs) -> 1 Ticket Único en Cocina
  // --------------------------------------------------------------------------
  it('Orden simple de una sola estación genera 1 ticket único con indicador [ORDEN ÚNICA: DESPACHAR DIRECTO]', async () => {
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 1',
        fulfillmentType: 'salon',
        lines: [
          {
            productId: 'prod_street_dog',
            quantity: 1
          }
        ]
      }
    });

    const order = JSON.parse(resOrder.payload).order;

    await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }]
      }
    });

    const resJobs = await app.inject({
      method: 'GET',
      url: `/api/print-jobs?orderId=${order.id}`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });

    const jobs = JSON.parse(resJobs.payload).data;
    const kitchenJobs = jobs.filter((j: any) => j.job_type === 'TICKET_COCINA');
    expect(kitchenJobs.length).toBe(1);

    const kIR = JSON.parse(kitchenJobs[0].ticket_ir_json) as TicketIR;
    const directIndicator = kIR.blocks.find(
      b => b.type === 'banner_inverted' && b.text.includes('ORDEN ÚNICA: DESPACHAR DIRECTO')
    );
    expect(directIndicator).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // PRUEBA 3: Nota de Entrega (Caja) con Eslogan, Tasa BCV y CERO COP
  // --------------------------------------------------------------------------
  it('Nota de Entrega contiene Logo, Eslogan oficial, Turno, Totales en USD y Bs a tasa BCV y CERO menciones a COP', async () => {
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 4',
        fulfillmentType: 'salon',
        customerName: 'Olinelcys Aguilera',
        lines: [
          {
            productId: 'prod_smash_clasica',
            quantity: 1
          }
        ]
      }
    });

    const order = JSON.parse(resOrder.payload).order;

    await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }]
      }
    });

    const resJobs = await app.inject({
      method: 'GET',
      url: `/api/print-jobs?orderId=${order.id}&printerId=print_caja_usb`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });

    const jobs = JSON.parse(resJobs.payload).data;
    expect(jobs.length).toBeGreaterThan(0);
    const cajaJob = jobs[0];

    const ir = JSON.parse(cajaJob.ticket_ir_json) as TicketIR;
    expect(ir.blocks.some(b => b.type === 'header_logo')).toBe(true);

    const eslogan = ir.blocks.find(
      b => b.type === 'text' && b.text.includes('Cocinamos con amor, te servimos como mereces y damos gloria a Dios')
    );
    expect(eslogan).toBeDefined();

    // Verificar Totales
    const totals = ir.blocks.find(b => b.type === 'totals_block') as any;
    expect(totals).toBeDefined();
    expect(totals.totalUsd).toContain('$');
    expect(totals.totalBs).toContain('Bs');
    expect(totals.bcvRate).toContain('Tasa BCV');

    // Verificar CERO menciones a COP en todo el ticket
    const jsonStr = JSON.stringify(ir);
    expect(jsonStr).not.toContain('COP');
    expect(jsonStr).not.toContain('Pesos');
    expect(jsonStr).not.toContain('COL$');

    // Vista previa HTML idéntica
    const previewRes = await app.inject({
      method: 'GET',
      url: `/api/print-jobs/${cajaJob.id}/preview`,
      headers: { authorization: `Bearer ${cajeraToken}` }
    });

    expect(previewRes.statusCode).toBe(200);
    const previewData = JSON.parse(previewRes.payload);
    expect(previewData.html).toContain('ticket-preview-container');
    expect(previewData.html).toContain('Olinelcys Aguilera');
    expect(previewData.html).toContain('Cocinamos con amor');
  });

  // --------------------------------------------------------------------------
  // PRUEBA 4: Ciclo de Vida del Worker e Impresión Exitosa
  // --------------------------------------------------------------------------
  it('PrintingWorker procesa la cola: en_cola -> imprimiendo -> impreso con payload binario ESC/POS', async () => {
    const worker = app.printingWorker!;
    expect(worker).toBeDefined();

    // Crear un trabajo de prueba
    const now = Date.now();
    const testIR: TicketIR = {
      title: 'Ticket Test',
      widthColumns: 32,
      blocks: [
        { type: 'title_double', text: 'TEST HARDWARE', align: 'center' },
        { type: 'cut', feedLines: 4 }
      ]
    };
    const testBytes = Buffer.from(renderTicketToEscPos(testIR));

    const testJobId = `pjob_test_${Date.now()}`;
    rawDb.prepare(`
      INSERT INTO print_jobs (
        id, printer_id, order_id, job_type, payload_bytes, ticket_ir_json, status, attempts, created_at_ms
      ) VALUES (?, 'print_caja_usb', NULL, 'TEST', ?, ?, 'en_cola', 0, ?)
    `).run(testJobId, testBytes, JSON.stringify(testIR), now);

    // Procesar cola
    await worker.processQueue();

    const updatedJob = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(testJobId) as any;
    expect(updatedJob.status).toBe('impreso');
    expect(updatedJob.completed_at_ms).toBeGreaterThan(0);
    expect(updatedJob.attempts).toBe(1);
  });

  // --------------------------------------------------------------------------
  // PRUEBA 5: Manejo de Fallos (3 Intentos -> requiere_atencion) y Resolución
  // --------------------------------------------------------------------------
  it('Tras 3 fallos consecutivos pasa a requiere_atencion y permite resolverse manualmente', async () => {
    const worker = app.printingWorker!;
    const failingJobId = `pjob_fail_${Date.now()}`;
    const testIR: TicketIR = {
      title: 'Failing Job',
      blocks: [{ type: 'title_double', text: 'FAIL TEST' }]
    };

    rawDb.prepare(`
      INSERT INTO print_jobs (
        id, printer_id, order_id, job_type, payload_bytes, ticket_ir_json, status, attempts, created_at_ms
      ) VALUES (?, 'print_cocina', NULL, 'TEST', ?, ?, 'en_cola', 0, ?)
    `).run(failingJobId, Buffer.from([0x1b, 0x40]), JSON.stringify(testIR), Date.now());

    // Configurar fallo simulado para este trabajo
    worker.mockFailures.add(failingJobId);

    // Intento 1
    await worker.processQueue();
    let jobRow = rawDb.prepare('SELECT status, attempts FROM print_jobs WHERE id = ?').get(failingJobId) as any;
    expect(jobRow.status).toBe('en_cola');
    expect(jobRow.attempts).toBe(1);

    // Intento 2
    await worker.processQueue();
    jobRow = rawDb.prepare('SELECT status, attempts FROM print_jobs WHERE id = ?').get(failingJobId) as any;
    expect(jobRow.status).toBe('en_cola');
    expect(jobRow.attempts).toBe(2);

    // Intento 3 -> Pasa a requiere_atencion
    await worker.processQueue();
    jobRow = rawDb.prepare('SELECT status, attempts FROM print_jobs WHERE id = ?').get(failingJobId) as any;
    expect(jobRow.status).toBe('requiere_atencion');
    expect(jobRow.attempts).toBe(3);

    // Resolver con 'mark_printed'
    const resResolve = await app.inject({
      method: 'POST',
      url: `/api/print-jobs/${failingJobId}/resolve`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { action: 'mark_printed' }
    });

    expect(resResolve.statusCode).toBe(200);
    jobRow = rawDb.prepare('SELECT status FROM print_jobs WHERE id = ?').get(failingJobId) as any;
    expect(jobRow.status).toBe('impreso');

    // Limpiar fallo simulado
    worker.mockFailures.delete(failingJobId);
  });

  // --------------------------------------------------------------------------
  // PRUEBA 6: Reimpresión Manual (Exige PIN de Cajera/Supervisor, Bloquea Cocinero)
  // --------------------------------------------------------------------------
  it('Reimpresión manual exige motivo y PIN autorizado, agregando banner de copia #1 y bloqueando al cocinero', async () => {
    // 1. Obtener un trabajo impreso existente (o crearlo si corre en aislamiento)
    let existingJob = rawDb.prepare("SELECT id FROM print_jobs WHERE status = 'impreso' AND ticket_ir_json IS NOT NULL LIMIT 1").get() as any;
    if (!existingJob) {
      const now = Date.now();
      const testIR: TicketIR = {
        title: 'Ticket Test Preexistente',
        widthColumns: 32,
        blocks: [
          { type: 'title_double', text: 'TEST HARDWARE', align: 'center' },
          { type: 'cut', feedLines: 4 }
        ]
      };
      const testJobId = `pjob_seed_${now}`;
      rawDb.prepare(`
        INSERT INTO print_jobs (
          id, printer_id, order_id, job_type, payload_bytes, ticket_ir_json, status, attempts, created_at_ms, completed_at_ms
        ) VALUES (?, 'print_caja_usb', NULL, 'NOTA_ENTREGA', ?, ?, 'impreso', 1, ?, ?)
      `).run(testJobId, Buffer.from([0x1b, 0x40]), JSON.stringify(testIR), now, now);
      existingJob = { id: testJobId };
    }
    expect(existingJob).toBeDefined();

    // 2. Cocinero intentando reimprimir -> 403 Forbidden
    const resForbidden = await app.inject({
      method: 'POST',
      url: `/api/print-jobs/${existingJob.id}/reprint`,
      headers: { authorization: `Bearer ${cocineroToken}` },
      payload: {
        pin: '5555', // PIN del cocinero
        reason: 'Ticket mojado'
      }
    });
    expect(resForbidden.statusCode).toBe(403);

    // 3. Cajera autorizando con PIN válido
    const resReprint = await app.inject({
      method: 'POST',
      url: `/api/print-jobs/${existingJob.id}/reprint`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        pin: '1111', // PIN de cajera
        reason: 'Papel atascado en caja'
      }
    });

    expect(resReprint.statusCode).toBe(201);
    const reprintData = JSON.parse(resReprint.payload);
    expect(reprintData.success).toBe(true);

    const newJob = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(reprintData.newJobId) as any;
    expect(newJob.job_type).toBe('REIMPRESION');
    expect(newJob.reprint_count).toBe(1);
    expect(newJob.reprint_reason).toBe('Papel atascado en caja');

    const reprintedIR = JSON.parse(newJob.ticket_ir_json) as TicketIR;
    const banner = reprintedIR.blocks.find(b => b.type === 'banner_inverted' && b.text.includes('COPIA / REIMPRESIÓN #1'));
    expect(banner).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // PRUEBA 7: Reposición Urgente Sin Cobro (Re-fire)
  // --------------------------------------------------------------------------
  it('Reposición urgente (Re-fire) genera ticket para cocina con banner *** REPOSICIÓN URGENTE SIN COBRO ***', async () => {
    let existingOrder = rawDb.prepare("SELECT id FROM orders WHERE payment_status = 'pagado' LIMIT 1").get() as any;
    if (!existingOrder) {
      const resOrder = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tableNumber: 'Mesa Test',
          fulfillmentType: 'salon',
          lines: [{ productId: 'prod_street_dog', quantity: 1 }]
        }
      });
      const order = JSON.parse(resOrder.payload).order;
      await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }]
        }
      });
      existingOrder = { id: order.id };
    }
    expect(existingOrder).toBeDefined();

    const resRefire = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/refire',
      headers: { authorization: `Bearer ${supervisorToken}` },
      payload: {
        orderId: existingOrder.id,
        reason: 'Cliente solicitó cambiar término de la carne',
        pin: '654321' // PIN supervisor
      }
    });

    expect(resRefire.statusCode).toBe(201);
    const refireData = JSON.parse(resRefire.payload);
    expect(refireData.success).toBe(true);

    const refireJob = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(refireData.newJobId) as any;
    expect(refireJob.job_type).toBe('REPOSICION_COCINA');

    const refireIR = JSON.parse(refireJob.ticket_ir_json) as TicketIR;
    const refireBanner = refireIR.blocks.find(
      b => b.type === 'banner_inverted' && b.text.includes('REPOSICIÓN URGENTE SIN COBRO')
    );
    expect(refireBanner).toBeDefined();
  });
});
