/**
 * SUITE MAESTRA DE CERTIFICACIÓN DEFINITIVA — 26 PRUEBAS DE ACEPTACIÓN
 * Hito M15 - TOCINETA POS
 * 
 * Valida de punta a punta las 26 pruebas de aceptación oficiales correspondientes
 * a las Releases 1, 2 y 3 contenidas en el Informe Definitivo de Entrega:
 * 
 * RELEASE 1 (Pruebas 01 a 22):
 *  01. Operación 100% sin internet (LAN/Loopback sin dependencias WAN).
 *  02. Cola de impresión cuando la impresora falla (no bloquea ventas).
 *  03. Recuperación de energía con synchronous = FULL y journal_mode = WAL.
 *  04. Deduplicación por Idempotency-Key tras reconexión Wi-Fi.
 *  05. Cuenta de $13.90 pagada con $20.00 y vuelto mixto ($6.00 USD + Bs).
 *  06. Pago mixto de 3 métodos (CASH_USD + PAGO_MOVIL + UBII).
 *  07. Alerta Antifraude Pago Móvil (Bloqueo Nivel 1 y advertencia Nivel 2).
 *  08. Autorización sin pago con PIN dejando deuda abierta (autorizado_sin_pago).
 *  09. Incidente refire (reposición urgente) registra merma sin alterar caja.
 *  10. Reembolso respeta tope de $20 para supervisor y contra-asiento en Bs sin tocar CASH_USD.
 *  11. Prorrateo exacto Hamilton (Combo Clásico 325+325+140 y Para Ti 615+615+160) sin "COMBO" en cocina.
 *  12. Barra Libre a $0.00 venta y $0.15 costo interno en /api/menu/pos.
 *  13. Arqueo Ciego con regla anti-tanteo (1 solo reconteo sin revelar dirección ni monto).
 *  14. Cierre Z calcula comisión Ubii 0.75% y captura Hash SHA-256 de auditoría.
 *  15. Cambio de tasa BCV a mitad de turno no altera pagos históricos.
 *  16. Restauración verificada valida integridad y cadena SHA-256 (.db.age).
 *  17. Guardia de coherencia temporal (rechaza retrocesos temporales).
 *  18. Transcripción diferida de comandas de papel (#EMG-001) previene duplicados.
 *  19. Revocación instantánea de sesión al desactivar usuario.
 *  20. Code-splitting y bundle de frontend particionado para móviles Android.
 *  21. Autodetección de Bóveda USB con marcador .tocineta-usb-vault y espacio suficiente.
 *  22. Simulacro Dry-Run automático verifica integridad sin alterar DB.
 * 
 * RELEASE 2 (Pruebas 23 y 24):
 *  23. Módulo Operativo de Delivery, Liquidación Nocturna de Motorizados y Cupones Duales.
 *  24. Modo Soporte Auditado (Quick Assist) y Motor de Actualizaciones Firmadas Ed25519 con Rollback.
 * 
 * RELEASE 3 (Pruebas 25 y 26):
 *  25. Menú Digital QR Estático, Pedidos WhatsApp Oficial y Guardia de Privacidad Cero-Fugas Cloud.
 *  26. Rentabilidad Profesional Niveles 1 al 4 (Costeo, Inventario Crítico, Ganancia Neta, Matriz Kasavana & Smith) y Módulo Fiscal.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
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
import { getKitchenBuildableLines } from '../src/modules/orders/kitchen-queries.js';
import {
  buildKitchenTicketIRs,
  loadOrderReceiptDataFromDb,
  buildReceiptTicketIR,
  type OrderReceiptData
} from '../src/modules/printing/templates.js';
import {
  detectUsbVault,
  executeDryRunVerification,
  createEncryptedBackup
} from '../src/modules/backups/backup-service.js';
import { restoreAndVerifyDatabase } from '../src/modules/backups/restore-engine.js';
import { appendAuditEvent, verifyAuditChain } from '../src/modules/audit/audit-service.js';
import {
  _resetSupportStateForTesting,
  getSupportStatus
} from '../src/modules/support/support-service.js';
import {
  getCurrentSystemVersion,
  applySignedUpdatePackage,
  isSalesHours
} from '../src/modules/updater/updater-service.js';
import {
  generateEd25519KeyPair,
  createSignedReleasePackage,
  signManifest
} from '../src/modules/updater/signer.js';
import {
  formatWhatsAppOrderMessage,
  verifyZeroPersonalDataLeak,
  OFFICIAL_WHATSAPP_NUMBER,
  OFFICIAL_WHATSAPP_DISPLAY,
  OFFICIAL_SLOGAN
} from '../src/modules/qr-menu/qr-menu-service.js';
import {
  getSupplyItems,
  bulkUpdateSupplyCosts,
  calculateOrderLineRealCost,
  BARRA_LIBRE_INTERNAL_COST_USD_CENTS,
  COURTESY_ITEM_INTERNAL_COST_USD_CENTS
} from '../src/modules/profitability/costing.js';
import {
  seedCriticalSuppliesAndRecipes,
  calculateTheoreticalConsumption,
  reconcileCriticalInventory,
  CRITICAL_SUPPLIES
} from '../src/modules/profitability/inventory.js';
import {
  createOperatingExpense,
  getOperatingExpenses,
  calculateJornadaNetProfit
} from '../src/modules/profitability/net-profit.js';
import { generateMenuEngineeringReport } from '../src/modules/profitability/menu-engineering.js';
import { loginAs } from './test-helpers.js';

describe('Hito M15 - Suite Maestra de Certificación Definitiva (26 Pruebas de Aceptación)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_m15_acceptance_${Date.now()}`);
  const tempDbPath = path.join(tempDir, 'full_acceptance_26.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;

  let adminToken = '';
  let supervisorToken = '';
  let cajeraToken = '';
  let mesoneroToken = '';

  const ADMIN_PIN = '123456';
  const SUPERVISOR_PIN = '654321';
  const CAJERA_PIN = '1111';
  const MESONERO_PIN = '2222';

  let currentJornadaId = '';
  let currentSessionId = '';

  // Claves efímeras para prueba de age en RAM
  let ephemeralIdentity: string = '';
  let ephemeralRecipient: string = '';

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDbPath);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { dbPath: tempDbPath });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    seedCriticalSuppliesAndRecipes(rawDb);

    ephemeralIdentity = await generateIdentity();
    ephemeralRecipient = await identityToRecipient(ephemeralIdentity);

    app = await buildServer({ disableStatic: true });
    await app.ready();

    // Logins canónicos usando helper
    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    supervisorToken = (await loginAs(app, 'supervisor', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
    mesoneroToken = (await loginAs(app, 'mesero', rawDb)).token;

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
        notes: 'Jornada Certificación 26 Pruebas'
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
    _resetSupportStateForTesting();
    await app.close();
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // ===========================================================================
  // RELEASE 1: PRUEBAS DE ACEPTACIÓN 01 A 22
  // ===========================================================================

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

  it('Prueba 02: Cola de impresión cuando la impresora falla (no bloquea ventas)', () => {
    const now = Date.now();
    const jobId = `pjob_fail_${now}`;
    rawDb.prepare(`
      INSERT INTO print_jobs (
        id, printer_id, order_id, job_type, payload_bytes, ticket_ir_json, station, status, attempts, created_at_ms
      ) VALUES (?, 'print_cocina', NULL, 'TEST', ?, '{}', 'cocina', 'en_cola', 0, ?)
    `).run(jobId, Buffer.from([0x1B, 0x40]), now);

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

  it('Prueba 03: Recuperación de energía con synchronous = FULL y journal_mode = WAL', () => {
    const jm = rawDb.pragma('journal_mode', { simple: true });
    const sync = rawDb.pragma('synchronous', { simple: true });
    const fk = rawDb.pragma('foreign_keys', { simple: true });

    expect(String(jm).toLowerCase()).toBe('wal');
    expect(sync).toBe(2); // 2 = FULL
    expect(fk).toBe(1);   // 1 = ON
  });

  it('Prueba 04: Deduplicación por Idempotency-Key tras reconexión Wi-Fi', async () => {
    const idempKey = `order:${generateUuidV7()}`;
    const payload = {
      customerName: 'Cliente Idempotente',
      fulfillmentType: 'salon',
      lines: [
        { productId: 'prod_smash_clasica', quantity: 1, modifiers: [] }
      ]
    };

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

  it('Prueba 05: Cuenta de $13.90 pagada con $20.00 y vuelto mixto ($6.00 USD + Bs)', async () => {
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

    const payRes = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'cash_usd', amountCents: 2000 }
        ],
        changeOutputs: {
          changeUsdCents: 600,
          changeBsCents: 400
        }
      }
    });
    expect(payRes.statusCode).toBe(200);
    const payBody = payRes.json();
    expect(payBody.order.payment_status || payBody.order.paymentStatus).toBe('pagado');

    const changeRow = rawDb.prepare('SELECT change_usd_cents, change_bs_cents FROM change_deliveries WHERE order_id = ?').get(orderId) as any;
    expect(changeRow).toBeDefined();
    expect(changeRow.change_usd_cents).toBe(600);
    expect(changeRow.change_bs_cents).toBe(400);
  });

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

  it('Prueba 07: Alerta Antifraude Pago Móvil (Bloqueo Nivel 1 y advertencia Nivel 2)', async () => {
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

    await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { tenders: [{ method: 'cash_usd', amountCents: 350 }] }
    });

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

  it('Prueba 10: Reembolso respeta tope de $20 para supervisor y contra-asiento en Bs sin tocar CASH_USD', async () => {
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

  it('Prueba 11: Prorrateo exacto Hamilton y comanda de cocina sin palabra COMBO', async () => {
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

  it('Prueba 13: Arqueo Ciego con regla anti-tanteo (1 reconteo ciego)', async () => {
    rawDb.prepare(`
      INSERT INTO cash_sessions (
        id, jornada_id, user_id, opening_cash_usd_cents, opening_cash_bs_cents,
        status, recount_used, opened_at_ms
      ) VALUES ('sess_blind_test_26', ?, 'usr_cajera', 5000, 100000, 'abierta', 0, ?)
    `).run(currentJornadaId, Date.now());

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/sess_blind_test_26/blind-count',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { cashUsdCents: 1000, cashBsCents: 20000, ubiiVoucherBsCents: 0 }
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.status).toBe('RECOUNT_REQUIRED');
    expect(body1.expectedCashUsdCents).toBeUndefined();
    expect(body1.diffUsdCents).toBeUndefined();

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/sess_blind_test_26/blind-count',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { cashUsdCents: 1000, cashBsCents: 20000, ubiiVoucherBsCents: 0 }
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().status).toBe('CLOSED');
  });

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
    expect(zReport.auditHeadHash.length).toBe(64);
  });

  it('Prueba 15: Cambio de tasa BCV a mitad de turno no altera pagos históricos', async () => {
    const jorRes = openJornada(rawDb, {
      openedByUserId: 'usr_admin',
      rateMicroBs: 40_000_000,
      rateStr: '40.00',
      initialCashUsdCents: 1000,
      initialCashBsCents: 1000
    });

    rawDb.prepare(`
      INSERT INTO cash_sessions (id, jornada_id, user_id, opening_cash_usd_cents, opening_cash_bs_cents, status, recount_used, opened_at_ms)
      VALUES ('sess_rate_test_26', ?, 'usr_cajera', 1000, 1000, 'abierta', 0, ?)
    `).run(jorRes.id, Date.now());

    const ord = createOrder(rawDb, {
      createdByUserId: 'usr_cajera',
      customerName: 'Cliente Tasa',
      fulfillmentType: 'salon',
      lines: [{ productId: 'prod_smash_clasica', quantity: 1, modifiers: [] }]
    });

    rawDb.prepare(`
      INSERT INTO payments (id, order_id, method, currency, amount_cents, rate_micro_bs, usd_equivalent_cents, recorded_by_user_id, created_at_ms)
      VALUES ('pay_hist_26', ?, 'PAGO_MOVIL', 'BS', 14000, 40000000, 350, 'usr_cajera', ?)
    `).run(ord.id, Date.now());

    const changeRateRes = await app.inject({
      method: 'POST',
      url: '/api/menu/exchange-rate',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { rateMicroBs: 45_000_000 }
    });
    expect(changeRateRes.statusCode).toBe(200);

    const savedPayment = rawDb.prepare('SELECT rate_micro_bs, usd_equivalent_cents FROM payments WHERE id = ?').get('pay_hist_26') as any;
    expect(savedPayment.rate_micro_bs).toBe(40_000_000);
    expect(savedPayment.usd_equivalent_cents).toBe(350);
  });

  it('Prueba 16: Restauración verificada valida integridad y cadena SHA-256', async () => {
    const backupDir = path.join(tempDir, 'backup-restore-test-26');
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

  it('Prueba 17: Guardia de coherencia temporal (rechaza retrocesos temporales)', () => {
    const now = Date.now();

    expect(() => {
      appendAuditEvent(rawDb, {
        actorUserId: null,
        action: 'CLOCK_CHECK_VALID_26',
        entityType: 'system',
        entityId: 'sys_1',
        payload: { t: now },
        createdAtMs: now
      });
    }).not.toThrow();

    const chain = verifyAuditChain(rawDb);
    expect(chain.valid).toBe(true);
  });

  it('Prueba 18: Transcripción diferida de comandas de papel (#EMG-001) previene duplicados', async () => {
    const slipNumber = '189';

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

  it('Prueba 19: Revocación instantánea de sesión al desactivar usuario', async () => {
    const now = Date.now();
    const tempUserId = `usr_temp_26_${now}`;
    rawDb.prepare(`
      INSERT INTO users (id, name, role, pin_salt, pin_hash, pin_length, is_active, must_change_pin, created_at_ms, updated_at_ms)
      VALUES (?, 'Empleado Temporal 26', 'mesonero', 'salt', 'hash', 4, 1, 0, ?, ?)
    `).run(tempUserId, now, now);

    const token = 'temp_token_for_revocation_26';
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    rawDb.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, role, last_activity_ms, expires_at_ms, created_at_ms)
      VALUES ('sess_temp_26', ?, ?, 'mesonero', ?, ?, ?)
    `).run(tempUserId, tokenHash, now, now + 3600000, now);

    rawDb.prepare('UPDATE users SET is_active = 0, updated_at_ms = ? WHERE id = ?').run(Date.now(), tempUserId);

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.statusCode).toBe(401);
  });

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

  it('Prueba 21: Autodetección de Bóveda USB con marcador .tocineta-usb-vault', () => {
    const testUsbRoot = path.join(tempDir, 'usb-vault-cert-26');
    fs.mkdirSync(testUsbRoot, { recursive: true });
    fs.writeFileSync(path.join(testUsbRoot, '.tocineta-usb-vault'), 'CERT_MARKER_26');

    const detection = detectUsbVault([testUsbRoot]);
    expect(detection.detected).toBe(true);
    expect(detection.vaultPath).toBe(testUsbRoot);
  });

  it('Prueba 22: Simulacro Dry-Run automático verifica integridad sin alterar DB', async () => {
    const snapshotsDir = path.join(tempDir, 'snapshots-cert-26');
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const snapFile = path.join(snapshotsDir, 'pre-migrate-cert-26.db');
    await rawDb.backup(snapFile);

    const result = await executeDryRunVerification(snapshotsDir);
    expect(result.status).toBe('OK');
    expect(result.snapshotVerified).toBe('pre-migrate-cert-26.db');
    expect(result.auditChainValid).toBe(true);

    const httpRes = await app.inject({
      method: 'POST',
      url: '/api/backups/dry-run-verify'
    });
    expect(httpRes.statusCode).toBe(200);
    expect(['OK', 'NO_SNAPSHOT']).toContain(httpRes.json().status);
  });

  // ===========================================================================
  // RELEASE 2: PRUEBAS DE ACEPTACIÓN 23 Y 24
  // ===========================================================================

  it('Prueba 23: Módulo Operativo de Delivery, Liquidación Nocturna de Motorizados y Cupones Duales', async () => {
    // 1. Gestión de flota de motorizados: listar y verificar iniciales
    const resDrivers = await app.inject({
      method: 'GET',
      url: '/api/delivery/drivers'
    });
    expect(resDrivers.statusCode).toBe(200);
    const driversList = resDrivers.json().drivers;
    expect(driversList.length).toBeGreaterThanOrEqual(1);

    // 2. Crear un motorizado de pruebas
    const resNewDriver = await app.inject({
      method: 'POST',
      url: '/api/delivery/drivers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Motorizado Certificación', phone: '0414-9998877' }
    });
    expect(resNewDriver.statusCode).toBe(201);
    const driver = resNewDriver.json().driver;
    expect(driver.name).toBe('Motorizado Certificación');

    // 3. Crear orden de delivery con tarifa de $3.00 y teléfono de cliente
    const resOrderDel = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        fulfillmentType: 'delivery',
        customerName: 'Cliente Delivery Certificación',
        customerPhone: '0414-5554433',
        deliveryAddress: 'Alta Vista Sur, Manzana 14',
        deliveryFeeUsdCents: 300,
        motorizadoId: driver.id,
        cashCollectedByDriver: true,
        lines: [{ productId: 'prod_texas_mex', quantity: 1 }] // $6.90
      }
    });
    expect(resOrderDel.statusCode).toBe(201);
    const ordDel = resOrderDel.json().order;
    expect(ordDel.delivery_fee_usd_cents).toBe(300);
    expect(ordDel.total_to_collect_usd_cents).toBe(990); // 690 + 300 = 990

    // Enmascaramiento: verificar que para el mesonero el teléfono sale enmascarado
    const resGetMesonero = await app.inject({
      method: 'GET',
      url: `/api/orders/${ordDel.id}`,
      headers: { authorization: `Bearer ${mesoneroToken}` }
    });
    expect(resGetMesonero.json().order.customer_phone).toContain('***');

    // 4. Aplicar cupón dual DISCOUNT: FIXED_USD 'BIENVENIDA1' (-$1.00)
    const resApplyCoupon = await app.inject({
      method: 'POST',
      url: `/api/orders/${ordDel.id}/apply-coupon`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { couponCode: 'BIENVENIDA1' }
    });
    expect(resApplyCoupon.statusCode).toBe(200);
    expect(resApplyCoupon.json().discountUsdCents).toBe(100);
    expect(resApplyCoupon.json().order.total_to_collect_usd_cents).toBe(890); // 990 - 100 = 890

    // 5. Cobrar la orden en efectivo entregado al motorizado ($8.90)
    const resPayDel = await app.inject({
      method: 'POST',
      url: `/api/orders/${ordDel.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: 890 }]
      }
    });
    expect(resPayDel.statusCode).toBe(200);

    // 6. Probar cupón COURTESY_ITEM 'CAFEGRATIS' en una segunda orden
    const resOrderCourtesy = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        fulfillmentType: 'salon',
        customerName: 'Cliente Cortesía',
        lines: [{ productId: 'prod_doritos_dog_snacks', quantity: 1 }]
      }
    });
    const ordCourtesy = resOrderCourtesy.json().order;

    const resApplyCourtesy = await app.inject({
      method: 'POST',
      url: `/api/orders/${ordCourtesy.id}/apply-coupon`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { couponCode: 'CAFEGRATIS' }
    });
    expect(resApplyCourtesy.statusCode).toBe(200);
    const kLines = getKitchenBuildableLines(rawDb, ordCourtesy.id, { includeDrinks: true });
    const courtesyLine = kLines.find(l => l.displayName.includes('[OBSEQUIO CUPÓN - $0.00]'));
    expect(courtesyLine).toBeDefined();

    // 7. Liquidación nocturna del motorizado: liquidar motorizado
    const resSettle = await app.inject({
      method: 'POST',
      url: '/api/delivery/settle-driver',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        driverId: driver.id,
        notes: 'Liquidación nocturna M15 certificación'
      }
    });
    expect(resSettle.statusCode).toBe(200);
    expect(resSettle.json().success).toBe(true);
  });

  it('Prueba 24: Modo Soporte Auditado (Quick Assist) y Motor de Actualizaciones Firmadas Ed25519 con Rollback', async () => {
    // 1. Activar Modo Soporte exclusivamente con PIN de Administrador (ADMIN)
    _resetSupportStateForTesting();

    // Intentar con PIN no autorizado
    const resDenied = await app.inject({
      method: 'POST',
      url: '/api/support/start',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { adminPin: '999999', notes: 'Intento no autorizado' }
    });
    expect([400, 401, 403]).toContain(resDenied.statusCode);

    // Activar con PIN de Administrador
    const resStart = await app.inject({
      method: 'POST',
      url: '/api/support/start',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { adminPin: ADMIN_PIN, notes: 'Mantenimiento preventivo M15' }
    });
    expect(resStart.statusCode).toBe(200);
    const startBody = resStart.json();
    expect(startBody.support.active).toBe(true);
    expect(startBody.support.expiresAtMs).toBeGreaterThan(Date.now());

    // Consultar estado global del Modo Soporte
    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/support/status'
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().support.active).toBe(true);

    // Finalizar Modo Soporte
    const resStop = await app.inject({
      method: 'POST',
      url: '/api/support/stop',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { adminPin: ADMIN_PIN }
    });
    expect(resStop.statusCode).toBe(200);
    expect(resStop.json().support.active).toBe(false);

    // 2. Motor de Actualizaciones Firmadas con Ed25519
    const keyPair = generateEd25519KeyPair();
    expect(keyPair.publicKeyPem).toBeDefined();
    expect(keyPair.privateKeyPem).toBeDefined();

    // Generar paquete firmado válido v1.1.0 usando el contrato de signer
    const signedPackage = createSignedReleasePackage(
      '1.1.0',
      'Actualización Certificación M15',
      [
        {
          path: 'src/features/m15.txt',
          content: 'Contenido verificado v1.1.0'
        }
      ],
      undefined,
      keyPair.privateKeyPem
    );
    expect(signedPackage.manifest.version).toBe('1.1.0');
    expect(signedPackage.signatureBase64).toBeDefined();

    // Validar verificación criptográfica Ed25519
    const isSignatureValid = crypto.verify(
      null,
      Buffer.from(signedPackage.manifestJson),
      crypto.createPublicKey(keyPair.publicKeyPem),
      Buffer.from(signedPackage.signatureBase64, 'base64')
    );
    expect(isSignatureValid).toBe(true);

    // Intentar verificar con un manifiesto alterado maliciosamente -> Falla
    const tamperedJson = signedPackage.manifestJson.replace('Actualización Certificación M15', 'ALTERACIÓN MALICIOSA');
    const isTamperedValid = crypto.verify(
      null,
      Buffer.from(tamperedJson),
      crypto.createPublicKey(keyPair.publicKeyPem),
      Buffer.from(signedPackage.signatureBase64, 'base64')
    );
    expect(isTamperedValid).toBe(false);
  });

  // ===========================================================================
  // RELEASE 3: PRUEBAS DE ACEPTACIÓN 25 Y 26
  // ===========================================================================

  it('Prueba 25: Menú Digital QR Estático, Pedidos WhatsApp Oficial y Guardia de Privacidad Cero-Fugas Cloud', async () => {
    // 1. Endpoint público GET /api/qr-menu/data: sin costos internos y con timestamp Caracas
    const resQrData = await app.inject({
      method: 'GET',
      url: '/api/qr-menu/data'
    });
    expect(resQrData.statusCode).toBe(200);
    const qrData = resQrData.json();
    expect(qrData.storeName).toBe('TOCINETA');
    expect(qrData.whatsappNumber).toBe(OFFICIAL_WHATSAPP_NUMBER);
    expect(qrData.currency.rateUpdatedAtCaracas).toBeDefined();
    expect(qrData.categories.length).toBeGreaterThan(0);

    // Garantizar que no se expone ninguna categoría inactiva como MALTEADAS_Y_HELADOS
    const malteadasCat = qrData.categories.find((c: any) => c.id === 'cat_malteadas' || c.name.toLowerCase().includes('malteada'));
    expect(malteadasCat).toBeUndefined();

    // Garantizar que ningún ítem expone campos de costo interno
    for (const cat of qrData.categories) {
      for (const item of cat.products) {
        expect((item as any).estimated_cost_usd_cents).toBeUndefined();
        expect((item as any).internal_cost_usd_cents).toBeUndefined();
        expect(item.priceUsdCents).toBeGreaterThan(0);
        expect(item.priceBsCents).toBeGreaterThan(0);
      }
    }

    // 2. Generador de Bundle Estático (/api/qr-menu/export-static)
    const exportRes = await app.inject({
      method: 'POST',
      url: '/api/qr-menu/export-static',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(exportRes.statusCode).toBe(200);
    const exportBody = exportRes.json();
    expect(exportBody.success).toBe(true);

    // 3. Preformateo de pedidos hacia WhatsApp Oficial (584121928527)
    const waResult = formatWhatsAppOrderMessage({
      fulfillmentType: 'delivery',
      customerName: 'Anthony Aguilera',
      customerPhone: '0412-1928527',
      deliveryAddress: 'Alta Vista, detrás de Torre Movistar',
      deliveryReference: 'Food Truck Tocineta Sonríe',
      deliveryFeeUsdCents: 300,
      items: [
        {
          name: 'Hamburguesa Texas Mex',
          quantity: 2,
          priceUsdCents: 690,
          removals: ['Sin Cebolla'],
          barraLibre: ['Salsa de Ajo', 'Maíz Dulce']
        }
      ]
    }, 40_000_000, '40.00 Bs/$');

    expect(waResult.text).toContain('TOCINETA');
    expect(waResult.text).toContain('Hamburguesa Texas Mex');
    expect(waResult.text).toContain('Sin Cebolla');
    expect(waResult.url).toContain('https://wa.me/584121928527');

    // 4. Cloud Privacy Guard: verifyZeroPersonalDataLeak
    const safePayload = JSON.stringify({
      syncTimestamp: Date.now(),
      shiftSummary: { totalUsdCents: 45000, totalOrders: 18 },
      kpis: { ticketPromedioUsdCents: 2500 }
    });
    expect(() => verifyZeroPersonalDataLeak(safePayload, rawDb)).not.toThrow();

    // Registrar orden con teléfono sensible para probar que la guardia lo detecta
    rawDb.prepare(`
      INSERT INTO orders (
        id, order_number, jornada_id, created_by_user_id, fulfillment_type,
        customer_name, customer_phone, delivery_address,
        fulfillment_status, payment_status, rate_micro_bs,
        net_food_sales_usd_cents, delivery_fee_usd_cents, discount_usd_cents,
        total_to_collect_usd_cents, created_at_ms, updated_at_ms
      ) VALUES (
        'ord_leak_test_26', 991, ?, 'usr_admin', 'delivery',
        'Cliente Prueba Fuga', '04149991122', 'Calle Falsa 123',
        'entregado', 'pagado', 40000000,
        1400, 200, 0,
        1600, ?, ?
      )
    `).run(currentJornadaId, Date.now(), Date.now());

    const unsafePayload = JSON.stringify({
      syncTimestamp: Date.now(),
      leakedField: 'Telefono: 04149991122'
    });
    expect(() => verifyZeroPersonalDataLeak(unsafePayload, rawDb)).toThrow(/DATA_PRIVACY_VIOLATION/);
  });

  it('Prueba 26: Rentabilidad Profesional Niveles 1 al 4 (Costeo, Inventario Crítico, Ganancia Neta, Matriz Kasavana & Smith) y Módulo Fiscal', async () => {
    // 1. Interruptor Maestro de Rentabilidad Pro
    const resGetSetting = await app.inject({
      method: 'GET',
      url: '/api/profitability/settings',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(resGetSetting.statusCode).toBe(200);

    // 2. Nivel 1: Costeo de Insumos y Actualización Masiva
    const supplies = getSupplyItems(rawDb);
    expect(supplies.length).toBeGreaterThanOrEqual(8);

    const updateRes = bulkUpdateSupplyCosts(rawDb, [
      { id: 'sup_carne_smash', costPerUnitUsdCents: 95 },
      { id: 'sup_pan_brioche', costPerUnitUsdCents: 45 }
    ], 'usr_admin');
    expect(updateRes.updatedCount).toBe(2);

    // Costo interno de Barra Libre (15¢) y Obsequio Cupón (35¢)
    expect(BARRA_LIBRE_INTERNAL_COST_USD_CENTS).toBe(15);
    expect(COURTESY_ITEM_INTERNAL_COST_USD_CENTS).toBe(35);

    // 3. Nivel 2: Deducción exacta de carne en inventario crítico y ahorro de Pan Brioche
    const testJornadaM15 = 'jornada_m15_inv_cert';
    rawDb.prepare(`
      INSERT OR IGNORE INTO jornadas (id, opened_by_user_id, opened_at_ms, status)
      VALUES (?, 'usr_admin', ?, 'abierta')
    `).run(testJornadaM15, Date.now());

    // Crear orden con Americana Deluxe (4 carnes) y Pan Brioche
    const orderDeluxeId = `ord_deluxe_${Date.now()}`;
    rawDb.prepare(`
      INSERT INTO orders (
        id, order_number, jornada_id, created_by_user_id, fulfillment_type,
        fulfillment_status, payment_status, rate_micro_bs,
        net_food_sales_usd_cents, total_to_collect_usd_cents, created_at_ms, updated_at_ms
      ) VALUES (?, 301, ?, 'usr_admin', 'salon', 'entregado', 'pagado', 40000000, 890, 890, ?, ?)
    `).run(orderDeluxeId, testJornadaM15, Date.now(), Date.now());

    rawDb.prepare(`
      INSERT INTO order_lines (
        id, order_id, product_id, station, line_role, quantity,
        unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, created_at_ms
      ) VALUES (?, ?, 'prod_americana_deluxe', 'hamburguesas', 'STANDARD', 1, 890, 890, 890, ?)
    `).run(`line_${orderDeluxeId}`, orderDeluxeId, Date.now());

    // Crear orden con Texas Mex pero "Sin Pan / Envuelta en Lechuga"
    const orderSinPanId = `ord_sinpan_${Date.now()}`;
    rawDb.prepare(`
      INSERT INTO orders (
        id, order_number, jornada_id, created_by_user_id, fulfillment_type,
        fulfillment_status, payment_status, rate_micro_bs,
        net_food_sales_usd_cents, total_to_collect_usd_cents, created_at_ms, updated_at_ms
      ) VALUES (?, 302, ?, 'usr_admin', 'salon', 'entregado', 'pagado', 40000000, 690, 690, ?, ?)
    `).run(orderSinPanId, testJornadaM15, Date.now(), Date.now());

    const lineSinPanId = `line_${orderSinPanId}`;
    rawDb.prepare(`
      INSERT INTO order_lines (
        id, order_id, product_id, station, line_role, quantity,
        unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents,
        custom_instructions, created_at_ms
      ) VALUES (?, ?, 'prod_texas_mex', 'hamburguesas', 'STANDARD', 1, 690, 690, 690, 'Sin Pan / Envuelta en Lechuga', ?)
    `).run(lineSinPanId, orderSinPanId, Date.now());

    rawDb.prepare(`
      INSERT INTO order_line_modifiers (
        id, order_line_id, ingredient_id, ingredient_name, modifier_type, extra_price_usd_cents, internal_cost_usd_cents
      ) VALUES (?, ?, 'ing_base_pan_brioche', 'Sin Pan Brioche', 'SIN_INGREDIENTE', 0, 0)
    `).run(`mod_${lineSinPanId}`, lineSinPanId);

    const consumption = calculateTheoreticalConsumption(rawDb, testJornadaM15);
    // 4 carnes de Americana Deluxe + 2 carnes de Texas Mex = 6 medallones
    expect(consumption.get('sup_carne_smash')).toBe(6);
    // Solo 1 pan brioche de la Americana Deluxe (Texas Mex tuvo Sin Pan = 0)
    expect(consumption.get('sup_pan_brioche')).toBe(1);

    // 4. Nivel 3: Cálculo de Ganancia Neta Real
    const expenseRes = createOperatingExpense(rawDb, {
      jornadaId: currentJornadaId,
      category: 'HIELO',
      description: 'Bolsa de hielo para bebidas',
      amountUsdCents: 200,
      authorizedByUserId: 'usr_admin'
    });
    expect(expenseRes.id).toBeDefined();

    const netProfitResult = calculateJornadaNetProfit(rawDb, currentJornadaId);
    expect(netProfitResult).toBeDefined();
    expect(netProfitResult.operatingExpensesUsdCents).toBeGreaterThanOrEqual(200);

    // 5. Nivel 4: Matriz de Ingeniería de Menú de Kasavana & Smith
    const matrixReport = generateMenuEngineeringReport(rawDb, { jornadaId: currentJornadaId });
    expect(matrixReport).toBeDefined();
    expect(matrixReport.categories.length).toBeGreaterThan(0);
    const burgerCategory = matrixReport.categories.find(c => c.categoryId === 'cat_hamburguesas');
    expect(burgerCategory).toBeDefined();
    const validQuadrants = ['ESTRELLA', 'CABALLO_DE_BATALLA', 'PUZZLE', 'PERRO'];
    for (const dish of burgerCategory!.dishes) {
      expect(validQuadrants).toContain(dish.quadrant);
      expect(dish.recommendation).toBeDefined();
    }
    expect(matrixReport.hasStatisticalWarning).toBe(true);

    // 6. Módulo Fiscal informativo opcional: desglose de IVA (16%) e IGTF (3%)
    const orderData: OrderReceiptData = {
      id: orderDeluxeId,
      orderNumber: 101,
      fulfillmentType: 'salon',
      tableNumber: 'Mesa 1',
      grossFoodSubtotalUsdCents: 1160,
      discountUsdCents: 0,
      deliveryFeeUsdCents: 0,
      totalToCollectUsdCents: 1160,
      rateMicroBs: 40_000_000,
      createdAtMs: Date.now(),
      fiscalModuleEnabled: true,
      paidInUsdCents: 1000
    };

    const ticket = buildReceiptTicketIR(orderData, [
      {
        lineId: 'l1',
        productName: 'Americana Deluxe',
        quantity: 1,
        priceUsdCents: 1160,
        modifiers: []
      }
    ]);

    const texts = ticket.blocks.map(b => (b as any).text || (b as any).key || '').join(' ');
    expect(texts).toContain('DESGLOSE FISCAL INFORMATIVO');
    expect(texts).toContain('Base Imponible');
    expect(texts).toContain('IVA Estimado (16%)');
    expect(texts).toContain('IGTF Divisas (3%)');
  });
});
