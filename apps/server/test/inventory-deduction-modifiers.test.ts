import { describe, it, expect, beforeAll } from 'vitest';
import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { buildServer } from '../src/server.js';
import { getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { seedCriticalSuppliesAndRecipes } from '../src/modules/profitability/inventory.js';
import { deductInventoryForOrder, revertInventoryForOrder } from '../src/modules/profitability/recipes-service.js';

describe('E1 — Descuento de inventario por modificadores y recetas', () => {
  let rawDb: Database.Database;
  const testJornadaId = 'jor_test_inv_mod';

  beforeAll(async () => {
    const app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    const dbCtx = getDatabaseContext();
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureOfficialLocations(rawDb);
    seedCriticalSuppliesAndRecipes(rawDb);

    rawDb.prepare("UPDATE business_settings SET inventory_operation_mode = 'tracked' WHERE id = 'default'").run();

    const now = Date.now();
    rawDb.prepare(`
      INSERT OR IGNORE INTO jornadas (
        id, location_id, opened_by_user_id, opened_at_ms, status
      ) VALUES (?, 'loc_alta_vista', 'usr_admin', ?, 'abierta')
    `).run(testJornadaId, now);
  });

  const createOrderWithLines = (
    orderId: string,
    orderNumber: number,
    locationId: string,
    lines: Array<{
      lineId: string;
      productId: string;
      quantity: number;
      lineRole?: string;
      modifiers?: Array<{
        id: string;
        type: string;
        ingredientId?: string;
        ingredientName: string;
      }>;
    }>
  ) => {
    const now = Date.now();
    rawDb.prepare(`
      INSERT OR REPLACE INTO orders (
        id, order_number, location_id, jornada_id, created_by_user_id, rate_micro_bs,
        created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, 'usr_admin', 50000000, ?, ?)
    `).run(orderId, orderNumber, locationId, testJornadaId, now, now);

    for (const l of lines) {
      rawDb.prepare(`
        INSERT OR REPLACE INTO order_lines (
          id, order_id, product_id, quantity, unit_price_usd_cents, prorated_unit_price_usd_cents,
          subtotal_usd_cents, station, line_role, created_at_ms
        ) VALUES (?, ?, ?, ?, 500, 500, 500, 'hamburguesas', ?, ?)
      `).run(l.lineId, orderId, l.productId, l.quantity, l.lineRole || 'STANDARD', now);

      if (l.modifiers) {
        for (const m of l.modifiers) {
          rawDb.prepare(`
            INSERT OR REPLACE INTO order_line_modifiers (
              id, order_line_id, ingredient_id, ingredient_name, modifier_type, extra_price_usd_cents, internal_cost_usd_cents
            ) VALUES (?, ?, ?, ?, ?, 0, 0)
          `).run(m.id, l.lineId, m.ingredientId || null, m.ingredientName, m.type);
        }
      }
    }
  };

  it('a) Jalapeños Dog normal: -1 pan_perro, -1 salchicha_pollo, movimiento VENTA_RECETA con costo = WAC vigente', () => {
    const locId = 'loc_alta_vista';
    const orderId = `ord_test_a_${generateUuidV7().slice(0, 8)}`;
    const lineId = `line_test_a_${generateUuidV7().slice(0, 8)}`;

    // Fijar WAC y stock inicial conocido
    rawDb.prepare(`
      UPDATE supply_items
      SET current_stock_qty = 50, weighted_avg_cost_usd_cents = 28, cost_per_unit_usd_cents = 25
      WHERE id = 'sup_pan_perro'
    `).run();
    rawDb.prepare(`
      UPDATE supply_items
      SET current_stock_qty = 50, weighted_avg_cost_usd_cents = 42, cost_per_unit_usd_cents = 40
      WHERE id = 'sup_salchicha_pollo'
    `).run();

    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, ?, 50, 5, ?)
    `).run(`${locId}_sup_pan_perro`, locId, 'sup_pan_perro', Date.now());
    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, ?, 50, 5, ?)
    `).run(`${locId}_sup_salchicha_pollo`, locId, 'sup_salchicha_pollo', Date.now());

    createOrderWithLines(orderId, 101, locId, [
      { lineId, productId: 'prod_jalapenos_dog', quantity: 1 }
    ]);

    deductInventoryForOrder(rawDb, orderId, locId, Date.now(), 'usr_cajera');

    const panLoc = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_pan_perro`) as any;
    const salchichaLoc = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_salchicha_pollo`) as any;

    expect(panLoc.current_stock_qty).toBe(49);
    expect(salchichaLoc.current_stock_qty).toBe(49);

    const movs = rawDb.prepare(`
      SELECT supply_id, movement_type, quantity_delta, unit_cost_usd_cents, total_cost_usd_cents
      FROM inventory_movements
      WHERE order_id = ?
    `).all(orderId) as any[];

    expect(movs).toHaveLength(2);
    const panMov = movs.find(m => m.supply_id === 'sup_pan_perro');
    const salMov = movs.find(m => m.supply_id === 'sup_salchicha_pollo');

    expect(panMov).toBeDefined();
    expect(panMov.movement_type).toBe('VENTA_RECETA');
    expect(panMov.quantity_delta).toBe(-1);
    expect(panMov.unit_cost_usd_cents).toBe(28); // WAC vigente

    expect(salMov).toBeDefined();
    expect(salMov.movement_type).toBe('VENTA_RECETA');
    expect(salMov.quantity_delta).toBe(-1);
    expect(salMov.unit_cost_usd_cents).toBe(42); // WAC vigente
  });

  it('b) Americana Deluxe "SIN carne": descuenta 0 medallones de los 4 de la receta (no 3)', () => {
    const locId = 'loc_alta_vista';
    const orderId = `ord_test_b_${generateUuidV7().slice(0, 8)}`;
    const lineId = `line_test_b_${generateUuidV7().slice(0, 8)}`;

    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, ?, 100, 5, ?)
    `).run(`${locId}_sup_carne_smash`, locId, 'sup_carne_smash', Date.now());
    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, ?, 100, 5, ?)
    `).run(`${locId}_sup_pan_brioche`, locId, 'sup_pan_brioche', Date.now());

    createOrderWithLines(orderId, 102, locId, [
      {
        lineId,
        productId: 'prod_americana_deluxe',
        quantity: 1,
        modifiers: [
          {
            id: `mod_${generateUuidV7().slice(0, 8)}`,
            type: 'SIN',
            ingredientId: 'ing_base_carne_smash',
            ingredientName: 'Carne Prime Smash'
          }
        ]
      }
    ]);

    deductInventoryForOrder(rawDb, orderId, locId, Date.now(), 'usr_cajera');

    // Pan brioche sí descuenta 1
    const panLoc = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_pan_brioche`) as any;
    expect(panLoc.current_stock_qty).toBe(99);

    // Carne smash debe descontar 0 (stock sigue intacto en 100)
    const carneLoc = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_carne_smash`) as any;
    expect(carneLoc.current_stock_qty).toBe(100);

    // No debe haber movimiento para carne smash
    const carneMov = rawDb.prepare(`
      SELECT * FROM inventory_movements WHERE order_id = ? AND supply_id = 'sup_carne_smash'
    `).get(orderId);
    expect(carneMov).toBeUndefined();
  });

  it('c) Doble Salchicha con EXTRA salchicha: 3 salchichas', () => {
    const locId = 'loc_alta_vista';
    const orderId = `ord_test_c_${generateUuidV7().slice(0, 8)}`;
    const lineId = `line_test_c_${generateUuidV7().slice(0, 8)}`;

    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, ?, 100, 5, ?)
    `).run(`${locId}_sup_salchicha_pollo`, locId, 'sup_salchicha_pollo', Date.now());

    createOrderWithLines(orderId, 103, locId, [
      {
        lineId,
        productId: 'prod_doble_salchicha_dog',
        quantity: 1,
        modifiers: [
          {
            id: `mod_${generateUuidV7().slice(0, 8)}`,
            type: 'EXTRA',
            ingredientId: 'ing_base_salchicha_pollo',
            ingredientName: 'Salchicha Nacional de Pollo'
          }
        ]
      }
    ]);

    deductInventoryForOrder(rawDb, orderId, locId, Date.now(), 'usr_cajera');

    // 2 de base + 1 extra = 3 salchichas descontadas (100 - 3 = 97)
    const salLoc = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_salchicha_pollo`) as any;
    expect(salLoc.current_stock_qty).toBe(97);

    const salMov = rawDb.prepare(`
      SELECT quantity_delta FROM inventory_movements WHERE order_id = ? AND supply_id = 'sup_salchicha_pollo'
    `).get(orderId) as any;
    expect(salMov.quantity_delta).toBe(-3);
  });

  it('d) combo con refresco elegido: descuenta el refresco hijo y no el padre', () => {
    const locId = 'loc_alta_vista';
    const orderId = `ord_test_d_${generateUuidV7().slice(0, 8)}`;
    const parentLineId = `line_parent_${generateUuidV7().slice(0, 8)}`;
    const childLineId1 = `line_child1_${generateUuidV7().slice(0, 8)}`;
    const childLineId2 = `line_child2_${generateUuidV7().slice(0, 8)}`;

    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, ?, 50, 5, ?)
    `).run(`${locId}_sup_malta_lata`, locId, 'sup_malta_lata', Date.now());
    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, ?, 50, 5, ?)
    `).run(`${locId}_sup_pan_perro`, locId, 'sup_pan_perro', Date.now());

    createOrderWithLines(orderId, 104, locId, [
      { lineId: parentLineId, productId: 'prod_combo_street', quantity: 1, lineRole: 'COMBO_PARENT' },
      { lineId: childLineId1, productId: 'prod_street_dog', quantity: 1, lineRole: 'COMBO_CHILD' },
      { lineId: childLineId2, productId: 'prod_malta_lata_250', quantity: 1, lineRole: 'COMBO_CHILD' }
    ]);

    deductInventoryForOrder(rawDb, orderId, locId, Date.now(), 'usr_cajera');

    // Hijo 1 (Street Dog) y Hijo 2 (Malta Lata) descontados
    const maltaLoc = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_malta_lata`) as any;
    expect(maltaLoc.current_stock_qty).toBe(49);

    // No debe haber descuento de un supply inexistente para el combo padre
    const comboMov = rawDb.prepare(`
      SELECT * FROM inventory_movements WHERE order_id = ? AND supply_id LIKE '%combo%'
    `).all(orderId);
    expect(comboMov).toHaveLength(0);
  });

  it('e) FINISHED_PRODUCT con receta y sin espejo: descuenta por receta', () => {
    const locId = 'loc_alta_vista';
    const orderId = `ord_test_e_${generateUuidV7().slice(0, 8)}`;
    const prodId = `prod_test_fin_${generateUuidV7().slice(0, 8)}`;
    const recId = `rec_${prodId}`;
    const supId = `sup_custom_component_${generateUuidV7().slice(0, 8)}`;
    const now = Date.now();

    // Crear insumo componente
    rawDb.prepare(`
      INSERT OR REPLACE INTO supply_items (id, name, unit, cost_per_unit_usd_cents, current_stock_qty, created_at_ms, updated_at_ms)
      VALUES (?, 'Componente Receta Especial', 'und', 50, 20, ?, ?)
    `).run(supId, now, now);
    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, ?, 20, 0, ?)
    `).run(`${locId}_${supId}`, locId, supId, now);

    // Crear producto FINISHED_PRODUCT sin insumo espejo
    rawDb.prepare(`
      INSERT OR REPLACE INTO products (id, category_id, name, recipe_mode, price_usd_cents, station, is_active, created_at_ms, updated_at_ms)
      VALUES (?, 'cat_hamburguesas', 'Postre Artesanal', 'FINISHED_PRODUCT', 300, 'hamburguesas', 1, ?, ?)
    `).run(prodId, now, now);

    // Crear receta técnica para este FINISHED_PRODUCT
    rawDb.prepare(`
      INSERT OR REPLACE INTO recipes (id, product_id, name) VALUES (?, ?, 'Receta Postre')
    `).run(recId, prodId);
    rawDb.prepare(`
      INSERT OR REPLACE INTO recipe_items (id, recipe_id, supply_item_id, quantity_required)
      VALUES (?, ?, ?, 2)
    `).run(`ri_${recId}`, recId, supId);

    createOrderWithLines(orderId, 105, locId, [
      { lineId: `line_${orderId}`, productId: prodId, quantity: 2 }
    ]);

    deductInventoryForOrder(rawDb, orderId, locId, Date.now(), 'usr_cajera');

    // Descuenta por receta: 2 unidades requeridas * 2 cantidad = 4 insumos descontados (20 - 4 = 16)
    const stockLoc = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_${supId}`) as any;
    expect(stockLoc.current_stock_qty).toBe(16);

    const mov = rawDb.prepare(`
      SELECT quantity_delta FROM inventory_movements WHERE order_id = ? AND supply_id = ?
    `).get(orderId, supId) as any;
    expect(mov.quantity_delta).toBe(-4);
  });

  it('f) orden cobrada dos veces: se descuenta una sola vez (idempotencia)', () => {
    const locId = 'loc_alta_vista';
    const orderId = `ord_test_f_${generateUuidV7().slice(0, 8)}`;
    const lineId = `line_test_f_${generateUuidV7().slice(0, 8)}`;

    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, ?, 50, 5, ?)
    `).run(`${locId}_sup_pan_perro`, locId, 'sup_pan_perro', Date.now());

    createOrderWithLines(orderId, 106, locId, [
      { lineId, productId: 'prod_jalapenos_dog', quantity: 1 }
    ]);

    // Primer cobro
    deductInventoryForOrder(rawDb, orderId, locId, Date.now(), 'usr_cajera');
    const panLocAfter1 = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_pan_perro`) as any;
    expect(panLocAfter1.current_stock_qty).toBe(49);

    const count1 = (rawDb.prepare('SELECT COUNT(*) as c FROM inventory_movements WHERE order_id = ?').get(orderId) as any).c;

    // Segundo cobro (simulación idempotente)
    deductInventoryForOrder(rawDb, orderId, locId, Date.now(), 'usr_cajera');
    const panLocAfter2 = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_pan_perro`) as any;
    expect(panLocAfter2.current_stock_qty).toBe(49);

    const count2 = (rawDb.prepare('SELECT COUNT(*) as c FROM inventory_movements WHERE order_id = ?').get(orderId) as any).c;
    expect(count2).toBe(count1);
  });

  it('g) anulación: stock vuelve al valor inicial y revierte movimientos', () => {
    const locId = 'loc_alta_vista';
    const orderId = `ord_test_g_${generateUuidV7().slice(0, 8)}`;
    const lineId = `line_test_g_${generateUuidV7().slice(0, 8)}`;

    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, ?, 40, 5, ?)
    `).run(`${locId}_sup_pan_perro`, locId, 'sup_pan_perro', Date.now());

    createOrderWithLines(orderId, 107, locId, [
      { lineId, productId: 'prod_jalapenos_dog', quantity: 1 }
    ]);

    deductInventoryForOrder(rawDb, orderId, locId, Date.now(), 'usr_cajera');
    const afterDeduct = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_pan_perro`) as any;
    expect(afterDeduct.current_stock_qty).toBe(39);

    // Revertir
    revertInventoryForOrder(rawDb, orderId, locId, 'Anulación de prueba', 'usr_cajera');
    const afterRevert = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_pan_perro`) as any;
    expect(afterRevert.current_stock_qty).toBe(40);

    const revMov = rawDb.prepare(`
      SELECT movement_type, quantity_delta FROM inventory_movements
      WHERE order_id = ? AND movement_type = 'REVERSION_VENTA'
    `).all(orderId) as any[];
    expect(revMov.length).toBeGreaterThan(0);

    // Idempotencia de reversión
    revertInventoryForOrder(rawDb, orderId, locId, 'Segunda anulación accidental', 'usr_cajera');
    const afterSecondRevert = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_pan_perro`) as any;
    expect(afterSecondRevert.current_stock_qty).toBe(40);
  });

  it('h) combo con refresco: COMBO_CHILD apunta a prod_refresco_1lt independientemente del flavor_choice', () => {
    // Verificación de la definición del slot del combo en base de datos
    const slotOptions = rawDb.prepare(`
      SELECT cso.product_id, p.name
      FROM combo_slots cs
      JOIN combo_slot_options cso ON cs.id = cso.slot_id
      JOIN products p ON cso.product_id = p.id
      WHERE cs.combo_id = 'prod_combo_para_ti' AND cs.slot_name LIKE '%Refresco%'
    `).all() as any[];

    // El combo apunta al producto genérico prod_refresco_1lt
    expect(slotOptions.length).toBeGreaterThanOrEqual(1);
    expect(slotOptions[0].product_id).toBe('prod_refresco_1lt');

    // La receta del producto genérico descuenta sup_refresco_1lt
    const recipeItem = rawDb.prepare(`
      SELECT ri.supply_item_id
      FROM recipes r
      JOIN recipe_items ri ON r.id = ri.recipe_id
      WHERE r.product_id = 'prod_refresco_1lt'
    `).get() as any;

    expect(recipeItem).toBeDefined();
    expect(recipeItem.supply_item_id).toBe('sup_refresco_1lt');
  });

  it('i) registra INVENTORY_DEDUCTION_GAP cuando FINISHED_PRODUCT no tiene espejo ni receta', () => {
    const locId = 'loc_alta_vista';
    const orderId = `ord_test_gap_${generateUuidV7().slice(0, 8)}`;
    const prodId = `prod_huerfano_${generateUuidV7().slice(0, 8)}`;
    const now = Date.now();

    rawDb.prepare(`
      INSERT OR REPLACE INTO products (id, category_id, name, recipe_mode, price_usd_cents, station, is_active, created_at_ms, updated_at_ms)
      VALUES (?, 'cat_hamburguesas', 'Producto Huérfano', 'FINISHED_PRODUCT', 200, 'hamburguesas', 1, ?, ?)
    `).run(prodId, now, now);

    createOrderWithLines(orderId, 108, locId, [
      { lineId: `line_${orderId}`, productId: prodId, quantity: 1 }
    ]);

    deductInventoryForOrder(rawDb, orderId, locId, Date.now(), 'usr_cajera');

    // Verificar que se registró el evento de auditoría GAP
    const gapEvent = rawDb.prepare(`
      SELECT * FROM audit_events
      WHERE action = 'INVENTORY_DEDUCTION_GAP' AND entity_id = ?
    `).get(orderId) as any;

    expect(gapEvent).toBeDefined();
    const payload = JSON.parse(gapEvent.payload_json);
    expect(payload.productId).toBe(prodId);
  });

  it('j) registra INVENTORY_NEGATIVE_STOCK cuando el stock resultante de location_inventory queda < 0', () => {
    const locId = 'loc_alta_vista';
    const orderId = `ord_test_neg_${generateUuidV7().slice(0, 8)}`;
    const lineId = `line_test_neg_${generateUuidV7().slice(0, 8)}`;

    // Dejar stock en 0 antes de la deducción
    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, ?, 0, 5, ?)
    `).run(`${locId}_sup_pan_perro`, locId, 'sup_pan_perro', Date.now());

    createOrderWithLines(orderId, 109, locId, [
      { lineId, productId: 'prod_jalapenos_dog', quantity: 1 }
    ]);

    deductInventoryForOrder(rawDb, orderId, locId, Date.now(), 'usr_cajera');

    const panLoc = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_pan_perro`) as any;
    expect(panLoc.current_stock_qty).toBe(-1);

    const negEvent = rawDb.prepare(`
      SELECT * FROM audit_events
      WHERE action = 'INVENTORY_NEGATIVE_STOCK' AND entity_id = 'sup_pan_perro'
      ORDER BY seq DESC LIMIT 1
    `).get() as any;

    expect(negEvent).toBeDefined();
    const payload = JSON.parse(negEvent.payload_json);
    expect(payload.supplyId).toBe('sup_pan_perro');
    expect(payload.resultantStock).toBe(-1);
  });

  it('k) ingredient_supply_map tiene precedencia sobre la heurística de nombres', () => {
    const locId = 'loc_alta_vista';
    const orderId = `ord_test_k_${generateUuidV7().slice(0, 8)}`;
    const lineId = `line_test_k_${generateUuidV7().slice(0, 8)}`;
    const customIngId = `ing_custom_map_${generateUuidV7().slice(0, 6)}`;

    // Mapear un ingrediente personalizado a sup_pan_perro
    rawDb.prepare(`
      INSERT OR REPLACE INTO ingredient_supply_map (ingredient_id, supply_id)
      VALUES (?, 'sup_pan_perro')
    `).run(customIngId);

    rawDb.prepare(`
      INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
      VALUES (?, ?, ?, 50, 5, ?)
    `).run(`${locId}_sup_pan_perro`, locId, 'sup_pan_perro', Date.now());

    // Orden con un Extra usando el id mapeado en ingredient_supply_map
    createOrderWithLines(orderId, 110, locId, [
      {
        lineId,
        productId: 'prod_jalapenos_dog',
        quantity: 1,
        modifiers: [
          {
            id: `mod_${generateUuidV7().slice(0, 8)}`,
            type: 'EXTRA',
            ingredientId: customIngId,
            ingredientName: 'Nombre Desconocido Que No Coincide Con Nada'
          }
        ]
      }
    ]);

    deductInventoryForOrder(rawDb, orderId, locId, Date.now(), 'usr_cajera');

    // Pan perro: 1 de receta + 1 extra mapeado = 2 descontados (50 - 2 = 48)
    const panLoc = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE id = ?').get(`${locId}_sup_pan_perro`) as any;
    expect(panLoc.current_stock_qty).toBe(48);
  });

  it('l) prod_libre no genera INVENTORY_DEDUCTION_GAP y otro producto sin receta sí lo sigue generando', () => {
    const locId = 'loc_alta_vista';
    const now = Date.now();

    // 1. Orden con el ítem libre de mostrador: no debe auditar ningún GAP.
    const freeOrderId = `ord_test_libre_${generateUuidV7().slice(0, 8)}`;
    createOrderWithLines(freeOrderId, 111, locId, [
      { lineId: `line_${freeOrderId}`, productId: 'prod_libre', quantity: 1 }
    ]);

    deductInventoryForOrder(rawDb, freeOrderId, locId, Date.now(), 'usr_cajera');

    const freeGaps = rawDb.prepare(`
      SELECT COUNT(*) as c FROM audit_events
      WHERE action = 'INVENTORY_DEDUCTION_GAP' AND entity_id = ?
    `).get(freeOrderId) as any;
    expect(freeGaps.c).toBe(0);

    // 2. Producto normal sin receta: el GAP de auditoría debe seguir registrándose.
    const prodId = `prod_sin_receta_${generateUuidV7().slice(0, 8)}`;
    rawDb.prepare(`
      INSERT OR REPLACE INTO products (id, category_id, name, recipe_mode, price_usd_cents, station, is_active, created_at_ms, updated_at_ms)
      VALUES (?, 'cat_hamburguesas', 'Producto Sin Receta', 'UNITS', 200, 'hamburguesas', 1, ?, ?)
    `).run(prodId, now, now);

    const orphanOrderId = `ord_test_sin_receta_${generateUuidV7().slice(0, 8)}`;
    createOrderWithLines(orphanOrderId, 112, locId, [
      { lineId: `line_${orphanOrderId}`, productId: prodId, quantity: 1 }
    ]);

    deductInventoryForOrder(rawDb, orphanOrderId, locId, Date.now(), 'usr_cajera');

    const gapEvent = rawDb.prepare(`
      SELECT * FROM audit_events
      WHERE action = 'INVENTORY_DEDUCTION_GAP' AND entity_id = ?
    `).get(orphanOrderId) as any;
    expect(gapEvent).toBeDefined();
    const payload = JSON.parse(gapEvent.payload_json);
    expect(payload.productId).toBe(prodId);
  });
});
