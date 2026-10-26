import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { buildServer } from '../src/server.js';
import { getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import {
  getSupplyItems,
  bulkUpdateSupplyCosts,
  calculateOrderLineRealCost,
  BARRA_LIBRE_INTERNAL_COST_USD_CENTS,
  COURTESY_ITEM_INTERNAL_COST_USD_CENTS
} from '../src/modules/profitability/costing.js';
import {
  seedCriticalSuppliesAndRecipes,
  calculateTheoreticalConsumption,
  reconcileCriticalInventory,
  CRITICAL_SUPPLIES
} from '../src/modules/profitability/inventory.js';
import {
  createOperatingExpense,
  getOperatingExpenses,
  calculateJornadaNetProfit
} from '../src/modules/profitability/net-profit.js';
import { generateMenuEngineeringReport } from '../src/modules/profitability/menu-engineering.js';
import { buildReceiptTicketIR, type OrderReceiptData } from '../src/modules/printing/templates.js';

describe('Hito M14 - Módulo de Rentabilidad Profesional (Niveles 1 al 4) y Módulo Fiscal', () => {
  let app: FastifyInstance;
  let rawDb: Database.Database;
  const testJornadaId = 'jornada_m14_test';

  beforeAll(async () => {
    app = await buildServer({ disableStatic: true });
    await app.ready();

    const dbCtx = getDatabaseContext();
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    seedCriticalSuppliesAndRecipes(rawDb);

    // Asegurar jornada de prueba abierta
    rawDb.prepare(`
      INSERT OR IGNORE INTO jornadas (id, opened_by_user_id, opened_at_ms, status)
      VALUES (?, 'usr_admin_olinelcys', ?, 'abierta')
    `).run(testJornadaId, Date.now());
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // BLOQUE 0: INTERRUPTOR MAESTRO Y MÓDULO FISCAL
  // =========================================================================
  describe('0. Interruptores de Configuración (Rentabilidad Pro y Módulo Fiscal)', () => {
    it('0.1 Permite alternar profitability_pro_enabled y fiscal_module_enabled', async () => {
      // 1. Obtener estado inicial
      const resGet = await app.inject({
        method: 'GET',
        url: '/api/profitability/settings'
      });
      expect(resGet.statusCode).toBe(200);
      const bodyGet = JSON.parse(resGet.payload);
      expect(bodyGet.success).toBe(true);
      expect(typeof bodyGet.profitabilityProEnabled).toBe('boolean');
      expect(typeof bodyGet.fiscalModuleEnabled).toBe('boolean');

      // 2. Activar ambos módulos
      const resPatch = await app.inject({
        method: 'PATCH',
        url: '/api/profitability/settings',
        payload: {
          profitabilityProEnabled: true,
          fiscalModuleEnabled: true
        }
      });
      expect(resPatch.statusCode).toBe(200);
      const bodyPatch = JSON.parse(resPatch.payload);
      expect(bodyPatch.profitabilityProEnabled).toBe(true);
      expect(bodyPatch.fiscalModuleEnabled).toBe(true);

      // Verificar en BD
      const row = rawDb.prepare('SELECT profitability_pro_enabled, fiscal_module_enabled FROM business_settings WHERE id = \'default\'').get() as any;
      expect(row.profitability_pro_enabled).toBe(1);
      expect(row.fiscal_module_enabled).toBe(1);
    });

    it('0.2 Módulo Fiscal: buildReceiptTicketIR genera desglose informativo cuando fiscalModuleEnabled = true', () => {
      const orderData: OrderReceiptData = {
        id: 'ord_fiscal_test',
        orderNumber: 101,
        fulfillmentType: 'salon',
        tableNumber: 'Mesa 1',
        grossFoodSubtotalUsdCents: 1160,
        discountUsdCents: 0,
        deliveryFeeUsdCents: 0,
        totalToCollectUsdCents: 1160, // $11.60
        rateMicroBs: 40_000_000,
        createdAtMs: Date.now(),
        fiscalModuleEnabled: true,
        paidInUsdCents: 1000 // $10.00 pagados en divisas
      };

      const ticket = buildReceiptTicketIR(orderData, [
        {
          lineId: 'l1',
          productName: 'Americana Deluxe',
          quantity: 1,
          priceUsdCents: 1160,
          modifiers: []
        }
      ]);

      const texts = ticket.blocks.map(b => (b as any).text || (b as any).key || '').join(' ');
      expect(texts).toContain('DESGLOSE FISCAL INFORMATIVO');
      expect(texts).toContain('Base Imponible');
      expect(texts).toContain('IVA Estimado (16%)');
      expect(texts).toContain('IGTF Divisas (3%)');

      // Cuando fiscalModuleEnabled está apagado (false): NO debe aparecer desglose fiscal
      const ticketNoFiscal = buildReceiptTicketIR({ ...orderData, fiscalModuleEnabled: false }, []);
      const textsNoFiscal = ticketNoFiscal.blocks.map(b => (b as any).text || (b as any).key || '').join(' ');
      expect(textsNoFiscal).not.toContain('DESGLOSE FISCAL INFORMATIVO');
    });
  });

  // =========================================================================
  // BLOQUE 1: NIVEL 1 — COSTEO DE INSUMOS, RECETAS Y ASISTENTE RÁPIDO
  // =========================================================================
  describe('1. Nivel 1 — Costeo de Insumos y Recetas Dinámicas (costing.ts)', () => {
    it('1.1 Detecta alerta de costo desactualizado (> 30 días) en supply_items', () => {
      // Simular insumo con fecha de actualización vieja (> 30 días)
      const oldTime = Date.now() - (35 * 24 * 60 * 60 * 1000);
      rawDb.prepare('UPDATE supply_items SET updated_at_ms = ? WHERE id = ?').run(oldTime, 'sup_pan_brioche');

      const supplies = getSupplyItems(rawDb);
      const brioche = supplies.find(s => s.id === 'sup_pan_brioche');
      expect(brioche).toBeDefined();
      expect(brioche!.isStaleCost).toBe(true);
      expect(brioche!.daysSinceLastUpdate).toBeGreaterThanOrEqual(35);
    });

    it('1.2 Asistente rápido (bulk-update) actualiza costos y genera historial en supply_cost_history', () => {
      const result = bulkUpdateSupplyCosts(rawDb, [
        { id: 'sup_pan_brioche', costPerUnitUsdCents: 45 }, // sube de 35 a 45
        { id: 'sup_carne_smash', costPerUnitUsdCents: 85 }  // sube de 75 a 85
      ], 'usr_admin_olinelcys');

      expect(result.updatedCount).toBe(2);
      expect(result.historyCount).toBe(2);

      const historyRows = rawDb.prepare(`
        SELECT * FROM supply_cost_history WHERE supply_item_id = 'sup_pan_brioche' ORDER BY changed_at_ms DESC LIMIT 1
      `).get() as any;

      expect(historyRows).toBeDefined();
      expect(historyRows.new_cost_usd_cents).toBe(45);
      expect(historyRows.changed_by_user_id).toBe('usr_admin_olinelcys');
    });

    it('1.3 Calcula costo real de plato con Modificadores (Extra Tocineta, 15¢ Barra Libre y 35¢ Cortesías)', () => {
      // A) Plato con Barra Libre (2 ingredientes: 2 * 15¢ = 30¢) y Extra Tocineta (+30¢ costo interno)
      const costRes = calculateOrderLineRealCost(rawDb, {
        productId: 'prod_texas_mex',
        quantity: 2,
        modifiers: [
          { modifierType: 'EXTRA_INGREDIENTE', ingredientName: 'Extra Tocineta', internalCostUsdCents: 30 },
          { modifierType: 'BARRA_LIBRE', ingredientName: 'Salsa de Ajo' },
          { modifierType: 'BARRA_LIBRE', ingredientName: 'Maíz' }
        ]
      });

      // 2 unidades de Texas Mex:
      // Barra Libre: 2 salsas * 15¢ * 2 unidades = 60¢
      expect(costRes.barraLibreCostUsdCents).toBe(2 * (2 * BARRA_LIBRE_INTERNAL_COST_USD_CENTS));
      // Extra ingrediente: 30¢ * 2 unidades = 60¢
      expect(costRes.extraIngredientsCostUsdCents).toBe(60);
      expect(costRes.totalFoodCostUsdCents).toBe(costRes.baseRecipeCostUsdCents + 60 + 60);

      // B) Ítem de Cortesía (COURTESY_ITEM cupón): 35¢ por cortesía asignados a Marketing
      const courtesyRes = calculateOrderLineRealCost(rawDb, {
        productId: 'prod_cafe_cortesia',
        quantity: 3,
        lineRole: 'COURTESY_ITEM'
      });

      expect(courtesyRes.courtesyMarketingCostUsdCents).toBe(3 * COURTESY_ITEM_INTERNAL_COST_USD_CENTS); // 105¢ = $1.05
      expect(courtesyRes.baseRecipeCostUsdCents).toBe(0); // Excluido del food cost, cargado a marketing
    });
  });

  // =========================================================================
  // BLOQUE 2: NIVEL 2 — INVENTARIO CRÍTICO, DESCUENTO DE MEDALLONES Y AHORRO SIN PAN
  // =========================================================================
  describe('2. Nivel 2 — Inventario Crítico, Descuentos de Carne y Ahorro Sin Pan (inventory.ts)', () => {
    it('2.1 Descuenta medallones exactos: 4 en Americana Deluxe, 3 en Miami, 2 en Texas Mex y 1 en Grill', () => {
      // 1. Limpiar órdenes previas de la jornada de prueba
      rawDb.prepare('DELETE FROM order_lines WHERE order_id IN (SELECT id FROM orders WHERE jornada_id = ?)').run(testJornadaId);
      rawDb.prepare('DELETE FROM orders WHERE jornada_id = ?').run(testJornadaId);

      const orderId = `ord_meat_test_${Date.now()}`;
      rawDb.prepare(`
        INSERT INTO orders (
          id, order_number, jornada_id, created_by_user_id, fulfillment_type,
          fulfillment_status, payment_status, rate_micro_bs,
          net_food_sales_usd_cents, total_to_collect_usd_cents, created_at_ms, updated_at_ms
        ) VALUES (?, 201, ?, 'usr_admin_olinelcys', 'salon', 'entregado', 'pagado', 40000000, 3000, 3000, ?, ?)
      `).run(orderId, testJornadaId, Date.now(), Date.now());

      const insertLine = rawDb.prepare(`
        INSERT INTO order_lines (
          id, order_id, product_id, station, line_role, quantity,
          unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, created_at_ms
        ) VALUES (?, ?, ?, 'hamburguesas', 'STANDARD', ?, 700, 700, 700, ?)
      `);

      // 1 Americana Deluxe (4 medallones)
      insertLine.run(`l_ame_${orderId}`, orderId, 'prod_americana_deluxe', 1, Date.now());
      // 1 Miami (3 medallones)
      insertLine.run(`l_mia_${orderId}`, orderId, 'prod_miami', 1, Date.now());
      // 1 Texas Mex (2 medallones)
      insertLine.run(`l_tex_${orderId}`, orderId, 'prod_texas_mex', 1, Date.now());
      // 1 Grill (1 medallón)
      insertLine.run(`l_gri_${orderId}`, orderId, 'prod_grill', 1, Date.now());

      // Consumo esperado de Carne Smash: 4 + 3 + 2 + 1 = 10 medallones
      // Consumo esperado de Pan Brioche: 1 + 1 + 1 + 1 = 4 panes
      const consumption = calculateTheoreticalConsumption(rawDb, testJornadaId);
      expect(consumption.get('sup_carne_smash')).toBe(10);
      expect(consumption.get('sup_pan_brioche')).toBe(4);
    });

    it('2.2 REGLA SIN PAN: Si la hamburguesa se pidió "Sin Pan / Envuelta en Lechuga", NO descuenta pan brioche', () => {
      const orderId = `ord_sinpan_test_${Date.now()}`;
      rawDb.prepare(`
        INSERT INTO orders (
          id, order_number, jornada_id, created_by_user_id, fulfillment_type,
          fulfillment_status, payment_status, rate_micro_bs,
          net_food_sales_usd_cents, total_to_collect_usd_cents, created_at_ms, updated_at_ms
        ) VALUES (?, 202, ?, 'usr_admin_olinelcys', 'salon', 'entregado', 'pagado', 40000000, 1400, 1400, ?, ?)
      `).run(orderId, testJornadaId, Date.now(), Date.now());

      // Línea de Texas Mex (2 medallones) con instrucción y modificador "Sin Pan / Envuelta en Lechuga"
      const lineId = `l_sp_${orderId}`;
      rawDb.prepare(`
        INSERT INTO order_lines (
          id, order_id, product_id, station, line_role, quantity,
          unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents,
          custom_instructions, created_at_ms
        ) VALUES (?, ?, 'prod_texas_mex', 'hamburguesas', 'STANDARD', 1, 700, 700, 700, 'Sin Pan / Envuelta en Lechuga', ?)
      `).run(lineId, orderId, Date.now());

      rawDb.prepare(`
        INSERT INTO order_line_modifiers (
          id, order_line_id, ingredient_id, ingredient_name, modifier_type, extra_price_usd_cents, internal_cost_usd_cents
        ) VALUES (?, ?, 'ing_base_pan_brioche', 'Sin Pan Brioche', 'SIN_INGREDIENTE', 0, 0)
      `).run(`mod_${lineId}`, lineId);

      const consumption = calculateTheoreticalConsumption(rawDb, testJornadaId);
      // Carne smash aumentó de 10 a 12 (sumó los 2 medallones de la Texas Mex)
      expect(consumption.get('sup_carne_smash')).toBe(12);
      // Pan brioche SE MANTUVO EN 4 (NO descontó pan para esta orden, comprobando el ahorro sin pan)
      expect(consumption.get('sup_pan_brioche')).toBe(4);
    });

    it('2.3 Conciliación de Cierre y Varianza en Unidades y en USD', () => {
      // Resetear stock inicial a 100 para sup_pan_brioche y 150 para sup_carne_smash
      rawDb.prepare("UPDATE supply_items SET current_stock_qty = 100 WHERE id = 'sup_pan_brioche'").run();
      rawDb.prepare("UPDATE supply_items SET current_stock_qty = 150 WHERE id = 'sup_carne_smash'").run();

      // Conciliar inventario comparando físico vs teórico
      const reconcileResult = reconcileCriticalInventory(rawDb, testJornadaId, [
        { supplyItemId: 'sup_pan_brioche', physicalQty: 94 }, // esperados: 100 - 4 = 96 -> faltan 2
        { supplyItemId: 'sup_carne_smash', physicalQty: 138 } // esperados: 150 - 12 = 138 -> exacto (0)
      ], 'usr_admin_olinelcys');

      expect(reconcileResult.items.length).toBe(CRITICAL_SUPPLIES.length);

      const briocheReconcile = reconcileResult.items.find(i => i.supplyItemId === 'sup_pan_brioche');
      expect(briocheReconcile).toBeDefined();
      expect(briocheReconcile!.theoreticalConsumptionQty).toBe(4);
      expect(briocheReconcile!.varianceUnits).toBe(-2); // Faltan 2 unidades
      expect(briocheReconcile!.status).toBe('FALTANTE');
      expect(briocheReconcile!.varianceCostUsdCents).toBeLessThan(0);
    });
  });

  // =========================================================================
  // BLOQUE 3: NIVEL 3 — GASTOS DE CAJA CHICA Y UTILIDAD NETA REAL
  // =========================================================================
  describe('3. Nivel 3 — Caja Chica y Utilidad Neta Real (net-profit.ts)', () => {
    it('3.1 Excluye tarifa de Delivery Modo A y calcula Utilidad Neta con Food Cost, Ubii 0.75% y Gastos', () => {
      // Limpiar mermas y gastos previos de la jornada
      rawDb.prepare('DELETE FROM worker_incidents WHERE jornada_id = ?').run(testJornadaId);
      rawDb.prepare('DELETE FROM operating_expenses WHERE jornada_id = ?').run(testJornadaId);

      // 1. Insertar orden de delivery con comida $10.00 y delivery $2.00
      const orderDeliveryId = `ord_del_profit_${Date.now()}`;
      rawDb.prepare(`
        INSERT INTO orders (
          id, order_number, jornada_id, created_by_user_id, fulfillment_type,
          fulfillment_status, payment_status, rate_micro_bs,
          gross_food_subtotal_usd_cents, discount_usd_cents, delivery_fee_usd_cents,
          net_food_sales_usd_cents, total_to_collect_usd_cents, created_at_ms, updated_at_ms
        ) VALUES (
          ?, 203, ?, 'usr_admin_olinelcys', 'delivery',
          'entregado', 'pagado', 40000000,
          1000, 0, 200,
          1000, 1200, ?, ?
        )
      `).run(orderDeliveryId, testJornadaId, Date.now(), Date.now());

      // Pago con Punto Ubii por Bs 480,00 ($12.00 a 40 Bs/$)
      rawDb.prepare(`
        INSERT INTO payments (
          id, order_id, method, currency, amount_cents, rate_micro_bs,
          usd_equivalent_cents, recorded_by_user_id, created_at_ms
        ) VALUES (?, ?, 'UBII', 'BS', 48000, 40000000, 1200, 'usr_admin_olinelcys', ?)
      `).run(`pay_ubii_${orderDeliveryId}`, orderDeliveryId, Date.now());

      // 2. Registrar gasto de turno en caja chica (Hielo: $5.00)
      createOperatingExpense(rawDb, {
        jornadaId: testJornadaId,
        category: 'HIELO',
        amountUsdCents: 500,
        description: '2 Bolsas de hielo para bebidas',
        authorizedByUserId: 'usr_admin_olinelcys'
      });

      // 3. Registrar merma de alimentos ($1.50)
      rawDb.prepare(`
        INSERT INTO worker_incidents (
          id, jornada_id, user_id, incident_type, description, estimated_loss_usd_cents, created_at_ms
        ) VALUES (?, ?, 'usr_admin_olinelcys', 'MERMA_ALIMENTO', 'Pan caído accidentalmente', 150, ?)
      `).run(`inc_loss_${Date.now()}`, testJornadaId, Date.now());

      // 4. Calcular Utilidad Neta Real
      const profitReport = calculateJornadaNetProfit(rawDb, testJornadaId);

      // Comprobación de exclusión Delivery Modo A:
      expect(profitReport.accountingMode).toBe('THIRD_PARTY_PASS_THROUGH');
      expect(profitReport.deliveryPassThroughExcludedUsdCents).toBe(200); // $2.00 excluidos de ventas comida
      expect(profitReport.netFoodSalesUsdCents).toBeGreaterThanOrEqual(1000);

      // Comprobación de Comisión Bancaria Ubii (0.75% de Bs 480,00 = Bs 3,60 = ~9¢ USD)
      expect(profitReport.ubiiGrossSalesBsCents).toBe(48000);
      expect(profitReport.ubiiFeeBsCents).toBe(Math.round((48000 * 75) / 10000)); // 360 céntimos Bs
      expect(profitReport.ubiiFeeUsdCents).toBeGreaterThan(0);

      // Comprobación de deducción de gastos de turno y mermas
      expect(profitReport.operatingExpensesUsdCents).toBeGreaterThanOrEqual(500);
      expect(profitReport.registeredFoodLossesUsdCents).toBe(150);

      // Utilidad Neta calculada exactamente:
      const expectedNetProfit = profitReport.netFoodSalesUsdCents
        - profitReport.totalFoodCostUsdCents
        - profitReport.couponCourtesiesUsdCents
        - profitReport.registeredFoodLossesUsdCents
        - profitReport.ubiiFeeUsdCents
        - profitReport.operatingExpensesUsdCents;

      expect(profitReport.netProfitUsdCents).toBe(expectedNetProfit);
    });
  });

  // =========================================================================
  // BLOQUE 4: NIVEL 4 — INGENIERÍA DE MENÚ DE KASAVANA & SMITH, ABC Y EQUILIBRIO
  // =========================================================================
  describe('4. Nivel 4 — Ingeniería de Menú de Kasavana & Smith y ABC (menu-engineering.ts)', () => {
    it('4.1 Clasifica platos exactamente en los 4 cuadrantes (Estrella, Caballo de Batalla, Puzzle, Perro)', () => {
      const report = generateMenuEngineeringReport(rawDb, { jornadaId: testJornadaId });

      expect(report.categories.length).toBeGreaterThan(0);

      const burgerCategory = report.categories.find(c => c.categoryId === 'cat_hamburguesas');
      expect(burgerCategory).toBeDefined();

      // Umbrales formales calculados
      const N = burgerCategory!.dishCount;
      expect(burgerCategory!.popularityThreshold).toBe(Number((0.70 * (1 / N)).toFixed(4)));
      expect(burgerCategory!.weightedAverageMarginUsdCents).toBeGreaterThan(0);

      // Validar que cada plato tenga asignado uno de los 4 cuadrantes formales
      const validQuadrants = ['ESTRELLA', 'CABALLO_DE_BATALLA', 'PUZZLE', 'PERRO'];
      for (const dish of burgerCategory!.dishes) {
        expect(validQuadrants).toContain(dish.quadrant);
        expect(dish.recommendation).toBeDefined();
        expect(dish.unitContributionMarginUsdCents).toBe(dish.salePriceUsdCents - dish.recipeCostUsdCents);
      }

      // Alerta estadística activada para muestras pequeñas (< 14 días o < 30 platos)
      expect(report.hasStatisticalWarning).toBe(true);
      expect(report.statisticalWarningMessage).toContain('Muestra estadística preliminar');

      // Análisis ABC: Clasificación A (80%), B (15%), C (5%)
      expect(report.abcSupplies.length).toBeGreaterThan(0);
      for (const abc of report.abcSupplies) {
        expect(['A', 'B', 'C']).toContain(abc.classification);
      }

      // Costo Primo y Punto de Equilibrio
      expect(report.primeCost.primeCostUsdCents).toBeGreaterThan(0);
      expect(report.breakEven.breakEvenSalesUsdCents).toBeGreaterThan(0);
    });
  });
});
