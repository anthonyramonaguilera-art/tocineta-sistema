import crypto from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type Database from 'better-sqlite3';
import { initSqlite } from '../../apps/server/src/db/connection.js';
import { runMigrations } from '../../apps/server/src/db/migrate.js';
import { isProductionDatabasePath, assertIsolatedTestDatabase } from '../../apps/server/src/db/test-guard.js';
import { seedCatalog } from '../../apps/server/src/db/seed-catalog.js';
import { ensureOfficialLocations } from '../../apps/server/src/modules/profitability/locations-service.js';
import { hashPin } from '../../apps/server/src/modules/auth/pin.js';
import { TEST_USERS, TEST_SCENARIO_CONFIG } from './test-constants.js';

function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export const SUPPLIES_SEED = [
  { id: 'sup_pan_perro', name: 'Pan de Perro Caliente', purchase_unit: 'paquete', usage_unit: 'und', conversion_factor: 1.0, category: 'panaderia', min_stock: 20, cost_usd_cents: 25 },
  { id: 'sup_pan_brioche', name: 'Pan Brioche Hamburguesa', purchase_unit: 'paquete', usage_unit: 'und', conversion_factor: 1.0, category: 'panaderia', min_stock: 20, cost_usd_cents: 35 },
  { id: 'sup_salchicha', name: 'Salchicha Nacional Pollo', purchase_unit: 'paquete', usage_unit: 'und', conversion_factor: 1.0, category: 'embutidos', min_stock: 30, cost_usd_cents: 40 },
  { id: 'sup_salchicha_polaca', name: 'Salchicha Polaca', purchase_unit: 'paquete', usage_unit: 'und', conversion_factor: 1.0, category: 'embutidos', min_stock: 20, cost_usd_cents: 60 },
  { id: 'sup_carne_smash', name: 'Carne Prime Smash (100g)', purchase_unit: 'kg', usage_unit: 'und', conversion_factor: 10.0, category: 'carnes', min_stock: 20, cost_usd_cents: 70 },
  { id: 'sup_tocineta', name: 'Tocineta Ahumada Premium', purchase_unit: 'kg', usage_unit: 'g', conversion_factor: 1000.0, category: 'embutidos', min_stock: 1000, cost_usd_cents: 30 },
  { id: 'sup_queso_cheddar', name: 'Queso Cheddar Rebanadas', purchase_unit: 'kg', usage_unit: 'und', conversion_factor: 1000.0, category: 'lacteos', min_stock: 50, cost_usd_cents: 25 },
  { id: 'sup_papas_hilo', name: 'Papas Ralladas al Hilo', purchase_unit: 'paquete', usage_unit: 'g', conversion_factor: 500.0, category: 'vegetales', min_stock: 500, cost_usd_cents: 15 },
  { id: 'sup_cebolla_caramelizada', name: 'Cebolla Caramelizada', purchase_unit: 'kg', usage_unit: 'g', conversion_factor: 1000.0, category: 'vegetales', min_stock: 500, cost_usd_cents: 15 },
  { id: 'sup_relish', name: 'Relish Dulce', purchase_unit: 'frasco', usage_unit: 'g', conversion_factor: 500.0, category: 'salsas', min_stock: 200, cost_usd_cents: 15 }
];

export const RECIPES_SEED = [
  {
    productId: 'prod_brazil_dog',
    recipeMode: 'UNITS',
    targetMarginBps: 6500,
    items: [
      { supplyId: 'sup_pan_perro', quantity: 1 },
      { supplyId: 'sup_salchicha', quantity: 1 },
      { supplyId: 'sup_papas_hilo', quantity: 20 }
    ]
  },
  {
    productId: 'prod_chicago_dog',
    recipeMode: 'UNITS',
    targetMarginBps: 6500,
    items: [
      { supplyId: 'sup_pan_perro', quantity: 1 },
      { supplyId: 'sup_salchicha_polaca', quantity: 1 },
      { supplyId: 'sup_tocineta', quantity: 15 },
      { supplyId: 'sup_relish', quantity: 15 }
    ]
  },
  {
    productId: 'prod_grill',
    recipeMode: 'UNITS',
    targetMarginBps: 6500,
    items: [
      { supplyId: 'sup_pan_brioche', quantity: 1 },
      { supplyId: 'sup_carne_smash', quantity: 1 },
      { supplyId: 'sup_queso_cheddar', quantity: 1 },
      { supplyId: 'sup_cebolla_caramelizada', quantity: 20 },
      { supplyId: 'sup_tocineta', quantity: 15 }
    ]
  }
];

