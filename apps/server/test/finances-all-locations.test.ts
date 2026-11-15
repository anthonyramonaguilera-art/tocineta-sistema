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
import { calculateProfitAndLoss } from '../src/modules/finances/profit-service.js';
import { calculateCashFlow } from '../src/modules/finances/cashflow-service.js';
import { listExpenses, createExpense } from '../src/modules/finances/expenses-service.js';
import { createMonthlyClosure } from '../src/modules/finances/export-service.js';
import { normalizeLocationFilter } from '../src/modules/finances/financial-truth-helpers.js';

describe('Finanzas — Manejo de "Todas las sedes" (locationId=ALL) y deduplicación de combos', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_finances_all_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_finances_all.db');
  let rawDb: Database.Database;

  const now = Date.now();
  const baseTime = now - 3600_000;
  const rateMicroBs = 40_000_000;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureOfficialLocations(rawDb);

    // Insertar tasa de cambio
    rawDb.prepare(`
      INSERT INTO exchange_rates (id, rate_micro_bs, is_current, source, created_at_ms)
      VALUES ('rate_test', ?, 1, 'manual', ?)
    `).run(rateMicroBs, baseTime);

    // Insertar jornada abierta en Alta Vista
    rawDb.prepare(`
      INSERT INTO jornadas (id, location_id, opened_by_user_id, opened_at_ms, status, initial_cash_usd_cents, initial_cash_bs_cents)
      VALUES ('jornada_test_av', 'loc_alta_vista', 'usr_admin', ?, 'abierta', 5000, 100000)
    `).run(baseTime);

    // ==========================================
    // Sede 1: loc_alta_vista
    // ==========================================
    // Orden 1: Regular (Street Dog $10.00 = 1000c) -> EFECTIVO_USD
    rawDb.prepare(`
      INSERT INTO orders (
        id, location_id, jornada_id, order_number, customer_name,
        created_by_user_id, fulfillment_type, rate_micro_bs,
        gross_food_subtotal_usd_cents, discount_usd_cents, net_food_sales_usd_cents,
        delivery_fee_usd_cents, total_to_collect_usd_cents, fulfillment_status,
        payment_status, created_at_ms, updated_at_ms
      ) VALUES ('ord_av_1', 'loc_alta_vista', 'jornada_test_av', 101, 'Cliente AV 1', 'usr_admin', 'salon', ?, 1000, 0, 1000, 0, 1000, 'entregado', 'pagado', ?, ?)
    `).run(rateMicroBs, baseTime + 100_000, baseTime + 100_000);

    rawDb.prepare(`
      INSERT INTO order_lines (
        id, order_id, product_id, line_role, quantity,
        unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, station, created_at_ms
      ) VALUES ('line_av_1', 'ord_av_1', 'prod_street_dog', 'STANDARD', 4, 250, 250, 1000, 'hot_dogs', ?)
    `).run(baseTime + 100_000);

    rawDb.prepare(`
      INSERT INTO payments (
        id, order_id, method, currency, amount_cents, rate_micro_bs,
        usd_equivalent_cents, recorded_by_user_id, created_at_ms
      ) VALUES ('pay_av_1', 'ord_av_1', 'EFECTIVO_USD', 'USD', 1000, ?, 1000, 'usr_admin', ?)
    `).run(rateMicroBs, baseTime + 100_000);

    // Orden 2: Combo (Combo Street $15.00 = 1500c) -> PAGO_MOVIL
    // Contiene 1 COMBO_PARENT y 2 COMBO_CHILD (para verificar que NO hay doble conteo en byCategory)
    rawDb.prepare(`
      INSERT INTO orders (
        id, location_id, jornada_id, order_number, customer_name,
        created_by_user_id, fulfillment_type, rate_micro_bs,
        gross_food_subtotal_usd_cents, discount_usd_cents, net_food_sales_usd_cents,
        delivery_fee_usd_cents, total_to_collect_usd_cents, fulfillment_status,
        payment_status, created_at_ms, updated_at_ms
      ) VALUES ('ord_av_2', 'loc_alta_vista', 'jornada_test_av', 102, 'Cliente AV 2', 'usr_admin', 'salon', ?, 1500, 0, 1500, 0, 1500, 'entregado', 'pagado', ?, ?)
    `).run(rateMicroBs, baseTime + 200_000, baseTime + 200_000);

    // COMBO_PARENT ($15.00, categoría Combos)
    rawDb.prepare(`
      INSERT INTO order_lines (
        id, order_id, product_id, line_role, quantity,
        unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, station, created_at_ms
      ) VALUES ('line_av_2_parent', 'ord_av_2', 'prod_combo_street', 'COMBO_PARENT', 1, 1500, 1500, 1500, 'hot_dogs', ?)
    `).run(baseTime + 200_000);

    // COMBO_CHILD 1 (2 perros, prorrateado $10.00)
    rawDb.prepare(`
      INSERT INTO order_lines (
        id, order_id, product_id, line_role, parent_line_id, quantity,
        unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, station, created_at_ms
      ) VALUES ('line_av_2_child1', 'ord_av_2', 'prod_street_dog', 'COMBO_CHILD', 'line_av_2_parent', 2, 250, 500, 1000, 'hot_dogs', ?)
    `).run(baseTime + 200_000);

    // COMBO_CHILD 2 (1 refresco/malta, prorrateado $5.00)
    rawDb.prepare(`
      INSERT INTO order_lines (
        id, order_id, product_id, line_role, parent_line_id, quantity,
        unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, station, created_at_ms
      ) VALUES ('line_av_2_child2', 'ord_av_2', 'prod_street_dog', 'COMBO_CHILD', 'line_av_2_parent', 1, 250, 500, 500, 'hot_dogs', ?)
    `).run(baseTime + 200_000);

    rawDb.prepare(`
      INSERT INTO payments (
        id, order_id, method, currency, amount_cents, rate_micro_bs,
        usd_equivalent_cents, recorded_by_user_id, created_at_ms
      ) VALUES ('pay_av_2', 'ord_av_2', 'PAGO_MOVIL', 'BS', 60000, ?, 1500, 'usr_admin', ?)
    `).run(rateMicroBs, baseTime + 200_000);

    // Gasto en Alta Vista
    createExpense(rawDb, {
      locationId: 'loc_alta_vista',
      category: 'VARIOS',
      amountUsdCents: 300,
      paymentMethod: 'EFECTIVO_USD',
      description: 'Gasto prueba Alta Vista',
      authorizedByUserId: 'usr_admin'
    });

    // ==========================================
    // Sede 2: loc_los_olivos
    // ==========================================
    // Orden 3: Regular (Hamburguesa $20.00 = 2000c) -> EFECTIVO_USD
    rawDb.prepare(`
      INSERT INTO orders (
        id, location_id, jornada_id, order_number, customer_name,
        created_by_user_id, fulfillment_type, rate_micro_bs,
        gross_food_subtotal_usd_cents, discount_usd_cents, net_food_sales_usd_cents,
        delivery_fee_usd_cents, total_to_collect_usd_cents, fulfillment_status,
        payment_status, created_at_ms, updated_at_ms
      ) VALUES ('ord_lo_1', 'loc_los_olivos', 'jornada_test_av', 201, 'Cliente LO 1', 'usr_admin', 'salon', ?, 2000, 0, 2000, 0, 2000, 'entregado', 'pagado', ?, ?)
    `).run(rateMicroBs, baseTime + 300_000, baseTime + 300_000);

    rawDb.prepare(`
      INSERT INTO order_lines (
        id, order_id, product_id, line_role, quantity,
        unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, station, created_at_ms
      ) VALUES ('line_lo_1', 'ord_lo_1', 'prod_texas_mex', 'STANDARD', 2, 1000, 1000, 2000, 'hamburguesas', ?)
    `).run(baseTime + 300_000);

    rawDb.prepare(`
      INSERT INTO payments (
        id, order_id, method, currency, amount_cents, rate_micro_bs,
        usd_equivalent_cents, recorded_by_user_id, created_at_ms
      ) VALUES ('pay_lo_1', 'ord_lo_1', 'EFECTIVO_USD', 'USD', 2000, ?, 2000, 'usr_admin', ?)
    `).run(rateMicroBs, baseTime + 300_000);

    // Orden 4: Regular (Street Dog $8.00 = 800c) -> PAGO_MOVIL
    rawDb.prepare(`
      INSERT INTO orders (
        id, location_id, jornada_id, order_number, customer_name,
        created_by_user_id, fulfillment_type, rate_micro_bs,
        gross_food_subtotal_usd_cents, discount_usd_cents, net_food_sales_usd_cents,
        delivery_fee_usd_cents, total_to_collect_usd_cents, fulfillment_status,
        payment_status, created_at_ms, updated_at_ms
      ) VALUES ('ord_lo_2', 'loc_los_olivos', 'jornada_test_av', 202, 'Cliente LO 2', 'usr_admin', 'salon', ?, 800, 0, 800, 0, 800, 'entregado', 'pagado', ?, ?)
    `).run(rateMicroBs, baseTime + 400_000, baseTime + 400_000);

    rawDb.prepare(`
      INSERT INTO order_lines (
        id, order_id, product_id, line_role, quantity,
        unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, station, created_at_ms
      ) VALUES ('line_lo_2', 'ord_lo_2', 'prod_street_dog', 'STANDARD', 2, 400, 400, 800, 'hot_dogs', ?)
    `).run(baseTime + 400_000);

    rawDb.prepare(`
      INSERT INTO payments (
        id, order_id, method, currency, amount_cents, rate_micro_bs,
        usd_equivalent_cents, recorded_by_user_id, created_at_ms
      ) VALUES ('pay_lo_2', 'ord_lo_2', 'PAGO_MOVIL', 'BS', 32000, ?, 800, 'usr_admin', ?)
    `).run(rateMicroBs, baseTime + 400_000);

    // Gasto en Los Olivos
    createExpense(rawDb, {
      locationId: 'loc_los_olivos',
      category: 'TRANSPORTE',
      amountUsdCents: 500,
      paymentMethod: 'PAGO_MOVIL',
      description: 'Gasto prueba Los Olivos',
      authorizedByUserId: 'usr_admin'
    });

    // Asegurar que los gastos tengan timestamps deterministas dentro del período
    rawDb.prepare(`UPDATE operating_expenses SET created_at_ms = ? WHERE location_id = 'loc_alta_vista'`).run(baseTime + 250_000);
    rawDb.prepare(`UPDATE operating_expenses SET created_at_ms = ? WHERE location_id = 'loc_los_olivos'`).run(baseTime + 450_000);
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

  it('normalizeLocationFilter normaliza cadenas vacías, nulos y "ALL" a null', () => {
    expect(normalizeLocationFilter()).toBeNull();
    expect(normalizeLocationFilter(null)).toBeNull();
    expect(normalizeLocationFilter('')).toBeNull();
    expect(normalizeLocationFilter('   ')).toBeNull();
    expect(normalizeLocationFilter('ALL')).toBeNull();
    expect(normalizeLocationFilter('all')).toBeNull();
    expect(normalizeLocationFilter('  All  ')).toBeNull();
    expect(normalizeLocationFilter('loc_alta_vista')).toBe('loc_alta_vista');
    expect(normalizeLocationFilter('loc_los_olivos')).toBe('loc_los_olivos');
  });

  it('P&L con locationId="ALL": no da cero en Ventas por Método ni por Categoría, y paridad exacta con netFoodSalesUsdCents', () => {
    const pnlAll = calculateProfitAndLoss(rawDb, {
      startDateMs: baseTime,
      endDateMs: baseTime + 500_000,
      locationId: 'ALL'
    });

    const expectedTotalSales = 1000 + 1500 + 2000 + 800; // 5300 centavos ($53.00)
    expect(pnlAll.summary.netFoodSalesUsdCents).toBe(expectedTotalSales);
    expect(pnlAll.summary.grossFoodSalesUsdCents).toBe(expectedTotalSales);
    expect(pnlAll.summary.totalOrders).toBe(4);

    // 1. Ventas por Método: no sale vacío ni en cero
    expect(pnlAll.breakdown.byMethod.length).toBeGreaterThan(0);
    const sumByMethod = pnlAll.breakdown.byMethod.reduce((acc, m) => acc + m.totalUsdCents, 0);
    expect(sumByMethod).toBe(expectedTotalSales);

    const efectivoUsd = pnlAll.breakdown.byMethod.find(m => m.method === 'EFECTIVO_USD');
    const pagoMovil = pnlAll.breakdown.byMethod.find(m => m.method === 'PAGO_MOVIL');
    expect(efectivoUsd?.totalUsdCents).toBe(1000 + 2000); // 3000
    expect(pagoMovil?.totalUsdCents).toBe(1500 + 800); // 2300

    // 2. Ventas por Categoría: no sale vacío ni en cero, y sin doble conteo por combo
    expect(pnlAll.breakdown.byCategory.length).toBeGreaterThan(0);
    const sumByCategory = pnlAll.breakdown.byCategory.reduce((acc, c) => acc + c.totalUsdCents, 0);
    expect(sumByCategory).toBe(expectedTotalSales);

    // 3. Ventas por Sede: contiene ambas sedes
    expect(pnlAll.breakdown.byLocation.length).toBe(2);
    const avLoc = pnlAll.breakdown.byLocation.find(l => l.locationId === 'loc_alta_vista');
    const loLoc = pnlAll.breakdown.byLocation.find(l => l.locationId === 'loc_los_olivos');
    expect(avLoc?.totalUsdCents).toBe(2500);
    expect(loLoc?.totalUsdCents).toBe(2800);
  });

  it('P&L con locationId="loc_alta_vista": filtra exclusivamente esa sede', () => {
    const pnlAv = calculateProfitAndLoss(rawDb, {
      startDateMs: baseTime,
      endDateMs: baseTime + 500_000,
      locationId: 'loc_alta_vista'
    });

    const expectedAvSales = 1000 + 1500; // 2500 centavos ($25.00)
    expect(pnlAv.summary.netFoodSalesUsdCents).toBe(expectedAvSales);
    expect(pnlAv.summary.totalOrders).toBe(2);

    const sumByMethod = pnlAv.breakdown.byMethod.reduce((acc, m) => acc + m.totalUsdCents, 0);
    expect(sumByMethod).toBe(expectedAvSales);

    const sumByCategory = pnlAv.breakdown.byCategory.reduce((acc, c) => acc + c.totalUsdCents, 0);
    expect(sumByCategory).toBe(expectedAvSales);

    expect(pnlAv.breakdown.byLocation.length).toBe(1);
    expect(pnlAv.breakdown.byLocation[0].locationId).toBe('loc_alta_vista');
    expect(pnlAv.breakdown.byLocation[0].totalUsdCents).toBe(expectedAvSales);
  });

  it('Cashflow y listExpenses con "ALL": devuelven todas las sedes sin inyectar filtro inválido', () => {
    // 1. listExpenses con 'ALL' devuelve 2 gastos
    const expensesAll = listExpenses(rawDb, { locationId: 'ALL' });
    expect(expensesAll.length).toBe(2);

    const expensesAv = listExpenses(rawDb, { locationId: 'loc_alta_vista' });
    expect(expensesAv.length).toBe(1);
    expect(expensesAv[0].locationId).toBe('loc_alta_vista');

    // 2. calculateCashFlow con 'ALL' no da cero en ingresos ni gastos
    const cashFlowAll = calculateCashFlow(rawDb, {
      startDateMs: baseTime,
      endDateMs: baseTime + 500_000,
      locationId: 'ALL'
    });

    expect(cashFlowAll.summary.salesInflowsUsdCents).toBe(5300);
    expect(cashFlowAll.summary.expensesOutflowsUsdCents).toBe(800); // 300 + 500
    expect(cashFlowAll.summary.netCashFlowUsdCents).toBe(5300 - 800);

    // byLocation tiene ambas sedes con sus movimientos
    const avLoc = cashFlowAll.byLocation.find(l => l.locationId === 'loc_alta_vista');
    const loLoc = cashFlowAll.byLocation.find(l => l.locationId === 'loc_los_olivos');
    expect(avLoc?.inflowsUsdCents).toBe(2500);
    expect(avLoc?.outflowsUsdCents).toBe(300);
    expect(loLoc?.inflowsUsdCents).toBe(2800);
    expect(loLoc?.outflowsUsdCents).toBe(500);
  });

  it('createMonthlyClosure con locationId="ALL" consolida ventas completas de todas las sedes', () => {
    const curDate = new Date(baseTime);
    const closure = createMonthlyClosure(rawDb, {
      year: curDate.getFullYear(),
      month: curDate.getMonth() + 1,
      locationId: 'ALL',
      userId: 'usr_admin',
      notes: 'Cierre global todas las sedes'
    });

    expect(closure.totalSalesUsdCents).toBe(5300);
    const parsedMetrics = JSON.parse(closure.metricsJson);
    expect(parsedMetrics.summary.netFoodSalesUsdCents).toBe(5300);
    expect(parsedMetrics.breakdown.byMethod.length).toBeGreaterThan(0);
    expect(parsedMetrics.breakdown.byCategory.length).toBeGreaterThan(0);
  });
});
