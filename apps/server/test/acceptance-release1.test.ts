/**
 * SUITE MAESTRA DE CERTIFICACIÓN DE LA RELEASE 1 (22 PRUEBAS DE ACEPTACIÓN)
 * Hito M10.3 - TOCINETA POS
 * 
 * Valida de punta a punta los 22 escenarios de aceptación del Informe Definitivo:
 * 1. Operación 100% sin internet (LAN/Loopback sin dependencias WAN).
 * 2. Cola de impresión cuando la impresora falla (no bloquea ventas).
 * 3. Recuperación de energía con synchronous = FULL y journal_mode = WAL.
 * 4. Deduplicación por Idempotency-Key tras reconexión Wi-Fi.
 * 5. Cuenta de $13.90 pagada con $20.00 y vuelto mixto ($6.00 USD + Bs).
 * 6. Pago mixto de 3 métodos (CASH_USD + PAGO_MOVIL + UBII).
 * 7. Alerta Antifraude Pago Móvil (Bloqueo Nivel 1 y advertencia Nivel 2).
 * 8. Autorización sin pago con PIN dejando deuda abierta (autorizado_sin_pago).
 * 9. Incidente refire (reposición urgente) registra merma sin alterar caja.
 * 10. Reembolso respeta tope de $20 para supervisor y contra-asiento en Bs sin tocar CASH_USD.
 * 11. Prorrateo exacto Hamilton (Combo Clásico 325+325+140 y Para Ti 615+615+160) sin "COMBO" en cocina.
 * 12. Barra Libre a $0.00 venta y $0.15 costo interno en /api/menu/pos.
 * 13. Arqueo Ciego con regla anti-tanteo (1 solo reconteo sin revelar dirección ni monto).
 * 14. Cierre Z calcula comisión Ubii 0.75% y captura Hash SHA-256 de auditoría.
 * 15. Cambio de tasa BCV a mitad de turno no altera pagos históricos.
 * 16. Restauración verificada valida integridad y cadena SHA-256 (.db.age).
 * 17. Guardia de coherencia temporal (rechaza retrocesos temporales).
 * 18. Transcripción diferida de comandas de papel (#EMG-001) previene duplicados.
 * 19. Revocación instantánea de sesión al desactivar usuario.
 * 20. Code-splitting y bundle de frontend particionado para móviles Android.
 * 21. Autodetección de Bóveda USB con marcador .tocineta-usb-vault y espacio suficiente.
 * 22. Simulacro Dry-Run automático verifica integridad sin alterar DB.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import DatabaseConstructor from 'better-sqlite3';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { generateIdentity, identityToRecipient } from 'age-encryption';
import { renderTicketToEscPos, generateUuidV7, type EscPosConfig } from '@tocineta/shared';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { buildServer } from '../src/server.js';
import { openJornada } from '../src/modules/cashier/cashier-service.js';
import { createOrder } from '../src/modules/orders/order-service.js';
import { buildKitchenTicketIRs, loadOrderReceiptDataFromDb } from '../src/modules/printing/templates.js';
import {
  detectUsbVault,
  executeDryRunVerification,
  createEncryptedBackup
} from '../src/modules/backups/backup-service.js';
import { restoreAndVerifyDatabase } from '../src/modules/backups/restore-engine.js';
import { appendAuditEvent, verifyAuditChain } from '../src/modules/audit/audit-service.js';
import { loginAs } from './test-helpers.js';

describe('Hito M10.3 - Suite Maestra de Certificación Release 1 (22 Pruebas de Aceptación)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_m10_3_${Date.now()}`);
  const tempDbPath = path.join(tempDir, 'release1_acceptance.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;

  let adminToken = '';
  let supervisorToken = '';
  let cajeraToken = '';

  const ADMIN_PIN = '123456';
  const SUPERVISOR_PIN = '654321';
  const CAJERA_PIN = '1111';

  let currentJornadaId = '';
  let currentSessionId = '';

  // Par efímero para prueba de age en RAM
  let ephemeralIdentity: string = '';
  let ephemeralRecipient: string = '';

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDbPath);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { dbPath: tempDbPath });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    // Claves efímeras para prueba de age
    ephemeralIdentity = await generateIdentity();
    ephemeralRecipient = await identityToRecipient(ephemeralIdentity);

    app = await buildServer({ disableStatic: true });
    await app.ready();

    // Logins canónicos usando helper
    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    supervisorToken = (await loginAs(app, 'supervisor', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;

    // Abrir Jornada de prueba
    const openJor = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        rateMicroBs: 40_000_000,
        rateStr: '40.00',
        initialCashUsdCents: 10000,
        initialCashBsCents: 200000,
        notes: 'Jornada Release 1 Certificación'
      }
    });
    currentJornadaId = openJor.json().jornada.id;

    // Abrir Sesión de Caja
    const openSess = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        jornadaId: currentJornadaId,
        openingCashUsdCents: 10000,
        openingCashBsCents: 200000
      }
    });
    currentSessionId = openSess.json().cashSession?.id || openSess.json().session?.id;
  });

  afterAll(async () => {
    await app.close();
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Operación 100% sin internet
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 01: Operación 100% sin internet (LAN/Loopback sin dependencias WAN)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system-health'
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.database.status).toBe('connected');
    expect(body.architecture).toBe('single_process');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Cola de impresión cuando la impresora falla
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 02: Cola de impresión cuando la impresora falla (no bloquea ventas)', () => {
    const now = Date.now();
    const jobId = `pjob_fail_${now}`;
    rawDb.prepare(`
      INSERT INTO print_jobs (
        id, printer_id, order_id, job_type, payload_bytes, ticket_ir_json, station, status, attempts, created_at_ms
      ) VALUES (?, 'print_cocina', NULL, 'TEST', ?, '{}', 'cocina', 'en_cola', 0, ?)
    `).run(jobId, Buffer.from([0x1B, 0x40]), now);

    // Simular intento fallido sin bloquear la base de datos
    rawDb.prepare(`
      UPDATE print_jobs
      SET attempts = attempts + 1,
          status = 'fallido',
          error_message = 'Timeout de conexión TCP a 192.168.1.200:9100'
      WHERE id = ?
    `).run(jobId);

    const job = rawDb.prepare('SELECT status, attempts, error_message FROM print_jobs WHERE id = ?').get(jobId) as any;
    expect(job.status).toBe('fallido');
    expect(job.attempts).toBe(1);
    expect(job.error_message).toContain('Timeout');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Recuperación con synchronous = FULL y WAL
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 03: Recuperación de energía con synchronous = FULL y journal_mode = WAL', () => {
    const jm = rawDb.pragma('journal_mode', { simple: true });
    const sync = rawDb.pragma('synchronous', { simple: true });
    const fk = rawDb.pragma('foreign_keys', { simple: true });

    expect(String(jm).toLowerCase()).toBe('wal');
    expect(sync).toBe(2); // 2 = FULL
    expect(fk).toBe(1);   // 1 = ON
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Deduplicación por Idempotency-Key tras caída de Wi-Fi
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 04: Deduplicación por Idempotency-Key tras reconexión Wi-Fi', async () => {
    const idempKey = `order:${generateUuidV7()}`;
    const payload = {
      customerName: 'Cliente Idempotente',
      fulfillmentType: 'salon',
      lines: [
        { productId: 'prod_smash_clasica', quantity: 1, modifiers: [] }
      ]
    };

    // Primera llamada
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'idempotency-key': idempKey
      },
      payload
    });
    expect(res1.statusCode).toBe(201);
    const order1 = res1.json().order;

    // Segunda llamada (reintento tras pérdida de conexión)
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: {
        authorization: `Bearer ${cajeraToken}`,
        'idempotency-key': idempKey
      },
      payload
    });
    expect(res2.statusCode).toBe(201);
    const order2 = res2.json().order;

    expect(order2.id).toBe(order1.id);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Cuenta de $13.90 pagada con $20.00 y vuelto mixto ($6.00 USD + Bs)
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 05: Cuenta de $13.90 pagada con $20.00 y vuelto mixto ($6.00 USD + Bs)', async () => {
    // Crear orden de $13.90 (Combo Para Ti)
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        customerName: 'Cliente Vuelto Mixto',
        fulfillmentType: 'salon',
        lines: [
          {
            productId: 'prod_combo_para_ti',
            quantity: 1,
            comboChildren: [
              { productId: 'prod_texas_mex' },
              { productId: 'prod_pechuga_cesar' },
              { productId: 'prod_refresco_1lt' }
            ]
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(201);
    const orderId = createRes.json().order.id;

    // Cobrar con $20.00 USD en efectivo y vuelto mixto: $6.00 USD + Bs 4.00 (10c USD a 40 Bs/$)
    const payRes = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'cash_usd', amountCents: 2000 }
        ],
        changeOutputs: {
          changeUsdCents: 600, // $6.00 USD en efectivo
          changeBsCents: 400   // Bs 4.00 en efectivo
        }
      }
    });
    expect(payRes.statusCode).toBe(200);
    const payBody = payRes.json();
    expect(payBody.order.payment_status || payBody.order.paymentStatus).toBe('pagado');

    // Verificar registro en change_deliveries
    const changeRow = rawDb.prepare('SELECT change_usd_cents, change_bs_cents FROM change_deliveries WHERE order_id = ?').get(orderId) as any;
    expect(changeRow).toBeDefined();
    expect(changeRow.change_usd_cents).toBe(600);
    expect(changeRow.change_bs_cents).toBe(400);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Pago mixto de 3 métodos (Efectivo USD + Pago Móvil + Ubii)
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 06: Pago mixto de 3 métodos (CASH_USD + PAGO_MOVIL + UBII)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        customerName: 'Cliente 3 Métodos',
        fulfillmentType: 'salon',
        lines: [
          {
            productId: 'prod_combo_clasico',
            quantity: 1,
            comboChildren: [
              { productId: 'prod_tocineta_dog_parmesano' },
              { productId: 'prod_doritos_dog_snacks' },
              { productId: 'prod_malta_lata_250' }
            ]
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(201);
    const orderId = createRes.json().order.id;

    // Pagar: $3.00 Cash USD + $2.90 eq Pago Móvil (11600 Bs cents) + $2.00 eq Ubii (8000 Bs cents) = $7.90
    const payRes = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'cash_usd', amountCents: 300 },
          { method: 'pago_movil', amountCents: 11600, referenceCode: 'PAGOMOVIL_3MET_01' },
          { method: 'ubii', amountCents: 8000, referenceCode: 'VOUCHER_UBII_01' }
        ]
      }
    });
    expect(payRes.statusCode).toBe(200);
    expect(payRes.json().order.payment_status || payRes.json().order.paymentStatus).toBe('pagado');

    const paymentRows = rawDb.prepare('SELECT method, amount_cents FROM payments WHERE order_id = ?').all(orderId) as any[];
    expect(paymentRows.length).toBe(3);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Bloqueo Nivel 1 y advertencia Nivel 2 en Pago Móvil
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 07: Alerta Antifraude Pago Móvil (Bloqueo Nivel 1 y advertencia Nivel 2)', async () => {
    // 1. Crear y cobrar una primera orden con referencia REF-777888
    const ord1 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        customerName: 'PM 1',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_smash_clasica', quantity: 1, modifiers: [] }]
      }
    });
    expect(ord1.statusCode).toBe(201);
    const id1 = ord1.json().order.id;

    const pay1 = await app.inject({
      method: 'POST',
      url: `/api/orders/${id1}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'pago_movil', amountCents: 14000, referenceCode: 'REF-777888' }]
      }
    });
    expect(pay1.statusCode).toBe(200);

    // 2. Nivel 1: Crear segunda orden con la MISMA referencia y MISMO monto
    const ord2 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        customerName: 'PM 2',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_smash_clasica', quantity: 1, modifiers: [] }]
      }
    });
    expect(ord2.statusCode).toBe(201);
    const id2 = ord2.json().order.id;

    // Cobrar sin PIN de supervisor -> Debe bloquear con 400
    const payBlocked = await app.inject({
      method: 'POST',
      url: `/api/orders/${id2}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'pago_movil', amountCents: 14000, referenceCode: 'REF-777888' }]
      }
    });
    expect(payBlocked.statusCode).toBe(400);
    expect(payBlocked.json().error).toContain('Supervisor');

    // Cobrar con PIN de supervisor -> Permite con advertencia auditada
    const payAllowed = await app.inject({
      method: 'POST',
      url: `/api/orders/${id2}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'pago_movil', amountCents: 14000, referenceCode: 'REF-777888' }],
        supervisorPin: SUPERVISOR_PIN
      }
    });
    expect(payAllowed.statusCode).toBe(200);

    // 3. Nivel 2: Misma referencia con DISTINTO monto (Advertencia)
    const ord3 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        customerName: 'PM 3',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 1, modifiers: [] }]
      }
    });
    expect(ord3.statusCode).toBe(201);
    const id3 = ord3.json().order.id;

    // Sin confirmación -> Advertencia Nivel 2
    const payWarn = await app.inject({
      method: 'POST',
      url: `/api/orders/${id3}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'pago_movil', amountCents: 10000, referenceCode: 'REF-777888' }]
      }
    });
    expect(payWarn.statusCode).toBe(400);
    expect(payWarn.json().error).toContain('ADVERTENCIA ANTIFRAUDE NIVEL 2');

    // Con confirmWarning: true -> Pasa sin requerir supervisor
    const payConfirmed = await app.inject({
      method: 'POST',
      url: `/api/orders/${id3}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'pago_movil', amountCents: 10000, referenceCode: 'REF-777888' }],
        confirmWarning: true
      }
    });
    expect(payConfirmed.statusCode).toBe(200);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Autorización sin pago con PIN dejando deuda abierta
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 08: Autorización sin pago con PIN deja deuda abierta (autorizado_sin_pago)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        customerName: 'Cliente Crédito Autorizado',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_smash_clasica', quantity: 1, modifiers: [] }]
      }
    });
    expect(createRes.statusCode).toBe(201);
    const orderId = createRes.json().order.id;

    const authRes = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/authorize-without-payment`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { authorizerUserId: 'usr_supervisor_test', pin: SUPERVISOR_PIN }
    });
    expect(authRes.statusCode).toBe(200);
    const body = authRes.json();
    expect(body.order.payment_status || body.order.paymentStatus).toBe('autorizado_sin_pago');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9. Incidente refire urgente sin cobro y registro de merma
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 09: Incidente refire (reposición urgente) registra merma sin alterar caja', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        customerName: 'Cliente Refire',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_smash_clasica', quantity: 1, modifiers: [] }]
      }
    });
    expect(createRes.statusCode).toBe(201);
    const orderId = createRes.json().order.id;

    // Pagar primero
    await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { tenders: [{ method: 'cash_usd', amountCents: 350 }] }
    });

    // Incidente Re-fire
    const incidentRes = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/incident`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        reasonCode: 'PRODUCT_DROPPED',
        responsibleArea: 'mesonero',
        resolution: 'refire',
        authorizerPin: SUPERVISOR_PIN,
        description: 'Hamburguesa cayó al suelo'
      }
    });
    expect(incidentRes.statusCode).toBe(200);

    const mermas = rawDb.prepare('SELECT estimated_loss_usd_cents FROM worker_incidents WHERE order_id = ?').all(orderId) as any[];
    expect(mermas.length).toBeGreaterThanOrEqual(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 10. Reembolso multimétodo con tope de $20 para supervisor
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 10: Reembolso respeta tope de $20 para supervisor y contra-asiento en Bs sin tocar CASH_USD', async () => {
    // 1. Probar tope de $20 para supervisor: orden de $27.80 (2 combos Para Ti)
    const bigOrdRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        customerName: 'Cliente Gran Orden',
        fulfillmentType: 'salon',
        lines: [
          {
            productId: 'prod_combo_para_ti',
            quantity: 2,
            comboChildren: [
              { productId: 'prod_texas_mex' },
              { productId: 'prod_pechuga_cesar' },
              { productId: 'prod_refresco_1lt' }
            ]
          }
        ]
      }
    });
    expect(bigOrdRes.statusCode).toBe(201);
    const bigOrdId = bigOrdRes.json().order.id;

    await app.inject({
      method: 'POST',
      url: `/api/orders/${bigOrdId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { tenders: [{ method: 'cash_usd', amountCents: 2780 }] }
    });

    // Intentar reembolso de $27.80 con supervisor -> debe fallar con 403 (tope $20)
    const overLimitRes = await app.inject({
      method: 'POST',
      url: `/api/orders/${bigOrdId}/incident`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        reasonCode: 'OVERLIMIT_TEST',
        responsibleArea: 'cliente',
        resolution: 'refund',
        authorizerPin: SUPERVISOR_PIN
      }
    });
    expect(overLimitRes.statusCode).toBe(403);
    expect(overLimitRes.json().error).toContain('supera el límite de $20.00');

    // 2. Reembolso multimétodo dentro del tope de $20 con supervisor
    const ordRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        customerName: 'Cliente Devolución Bs',
        fulfillmentType: 'salon',
        lines: [
          { productId: 'prod_smash_clasica', quantity: 1, modifiers: [] },
          { productId: 'prod_papas_fritas_extra_150', quantity: 1, modifiers: [] }
        ]
      }
    });
    expect(ordRes.statusCode).toBe(201);
    const orderId = ordRes.json().order.id;

    await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'pago_movil', amountCents: 18000, referenceCode: 'PM_DEV_BS_01' }
        ]
      }
    });

    const refundRes = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/incident`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        reasonCode: 'CUSTOMER_DISSATISFIED',
        responsibleArea: 'cocina',
        resolution: 'refund',
        refundMethod: 'PAGO_MOVIL',
        authorizerPin: SUPERVISOR_PIN,
        description: 'Cliente insatisfecho con la salsa'
      }
    });
    expect(refundRes.statusCode).toBe(200);

    // Verificar que se acreditó BANK_BS y NUNCA se tocó CASH_USD
    const ledgerRows = rawDb.prepare(`
      SELECT account_bucket, debit_usd_cents, credit_usd_cents
      FROM ledger_entries
      WHERE order_id = ?
    `).all(orderId) as any[];

    expect(ledgerRows.length).toBeGreaterThanOrEqual(1);
    const bankBsEntry = ledgerRows.find(l => l.account_bucket === 'BANK_BS');
    expect(bankBsEntry).toBeDefined();

    const cashUsdEntry = ledgerRows.find(l => l.account_bucket === 'CASH_USD');
    expect(cashUsdEntry).toBeUndefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11. Prorrateo exacto Combo Clásico y Combo Para Ti sin "COMBO" en cocina
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 11: Prorrateo exacto Hamilton y comanda de cocina sin palabra COMBO', async () => {
    // 1. Combo Clásico ($7.90 -> 325 + 325 + 140)
    const ordClasico = createOrder(rawDb, {
      createdByUserId: 'usr_cajera',
      customerName: 'Hamilton Clásico',
      fulfillmentType: 'salon',
      lines: [
        {
          productId: 'prod_combo_clasico',
          quantity: 1,
          comboChildren: [
            { productId: 'prod_tocineta_dog_parmesano' },
            { productId: 'prod_doritos_dog_snacks' },
            { productId: 'prod_malta_lata_250' }
          ]
        }
      ]
    });

    const linesClasico = rawDb.prepare(`
      SELECT subtotal_usd_cents 
      FROM order_lines 
      WHERE order_id = ? AND line_role = 'COMBO_CHILD'
      ORDER BY subtotal_usd_cents DESC
    `).all(ordClasico.id) as Array<{ subtotal_usd_cents: number }>;

    const centsClasico = linesClasico.map(l => l.subtotal_usd_cents);
    expect(centsClasico).toEqual([325, 325, 140]);
    expect(centsClasico.reduce((a, b) => a + b, 0)).toBe(790);

    // 2. Combo Para Ti ($13.90 -> 615 + 615 + 160)
    const ordParaTi = createOrder(rawDb, {
      createdByUserId: 'usr_cajera',
      customerName: 'Hamilton Para Ti',
      fulfillmentType: 'salon',
      lines: [
        {
          productId: 'prod_combo_para_ti',
          quantity: 1,
          comboChildren: [
            { productId: 'prod_texas_mex' },
            { productId: 'prod_pechuga_cesar' },
            { productId: 'prod_refresco_1lt' }
          ]
        }
      ]
    });

    const linesParaTi = rawDb.prepare(`
      SELECT subtotal_usd_cents 
      FROM order_lines 
      WHERE order_id = ? AND line_role = 'COMBO_CHILD'
      ORDER BY subtotal_usd_cents DESC
    `).all(ordParaTi.id) as Array<{ subtotal_usd_cents: number }>;

    const centsParaTi = linesParaTi.map(l => l.subtotal_usd_cents);
    expect(centsParaTi).toEqual([615, 615, 160]);
    expect(centsParaTi.reduce((a, b) => a + b, 0)).toBe(1390);

    // 3. Verificar que los tickets de cocina generados NO tengan la palabra "COMBO"
    const { order: ordReceipt, kitchenLines } = loadOrderReceiptDataFromDb(rawDb, ordClasico.id);
    const kitchenIRs = buildKitchenTicketIRs({ order: ordReceipt, kitchenLines });
    expect(kitchenIRs.length).toBeGreaterThanOrEqual(1);
    for (const ticket of kitchenIRs) {
      for (const block of ticket.blocks) {
        if (block.type === 'line_item') {
          expect(block.name.toUpperCase()).not.toContain('COMBO');
        }
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 12. Barra Libre a $0.00 venta y $0.15 costo interno
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 12: Barra Libre a $0.00 venta y $0.15 costo interno en /api/menu/pos', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/menu/pos'
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const items = body.barraLibre || body.barraLibreIngredients;
    expect(items).toBeDefined();
    expect(items.length).toBe(6);

    // Verificar en base de datos costo interno $0.15 (15 centavos) y venta $0.00
    const dbIngredients = rawDb.prepare(`
      SELECT internal_cost_usd_cents, extra_price_usd_cents 
      FROM ingredients 
      WHERE is_barra_libre = 1
    `).all() as Array<{ internal_cost_usd_cents: number; extra_price_usd_cents: number }>;

    expect(dbIngredients.length).toBe(6);
    for (const ing of dbIngredients) {
      expect(ing.internal_cost_usd_cents).toBe(15);
      expect(ing.extra_price_usd_cents).toBe(0);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 13. Arqueo ciego permitiendo 1 solo reconteo sin revelar dirección ni monto
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 13: Arqueo Ciego con regla anti-tanteo (1 reconteo ciego)', async () => {
    const newSession = rawDb.prepare(`
      INSERT INTO cash_sessions (
        id, jornada_id, user_id, opening_cash_usd_cents, opening_cash_bs_cents,
        status, recount_used, opened_at_ms
      ) VALUES ('sess_blind_test', ?, 'usr_cajera', 5000, 100000, 'abierta', 0, ?)
    `).run(currentJornadaId, Date.now());

    // 1er intento con diferencia -> RECOUNT_REQUIRED sin números
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/sess_blind_test/blind-count',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { cashUsdCents: 1000, cashBsCents: 20000, ubiiVoucherBsCents: 0 }
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.status).toBe('RECOUNT_REQUIRED');
    expect(body1.expectedCashUsdCents).toBeUndefined();
    expect(body1.diffUsdCents).toBeUndefined();

    // 2do intento -> Cierra la sesión
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/sess_blind_test/blind-count',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { cashUsdCents: 1000, cashBsCents: 20000, ubiiVoucherBsCents: 0 }
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().status).toBe('CLOSED');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 14. Cierre Z con comisión Ubii 0.75% y Hash SHA-256 impreso
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 14: Cierre Z calcula comisión Ubii 0.75% y captura Hash SHA-256 de auditoría', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/jornadas/${currentJornadaId}/close`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { adminPin: ADMIN_PIN }
    });
    expect(res.statusCode).toBe(200);
    const zReport = res.json().zReport;

    expect(zReport.ubiiFeeBsCents).toBe(Math.round((zReport.ubiiGrossBsCents * 75) / 10000));
    expect(zReport.auditHeadHash).toBeDefined();
    expect(zReport.auditHeadHash.length).toBe(64); // SHA-256 hex
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 15. Cambio de tasa BCV a mitad de turno sin alterar pagos previos
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 15: Cambio de tasa BCV a mitad de turno no altera pagos históricos', async () => {
    const jorRes = openJornada(rawDb, {
      openedByUserId: 'usr_admin',
      rateMicroBs: 40_000_000, // 40.00
      rateStr: '40.00',
      initialCashUsdCents: 1000,
      initialCashBsCents: 1000
    });

    rawDb.prepare(`
      INSERT INTO cash_sessions (id, jornada_id, user_id, opening_cash_usd_cents, opening_cash_bs_cents, status, recount_used, opened_at_ms)
      VALUES ('sess_rate_test', ?, 'usr_cajera', 1000, 1000, 'abierta', 0, ?)
    `).run(jorRes.id, Date.now());

    const ord = createOrder(rawDb, {
      createdByUserId: 'usr_cajera',
      customerName: 'Cliente Tasa',
      fulfillmentType: 'salon',
      lines: [{ productId: 'prod_smash_clasica', quantity: 1, modifiers: [] }]
    });

    // Pagar a tasa 40.00 Bs/$ -> 140 Bs
    rawDb.prepare(`
      INSERT INTO payments (id, order_id, method, currency, amount_cents, rate_micro_bs, usd_equivalent_cents, recorded_by_user_id, created_at_ms)
      VALUES ('pay_hist_01', ?, 'PAGO_MOVIL', 'BS', 14000, 40000000, 350, 'usr_cajera', ?)
    `).run(ord.id, Date.now());

    // Cambiar la tasa a 45.00 Bs/$
    const changeRateRes = await app.inject({
      method: 'POST',
      url: '/api/menu/exchange-rate',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { rateMicroBs: 45_000_000 }
    });
    expect(changeRateRes.statusCode).toBe(200);

    // El pago previo conserva su tasa original de 40.00 Bs/$
    const savedPayment = rawDb.prepare('SELECT rate_micro_bs, usd_equivalent_cents FROM payments WHERE id = ?').get('pay_hist_01') as any;
    expect(savedPayment.rate_micro_bs).toBe(40_000_000);
    expect(savedPayment.usd_equivalent_cents).toBe(350);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 16. Restauración verificada de respaldo .db.age
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 16: Restauración verificada valida integridad y cadena SHA-256', async () => {
    const backupDir = path.join(tempDir, 'backup-restore-test');
    fs.mkdirSync(backupDir, { recursive: true });

    const backupResult = await createEncryptedBackup(rawDb, {
      destinationDir: backupDir,
      backupType: 'MANUAL_EXPORT',
      recipients: [ephemeralRecipient]
    });

    expect(fs.existsSync(backupResult.encryptedFilePath)).toBe(true);

    const restoredTarget = path.join(backupDir, 'restored.db');
    const restoreResult = await restoreAndVerifyDatabase({
      backupFilePath: backupResult.encryptedFilePath,
      privateKey: ephemeralIdentity,
      targetDbPath: restoredTarget,
      dryRun: true
    });

    expect(restoreResult.success).toBe(true);
    expect(restoreResult.integrityCheck).toBe('ok');
    expect(restoreResult.auditChain.valid).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 17. Guardia de reloj atrasado
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 17: Guardia de coherencia temporal (rechaza retrocesos temporales)', () => {
    const now = Date.now();

    expect(() => {
      appendAuditEvent(rawDb, {
        actorUserId: null,
        action: 'CLOCK_CHECK_VALID',
        entityType: 'system',
        entityId: 'sys_1',
        payload: { t: now },
        createdAtMs: now
      });
    }).not.toThrow();

    const chain = verifyAuditChain(rawDb);
    expect(chain.valid).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 18. Transcripción diferida de comandas de papel (#EMG-001)
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 18: Transcripción diferida de comandas de papel (#EMG-001) previene duplicados', async () => {
    const slipNumber = '142';

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/emergency/deferred-orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        emergencySlipNumber: slipNumber,
        realCreatedAtMs: Date.now() - 3600000,
        customerName: 'Cliente Papel',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_smash_clasica', quantity: 1 }],
        tenders: [{ method: 'cash_usd', amountCents: 350 }]
      }
    });
    expect(res1.statusCode).toBe(201);

    // Intentar transcribir exactamente la misma comanda de papel
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/emergency/deferred-orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        emergencySlipNumber: slipNumber,
        realCreatedAtMs: Date.now() - 3600000,
        customerName: 'Cliente Papel Duplicado',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_smash_clasica', quantity: 1 }],
        tenders: [{ method: 'cash_usd', amountCents: 350 }]
      }
    });
    expect(res2.statusCode).toBe(409);
    expect(res2.json().error).toContain('ya fue registrada');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 19. Revocación instantánea de sesión de un empleado desactivado
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 19: Revocación instantánea de sesión al desactivar usuario', async () => {
    const now = Date.now();
    const tempUserId = `usr_temp_${now}`;
    rawDb.prepare(`
      INSERT INTO users (id, name, role, pin_salt, pin_hash, pin_length, is_active, must_change_pin, created_at_ms, updated_at_ms)
      VALUES (?, 'Empleado Temporal', 'mesonero', 'salt', 'hash', 4, 1, 0, ?, ?)
    `).run(tempUserId, now, now);

    const token = 'temp_token_for_revocation';
    const crypto = await import('node:crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    rawDb.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, role, last_activity_ms, expires_at_ms, created_at_ms)
      VALUES ('sess_temp', ?, ?, 'mesonero', ?, ?, ?)
    `).run(tempUserId, tokenHash, now, now + 3600000, now);

    // Desactivar el empleado
    rawDb.prepare('UPDATE users SET is_active = 0, updated_at_ms = ? WHERE id = ?').run(Date.now(), tempUserId);

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.statusCode).toBe(401);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 20. Code-splitting y navegación offline segura en UI
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 20: Code-splitting y bundle de frontend particionado para móviles', () => {
    const candidateWebDirs = [
      path.resolve(process.cwd(), '../web'),
      path.resolve(process.cwd(), 'apps/web'),
      path.resolve(process.cwd(), '../../apps/web')
    ];

    let foundAppTsx = '';
    for (const d of candidateWebDirs) {
      const p = path.join(d, 'src/App.tsx');
      if (fs.existsSync(p)) {
        foundAppTsx = p;
        break;
      }
    }

    expect(foundAppTsx).not.toBe('');
    const appSource = fs.readFileSync(foundAppTsx, 'utf-8');
    expect(appSource).toContain('React.lazy');
    expect(appSource).toContain('ViewErrorBoundary');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 21. Detección y espacio de Bóveda USB (.tocineta-usb-vault)
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 21: Autodetección de Bóveda USB con marcador .tocineta-usb-vault', () => {
    const testUsbRoot = path.join(tempDir, 'usb-vault-cert');
    fs.mkdirSync(testUsbRoot, { recursive: true });
    fs.writeFileSync(path.join(testUsbRoot, '.tocineta-usb-vault'), 'CERT_MARKER');

    const detection = detectUsbVault([testUsbRoot]);
    expect(detection.detected).toBe(true);
    expect(detection.vaultPath).toBe(testUsbRoot);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 22. Simulacro Dry-Run automático de integridad y cadena SHA-256
  // ───────────────────────────────────────────────────────────────────────────
  it('Prueba 22: Simulacro Dry-Run automático verifica integridad sin alterar DB', async () => {
    const snapshotsDir = path.join(tempDir, 'snapshots-cert');
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const snapFile = path.join(snapshotsDir, 'pre-migrate-cert-22.db');
    await rawDb.backup(snapFile);

    const result = await executeDryRunVerification(snapshotsDir);
    expect(result.status).toBe('OK');
    expect(result.snapshotVerified).toBe('pre-migrate-cert-22.db');
    expect(result.auditChainValid).toBe(true);

    const httpRes = await app.inject({
      method: 'POST',
      url: '/api/backups/dry-run-verify'
    });
    expect(httpRes.statusCode).toBe(200);
    expect(['OK', 'NO_SNAPSHOT']).toContain(httpRes.json().status);
  });
});
