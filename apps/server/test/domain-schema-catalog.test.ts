import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { getKitchenBuildableLines } from '../src/modules/orders/kitchen-queries.js';

describe('Hito M2 - Esquema de Dominio, Catálogo Oficial y Triggers Contables (@tocineta/server)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_m2_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_m2.db');
  let rawDb: Database.Database;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    // Ejecutar migraciones 0001 y 0002
    await runMigrations(rawDb, { dbPath: tempDb });

    // Sembrar usuarios y catálogo
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
  });

  afterAll(async () => {
    try {
      const dbCtx = getDatabaseContext();
      dbCtx.rawDb.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // --------------------------------------------------------------------------
  // CRITERIO 1: Feature Flag de Malteadas (Categoría Inactiva por Defecto)
  // --------------------------------------------------------------------------
  describe('Regla 1: Feature Flag de Malteadas y Helados', () => {
    it('MALTEADAS_Y_HELADOS existe en la base de datos con is_active = 0', () => {
      const cat = rawDb.prepare("SELECT * FROM categories WHERE id = 'cat_malteadas'").get() as any;
      expect(cat).toBeDefined();
      expect(cat.name).toBe('Malteadas y Helados');
      expect(cat.is_active).toBe(0);
    });

    it('La consulta de categorías activas para el POS excluye Malteadas y Helados', () => {
      const activeCats = rawDb.prepare(`
        SELECT id, name, is_active FROM categories 
        WHERE is_active = 1 AND is_internal = 0 
        ORDER BY display_order ASC
      `).all() as any[];

      const catNames = activeCats.map(c => c.name);
      expect(catNames).toContain('Hot Dogs');
      expect(catNames).toContain('Hamburguesas');
      expect(catNames).toContain('Combos');
      expect(catNames).toContain('Extras y Raciones');
      expect(catNames).toContain('Bebidas');
      expect(catNames).not.toContain('Malteadas y Helados');
    });

    it('Se activa instantáneamente con un clic (is_active = 1) sin requerir migraciones', () => {
      rawDb.prepare("UPDATE categories SET is_active = 1 WHERE id = 'cat_malteadas'").run();

      const activeAfterUpdate = rawDb.prepare(`
        SELECT id, name FROM categories 
        WHERE is_active = 1 AND is_internal = 0
      `).all() as any[];

      expect(activeAfterUpdate.some(c => c.id === 'cat_malteadas')).toBe(true);

      // Restaurar a inactiva para mantener fidelidad con el estado inicial
      rawDb.prepare("UPDATE categories SET is_active = 0 WHERE id = 'cat_malteadas'").run();
    });
  });

  // --------------------------------------------------------------------------
  // CRITERIO 2: Sabores Oficiales Pepsi para Refresco 1 Lt
  // --------------------------------------------------------------------------
  describe('Regla 4: Sabores Oficiales Pepsi para Refresco 1 Lt ($1.80)', () => {
    it('Refresco 1 Lt tiene exactamente los 6 sabores oficiales y ningún otro sabor', () => {
      const flavors = rawDb.prepare(`
        SELECT flavor_name, display_order, is_active 
        FROM product_flavor_options 
        WHERE product_id = 'prod_refresco_1lt'
        ORDER BY display_order ASC
      `).all() as any[];

      expect(flavors).toHaveLength(6);
      const flavorNames = flavors.map(f => f.flavor_name);
      expect(flavorNames).toEqual(['Pepsi', '7Up', 'Frescolita', 'Manzanita', 'Piña', 'Naranja']);

      // Verificar que no existe Coca-Cola ni ningún sabor extraño
      expect(flavorNames).not.toContain('Coca-Cola');
      expect(flavorNames).not.toContain('Chinotto');
    });
  });

  // --------------------------------------------------------------------------
  // CRITERIO 3: Descomposición de Combos, Barra Libre y Obsequio Cupón
  // --------------------------------------------------------------------------
  describe('Reglas 2, 3 y 6: Descomposición de Combos en Cocina, Barra Libre y Cupones', () => {
    const orderId = 'ord_test_combo_m2';
    const jornadaId = 'jornada_test_m2';

    beforeAll(() => {
      const now = Date.now();
      // Crear jornada de prueba
      rawDb.prepare(`
        INSERT OR IGNORE INTO jornadas (id, opened_by_user_id, opened_at_ms, status)
        VALUES (?, 'usr_admin', ?, 'abierta')
      `).run(jornadaId, now);

      // Crear Orden con 1 Combo Clásico ($7.90) + 1 Cupón Obsequio (Café de Cortesía $0.00)
      rawDb.prepare(`
        INSERT INTO orders (
          id, order_number, jornada_id, created_by_user_id,
          gross_food_subtotal_usd_cents, net_food_sales_usd_cents,
          total_to_collect_usd_cents, rate_micro_bs,
          payment_status, fulfillment_status, created_at_ms, updated_at_ms
        ) VALUES (
          ?, 101, ?, 'usr_admin',
          790, 790,
          790, 40000000,
          'pagado', 'pendiente', ?, ?
        )
      `).run(orderId, jornadaId, now, now);

      // Línea 1 (Padre del Combo): Combo Clásico ($7.90 / 790 cents) para Caja
      rawDb.prepare(`
        INSERT INTO order_lines (
          id, order_id, product_id, line_role, quantity,
          unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents,
          station, created_at_ms
        ) VALUES (
          'line_parent_combo', ?, 'prod_combo_clasico', 'COMBO_PARENT', 1,
          790, 790, 790,
          'hot_dogs', ?
        )
      `).run(orderId, now);

      // Línea 2 (Hija 1): Doritos Dog Snacks (con Barra Libre: Maíz y Cebolla Caramelizada)
      rawDb.prepare(`
        INSERT INTO order_lines (
          id, order_id, product_id, line_role, parent_line_id, quantity,
          unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents,
          station, created_at_ms
        ) VALUES (
          'line_child_doritos', ?, 'prod_doritos_dog_snacks', 'COMBO_CHILD', 'line_parent_combo', 1,
          350, 325, 325,
          'hot_dogs', ? + 1
        )
      `).run(orderId, now);

      // Modificadores de Barra Libre para Doritos Dog Snacks
      rawDb.prepare(`
        INSERT INTO order_line_modifiers (
          id, order_line_id, ingredient_id, ingredient_name, modifier_type, extra_price_usd_cents, internal_cost_usd_cents
        ) VALUES 
          ('mod_bl_1_maiz', 'line_child_doritos', 'ing_bl_maiz', 'Maíz', 'BARRA_LIBRE', 0, 15),
          ('mod_bl_2_cebolla', 'line_child_doritos', 'ing_bl_cebolla_caramelizada', 'Cebolla Caramelizada', 'BARRA_LIBRE', 0, 15)
      `).run();

      // Línea 3 (Hija 2): Brazil Dog (con exclusión: Sin Salsa de Ajo)
      rawDb.prepare(`
        INSERT INTO order_lines (
          id, order_id, product_id, line_role, parent_line_id, quantity,
          unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents,
          station, created_at_ms
        ) VALUES (
          'line_child_brazil', ?, 'prod_brazil_dog', 'COMBO_CHILD', 'line_parent_combo', 1,
          350, 325, 325,
          'hot_dogs', ? + 2
        )
      `).run(orderId, now);

      // Modificador de exclusión para Brazil Dog
      rawDb.prepare(`
        INSERT INTO order_line_modifiers (
          id, order_line_id, ingredient_id, ingredient_name, modifier_type, extra_price_usd_cents, internal_cost_usd_cents
        ) VALUES 
          ('mod_sin_ajo', 'line_child_brazil', 'ing_base_salsa_ajo', 'Salsa de Ajo', 'SIN_INGREDIENTE', 0, 0)
      `).run();

      // Línea 4 (Hija 3): Malta Lata 250 ml (estación caja_bebidas)
      rawDb.prepare(`
        INSERT INTO order_lines (
          id, order_id, product_id, line_role, parent_line_id, quantity,
          unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents,
          station, created_at_ms
        ) VALUES (
          'line_child_malta', ?, 'prod_malta_lata_250', 'COMBO_CHILD', 'line_parent_combo', 1,
          150, 140, 140,
          'caja_bebidas', ? + 3
        )
      `).run(orderId, now);

      // Línea 5 (Cortesía Cupón): Café de Cortesía ($0.00)
      rawDb.prepare(`
        INSERT INTO order_lines (
          id, order_id, product_id, line_role, quantity,
          unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents,
          station, created_at_ms
        ) VALUES (
          'line_courtesy_cafe', ?, 'prod_cafe_cortesia', 'COURTESY_ITEM', 1,
          0, 0, 0,
          'hot_dogs', ? + 4
        )
      `).run(orderId, now);
    });

    it('Para Caja (Nota de Entrega): Muestra el Combo Clásico a $7.90 (790 cents) y el Café de Cortesía a $0.00', () => {
      const cashierLines = rawDb.prepare(`
        SELECT ol.id, p.name, ol.line_role, ol.unit_price_usd_cents, ol.subtotal_usd_cents
        FROM order_lines ol
        JOIN products p ON ol.product_id = p.id
        WHERE ol.order_id = ? AND ol.line_role IN ('STANDARD', 'COMBO_PARENT', 'COURTESY_ITEM')
        ORDER BY ol.created_at_ms ASC
      `).all(orderId) as any[];

      expect(cashierLines).toHaveLength(2);
      expect(cashierLines[0].name).toBe('Combo Clásico');
      expect(cashierLines[0].unit_price_usd_cents).toBe(790);
      expect(cashierLines[0].line_role).toBe('COMBO_PARENT');

      expect(cashierLines[1].name).toBe('Café de Cortesía');
      expect(cashierLines[1].unit_price_usd_cents).toBe(0);
      expect(cashierLines[1].line_role).toBe('COURTESY_ITEM');
    });

    it('Para Cocina: getKitchenBuildableLines() devuelve 1x Doritos Dog Snacks, 1x Brazil Dog y 1x Café de Cortesía [OBSEQUIO CUPÓN - $0.00]', () => {
      const kitchenLines = getKitchenBuildableLines(rawDb, orderId);

      expect(kitchenLines).toHaveLength(3);

      // 1. Doritos Dog Snacks
      expect(kitchenLines[0].displayName).toBe('1x Doritos Dog Snacks');
      expect(kitchenLines[0].station).toBe('hot_dogs');
      expect(kitchenLines[0].modifiers).toContain('+ AGREGAR (Barra Libre): Maíz, Cebolla Caramelizada');
      expect(kitchenLines[0].barraLibreModifiers).toEqual(['Maíz', 'Cebolla Caramelizada']);

      // 2. Brazil Dog
      expect(kitchenLines[1].displayName).toBe('1x Brazil Dog');
      expect(kitchenLines[1].station).toBe('hot_dogs');
      expect(kitchenLines[1].modifiers).toContain('SIN Salsa de Ajo');
      expect(kitchenLines[1].ingredientExclusions).toEqual(['SIN Salsa de Ajo']);

      // 3. Café de Cortesía con etiqueta de cupón
      expect(kitchenLines[2].displayName).toBe('1x Café de Cortesía [OBSEQUIO CUPÓN - $0.00]');
      expect(kitchenLines[2].station).toBe('hot_dogs');
    });

    it('Para Cocina: Ningún campo de la estructura de cocina contiene la palabra "Combo"', () => {
      const kitchenLines = getKitchenBuildableLines(rawDb, orderId);
      const jsonString = JSON.stringify(kitchenLines);
      expect(jsonString.toLowerCase()).not.toContain('combo');
    });
  });

  // --------------------------------------------------------------------------
  // CRITERIO 4: Triggers SQLite de Inmutabilidad y Control de Deuda
  // --------------------------------------------------------------------------
  describe('Reglas Contables: Triggers de Inmutabilidad en Ledger y Bloqueo de Cierre con Deuda', () => {
    const jornadaId = 'jornada_triggers_test';

    beforeAll(() => {
      // Regla D1: Cerrar jornada de prueba previa antes de abrir nueva jornada en el mismo archivo
      rawDb.prepare("UPDATE jornadas SET status = 'cerrada' WHERE status = 'abierta'").run();
      rawDb.prepare(`
        INSERT OR IGNORE INTO jornadas (id, opened_by_user_id, opened_at_ms, status)
        VALUES (?, 'usr_admin', ?, 'abierta')
      `).run(jornadaId, Date.now());

      // Insertar un asiento contable inicial en ledger_entries
      rawDb.prepare(`
        INSERT OR IGNORE INTO ledger_entries (
          entry_id, jornada_id, account_bucket, debit_usd_cents, credit_usd_cents, rate_micro_bs, description, created_at_ms
        ) VALUES (
          'entry_test_immutable', ?, 'FOOD_SALES', 0, 1500, 40000000, 'Venta Neta Orden 99', ?
        )
      `).run(jornadaId, Date.now());
    });

    it('El trigger trg_ledger_entries_no_update bloquea cualquier intento de UPDATE en ledger_entries', () => {
      expect(() => {
        rawDb.prepare(`
          UPDATE ledger_entries 
          SET description = 'Intento de alteración contable' 
          WHERE entry_id = 'entry_test_immutable'
        `).run();
      }).toThrow(/LEDGER_IMMUTABLE/i);
    });

    it('El trigger trg_ledger_entries_no_delete bloquea cualquier intento de DELETE en ledger_entries', () => {
      expect(() => {
        rawDb.prepare(`
          DELETE FROM ledger_entries 
          WHERE entry_id = 'entry_test_immutable'
        `).run();
      }).toThrow(/LEDGER_IMMUTABLE/i);
    });

    it('El trigger trg_orders_no_close_with_debt bloquea cerrar una orden si payment_status es "autorizado_sin_pago"', () => {
      const orderDebtId = 'ord_test_debt_close';
      rawDb.prepare(`
        INSERT OR REPLACE INTO orders (
          id, order_number, jornada_id, created_by_user_id,
          gross_food_subtotal_usd_cents, net_food_sales_usd_cents,
          total_to_collect_usd_cents, rate_micro_bs,
          payment_status, fulfillment_status, created_at_ms, updated_at_ms
        ) VALUES (
          ?, 102, ?, 'usr_admin',
          1200, 1200,
          1200, 40000000,
          'autorizado_sin_pago', 'entregado', ?, ?
        )
      `).run(orderDebtId, jornadaId, Date.now(), Date.now());

      // Intentar cerrar la orden con deuda autorizada
      expect(() => {
        rawDb.prepare(`
          UPDATE orders 
          SET fulfillment_status = 'cerrado' 
          WHERE id = ?
        `).run(orderDebtId);
      }).toThrow(/ORDER_CLOSE_DEBT_BLOCKED/i);
    });

    it('El trigger trg_orders_no_close_with_debt permite cerrar la orden una vez que pasa a "pagado"', () => {
      const orderPaidId = 'ord_test_paid_close';
      rawDb.prepare(`
        INSERT OR REPLACE INTO orders (
          id, order_number, jornada_id, created_by_user_id,
          gross_food_subtotal_usd_cents, net_food_sales_usd_cents,
          total_to_collect_usd_cents, rate_micro_bs,
          payment_status, fulfillment_status, created_at_ms, updated_at_ms
        ) VALUES (
          ?, 103, ?, 'usr_admin',
          1200, 1200,
          1200, 40000000,
          'sin_pago', 'entregado', ?, ?
        )
      `).run(orderPaidId, jornadaId, Date.now(), Date.now());

      // Bloqueado en sin_pago
      expect(() => {
        rawDb.prepare("UPDATE orders SET fulfillment_status = 'cerrado' WHERE id = ?").run(orderPaidId);
      }).toThrow(/ORDER_CLOSE_DEBT_BLOCKED/i);

      // Ahora se registra el pago y pasa a 'pagado'
      rawDb.prepare("UPDATE orders SET payment_status = 'pagado' WHERE id = ?").run(orderPaidId);

      // Ahora cerrar la orden debe ejecutarse exitosamente
      expect(() => {
        rawDb.prepare("UPDATE orders SET fulfillment_status = 'cerrado' WHERE id = ?").run(orderPaidId);
      }).not.toThrow();

      const closedOrder = rawDb.prepare('SELECT fulfillment_status FROM orders WHERE id = ?').get(orderPaidId) as any;
      expect(closedOrder.fulfillment_status).toBe('cerrado');
    });
  });

  // --------------------------------------------------------------------------
  // REGLA 5: Configuración de Delivery y Fondo Motorizado
  // --------------------------------------------------------------------------
  describe('Regla 5: Parámetros Contables de Delivery', () => {
    it('business_settings tiene THIRD_PARTY_PASS_THROUGH y tiers [200, 300, 400, 500]', () => {
      const settings = rawDb.prepare("SELECT * FROM business_settings WHERE id = 'default'").get() as any;
      expect(settings).toBeDefined();
      expect(settings.delivery_accounting_mode).toBe('THIRD_PARTY_PASS_THROUGH');
      expect(JSON.parse(settings.delivery_quick_tiers_json)).toEqual([200, 300, 400, 500]);
    });

    it('Registrar cobro de delivery en ledger_entries imputa a MOTORIZADO_FUND', () => {
      const entryId = 'entry_delivery_test';
      rawDb.prepare(`
        INSERT INTO ledger_entries (
          entry_id, jornada_id, account_bucket, debit_usd_cents, credit_usd_cents, rate_micro_bs, description, created_at_ms
        ) VALUES (
          ?, 'jornada_triggers_test', 'MOTORIZADO_FUND', 0, 300, 40000000, 'Cobro delivery Zona 2 a liquidar', ?
        )
      `).run(entryId, Date.now());

      const entry = rawDb.prepare('SELECT * FROM ledger_entries WHERE entry_id = ?').get(entryId) as any;
      expect(entry).toBeDefined();
      expect(entry.account_bucket).toBe('MOTORIZADO_FUND');
      expect(entry.credit_usd_cents).toBe(300);
    });
  });
});
