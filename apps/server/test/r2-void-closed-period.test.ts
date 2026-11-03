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
import { loginAs, ensureTestSupervisor } from './test-helpers.js';
import { _resetAuthorizerGuardState } from '../src/modules/auth/authorizer-guard.js';

describe('B3 / D17: Rechazar anulación de orden pagada en período cerrado (jornada o sesión)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_b3_void_${Date.now()}`);
  const tempDb = path.join(tempDir, 'b3_void.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;
  let cajeraToken: string;
  let jornadaId: string;
  let sessionId: string;
  const ADMIN_PIN = '123456';

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureTestSupervisor(rawDb);
    rawDb.prepare('UPDATE users SET must_change_pin = 0').run();

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
  });

  afterAll(async () => {
    if (app) {
      app.server.closeAllConnections?.();
      await app.close();
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

  beforeEach(async () => {
    _resetAuthorizerGuardState();

    // Cerrar cualquier jornada y sesión previa para garantizar aislamiento total por test
    rawDb.prepare("UPDATE cash_sessions SET status = 'cerrada' WHERE status = 'abierta'").run();
    rawDb.prepare("UPDATE jornadas SET status = 'cerrada' WHERE status = 'abierta'").run();

    // Abrir jornada fresca para el test (Apertura: $50 USD = 5000c, 1000c Bs, tasa 40.00)
    const resJornada = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        rateMicroBs: 40_000_000,
        initialCashUsdCents: 5000,
        initialCashBsCents: 1000
      }
    });
    expect(resJornada.statusCode).toBe(200);
    jornadaId = resJornada.json().jornada.id;

    const session = rawDb.prepare("SELECT * FROM cash_sessions WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
    expect(session).toBeDefined();
    sessionId = session.id;
  });

  it('a) Orden pagada en sesión cerrada vía blind-count -> void con PIN válido responde 409 ORDER_IN_CLOSED_PERIOD y ledger_entries no cambia', async () => {
    // 1. Crear y pagar una orden en la sesión abierta
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 1',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 1 }]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'efectivo_usd', amountCents: 250 }
        ]
      }
    });
    expect(resPay.statusCode).toBe(200);

    // Snapshot de ledger_entries
    const ledgerBefore = rawDb.prepare(
      'SELECT seq, entry_id, account_bucket, debit_usd_cents, credit_usd_cents, description FROM ledger_entries WHERE order_id = ? ORDER BY seq ASC'
    ).all(order.id);
    expect(ledgerBefore.length).toBeGreaterThan(0);

    // 2. Cerrar sesión de caja vía blind-count
    const resBlind = await app.inject({
      method: 'POST',
      url: `/api/cash-sessions/${sessionId}/blind-count`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        counts: [
          { method: 'EFECTIVO_USD', countedCents: 5250 },
          { method: 'EFECTIVO_BS', countedCents: 1000 },
          { method: 'PAGO_MOVIL', countedCents: 0 },
          { method: 'PUNTO_DE_VENTA', countedCents: 0 },
          { method: 'UBII', countedCents: 0 },
          { method: 'TRANSFERENCIA', countedCents: 0 },
          { method: 'ZELLE', countedCents: 0 },
          { method: 'BINANCE', countedCents: 0 },
          { method: 'OTROS', countedCents: 0 }
        ]
      }
    });
    expect(resBlind.statusCode).toBe(200);

    const sessionRow = rawDb.prepare('SELECT status FROM cash_sessions WHERE id = ?').get(sessionId) as any;
    expect(sessionRow.status).toBe('cerrada');

    // 3. Intentar anular la orden con PIN de admin válido
    const resVoid = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        supervisorPin: ADMIN_PIN,
        reason: 'Cliente solicita anulación tardía'
      }
    });

    expect(resVoid.statusCode).toBe(409);
    const body = resVoid.json();
    expect(body.code).toBe('ORDER_IN_CLOSED_PERIOD');

    // 4. Verificar que ledger_entries no cambió en absoluto
    const ledgerAfter = rawDb.prepare(
      'SELECT seq, entry_id, account_bucket, debit_usd_cents, credit_usd_cents, description FROM ledger_entries WHERE order_id = ? ORDER BY seq ASC'
    ).all(order.id);
    expect(ledgerAfter).toEqual(ledgerBefore);

    // 5. Verificar que la orden no fue alterada a estado anulado/reembolsado
    const orderAfter = rawDb.prepare('SELECT payment_status, fulfillment_status FROM orders WHERE id = ?').get(order.id) as any;
    expect(orderAfter.payment_status).toBe('pagado');
    expect(orderAfter.fulfillment_status).not.toBe('anulado');
  });

  it('b) Orden pagada en sesión abierta -> void con PIN válido responde 200', async () => {
    // 1. Crear y pagar una orden
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 2',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 1 }]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'efectivo_usd', amountCents: 250 }
        ]
      }
    });
    expect(resPay.statusCode).toBe(200);

    // 2. Anular la orden en sesión abierta con PIN válido
    const resVoid = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        supervisorPin: ADMIN_PIN,
        reason: 'Cliente canceló el pedido en el momento'
      }
    });

    expect(resVoid.statusCode).toBe(200);
    expect(resVoid.json().success).toBe(true);

    const orderAfter = rawDb.prepare('SELECT payment_status, fulfillment_status FROM orders WHERE id = ?').get(order.id) as any;
    expect(orderAfter.payment_status).toBe('reembolsado');
    expect(orderAfter.fulfillment_status).toBe('anulado');
  });

  it('c) Orden SIN pago en sesión cerrada -> void responde 200', async () => {
    // 1. Crear una orden NO pagada (pendiente)
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 3',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 1 }]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    const orderBefore = rawDb.prepare('SELECT payment_status FROM orders WHERE id = ?').get(order.id) as any;
    expect(orderBefore.payment_status).toBe('sin_pago');

    // 2. Cerrar la sesión de caja vía blind-count
    const resBlind = await app.inject({
      method: 'POST',
      url: `/api/cash-sessions/${sessionId}/blind-count`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        counts: [
          { method: 'EFECTIVO_USD', countedCents: 5000 },
          { method: 'EFECTIVO_BS', countedCents: 1000 },
          { method: 'PAGO_MOVIL', countedCents: 0 },
          { method: 'PUNTO_DE_VENTA', countedCents: 0 },
          { method: 'UBII', countedCents: 0 },
          { method: 'TRANSFERENCIA', countedCents: 0 },
          { method: 'ZELLE', countedCents: 0 },
          { method: 'BINANCE', countedCents: 0 },
          { method: 'OTROS', countedCents: 0 }
        ]
      }
    });
    expect(resBlind.statusCode).toBe(200);

    // 3. Anular la orden no pagada (sin PIN requerido ni restricción de período)
    const resVoid = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        reason: 'Mesa se retiró sin pagar'
      }
    });

    expect(resVoid.statusCode).toBe(200);
    expect(resVoid.json().success).toBe(true);

    const orderAfter = rawDb.prepare('SELECT payment_status, fulfillment_status FROM orders WHERE id = ?').get(order.id) as any;
    expect(orderAfter.payment_status).toBe('anulado');
    expect(orderAfter.fulfillment_status).toBe('anulado');
  });

  it('d) Orden pagada en jornada cerrada (Cierre Z) -> 409 ORDER_IN_CLOSED_PERIOD', async () => {
    // 1. Crear y pagar una orden
    const resOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa 4',
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_street_dog', quantity: 1 }]
      }
    });
    expect(resOrder.statusCode).toBe(201);
    const order = resOrder.json().order;

    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'efectivo_usd', amountCents: 250 }
        ]
      }
    });
    expect(resPay.statusCode).toBe(200);

    // 2. Cerrar la sesión de caja primero (requisito previo para Cierre Z)
    const resBlind = await app.inject({
      method: 'POST',
      url: `/api/cash-sessions/${sessionId}/blind-count`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        counts: [
          { method: 'EFECTIVO_USD', countedCents: 5250 },
          { method: 'EFECTIVO_BS', countedCents: 1000 },
          { method: 'PAGO_MOVIL', countedCents: 0 },
          { method: 'PUNTO_DE_VENTA', countedCents: 0 },
          { method: 'UBII', countedCents: 0 },
          { method: 'TRANSFERENCIA', countedCents: 0 },
          { method: 'ZELLE', countedCents: 0 },
          { method: 'BINANCE', countedCents: 0 },
          { method: 'OTROS', countedCents: 0 }
        ]
      }
    });
    expect(resBlind.statusCode).toBe(200);

    // 3. Ejecutar Cierre Z de la jornada
    const resCloseJornada = await app.inject({
      method: 'POST',
      url: `/api/jornadas/${jornadaId}/close`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        pin: ADMIN_PIN,
        countedCashUsdCents: 5250,
        countedCashBsCents: 1000
      }
    });
    expect(resCloseJornada.statusCode).toBe(200);

    const jornadaRow = rawDb.prepare('SELECT status FROM jornadas WHERE id = ?').get(jornadaId) as any;
    expect(jornadaRow.status).toBe('cerrada');

    // 4. Intentar anular la orden pagada en jornada cerrada
    const resVoid = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        supervisorPin: ADMIN_PIN,
        reason: 'Reclamo posterior al Cierre Z'
      }
    });

    expect(resVoid.statusCode).toBe(409);
    const body = resVoid.json();
    expect(body.code).toBe('ORDER_IN_CLOSED_PERIOD');
  });
});
