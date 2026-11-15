import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { runMigrations } from '../src/db/migrate.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { seedCriticalSuppliesAndRecipes } from '../src/modules/profitability/inventory.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { registerWasteLog, getWasteLogs, resolveProductRecipeDeductions } from '../src/modules/profitability/waste-service.js';
import { getFinancialTruth } from '../src/modules/finances/financial-truth-service.js';

describe('E2 — Merma de plato terminado descuenta sus ingredientes', () => {
  let db: Database.Database;
  const testJornadaId = 'jor_test_waste_e2';
  const locId = 'loc_alta_vista';

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, { dbPath: ':memory:' });
    seedInitialUsers(db);
    seedCatalog(db);
    ensureOfficialLocations(db);
    seedCriticalSuppliesAndRecipes(db);

    const now = Date.now();
    db.prepare(`
      INSERT OR IGNORE INTO jornadas (id, location_id, opened_by_user_id, opened_at_ms, status)
      VALUES (?, ?, 'usr_admin', ?, 'abierta')
    `).run(testJornadaId, locId, now);

    db.prepare(`
      INSERT OR REPLACE INTO exchange_rates (id, rate_micro_bs, source, is_current, created_at_ms)
      VALUES ('rate_test', 50000000, 'BCV', 1, ?)
    `).run(now);

    db.prepare("UPDATE business_settings SET inventory_operation_mode = 'tracked' WHERE id = 'default'").run();
  });

  afterEach(() => {
    db.close();
  });

  it('1. Merma de 2 Jalapeños Dog descuenta pan y salchicha, genera 2 movimientos MERMA y valora al costo real', () => {
    const now = Date.now();

    // Fijar WAC y stock inicial conocido
    db.prepare(`
      UPDATE supply_items
      SET current_stock_qty = 50, weighted_avg_cost_usd_cents = 28, cost_per_unit_usd_cents = 25
      WHERE id = 'sup_pan_perro'
    `).run();
    db.prepare(`
      UPDATE supply_items
      SET current_stock_qty = 50, weighted_avg_cost_usd_cents = 42, cost_per_unit_usd_cents = 40
      WHERE id = 'sup_salchicha_pollo'
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, 'sup_pan_perro', 50, 5, ?)
    `).run(`${locId}_sup_pan_perro`, locId, now);
    db.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, 'sup_salchicha_pollo', 50, 5, ?)
    `).run(`${locId}_sup_salchicha_pollo`, locId, now);

    const ftBefore = getFinancialTruth(db, { jornadaId: testJornadaId, locationId: locId });
    const initialWaste = ftBefore.waste.totalUsdCents;

    // Registrar merma de 2 Jalapeños Dog
    const wasteRecord = registerWasteLog(db, {
      locationId: locId,
      itemType: 'product',
      productId: 'prod_jalapenos_dog',
      quantity: 2,
      reason: 'Pan quemado y salchicha rota en preparacion',
      reportedByUserId: 'usr_admin'
    });

    // 1. Stock en la sede baja 2 unidades
    const panLoc = db.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_pan_perro`) as any;
    const salchichaLoc = db.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_salchicha_pollo`) as any;
    expect(panLoc.current_stock_qty).toBe(48);
    expect(salchichaLoc.current_stock_qty).toBe(48);

    // Stock global en supply_items baja 2 unidades
    const panGlobal = db.prepare('SELECT current_stock_qty FROM supply_items WHERE id = ?').get('sup_pan_perro') as any;
    const salchichaGlobal = db.prepare('SELECT current_stock_qty FROM supply_items WHERE id = ?').get('sup_salchicha_pollo') as any;
    expect(panGlobal.current_stock_qty).toBe(48);
    expect(salchichaGlobal.current_stock_qty).toBe(48);

    // 2. Existen 2 movimientos MERMA
    const movs = db.prepare(`
      SELECT supply_id, movement_type, quantity_delta, unit_cost_usd_cents, total_cost_usd_cents, reference_doc
      FROM inventory_movements
      WHERE reference_doc = 'MERMA' AND movement_type = 'MERMA'
    `).all() as any[];
    expect(movs).toHaveLength(2);

    const panMov = movs.find(m => m.supply_id === 'sup_pan_perro');
    const salMov = movs.find(m => m.supply_id === 'sup_salchicha_pollo');

    expect(panMov).toBeDefined();
    expect(panMov.quantity_delta).toBe(-2);
    expect(panMov.unit_cost_usd_cents).toBe(28);
    expect(panMov.total_cost_usd_cents).toBe(56); // 2 * 28

    expect(salMov).toBeDefined();
    expect(salMov.quantity_delta).toBe(-2);
    expect(salMov.unit_cost_usd_cents).toBe(42);
    expect(salMov.total_cost_usd_cents).toBe(84); // 2 * 42

    // 3. Valoración del waste_log: 2 * (WAC pan + WAC salchicha) = 56 + 84 = 140
    expect(wasteRecord.costUsdCents).toBe(140);
    const savedLog = db.prepare('SELECT * FROM waste_logs WHERE id = ?').get(wasteRecord.id) as any;
    expect(savedLog.cost_usd_cents).toBe(140);
    expect(savedLog.product_id).toBe('prod_jalapenos_dog');

    // 4. getFinancialTruth waste.totalUsdCents sube exactamente 140
    const ftAfter = getFinancialTruth(db, { jornadaId: testJornadaId, locationId: locId });
    expect(ftAfter.waste.totalUsdCents).toBe(initialWaste + 140);
    expect(ftAfter.waste.wasteLogsUsdCents).toBe(140);

    // 5. No se duplica con incidentes concurrentes
    db.prepare(`
      INSERT INTO worker_incidents (
        id, jornada_id, user_id, incident_type, estimated_loss_usd_cents,
        description, created_at_ms
      ) VALUES (?, ?, 'usr_admin', 'MERMA_ALIMENTO', 140, 'Incidente duplicado', ?)
    `).run(`inc_${generateUuidV7()}`, testJornadaId, savedLog.created_at_ms);

    const ftWithIncident = getFinancialTruth(db, { jornadaId: testJornadaId, locationId: locId });
    expect(ftWithIncident.waste.totalUsdCents).toBe(140);
    expect(ftWithIncident.waste.wasteLogsUsdCents).toBe(140);
    expect(ftWithIncident.waste.workerIncidentsUsdCents).toBe(0);
  });

  it('2. Respeta costUsdCents explícito si se envía en el input', () => {
    db.prepare(`
      UPDATE supply_items
      SET current_stock_qty = 50, weighted_avg_cost_usd_cents = 28
      WHERE id = 'sup_pan_perro'
    `).run();
    db.prepare(`
      UPDATE supply_items
      SET current_stock_qty = 50, weighted_avg_cost_usd_cents = 42
      WHERE id = 'sup_salchicha_pollo'
    `).run();

    const wasteRecord = registerWasteLog(db, {
      locationId: locId,
      itemType: 'product',
      productId: 'prod_jalapenos_dog',
      quantity: 1,
      costUsdCents: 200, // Explícito mayor que 70
      reason: 'Ajuste manual de costo',
      reportedByUserId: 'usr_admin'
    });

    expect(wasteRecord.costUsdCents).toBe(200);
    const savedLog = db.prepare('SELECT cost_usd_cents FROM waste_logs WHERE id = ?').get(wasteRecord.id) as any;
    expect(savedLog.cost_usd_cents).toBe(200);

    // Los inventarios igualmente se descuentan 1 unidad
    const panLoc = db.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_pan_perro`) as any;
    expect(panLoc.current_stock_qty).toBe(-1);
  });

  it('3. Producto sin receta técnica pero con insumo espejo sup_<id>: descuenta stock y registra movimiento', () => {
    const now = Date.now();
    // Crear producto sin receta
    db.prepare(`
      INSERT INTO products (id, category_id, name, description, price_usd_cents, estimated_cost_usd_cents, station, is_active, created_at_ms, updated_at_ms)
      VALUES ('prod_jugo_naranja', 'cat_bebidas', 'Jugo de Naranja', 'Natural', 200, 80, 'caja_bebidas', 1, ?, ?)
    `).run(now, now);

    // Crear insumo espejo
    db.prepare(`
      INSERT INTO supply_items (id, name, unit, unit_measure, current_stock_qty, minimum_stock_qty, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents, created_at_ms, updated_at_ms)
      VALUES ('sup_jugo_naranja', 'Jugo de Naranja Insumo', 'und', 'und', 30, 5, 80, 85, ?, ?)
    `).run(now, now);

    db.prepare(`
      INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES ('loc_alta_vista_sup_jugo_naranja', 'loc_alta_vista', 'sup_jugo_naranja', 30, 5, ?)
    `).run(now);

    const waste = registerWasteLog(db, {
      locationId: locId,
      itemType: 'product',
      productId: 'prod_jugo_naranja',
      quantity: 3,
      reason: 'Envase roto',
      reportedByUserId: 'usr_admin'
    });

    expect(waste.costUsdCents).toBe(3 * 85);

    const locInv = db.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get('loc_alta_vista_sup_jugo_naranja') as any;
    expect(locInv.current_stock_qty).toBe(27);

    const globalSup = db.prepare('SELECT current_stock_qty FROM supply_items WHERE id = ?').get('sup_jugo_naranja') as any;
    expect(globalSup.current_stock_qty).toBe(27);

    const mov = db.prepare("SELECT * FROM inventory_movements WHERE supply_id = 'sup_jugo_naranja' AND movement_type = 'MERMA'").get() as any;
    expect(mov).toBeDefined();
    expect(mov.quantity_delta).toBe(-3);
    expect(mov.unit_cost_usd_cents).toBe(85);
    expect(mov.total_cost_usd_cents).toBe(255);
  });

  it('4. Producto sin receta ni espejo: valora con estimated_cost y emite evento WASTE_WITHOUT_RECIPE', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO products (id, category_id, name, description, price_usd_cents, estimated_cost_usd_cents, station, is_active, created_at_ms, updated_at_ms)
      VALUES ('prod_especial_sin_receta', 'cat_hamburguesas', 'Especial Sin Receta', 'Sin receta ni espejo', 450, 150, 'hamburguesas', 1, ?, ?)
    `).run(now, now);

    const waste = registerWasteLog(db, {
      locationId: locId,
      itemType: 'product',
      productId: 'prod_especial_sin_receta',
      quantity: 2,
      reason: 'Vencido en exhibidor',
      reportedByUserId: 'usr_admin'
    });

    expect(waste.costUsdCents).toBe(300); // 2 * 150

    const audit = db.prepare("SELECT * FROM audit_events WHERE action = 'WASTE_WITHOUT_RECIPE' ORDER BY seq DESC LIMIT 1").get() as any;
    expect(audit).toBeDefined();
    expect(audit.entity_id).toBe('prod_especial_sin_receta');
    const payload = JSON.parse(audit.payload_json);
    expect(payload.productId).toBe('prod_especial_sin_receta');
    expect(payload.quantity).toBe(2);
  });

  it('5. Producto con sub-receta desglosa sus insumos componentes en la merma', () => {
    const now = Date.now();
    // Insumos base
    db.prepare(`
      INSERT INTO supply_items (id, name, unit, unit_measure, current_stock_qty, minimum_stock_qty, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents, created_at_ms, updated_at_ms)
      VALUES ('sup_tomate_base', 'Tomate', 'kg', 'kg', 10, 1, 100, 100, ?, ?)
    `).run(now, now);

    // Sub-receta de salsa con rendimiento de 10 porciones usando 2kg de tomate
    db.prepare(`
      INSERT INTO sub_recipes (id, name, yield_quantity, yield_unit, cost_per_unit_usd_cents, created_at_ms, updated_at_ms)
      VALUES ('sub_salsa_especial', 'Salsa Especial', 10, 'porcion', 20, ?, ?)
    `).run(now, now);

    db.prepare(`
      INSERT INTO sub_recipe_items (id, sub_recipe_id, supply_id, quantity_required)
      VALUES ('sri_1', 'sub_salsa_especial', 'sup_tomate_base', 2)
    `).run();

    // Producto que usa 1 porcion de sub_salsa_especial
    db.prepare(`
      INSERT INTO products (id, category_id, name, description, price_usd_cents, estimated_cost_usd_cents, station, is_active, created_at_ms, updated_at_ms)
      VALUES ('prod_plato_salsa', 'cat_hamburguesas', 'Plato Salsa', 'Con salsa', 500, 50, 'hamburguesas', 1, ?, ?)
    `).run(now, now);

    db.prepare(`
      INSERT INTO recipes (id, product_id, name)
      VALUES ('prod_plato_salsa', 'prod_plato_salsa', 'Receta Plato Salsa')
    `).run();

    db.prepare(`
      INSERT INTO recipe_items (id, recipe_id, sub_recipe_id, quantity_required)
      VALUES ('ri_sub_1', 'prod_plato_salsa', 'sub_salsa_especial', 1)
    `).run();

    // Merma de 5 platos: cada plato usa 1 porcion = (2 / 10) * 1 = 0.2 kg tomate. 5 platos = 1.0 kg tomate.
    const waste = registerWasteLog(db, {
      locationId: locId,
      itemType: 'product',
      productId: 'prod_plato_salsa',
      quantity: 5,
      reason: 'Plato derramado',
      reportedByUserId: 'usr_admin'
    });

    // 1 kg tomate a 100 cents/kg = 100 cents
    expect(waste.costUsdCents).toBe(100);

    const supTomate = db.prepare("SELECT current_stock_qty FROM supply_items WHERE id = 'sup_tomate_base'").get() as any;
    expect(supTomate.current_stock_qty).toBe(9); // 10 - 1

    const mov = db.prepare("SELECT * FROM inventory_movements WHERE supply_id = 'sup_tomate_base' AND movement_type = 'MERMA'").get() as any;
    expect(mov).toBeDefined();
    expect(mov.quantity_delta).toBe(-1);
    expect(mov.total_cost_usd_cents).toBe(100);
  });

  it('6. Producto en modo GRAMMAGE calcula merma considerando merma técnica (shrinkage)', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO supply_items (id, name, unit, unit_measure, current_stock_qty, minimum_stock_qty, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents, created_at_ms, updated_at_ms)
      VALUES ('sup_carne_molida_kg', 'Carne Molida', 'kg', 'kg', 20, 2, 500, 500, ?, ?)
    `).run(now, now);

    db.prepare(`
      INSERT INTO products (id, category_id, name, description, price_usd_cents, estimated_cost_usd_cents, station, recipe_mode, is_active, created_at_ms, updated_at_ms)
      VALUES ('prod_burger_grammage', 'cat_hamburguesas', 'Burger Grammage', '150g carne bruta', 600, 100, 'hamburguesas', 'GRAMMAGE', 1, ?, ?)
    `).run(now, now);

    db.prepare(`
      INSERT INTO recipes (id, product_id, name)
      VALUES ('prod_burger_grammage', 'prod_burger_grammage', 'Receta Burger Grammage')
    `).run();

    // 150g brutos, 20% merma técnica -> factor 1.2 -> 180g necesarios = 0.18 kg
    db.prepare(`
      INSERT INTO recipe_items (id, recipe_id, supply_item_id, quantity_required, gross_weight_grams, shrinkage_percentage)
      VALUES ('ri_gram_1', 'prod_burger_grammage', 'sup_carne_molida_kg', 1, 150, 20)
    `).run();

    // Merma de 2 hamburguesas -> 2 * 0.18 = 0.36 kg
    const waste = registerWasteLog(db, {
      locationId: locId,
      itemType: 'product',
      productId: 'prod_burger_grammage',
      quantity: 2,
      reason: 'Carne pasada de coccion',
      reportedByUserId: 'usr_admin'
    });

    // 0.36 kg * 500 cents/kg = 180 cents
    expect(waste.costUsdCents).toBe(180);

    const supCarne = db.prepare("SELECT current_stock_qty FROM supply_items WHERE id = 'sup_carne_molida_kg'").get() as any;
    expect(supCarne.current_stock_qty).toBeCloseTo(19.64, 4);

    const mov = db.prepare("SELECT * FROM inventory_movements WHERE supply_id = 'sup_carne_molida_kg' AND movement_type = 'MERMA'").get() as any;
    expect(mov).toBeDefined();
    expect(mov.quantity_delta).toBeCloseTo(-0.36, 4);
    expect(mov.total_cost_usd_cents).toBe(180);
  });
});
