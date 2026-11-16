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
import { loginAs } from './test-helpers.js';

describe('H5 - Motivos claros de rechazo en POST /api/orders/:id/pay', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_pay400_${Date.now()}`);
  const tempDb = path.join(tempDir, 'pay400.db');
  let rawDb: Database.Database;
  let cajeraToken: string;

  const createOrder = async (productId = 'prod_doritos_dog_snacks'): Promise<any> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tableNumber: 'Mesa QA',
        fulfillmentType: 'salon',
        lines: [{ productId, quantity: 1 }]
      }
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.payload).order;
  };

  const pay = async (orderId: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload
    });

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { dbPath: tempDb });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;

    const jornada = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        rateStr: '36.60',
        initialCashUsdCents: 5000,
        initialCashBsCents: 183000
      }
    });
    expect(jornada.statusCode).toBe(200);

    const session = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { openingCashUsdCents: 5000, openingCashBsCents: 183000 }
    });
    expect(session.statusCode).toBe(200);
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      getDatabaseContext().rawDb.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('Sin tenders: rechaza con un mensaje accionable y sin código genérico', async () => {
    const order = await createOrder();
    const res = await pay(order.id, { tenders: [] });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Debe incluir al menos un método de pago en tenders');
  });

  it('Orden ya pagada: devuelve 400 PAYMENT_FAILED con el motivo exacto (caso reportado)', async () => {
    const order = await createOrder();
    const first = await pay(order.id, {
      tenders: [{ method: 'cash_usd', amountCents: 350 }]
    });
    expect(first.statusCode).toBe(200);

    const res = await pay(order.id, {
      tenders: [{ method: 'cash_usd', amountCents: 350 }]
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.code).toBe('PAYMENT_FAILED');
    expect(body.error).toMatch(/ya fue cobrada previamente/i);
    expect(body.requiresSupervisorPin).toBe(false);
    expect(body.requiresConfirmation).toBe(false);
    expect(body.settlement).toBeUndefined();
    expect(body.netOverpaymentUsdCents).toBeUndefined();
  });

  it('Sobrepago sin clasificar: 400 con monto excedente exacto y flags en false', async () => {
    const order = await createOrder();
    const res = await pay(order.id, {
      tenders: [{ method: 'cash_usd', amountCents: 500 }]
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toMatch(/SOBREPAGO DETECTADO/);
    expect(body.error).toMatch(/\$1\.50/);
    expect(body.netOverpaymentUsdCents).toBe(150);
    expect(body.requiresSupervisorPin).toBe(false);
    expect(body.requiresConfirmation).toBe(false);
  });

  it('Referencia Pago Móvil duplicada con el mismo monto: 400 y requiere PIN de supervisor', async () => {
    const orderA = await createOrder();
    const first = await pay(orderA.id, {
      tenders: [{ method: 'pago_movil', amountCents: 12810, referenceCode: 'PM-QA-LEVEL1' }]
    });
    expect(first.statusCode).toBe(200);

    const orderB = await createOrder();
    const res = await pay(orderB.id, {
      tenders: [{ method: 'pago_movil', amountCents: 12810, referenceCode: 'PM-QA-LEVEL1' }]
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.code).toBe('FRAUD_BLOCK_DUPLICATE_PAYMENT');
    expect(body.requiresSupervisorPin).toBe(true);
    expect(body.requiresConfirmation).toBe(false);
    expect(body.error).toMatch(/ALERTA ANTIFRAUDE NIVEL 1/);
  });

  it('Referencia Pago Móvil duplicada con otro monto: 400 y requiere confirmación', async () => {
    const orderA = await createOrder();
    const first = await pay(orderA.id, {
      tenders: [{ method: 'pago_movil', amountCents: 12810, referenceCode: 'PM-QA-LEVEL2' }]
    });
    expect(first.statusCode).toBe(200);

    const orderB = await createOrder();
    const res = await pay(orderB.id, {
      tenders: [{ method: 'pago_movil', amountCents: 12000, referenceCode: 'PM-QA-LEVEL2' }]
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.code).toBe('FRAUD_WARN_DUPLICATE_REFERENCE');
    expect(body.requiresConfirmation).toBe(true);
    expect(body.requiresSupervisorPin).toBe(false);
    expect(body.error).toMatch(/ADVERTENCIA ANTIFRAUDE NIVEL 2/);
  });
});
