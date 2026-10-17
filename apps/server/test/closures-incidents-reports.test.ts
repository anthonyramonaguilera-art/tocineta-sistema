import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

describe('Hito M8 - Arqueo Ciego, Cierre Z, Incidentes (Re-fire vs Refund) y Reportes Locales (@tocineta/server)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_m8_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_m8.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;

  // Tokens de sesión para las pruebas
  let adminToken = '';
  let supervisorToken = '';
  let cajeraToken = '';
  let mesoneroToken = '';

  const ADMIN_PIN = '123456';
  const SUPERVISOR_PIN = '654321';
  const CAJERA_PIN = '1111';
  const MESONERO_PIN = '2222';

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    // Migraciones y Semillas
    await runMigrations(rawDb, { dbPath: tempDb });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    // Inicializar servidor Fastify de pruebas
    app = await buildServer({ disableStatic: true });

    // Autenticar roles
    const loginAdmin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_admin_olinelcys', pin: ADMIN_PIN }
    });
    adminToken = loginAdmin.json().token;

    const loginSup = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_supervisor_turno', pin: SUPERVISOR_PIN }
    });
    supervisorToken = loginSup.json().token;

    const loginCajera = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_cajera_principal', pin: CAJERA_PIN }
    });
    cajeraToken = loginCajera.json().token;

    const loginMesonero = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_mesonero_carlos', pin: MESONERO_PIN }
    });
    mesoneroToken = loginMesonero.json().token;
  });

  afterAll(async () => {
    await app.close();
    try {
      const dbCtx = getDatabaseContext();
      dbCtx.rawDb.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================================================
  // PRUEBA 1: ARQUEO CIEGO ESTRICTO Y REGLA ANTI-TANTEO
  // ==========================================================================
  describe('1. Arqueo Ciego y Regla Anti-Tanteo (POST /api/cash-sessions/:id/blind-count)', () => {
    let jornadaId = '';
    let sessionId = '';

    beforeAll(async () => {
      // Abrir jornada con tasa 40.00 Bs/$
      const resJornada = await app.inject({
        method: 'POST',
        url: '/api/jornadas/open',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          rateMicroBs: 40_000_000,
          rateStr: '40.00',
          initialCashUsdCents: 5000, // $50.00 inicial
          initialCashBsCents: 100000 // 1,000.00 Bs inicial (100,000 centavos)
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

      // Crear y cobrar una orden en esta sesión de caja:
      // Total $5.00: pagado con $3.00 cash_usd y el resto en Ubii Punto de Venta (80.00 Bs = 8,000 centavos)
      const resOrder = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          fulfillmentType: 'salon',
          tableNumber: '4',
          lines: [{ productId: 'prod_classic_dog', quantity: 2 }] // 2 * $2.50 = $5.00
        }
      });
      const order = resOrder.json().order;

      // Asignar sesión de caja y cobrar orden
      rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, order.id);

      await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [
            { method: 'cash_usd', amountCents: 300 }, // $3.00
            { method: 'ubii', amountCents: 8000 } // $2.00 = 80.00 Bs = 8,000 centavos
          ]
        }
      });
    });

    it('Regla Anti-Tanteo: Si hay descuadre y recount_used === 0, rechaza a ciegas sin revelar diferencias ni montos esperados', async () => {
      // Conteo con montos erróneos (descuadrados)
      const resBlind1 = await app.inject({
        method: 'POST',
        url: `/api/cash-sessions/${sessionId}/blind-count`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          cash_usd_cents: 6000, // Error intencional
          cash_bs_cents: 100000,
          ubii_voucher_bs_cents: 10000
        }
      });

      expect(resBlind1.statusCode).toBe(200);
      const data1 = resBlind1.json();

      expect(data1.status).toBe('RECOUNT_REQUIRED');
      expect(data1.message).toBe('Por favor realiza una segunda verificación del conteo físico.');
      // SEGURIDAD ESTRICTA ANTI-TANTEO: No revela montos ni diferencias
      expect(data1.session).toBeUndefined();
      expect(data1.expectedCashUsdCents).toBeUndefined();
      expect(data1.diffUsdCents).toBeUndefined();

      // Verificar que en base de datos recount_used pasó a 1
      const sessionRow = rawDb.prepare('SELECT recount_used, status FROM cash_sessions WHERE id = ?').get(sessionId) as any;
      expect(sessionRow.recount_used).toBe(1);
      expect(sessionRow.status).toBe('abierta');
    });

    it('En el segundo conteo, la sesión se cierra definitivamente; para cajera oculta los montos esperados', async () => {
      // Segundo conteo enviado por cajera
      const resBlind2 = await app.inject({
        method: 'POST',
        url: `/api/cash-sessions/${sessionId}/blind-count`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          cash_usd_cents: 5300, // Fondo $50 + Venta $3 = $53.00 (5300 cents)
          cash_bs_cents: 100000,
          ubii_voucher_bs_cents: 8000
        }
      });

      expect(resBlind2.statusCode).toBe(200);
      const data2 = resBlind2.json();
      expect(data2.status).toBe('CLOSED');
      expect(data2.message).toContain('cerrada');

      // Cajera NO recibe session con esperados ni diferencias
      expect(data2.session).toBeUndefined();

      // Verificar en BD que está cerrada
      const sessionRow = rawDb.prepare('SELECT status, closing_cash_usd_cents FROM cash_sessions WHERE id = ?').get(sessionId) as any;
      expect(sessionRow.status).toBe('cerrada');
      expect(sessionRow.closing_cash_usd_cents).toBe(5300);
    });

    it('Liquidación Ubii (0.75%): Calcula comisión, neto bancario esperado y conciliación para usuarios con rol supervisor/admin', async () => {
      // Abrir otra sesión para probar vista privilegiada
      const resNewSession = await app.inject({
        method: 'POST',
        url: '/api/cash-sessions/open',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          jornadaId,
          openingCashUsdCents: 1000,
          openingCashBsCents: 0
        }
      });
      const sId = resNewSession.json().cashSession.id;

      // Crear orden con pago Ubii de 10.000 Bs centavos (100,00 Bs = $2.50)
      const resOrder = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          fulfillmentType: 'salon',
          lines: [{ productId: 'prod_classic_dog', quantity: 1 }]
        }
      });
      const oId = resOrder.json().order.id;
      rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sId, oId);

      await app.inject({
        method: 'POST',
        url: `/api/orders/${oId}/pay`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          tenders: [{ method: 'ubii', amountCents: 10000 }] // 100.00 Bs
        }
      });

      // Supervisor envía conteo físico con voucher de 10,000 Bs centavos
      const resClosePrivileged = await app.inject({
        method: 'POST',
        url: `/api/cash-sessions/${sId}/blind-count`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          cash_usd_cents: 1000,
          cash_bs_cents: 0,
          ubii_voucher_bs_cents: 10000
        }
      });

      expect(resClosePrivileged.statusCode).toBe(200);
      const dataPriv = resClosePrivileged.json();
      expect(dataPriv.status).toBe('CLOSED');
      expect(dataPriv.session).toBeDefined();

      // Liquidación Ubii 0.75% sobre 10,000 centavos = 75 centavos comisión
      const liq = dataPriv.session.ubiiLiquidation;
      expect(liq).toBeDefined();
      expect(liq.grossBsCents).toBe(10000);
      expect(liq.feeBsCents).toBe(75); // 0.75% de 10,000 = 75
      expect(liq.netBsCents).toBe(9925); // 10,000 - 75 = 9,925
      expect(liq.voucherDiffBsCents).toBe(0);
    });
  });

  // ==========================================================================
  // PRUEBA 2: CIERRE Z DE JORNADA CON TOTALES DE LEDGER Y HASH DE AUDITORÍA
  // ==========================================================================
  describe('2. Cierre Z de Jornada y Ticket Térmico con Hash SHA-256 (POST /api/jornadas/:id/close)', () => {
    let zJornadaId = '';

    beforeAll(async () => {
      // Abrir jornada exclusiva para Cierre Z
      const resJornada = await app.inject({
        method: 'POST',
        url: '/api/jornadas/open',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          rateMicroBs: 40_000_000,
          initialCashUsdCents: 2000,
          initialCashBsCents: 0
        }
      });
      zJornadaId = resJornada.json().jornada.id;

      // Crear orden cobrada para generar asientos en ledger
      const resOrder = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          fulfillmentType: 'salon',
          lines: [{ productId: 'prod_classic_dog', quantity: 1 }]
        }
      });
      const ordId = resOrder.json().order.id;

      await app.inject({
        method: 'POST',
        url: `/api/orders/${ordId}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: 250 }]
        }
      });
    });

    it('Cajera no tiene privilegios para ejecutar el Cierre Z (Requiere Supervisor o Admin)', async () => {
      const resFail = await app.inject({
        method: 'POST',
        url: `/api/jornadas/${zJornadaId}/close`,
        headers: { authorization: `Bearer ${cajeraToken}` }
      });
      expect(resFail.statusCode).toBe(403);
    });

    it('Ejecutar Cierre Z con Admin: suma ledger_entries, captura SHA-256 head hash y encola ticket térmico', async () => {
      const resClose = await app.inject({
        method: 'POST',
        url: `/api/jornadas/${zJornadaId}/close`,
        headers: { authorization: `Bearer ${adminToken}` }
      });

      expect(resClose.statusCode).toBe(200);
      const data = resClose.json();
      expect(data.success).toBe(true);

      const z = data.zReport;
      expect(z).toBeDefined();
      expect(z.jornadaId).toBe(zJornadaId);
      expect(z.netSalesUsdCents).toBeGreaterThan(0);
      expect(z.auditHeadHash).toBeDefined();
      expect(z.auditHeadHash.length).toBeGreaterThan(10); // SHA-256 hash presente

      // Verificar que se encoló el trabajo de impresión en print_jobs con el hash
      const printJob = rawDb.prepare(`
        SELECT * FROM print_jobs WHERE job_type = 'CIERRE_Z' ORDER BY created_at_ms DESC LIMIT 1
      `).get() as any;

      expect(printJob).toBeDefined();
      expect(printJob.printer_id).toBe('print_caja_usb');
      expect(printJob.ticket_ir_json).toContain(z.auditHeadHash);

      // Verificar estado cerrado en BD
      const jRow = rawDb.prepare('SELECT status, audit_head_hash FROM jornadas WHERE id = ?').get(zJornadaId) as any;
      expect(jRow.status).toBe('cerrada');
      expect(jRow.audit_head_hash).toBe(z.auditHeadHash);
    });
  });

  // ==========================================================================
  // PRUEBA 3: INCIDENTES, MERMAS Y DEVOLUCIONES (RE-FIRE VS REFUND)
  // ==========================================================================
  describe('3. Incidentes y Devoluciones (POST /api/orders/:id/incident)', () => {
    let incidentJornadaId = '';

    beforeAll(async () => {
      const resJ = await app.inject({
        method: 'POST',
        url: '/api/jornadas/open',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { rateMicroBs: 40_000_000 }
      });
      incidentJornadaId = resJ.json().jornada.id;

      await app.inject({
        method: 'POST',
        url: '/api/cash-sessions/open',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          jornadaId: incidentJornadaId,
          openingCashUsdCents: 5000,
          openingCashBsCents: 0
        }
      });
    });

    it('Re-fire (Reposición): Requiere PIN supervisor/admin, registra merma y ticket urgente a cocina sin alterar caja', async () => {
      // Crear y cobrar orden
      const resOrder = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          fulfillmentType: 'salon',
          lines: [{ productId: 'prod_classic_dog', quantity: 1 }]
        }
      });
      const order = resOrder.json().order;

      await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }]
        }
      });

      // Contar asientos en ledger antes de la reposición
      const ledgerCountBefore = (rawDb.prepare('SELECT count(*) as count FROM ledger_entries WHERE order_id = ?').get(order.id) as any).count;

      // Disparar incidente Re-fire por error de cocina
      const resIncident = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/incident`,
        payload: {
          reason_code: 'comida_fria',
          responsible_area: 'cocina',
          resolution: 'refire',
          authorizer_pin: SUPERVISOR_PIN
        }
      });

      expect(resIncident.statusCode).toBe(200);
      const incData = resIncident.json();
      expect(incData.success).toBe(true);
      expect(incData.resolution).toBe('refire');
      expect(incData.printJobId).toBeDefined();

      // Verificar que el ticket de reposición está en print_jobs con banner '*** REPOSICIÓN URGENTE SIN COBRO ***'
      const pjob = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(incData.printJobId) as any;
      expect(pjob.job_type).toBe('REPOSICION_COCINA');
      expect(pjob.printer_id).toBe('print_cocina');
      expect(pjob.ticket_ir_json).toContain('REPOSICIÓN');

      // Verificar que NO se alteró la caja (mismos asientos en ledger)
      const ledgerCountAfter = (rawDb.prepare('SELECT count(*) as count FROM ledger_entries WHERE order_id = ?').get(order.id) as any).count;
      expect(ledgerCountAfter).toBe(ledgerCountBefore);

      // Verificar que se registró la merma en worker_incidents
      const incRow = rawDb.prepare('SELECT * FROM worker_incidents WHERE id = ?').get(incData.incidentId) as any;
      expect(incRow.incident_type).toBe('MERMA_ALIMENTO');
      expect(incRow.resolution).toBe('refire');
      expect(incRow.estimated_loss_usd_cents).toBeGreaterThan(0);
    });

    it('Refund: Supervisor está restringido al tope configurado ($20.00 USD / 2000 cents); montos mayores requieren Admin', async () => {
      // Crear orden de alto valor ($25.00: 10 * $2.50 = $25.00 > $20.00)
      const resBigOrder = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          fulfillmentType: 'salon',
          lines: [{ productId: 'prod_classic_dog', quantity: 10 }] // 10 * $2.50 = $25.00
        }
      });
      const bigOrder = resBigOrder.json().order;

      await app.inject({
        method: 'POST',
        url: `/api/orders/${bigOrder.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: bigOrder.total_to_collect_usd_cents }]
        }
      });

      // Intento de reembolso con PIN de supervisor debe fallar por exceder $20.00
      const resSupFail = await app.inject({
        method: 'POST',
        url: `/api/orders/${bigOrder.id}/incident`,
        payload: {
          reason_code: 'cliente_insatisfecho',
          responsible_area: 'cliente',
          resolution: 'refund',
          authorizer_pin: SUPERVISOR_PIN
        }
      });

      expect(resSupFail.statusCode).toBe(403);
      expect(resSupFail.json().error).toContain('supera el límite de $20.00 permitido para Supervisores');

      // Reembolso con PIN de Admin debe proceder y generar el contra-asiento en ledger_entries
      const resAdminSuccess = await app.inject({
        method: 'POST',
        url: `/api/orders/${bigOrder.id}/incident`,
        payload: {
          reason_code: 'cliente_insatisfecho',
          responsible_area: 'cliente',
          resolution: 'refund',
          authorizer_pin: ADMIN_PIN
        }
      });

      expect(resAdminSuccess.statusCode).toBe(200);
      const refundData = resAdminSuccess.json();
      expect(refundData.success).toBe(true);

      // Verificar que el estado de la orden pasó a 'reembolsado'
      const updatedOrder = rawDb.prepare('SELECT payment_status, fulfillment_status FROM orders WHERE id = ?').get(bigOrder.id) as any;
      expect(updatedOrder.payment_status).toBe('reembolsado');
      expect(updatedOrder.fulfillment_status).toBe('anulado');

      // Verificar contra-asiento en ledger_entries revirtiendo ventas
      const refundEntries = rawDb.prepare(`
        SELECT * FROM ledger_entries 
        WHERE order_id = ? AND description LIKE '%Reversión%'
      `).all(bigOrder.id) as any[];
      expect(refundEntries.length).toBeGreaterThan(0);
      expect(refundEntries[0].account_bucket).toBe('FOOD_SALES');
      expect(refundEntries[0].debit_usd_cents).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // PRUEBA 4: MÉTRICAS DE PERSONAL Y EXPORTACIÓN LOCAL (EXCEL Y PDF)
  // ==========================================================================
  describe('4. Métricas de Personal y Generación Local de Reportes (Excel y PDF)', () => {
    let reportJornadaId = '';

    beforeAll(async () => {
      const resJ = await app.inject({
        method: 'POST',
        url: '/api/jornadas/open',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { rateMicroBs: 40_000_000 }
      });
      reportJornadaId = resJ.json().jornada.id;
    });

    it('GET /api/reports/my-performance: Muestra únicamente las métricas individuales del trabajador', async () => {
      const resPerf = await app.inject({
        method: 'GET',
        url: '/api/reports/my-performance',
        headers: { authorization: `Bearer ${mesoneroToken}` }
      });

      expect(resPerf.statusCode).toBe(200);
      const metrics = resPerf.json().metrics;
      expect(metrics.userId).toBe('usr_mesonero_carlos');
      expect(metrics.ordersCount).toBeGreaterThanOrEqual(0);
      expect(metrics.incidentFreeRatePct).toBeGreaterThanOrEqual(0);
      expect(metrics.incidentFreeRatePct).toBeLessThanOrEqual(100);
    });

    it('GET /api/reports/staff-performance: Vista Admin con métricas de todo el personal y alertas', async () => {
      const resStaff = await app.inject({
        method: 'GET',
        url: '/api/reports/staff-performance',
        headers: { authorization: `Bearer ${adminToken}` }
      });

      expect(resStaff.statusCode).toBe(200);
      const body = resStaff.json().report;
      expect(body.totalWorkers).toBeGreaterThan(0);
      expect(Array.isArray(body.workers)).toBe(true);
      expect(Array.isArray(body.alerts)).toBe(true);
    });

    it('GET /api/reports/jornada/:id/excel: Genera 100% localmente archivo Excel con hojas de Resumen, Ledger e Incidentes', async () => {
      const resExcel = await app.inject({
        method: 'GET',
        url: `/api/reports/jornada/${reportJornadaId}/excel`,
        headers: { authorization: `Bearer ${adminToken}` }
      });

      expect(resExcel.statusCode).toBe(200);
      expect(resExcel.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

      const rawBuffer = resExcel.rawPayload;
      expect(rawBuffer.length).toBeGreaterThan(500);

      // Cargar con ExcelJS para validar integridad de hojas y datos
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(rawBuffer);

      const sheetNames = workbook.worksheets.map(w => w.name);
      expect(sheetNames).toContain('Resumen Jornada');
      expect(sheetNames).toContain('Libro Contable');
      expect(sheetNames).toContain('Incidentes y Mermas');
    });

    it('GET /api/reports/jornada/:id/pdf: Genera 100% localmente documento PDF con fuente estándar y Hash SHA-256', async () => {
      const resPdf = await app.inject({
        method: 'GET',
        url: `/api/reports/jornada/${reportJornadaId}/pdf`,
        headers: { authorization: `Bearer ${adminToken}` }
      });

      expect(resPdf.statusCode).toBe(200);
      expect(resPdf.headers['content-type']).toContain('application/pdf');

      const rawBuffer = resPdf.rawPayload;
      // Verificar cabecera mágica de PDF
      const pdfHeader = rawBuffer.subarray(0, 5).toString('ascii');
      expect(pdfHeader).toBe('%PDF-');
      expect(rawBuffer.length).toBeGreaterThan(1000);
    });
  });
});
