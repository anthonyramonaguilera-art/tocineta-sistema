import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { calculateProfitAndLoss } from '../src/modules/finances/profit-service.js';

// Se envuelve el cálculo real para poder forzar un fallo puntual sin tocar menu-engineering.ts.
vi.mock('../src/modules/profitability/menu-engineering.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../src/modules/profitability/menu-engineering.js')>();
  return {
    ...actual,
    generateMenuEngineeringReport: vi.fn(actual.generateMenuEngineeringReport)
  };
});

import { generateMenuEngineeringReport } from '../src/modules/profitability/menu-engineering.js';

const mockedGenerate = vi.mocked(generateMenuEngineeringReport);

describe('H2 - Matriz Kasavana & Smith visible en el Estado de Resultados', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_kasavana_${Date.now()}`);
  const tempDb = path.join(tempDir, 'kasavana.db');
  const periodStart = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const periodEnd = Date.now() + 60 * 1000;
  let db: Database.Database;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    db = new Database(tempDb);
    db.pragma('foreign_keys = ON');

    await runMigrations(db, { dbPath: tempDb });
    seedInitialUsers(db);
    seedCatalog(db);

    const now = Date.now();
    db.prepare(`
      INSERT OR IGNORE INTO jornadas (id, opened_by_user_id, opened_at_ms, status)
      VALUES ('jornada_kasavana_test', 'usr_admin', ?, 'abierta')
    `).run(now);

    db.prepare(`
      INSERT INTO orders (
        id, order_number, jornada_id, created_by_user_id, fulfillment_type,
        fulfillment_status, payment_status, rate_micro_bs,
        net_food_sales_usd_cents, total_to_collect_usd_cents, created_at_ms, updated_at_ms
      ) VALUES ('ord_kasavana_1', 9001, 'jornada_kasavana_test', 'usr_admin', 'salon',
        'entregado', 'pagado', 40000000, 3750, 3750, ?, ?)
    `).run(now, now);

    const insertLine = db.prepare(`
      INSERT INTO order_lines (
        id, order_id, product_id, station, line_role, quantity,
        unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, created_at_ms
      ) VALUES (?, 'ord_kasavana_1', ?, 'hot_dogs', 'STANDARD', ?, ?, ?, ?, ?)
    `);

    // 3 platos de la misma categoría (Hot Dogs) con ventas distintas.
    insertLine.run('line_kas_street', 'prod_street_dog', 10, 250, 250, 2500, now);
    insertLine.run('line_kas_tocineta', 'prod_tocineta_dog_parmesano', 5, 350, 350, 1750, now);
    insertLine.run('line_kas_doritos', 'prod_doritos_dog_snacks', 3, 350, 350, 1050, now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('generateMenuEngineeringReport devuelve los 3 platos de la categoría con cuadrantes válidos', () => {
    const report = generateMenuEngineeringReport(db, {
      startDateMs: periodStart,
      endDateMs: periodEnd
    });

    expect(report.categories).toHaveLength(1);
    const category = report.categories[0];
    expect(category.categoryId).toBe('cat_hot_dogs');
    expect(category.dishes).toHaveLength(3);

    const validQuadrants = ['ESTRELLA', 'CABALLO_DE_BATALLA', 'PUZZLE', 'PERRO'];
    for (const dish of category.dishes) {
      expect(validQuadrants).toContain(dish.quadrant);
      expect(dish.recommendation.length).toBeGreaterThan(0);
      expect(dish.unitsSold).toBeGreaterThan(0);
    }
  });

  it('calculateProfitAndLoss expone la matriz con los platos y sin kasavanaError', () => {
    const pnl = calculateProfitAndLoss(db, { startDateMs: periodStart, endDateMs: periodEnd });

    expect(pnl.breakdown.kasavanaError).toBeUndefined();
    expect(pnl.breakdown.kasavanaMatrix.categories).toHaveLength(1);
    expect(pnl.breakdown.kasavanaMatrix.categories[0].dishes).toHaveLength(3);
    expect(pnl.breakdown.kasavanaMatrix.totalUnitsSold).toBe(18);
  });

  it('si la matriz falla, registra console.warn y expone kasavanaError sin romper el P&L', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedGenerate.mockImplementationOnce(() => {
      throw new Error('fallo simulado Kasavana');
    });

    const pnl = calculateProfitAndLoss(db, { startDateMs: periodStart, endDateMs: periodEnd });

    expect(pnl.breakdown.kasavanaError).toContain('fallo simulado Kasavana');
    expect(pnl.breakdown.kasavanaMatrix.categories).toEqual([]);
    expect(pnl.breakdown.kasavanaMatrix.sampleStatus).toBe('DATOS_INSUFICIENTES');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('Kasavana');

    // El resto del estado de resultados sigue disponible.
    expect(pnl.summary.netFoodSalesUsdCents).toBe(3750);
  });
});