export async function seedR2Scenario(customDbPath?: string): Promise<{ dbPath: string; rawDb: Database.Database }> {
  const dbPath = customDbPath || process.env.TOCINETA_DB_PATH || TEST_SCENARIO_CONFIG.defaultDbPath;

  // Guarda estricta: rechazar tajantemente correr si apunta a la base de datos de producción
  if (isProductionDatabasePath(dbPath)) {
    throw new Error(`[R2-HARNESS] RECHAZADO: Se intentó sembrar el escenario de pruebas sobre la base de producción (${dbPath}).`);
  }
  assertIsolatedTestDatabase(dbPath);

  // Asegurar directorio
  const resolved = path.resolve(process.cwd(), dbPath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Si existe archivo previo y queremos reiniciar escenario limpio
  const dbCtx = initSqlite(resolved);
  const rawDb = dbCtx.rawDb;
  const now = Date.now();

  try {
    // 1. Ejecutar todas las migraciones
    await runMigrations(rawDb, { dbPath: resolved });

    // 2. Sembrar catálogo base y sedes oficiales (las sedes incluirán hoy la 3ra sede alias para B13)
    seedCatalog(rawDb);
    ensureOfficialLocations(rawDb);

    // 2.5 Sembrar usuarios de prueba con PINs y contraseñas específicas del harness primero
    const insertUser = rawDb.prepare(`
      INSERT INTO users (
        id, name, username, role, pin_hash, pin_salt, pin_length,
        password_hash, password_salt, must_change_pin, is_active,
        failed_attempts, lockout_stage, locked_until_ms, approval_status,
        permissions_json, default_location_id, allowed_locations_json,
        created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, 0, NULL, 'APPROVED', '[]', 'loc_alta_vista', '["loc_los_olivos", "loc_alta_vista"]', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        username = excluded.username,
        role = excluded.role,
        pin_hash = excluded.pin_hash,
        pin_salt = excluded.pin_salt,
        pin_length = excluded.pin_length,
        password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
        must_change_pin = 0,
        is_active = 1,
        approval_status = 'APPROVED',
        updated_at_ms = excluded.updated_at_ms
    `);

    for (const key of Object.keys(TEST_USERS)) {
      const u = TEST_USERS[key];
      const { hash: pinHash, salt: pinSalt } = hashPin(u.pin);
      const { hash: pwHash, salt: pwSalt } = hashPassword(u.password);
      insertUser.run(
        u.id,
        u.name,
        u.username,
        u.role,
        pinHash,
        pinSalt,
        u.pin.length,
        pwHash,
        pwSalt,
        now,
        now
      );
    }

    // 3. Tasa fija 500 Bs/USD (rate_micro_bs = 500000000)
    rawDb.prepare('UPDATE exchange_rates SET is_current = 0').run();
    rawDb.prepare(`
      INSERT INTO exchange_rates (
        id, rate_micro_bs, source, set_by_user_id, created_at_ms, is_current
      ) VALUES ('rate_r2_scenario', ?, 'BCV_MANUAL', 'usr_test_admin', ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        rate_micro_bs = excluded.rate_micro_bs,
        created_at_ms = excluded.created_at_ms,
        is_current = 1
    `).run(TEST_SCENARIO_CONFIG.rateMicroBs, now);

    // 4. Sembrar los 10 insumos oficiales
    const insertSupply = rawDb.prepare(`
      INSERT INTO supply_items (
        id, name, unit, unit_measure, purchase_unit, usage_unit, conversion_factor,
        category, min_stock, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents,
        last_cost_usd_cents, is_active, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        purchase_unit = excluded.purchase_unit,
        usage_unit = excluded.usage_unit,
        conversion_factor = excluded.conversion_factor,
        category = excluded.category,
        min_stock = excluded.min_stock,
        cost_per_unit_usd_cents = excluded.cost_per_unit_usd_cents,
        weighted_avg_cost_usd_cents = excluded.weighted_avg_cost_usd_cents,
        last_cost_usd_cents = excluded.last_cost_usd_cents,
        is_active = 1,
        updated_at_ms = excluded.updated_at_ms
    `);

    for (const sup of SUPPLIES_SEED) {
      insertSupply.run(
        sup.id,
        sup.name,
        sup.purchase_unit,
        sup.usage_unit,
        sup.purchase_unit,
        sup.usage_unit,
        sup.conversion_factor,
        sup.category,
        sup.min_stock,
        sup.cost_usd_cents,
        sup.cost_usd_cents,
        sup.cost_usd_cents,
        now,
        now
      );
    }

    // 5. Sembrar las 3 recetas reales (Brazil Dog, Chicago Dog, Grill)
    for (const rec of RECIPES_SEED) {
      rawDb.prepare(`
        UPDATE products 
        SET recipe_mode = ?, target_margin_bps = ?, updated_at_ms = ?
        WHERE id = ?
      `).run(rec.recipeMode, rec.targetMarginBps, now, rec.productId);

      const existingRecipe = rawDb.prepare('SELECT id FROM recipes WHERE product_id = ?').get(rec.productId) as any;
      const recipeId = existingRecipe?.id || `rec_${rec.productId}`;
      if (!existingRecipe) {
        rawDb.prepare('INSERT INTO recipes (id, product_id, name) VALUES (?, ?, ?)').run(recipeId, rec.productId, rec.productId);
      }

      rawDb.prepare('DELETE FROM recipe_items WHERE recipe_id = ?').run(recipeId);
      const insertRecipeItem = rawDb.prepare(`
        INSERT INTO recipe_items (id, recipe_id, supply_item_id, quantity_required)
        VALUES (?, ?, ?, ?)
      `);

      for (let i = 0; i < rec.items.length; i++) {
        const it = rec.items[i];
        insertRecipeItem.run(`ritem_${recipeId}_${it.supplyId}`, recipeId, it.supplyId, it.quantity);
      }
    }

    // 6. Stock inicial por sede (loc_los_olivos y loc_alta_vista)
    const locations = ['loc_los_olivos', 'loc_alta_vista'];
    const insertLocInv = rawDb.prepare(`
      INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, ?, ?, 10, ?)
      ON CONFLICT(id) DO UPDATE SET
        current_stock_qty = excluded.current_stock_qty,
        updated_at_ms = excluded.updated_at_ms
    `);

    const insertInvMov = rawDb.prepare(`
      INSERT OR IGNORE INTO inventory_movements (
        id, location_id, supply_id, movement_type, quantity_delta,
        unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
      ) VALUES (?, ?, ?, 'AJUSTE_PRODUCCION', ?, ?, ?, 'CARGA_INICIAL_R2', 'Stock inicial escenario R2', 'usr_test_admin', ?)
    `);

    for (const locId of locations) {
      for (const sup of SUPPLIES_SEED) {
        const invId = `${locId}_${sup.id}`;
        const initialQty = 100;
        insertLocInv.run(invId, locId, sup.id, initialQty, now);
        insertInvMov.run(
          `mov_init_${invId}`,
          locId,
          sup.id,
          initialQty,
          sup.cost_usd_cents,
          initialQty * sup.cost_usd_cents,
          now
        );
      }
    }

    // 8. Una jornada abierta con fondo $100 + Bs 10.000 y una sesión de caja de la cajera
    // Cerrar cualquier jornada residual abierta en pruebas anteriores
    rawDb.prepare("UPDATE jornadas SET status = 'cerrada', closed_at_ms = ? WHERE status = 'abierta'").run(now);
    rawDb.prepare("UPDATE cash_sessions SET status = 'cerrada', closed_at_ms = ? WHERE status = 'abierta'").run(now);

    rawDb.prepare(`
      INSERT INTO jornadas (
        id, opened_by_user_id, opened_at_ms, status,
        initial_cash_usd_cents, initial_cash_bs_cents, location_id, notes
      ) VALUES (?, ?, ?, 'abierta', ?, ?, 'loc_alta_vista', 'Jornada oficial escenario R2')
      ON CONFLICT(id) DO UPDATE SET
        opened_by_user_id = excluded.opened_by_user_id,
        opened_at_ms = excluded.opened_at_ms,
        status = 'abierta',
        closed_at_ms = NULL,
        initial_cash_usd_cents = excluded.initial_cash_usd_cents,
        initial_cash_bs_cents = excluded.initial_cash_bs_cents,
        location_id = excluded.location_id,
        notes = excluded.notes
    `).run(
      TEST_SCENARIO_CONFIG.jornadaId,
      TEST_USERS.cajera.id,
      now,
      TEST_SCENARIO_CONFIG.initialCashUsdCents,
      TEST_SCENARIO_CONFIG.initialCashBsCents
    );

    rawDb.prepare(`
      INSERT INTO cash_sessions (
        id, jornada_id, user_id, opened_at_ms, status,
        opening_cash_usd_cents, opening_cash_bs_cents, location_id
      ) VALUES (?, ?, ?, ?, 'abierta', ?, ?, 'loc_alta_vista')
      ON CONFLICT(id) DO UPDATE SET
        jornada_id = excluded.jornada_id,
        user_id = excluded.user_id,
        opened_at_ms = excluded.opened_at_ms,
        status = 'abierta',
        closed_at_ms = NULL,
        opening_cash_usd_cents = excluded.opening_cash_usd_cents,
        opening_cash_bs_cents = excluded.opening_cash_bs_cents,
        location_id = excluded.location_id
    `).run(
      TEST_SCENARIO_CONFIG.cashSessionId,
      TEST_SCENARIO_CONFIG.jornadaId,
      TEST_USERS.cajera.id,
      now,
      TEST_SCENARIO_CONFIG.initialCashUsdCents,
      TEST_SCENARIO_CONFIG.initialCashBsCents
    );

    return { dbPath: resolved, rawDb };
  } catch (err) {
    throw err;
  }
}

// Si se ejecuta directamente por CLI (ej. tsx tools/r2-harness/seed-r2-scenario.ts)
if (process.argv[1] && process.argv[1].endsWith('seed-r2-scenario.ts')) {
  seedR2Scenario()
    .then(({ dbPath }) => {
      console.log(`[R2-HARNESS] Escenario determinista sembrado con éxito en: ${dbPath}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('[R2-HARNESS] Error sembrando escenario determinista:', err);
      process.exit(1);
    });
}
