import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { seedCriticalSuppliesAndRecipes } from '../src/modules/profitability/inventory.js';
import { openJornada, processOrderPayment } from '../src/modules/cashier/cashier-service.js';
import { updateKdsLineStatus } from '../src/modules/kds/kds-service.js';

/**
 * I3 — Una venta de Los Olivos descuenta el inventario de Los Olivos.
 * El pedido se siembra con location_id = 'loc_los_olivos' (patrón de
 * inventory-deduction-modifiers.test.ts) y el cobro entra por el servicio
 * real de caja (processOrderPayment), no por deducción manual.
 */
describe('I3 — Venta en Los Olivos descuenta inventario de su sede', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_sale_location_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_sale_location.db');
  const RATE_MICRO_BS = 40_000_000;
  let rawDb: Database.Database;
  let jornadaId: string;

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

  const createLosOlivosOrder = (
    orderId: string,
    orderNumber: number,
    lineId: string,
    quantity: number,
    unitPriceUsdCents: number
  ) => {
    const now = Date.now();
    const total = quantity * unitPriceUsdCents;

    rawDb.prepare(`
      INSERT INTO orders (
        id, order_number, location_id, jornada_id, created_by_user_id, rate_micro_bs,
        gross_food_subtotal_usd_cents, discount_usd_cents, net_food_sales_usd_cents,
        total_to_collect_usd_cents, payment_status, fulfillment_status,
        station_status_hot_dogs, station_status_hamburguesas, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'loc_los_olivos', ?, 'usr_cajera', ?, ?, 0, ?, ?, 'sin_pago', 'enviado', 'pendiente', 'na', ?, ?)
    `).run(orderId, orderNumber, jornadaId, RATE_MICRO_BS, total, total, total, now, now);

    rawDb.prepare(`
      INSERT INTO order_lines (
        id, order_id, product_id, quantity, unit_price_usd_cents,
        prorated_unit_price_usd_cents, subtotal_usd_cents,
        station, line_role, status, created_at_ms
      ) VALUES (?, ?, 'prod_jalapenos_dog', ?, ?, ?, ?, 'hot_dogs', 'STANDARD', 'pendiente', ?)
    `).run(lineId, orderId, quantity, unitPriceUsdCents, unitPriceUsdCents, total, now);
  };

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureOfficialLocations(rawDb);
    seedCriticalSuppliesAndRecipes(rawDb);

    // Activar descuento por receta (solo en modo tracked hay deducción).
    rawDb.prepare("UPDATE business_settings SET inventory_operation_mode = 'tracked' WHERE id = 'default'").run();

    // Abre jornada en Los Olivos y crea la sesión de caja de la cajera.
    const jornada = openJornada(rawDb, {
      openedByUserId: 'usr_cajera',
      locationId: 'loc_los_olivos',
      rateMicroBs: RATE_MICRO_BS,
      initialCashUsdCents: 0,
      initialCashBsCents: 0
    });
    jornadaId = jornada.id;

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
  });

  afterAll(() => {
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

  it('cobro en caja: descuenta 2 + 2 en Los Olivos, no toca Alta Vista y es idempotente', () => {
    const orderId = 'ord_sale_lo_caja';
    createLosOlivosOrder(orderId, 201, 'line_sale_lo_caja', 2, 350);

    const transferBatchesBefore = (rawDb.prepare('SELECT COUNT(*) as c FROM transfer_batches').get() as any).c;

    const payment = processOrderPayment(rawDb, orderId, {
      orderId,
      cashierUserId: 'usr_cajera',
      tenders: [{ method: 'cash_usd', amountCents: 700 }],
      changeOutputs: { changeUsdCents: 0, changeBsCents: 0 }
    });

    expect(payment.order.payment_status).toBe('pagado');
    expect(payment.order.location_id).toBe('loc_los_olivos');

    expect(getStock('loc_los_olivos', 'sup_pan_perro')).toBe(18);
    expect(getStock('loc_los_olivos', 'sup_salchicha_pollo')).toBe(28);
    expect(getStock('loc_alta_vista', 'sup_pan_perro')).toBe(50);
    expect(getStock('loc_alta_vista', 'sup_salchicha_pollo')).toBe(60);

    const movements = rawDb.prepare(`
      SELECT supply_id, movement_type, quantity_delta, location_id
      FROM inventory_movements
      WHERE order_id = ?
      ORDER BY supply_id
    `).all(orderId) as any[];

    expect(movements).toHaveLength(2);
    expect(movements.every(m => m.movement_type === 'VENTA_RECETA')).toBe(true);
    expect(movements.every(m => m.location_id === 'loc_los_olivos')).toBe(true);
    expect(movements.find(m => m.supply_id === 'sup_pan_perro')?.quantity_delta).toBe(-2);
    expect(movements.find(m => m.supply_id === 'sup_salchicha_pollo')?.quantity_delta).toBe(-2);

    const transferBatchesAfter = (rawDb.prepare('SELECT COUNT(*) as c FROM transfer_batches').get() as any).c;
    expect(transferBatchesAfter).toBe(transferBatchesBefore);

    // Segundo intento de cobro: rechazado y sin descuento adicional.
    expect(() => processOrderPayment(rawDb, orderId, {
      orderId,
      cashierUserId: 'usr_cajera',
      tenders: [{ method: 'cash_usd', amountCents: 700 }],
      changeOutputs: { changeUsdCents: 0, changeBsCents: 0 }
    })).toThrow(/ya fue cobrada/i);

    expect(getStock('loc_los_olivos', 'sup_pan_perro')).toBe(18);
    expect(getStock('loc_los_olivos', 'sup_salchicha_pollo')).toBe(28);
    expect(getStock('loc_alta_vista', 'sup_pan_perro')).toBe(50);
    expect(getStock('loc_alta_vista', 'sup_salchicha_pollo')).toBe(60);

    const movementCount = (rawDb.prepare(
      'SELECT COUNT(*) as c FROM inventory_movements WHERE order_id = ?'
    ).get(orderId) as any).c;
    expect(movementCount).toBe(2);
  });

  it('entrada por KDS: descuenta de la sede de la orden y no de Alta Vista', () => {
    const orderId = 'ord_sale_lo_kds';
    const lineId = 'line_sale_lo_kds';
    createLosOlivosOrder(orderId, 202, lineId, 2, 350);

    const transferBatchesBefore = (rawDb.prepare('SELECT COUNT(*) as c FROM transfer_batches').get() as any).c;

    updateKdsLineStatus(rawDb, lineId, 'preparando', 'usr_plancha');

    expect(getStock('loc_los_olivos', 'sup_pan_perro')).toBe(16);
    expect(getStock('loc_los_olivos', 'sup_salchicha_pollo')).toBe(26);
    expect(getStock('loc_alta_vista', 'sup_pan_perro')).toBe(50);
    expect(getStock('loc_alta_vista', 'sup_salchicha_pollo')).toBe(60);

    const movements = rawDb.prepare(`
      SELECT supply_id, movement_type, quantity_delta, location_id
      FROM inventory_movements
      WHERE order_id = ?
      ORDER BY supply_id
    `).all(orderId) as any[];

    expect(movements).toHaveLength(2);
    expect(movements.every(m => m.movement_type === 'VENTA_RECETA')).toBe(true);
    expect(movements.every(m => m.location_id === 'loc_los_olivos')).toBe(true);
    expect(movements.find(m => m.supply_id === 'sup_pan_perro')?.quantity_delta).toBe(-2);
    expect(movements.find(m => m.supply_id === 'sup_salchicha_pollo')?.quantity_delta).toBe(-2);

    const transferBatchesAfter = (rawDb.prepare('SELECT COUNT(*) as c FROM transfer_batches').get() as any).c;
    expect(transferBatchesAfter).toBe(transferBatchesBefore);
  });
});
