import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { seedCriticalSuppliesAndRecipes } from '../src/modules/profitability/inventory.js';
import { openJornada, processOrderPayment } from '../src/modules/cashier/cashier-service.js';
import { loginAs } from './test-helpers.js';

/**
 * J2 — El pedido guarda la sede donde se vende.
 * Cubre la resolución de sede en POST /api/orders (explícita, por defecto del
 * usuario, inválida) y que el cobro en modo tracked descuente inventario de la
 * sede de la orden y no de la otra sede.
 */
describe('J2 — Sede en el pedido', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_order_location_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_order_location.db');
  const RATE_MICRO_BS = 40_000_000;

  let app: FastifyInstance;
  let rawDb: Database.Database;
  let meseroToken: string;

  const getStock = (locationId: string, supplyId: string): number => {
    const row = rawDb.prepare(
      'SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?'
    ).get(locationId, supplyId) as any;
    return Number(row?.current_stock_qty ?? 0);
  };

  const setStock = (locationId: string, supplyId: string, qty: number) => {
    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(`${locationId}_${supplyId}`, locationId, supplyId, qty, Date.now());
  };

  const setMeseroDefaultLocation = (locationId: string) => {
    rawDb.prepare('UPDATE users SET default_location_id = ? WHERE id = ?').run(locationId, 'usr_mesero');
  };

  const createOrderViaApi = async (payload: Record<string, unknown>) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${meseroToken}` },
      payload
    });
    const body = JSON.parse(res.payload) as any;
    return { statusCode: res.statusCode, body };
  };

  const baseOrderPayload = {
    tableNumber: 'Mesa J2',
    fulfillmentType: 'salon',
    lines: [{ productId: 'prod_jalapenos_dog', quantity: 1 }]
  };

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { dbPath: tempDb });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureOfficialLocations(rawDb);
    seedCriticalSuppliesAndRecipes(rawDb);

    // En modo tracked el cobro descuenta inventario por receta.
    rawDb.prepare("UPDATE business_settings SET inventory_operation_mode = 'tracked' WHERE id = 'default'").run();

    // Jornada abierta con sesión de caja de la cajera en Los Olivos.
    openJornada(rawDb, {
      openedByUserId: 'usr_cajera',
      locationId: 'loc_los_olivos',
      rateMicroBs: RATE_MICRO_BS,
      initialCashUsdCents: 0,
      initialCashBsCents: 0
    });

    // Stock distinto por sede para detectar cualquier descuento cruzado.
    rawDb.prepare(`
      UPDATE supply_items
      SET current_stock_qty = 200, weighted_avg_cost_usd_cents = 25, cost_per_unit_usd_cents = 25
      WHERE id = 'sup_pan_perro'
    `).run();
    rawDb.prepare(`
      UPDATE supply_items
      SET current_stock_qty = 200, weighted_avg_cost_usd_cents = 40, cost_per_unit_usd_cents = 40
      WHERE id = 'sup_salchicha_pollo'
    `).run();

    setStock('loc_alta_vista', 'sup_pan_perro', 50);
    setStock('loc_alta_vista', 'sup_salchicha_pollo', 60);
    setStock('loc_los_olivos', 'sup_pan_perro', 20);
    setStock('loc_los_olivos', 'sup_salchicha_pollo', 30);

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    meseroToken = (await loginAs(app, 'mesero', rawDb)).token;
  });

  afterAll(async () => {
    if (app) await app.close();
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

  it('guarda la sede de Los Olivos enviada explícitamente en el body', async () => {
    const res = await createOrderViaApi({
      ...baseOrderPayload,
      locationId: 'loc_los_olivos'
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.order.location_id).toBe('loc_los_olivos');

    const row = rawDb.prepare('SELECT location_id FROM orders WHERE id = ?').get(res.body.order.id) as any;
    expect(row.location_id).toBe('loc_los_olivos');
  });

  it('usa la sede por defecto del usuario (Los Olivos) cuando el body no la envía', async () => {
    setMeseroDefaultLocation('loc_los_olivos');

    const res = await createOrderViaApi({ ...baseOrderPayload });

    expect(res.statusCode).toBe(201);
    expect(res.body.order.location_id).toBe('loc_los_olivos');
  });

  it('usa la sede por defecto del usuario (Alta Vista) cuando el body no la envía', async () => {
    setMeseroDefaultLocation('loc_alta_vista');

    const res = await createOrderViaApi({ ...baseOrderPayload });

    expect(res.statusCode).toBe(201);
    expect(res.body.order.location_id).toBe('loc_alta_vista');
  });

  it('rechaza con 400 una sede inexistente o inactiva', async () => {
    const ordersBefore = (rawDb.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c;

    const res = await createOrderViaApi({
      ...baseOrderPayload,
      locationId: 'loc_inexistente'
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('LOCATION_REQUIRED');

    const ordersAfter = (rawDb.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c;
    expect(ordersAfter).toBe(ordersBefore);
  });

  it('el cobro en tracked descuenta la sede de la orden (Los Olivos) y no Alta Vista', async () => {
    const res = await createOrderViaApi({
      ...baseOrderPayload,
      locationId: 'loc_los_olivos',
      lines: [{ productId: 'prod_jalapenos_dog', quantity: 2 }]
    });

    expect(res.statusCode).toBe(201);
    const orderId = res.body.order.id as string;
    expect(res.body.order.location_id).toBe('loc_los_olivos');
    expect(res.body.order.total_to_collect_usd_cents).toBe(700);

    const loPanBefore = getStock('loc_los_olivos', 'sup_pan_perro');
    const loSalchichaBefore = getStock('loc_los_olivos', 'sup_salchicha_pollo');
    const avPanBefore = getStock('loc_alta_vista', 'sup_pan_perro');
    const avSalchichaBefore = getStock('loc_alta_vista', 'sup_salchicha_pollo');

    const payment = processOrderPayment(rawDb, orderId, {
      orderId,
      cashierUserId: 'usr_cajera',
      tenders: [{ method: 'cash_usd', amountCents: 700 }],
      changeOutputs: { changeUsdCents: 0, changeBsCents: 0 }
    });

    expect(payment.order.payment_status).toBe('pagado');
    expect(payment.order.location_id).toBe('loc_los_olivos');

    expect(getStock('loc_los_olivos', 'sup_pan_perro')).toBe(loPanBefore - 2);
    expect(getStock('loc_los_olivos', 'sup_salchicha_pollo')).toBe(loSalchichaBefore - 2);
    expect(getStock('loc_alta_vista', 'sup_pan_perro')).toBe(avPanBefore);
    expect(getStock('loc_alta_vista', 'sup_salchicha_pollo')).toBe(avSalchichaBefore);

    const movements = rawDb.prepare(`
      SELECT supply_id, movement_type, quantity_delta, location_id
      FROM inventory_movements
      WHERE order_id = ?
      ORDER BY supply_id
    `).all(orderId) as any[];

    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.movement_type === 'VENTA_RECETA')).toBe(true);
    expect(movements.every((m) => m.location_id === 'loc_los_olivos')).toBe(true);
    expect(movements.find((m) => m.supply_id === 'sup_pan_perro')?.quantity_delta).toBe(-2);
    expect(movements.find((m) => m.supply_id === 'sup_salchicha_pollo')?.quantity_delta).toBe(-2);
  });
});
