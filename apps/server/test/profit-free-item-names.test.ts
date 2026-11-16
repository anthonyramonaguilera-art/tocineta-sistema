import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { calculateProfitAndLoss } from '../src/modules/finances/profit-service.js';

describe('P&L — Ítems libres separados por nombre en el ranking de productos', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_profit_free_names_${Date.now()}`);
  const tempDbPath = path.join(tempDir, 'profit_free_names.db');
  let rawDb: Database.Database;

  const now = Date.now();
  const baseTime = now - 3600_000;
  const periodEnd = baseTime + 500_000;
  const rateMicroBs = 40_000_000;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDbPath);
    rawDb = dbCtx.rawDb;
    rawDb.pragma('foreign_keys = ON');

    await runMigrations(rawDb, { dbPath: tempDbPath });
    seedInitialUsers(rawDb);
    ensureOfficialLocations(rawDb);

    rawDb.prepare(`
      INSERT INTO exchange_rates (id, rate_micro_bs, is_current, source, created_at_ms)
      VALUES ('rate_profit_free', ?, 1, 'manual', ?)
    `).run(rateMicroBs, baseTime);

    rawDb.prepare(`
      INSERT INTO jornadas (id, location_id, opened_by_user_id, opened_at_ms, status, initial_cash_usd_cents, initial_cash_bs_cents)
      VALUES ('jornada_profit_free', 'loc_alta_vista', 'usr_admin', ?, 'abierta', 5000, 100000)
    `).run(baseTime);

    // Orden 1: $7.00 = 700c -> 2 tortas (500c) + 1 jugo (200c), todos ítems libres con nombre propio.
    rawDb.prepare(`
      INSERT INTO orders (
        id, location_id, jornada_id, order_number, customer_name,
        created_by_user_id, fulfillment_type, rate_micro_bs,
        gross_food_subtotal_usd_cents, discount_usd_cents, net_food_sales_usd_cents,
        delivery_fee_usd_cents, total_to_collect_usd_cents, fulfillment_status,
        payment_status, created_at_ms, updated_at_ms
      ) VALUES ('ord_profit_free_1', 'loc_alta_vista', 'jornada_profit_free', 501, 'Cliente Libre 1',
        'usr_admin', 'salon', ?, 700, 0, 700, 0, 700, 'entregado', 'pagado', ?, ?)
    `).run(rateMicroBs, baseTime + 100_000, baseTime + 100_000);

    // Orden 2: $3.00 = 300c -> otra torta con el mismo nombre personalizado.
    rawDb.prepare(`
      INSERT INTO orders (
        id, location_id, jornada_id, order_number, customer_name,
        created_by_user_id, fulfillment_type, rate_micro_bs,
        gross_food_subtotal_usd_cents, discount_usd_cents, net_food_sales_usd_cents,
        delivery_fee_usd_cents, total_to_collect_usd_cents, fulfillment_status,
        payment_status, created_at_ms, updated_at_ms
      ) VALUES ('ord_profit_free_2', 'loc_alta_vista', 'jornada_profit_free', 502, 'Cliente Libre 2',
        'usr_admin', 'salon', ?, 300, 0, 300, 0, 300, 'entregado', 'pagado', ?, ?)
    `).run(rateMicroBs, baseTime + 200_000, baseTime + 200_000);

    const insertLine = rawDb.prepare(`
      INSERT INTO order_lines (
        id, order_id, product_id, line_role, quantity,
        unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents,
        station, custom_name, created_at_ms
      ) VALUES (?, ?, 'prod_libre', 'STANDARD', ?, ?, ?, ?, 'caja_bebidas', ?, ?)
    `);

    insertLine.run('line_pf_torta_1', 'ord_profit_free_1', 2, 250, 250, 500, 'Torta de Chocolate', baseTime + 100_000);
    insertLine.run('line_pf_jugo_1', 'ord_profit_free_1', 1, 200, 200, 200, 'Jugo Natural', baseTime + 100_000);
    insertLine.run('line_pf_torta_2', 'ord_profit_free_2', 1, 300, 300, 300, 'Torta de Chocolate', baseTime + 200_000);
  });

  afterAll(() => {
    try {
      if (rawDb) rawDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('separa 2 ítems libres con nombres distintos en 2 filas de topProducts', () => {
    const pnl = calculateProfitAndLoss(rawDb, {
      startDateMs: baseTime,
      endDateMs: periodEnd,
      locationId: 'loc_alta_vista'
    });

    const freeRows = pnl.breakdown.topProducts.filter(p => p.productId.startsWith('prod_libre:'));
    expect(freeRows).toHaveLength(2);

    const torta = pnl.breakdown.topProducts.find(p => p.productName === 'Torta de Chocolate');
    expect(torta).toBeDefined();
    expect(torta?.productId).toBe('prod_libre:Torta de Chocolate');
    expect(torta?.unitsSold).toBe(3);
    expect(torta?.totalSalesUsdCents).toBe(800);

    const jugo = pnl.breakdown.topProducts.find(p => p.productName === 'Jugo Natural');
    expect(jugo).toBeDefined();
    expect(jugo?.productId).toBe('prod_libre:Jugo Natural');
    expect(jugo?.unitsSold).toBe(1);
    expect(jugo?.totalSalesUsdCents).toBe(200);

    // Ya no queda una fila consolidada "Item libre" ni el productId plano.
    expect(pnl.breakdown.topProducts.some(p => p.productName === 'Item libre')).toBe(false);
    expect(pnl.breakdown.topProducts.some(p => p.productId === 'prod_libre')).toBe(false);
  });

  it('la suma de centavos del ranking no cambia y coincide con netFoodSalesUsdCents', () => {
    const pnl = calculateProfitAndLoss(rawDb, {
      startDateMs: baseTime,
      endDateMs: periodEnd,
      locationId: 'loc_alta_vista'
    });

    const totalRanking = pnl.breakdown.topProducts.reduce((acc, p) => acc + p.totalSalesUsdCents, 0);
    expect(totalRanking).toBe(1000);
    expect(totalRanking).toBe(pnl.summary.netFoodSalesUsdCents);
    expect(pnl.breakdown.topProducts.reduce((acc, p) => acc + p.unitsSold, 0)).toBe(4);
  });

  it('byCategory sigue agrupando los ítems libres en la categoría "Item Libre"', () => {
    const pnl = calculateProfitAndLoss(rawDb, {
      startDateMs: baseTime,
      endDateMs: periodEnd,
      locationId: 'loc_alta_vista'
    });

    const libreCategory = pnl.breakdown.byCategory.find(c => c.categoryId === 'cat_libre');
    expect(libreCategory).toBeDefined();
    expect(libreCategory?.categoryName).toBe('Item Libre');
    expect(libreCategory?.unitsSold).toBe(4);
    expect(libreCategory?.totalUsdCents).toBe(1000);
  });
});
