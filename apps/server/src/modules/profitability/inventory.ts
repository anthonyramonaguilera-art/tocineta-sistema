import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';

export interface CriticalSupplySeed {
  id: string;
  name: string;
  unit: string;
  costPerUnitUsdCents: number;
  initialStock: number;
  minimumStock: number;
}

export const CRITICAL_SUPPLIES: CriticalSupplySeed[] = [
  { id: 'sup_pan_brioche', name: 'Pan Brioche Hamburguesa', unit: 'unid', costPerUnitUsdCents: 35, initialStock: 100, minimumStock: 25 },
  { id: 'sup_pan_perro', name: 'Pan de Perro Caliente', unit: 'unid', costPerUnitUsdCents: 25, initialStock: 100, minimumStock: 25 },
  { id: 'sup_carne_smash', name: 'Medallón Carne Prime Smash', unit: 'unid', costPerUnitUsdCents: 70, initialStock: 150, minimumStock: 40 },
  { id: 'sup_salchicha_pollo', name: 'Salchicha Nacional de Pollo', unit: 'unid', costPerUnitUsdCents: 40, initialStock: 100, minimumStock: 30 },
  { id: 'sup_salchicha_polaca', name: 'Salchicha Polaca', unit: 'unid', costPerUnitUsdCents: 60, initialStock: 40, minimumStock: 15 },
  { id: 'sup_pechuga_pollo', name: 'Pechuga de Pollo Crispy/Grill', unit: 'unid', costPerUnitUsdCents: 80, initialStock: 50, minimumStock: 15 },
  { id: 'sup_malta_lata', name: 'Malta Lata 250 ml', unit: 'unid', costPerUnitUsdCents: 65, initialStock: 48, minimumStock: 12 },
  { id: 'sup_refresco_1lt', name: 'Refresco 1 Litro', unit: 'unid', costPerUnitUsdCents: 90, initialStock: 36, minimumStock: 10 }
];

export interface InventoryItemReconciliation {
  supplyItemId: string;
  supplyName: string;
  unit: string;
  unitCostUsdCents: number;
  initialStockQty: number;
  inflowsQty: number;
  theoreticalConsumptionQty: number;
  lossesQty: number;
  expectedTheoreticalStockQty: number;
  physicalCountQty: number;
  varianceUnits: number; // physical - expected
  varianceCostUsdCents: number; // varianceUnits * unitCost
  status: 'OPTIMO' | 'FALTANTE' | 'SOBRANTE';
}

/**
 * 1. Siembra o actualiza los 8 insumos críticos de alta rotación y sus recetas técnicas oficiales
 */
export function seedCriticalSuppliesAndRecipes(rawDb: Database.Database): void {
  const now = Date.now();

  const tx = rawDb.transaction(() => {
    // 1. Sembrar los 8 insumos críticos en supply_items
    const insertSupply = rawDb.prepare(`
      INSERT OR REPLACE INTO supply_items (
        id, name, unit, current_stock_qty, minimum_stock_qty, cost_per_unit_usd_cents, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const sup of CRITICAL_SUPPLIES) {
      // Verificar si ya existe para no sobreescribir el stock actual en caliente si ya fue modificado
      const existing = rawDb.prepare('SELECT current_stock_qty FROM supply_items WHERE id = ?').get(sup.id) as any;
      const stock = existing ? existing.current_stock_qty : sup.initialStock;
      insertSupply.run(sup.id, sup.name, sup.unit, stock, sup.minimumStock, sup.costPerUnitUsdCents, now, now);
    }

    // 2. Asegurar que Americana Deluxe exista en products
    rawDb.prepare(`
      INSERT OR IGNORE INTO products (
        id, category_id, name, description, price_usd_cents, estimated_cost_usd_cents,
        station, is_active, is_combo, allows_flavors, image_url, created_at_ms, updated_at_ms
      ) VALUES (
        'prod_americana_deluxe', 'cat_hamburguesas', 'Americana Deluxe',
        '4 medallones smash prime con queso cheddar y tocineta', 890, 315,
        'hamburguesas', 1, 0, 0, NULL, ?, ?
      )
    `).run(now, now);

    // 3. Crear o actualizar Recetas Técnicas (recipes y recipe_items)
    const insertRecipe = rawDb.prepare(`
      INSERT OR REPLACE INTO recipes (id, product_id, name, notes)
      VALUES (?, ?, ?, ?)
    `);

    const insertRecipeItem = rawDb.prepare(`
      INSERT OR REPLACE INTO recipe_items (id, recipe_id, supply_item_id, quantity_required)
      VALUES (?, ?, ?, ?)
    `);

    // Definición de las reglas exactas de recetas de Tocineta Sonríe
    interface RecipeDef {
      productId: string;
      productName: string;
      items: Array<{ supplyId: string; qty: number }>;
    }

    const recipesData: RecipeDef[] = [
      // HAMBURGUESAS (Medallones según especificación exacta de Tocineta Sonríe)
      // Americana Deluxe: 4 medallones
      { productId: 'prod_americana_deluxe', productName: 'Americana Deluxe', items: [{ supplyId: 'sup_pan_brioche', qty: 1 }, { supplyId: 'sup_carne_smash', qty: 4 }] },
      // Miami: 3 medallones
      { productId: 'prod_miami', productName: 'Miami', items: [{ supplyId: 'sup_pan_brioche', qty: 1 }, { supplyId: 'sup_carne_smash', qty: 3 }] },
      // Texas Mex, New York, Mozarrella, Doble Smash: 2 medallones
      { productId: 'prod_texas_mex', productName: 'Texas Mex', items: [{ supplyId: 'sup_pan_brioche', qty: 1 }, { supplyId: 'sup_carne_smash', qty: 2 }] },
      { productId: 'prod_new_york', productName: 'New York', items: [{ supplyId: 'sup_pan_brioche', qty: 1 }, { supplyId: 'sup_carne_smash', qty: 2 }] },
      { productId: 'prod_mozarrella', productName: 'Mozarrella', items: [{ supplyId: 'sup_pan_brioche', qty: 1 }, { supplyId: 'sup_carne_smash', qty: 2 }] },
      { productId: 'prod_doble_smash', productName: 'Doble Smash', items: [{ supplyId: 'sup_pan_brioche', qty: 1 }, { supplyId: 'sup_carne_smash', qty: 2 }] },
      // Grill, Nuggets Meat, Smash Clásica, Kids Burger: 1 medallón
      { productId: 'prod_grill', productName: 'Grill', items: [{ supplyId: 'sup_pan_brioche', qty: 1 }, { supplyId: 'sup_carne_smash', qty: 1 }] },
      { productId: 'prod_nuggets_meat', productName: 'Nuggets Meat', items: [{ supplyId: 'sup_pan_brioche', qty: 1 }, { supplyId: 'sup_carne_smash', qty: 1 }] },
      { productId: 'prod_smash_clasica', productName: 'Smash Clásica', items: [{ supplyId: 'sup_pan_brioche', qty: 1 }, { supplyId: 'sup_carne_smash', qty: 1 }] },
      { productId: 'prod_kids_burger', productName: 'Kids Burger', items: [{ supplyId: 'sup_pan_brioche', qty: 1 }, { supplyId: 'sup_carne_smash', qty: 1 }] },
      // Pechuga César: 1 pechuga de pollo crispy/grill
      { productId: 'prod_pechuga_cesar', productName: 'Pechuga César', items: [{ supplyId: 'sup_pan_brioche', qty: 1 }, { supplyId: 'sup_pechuga_pollo', qty: 1 }] },

      // HOT DOGS
      // Street Dog y perros estándar: 1 pan de perro + 1 salchicha pollo
      { productId: 'prod_street_dog', productName: 'Street Dog', items: [{ supplyId: 'sup_pan_perro', qty: 1 }, { supplyId: 'sup_salchicha_pollo', qty: 1 }] },
      { productId: 'prod_classic_dog', productName: 'Classic Dog', items: [{ supplyId: 'sup_pan_perro', qty: 1 }, { supplyId: 'sup_salchicha_pollo', qty: 1 }] },
      { productId: 'prod_brazil_dog', productName: 'Brazil Dog', items: [{ supplyId: 'sup_pan_perro', qty: 1 }, { supplyId: 'sup_salchicha_pollo', qty: 1 }] },
      { productId: 'prod_doritos_dog_snacks', productName: 'Doritos Dog Snacks', items: [{ supplyId: 'sup_pan_perro', qty: 1 }, { supplyId: 'sup_salchicha_pollo', qty: 1 }] },
      { productId: 'prod_jalapenos_dog', productName: 'Jalapeños Dog', items: [{ supplyId: 'sup_pan_perro', qty: 1 }, { supplyId: 'sup_salchicha_pollo', qty: 1 }] },
      { productId: 'prod_tocineta_dog_parmesano', productName: 'Tocineta Dog Parmesano', items: [{ supplyId: 'sup_pan_perro', qty: 1 }, { supplyId: 'sup_salchicha_pollo', qty: 1 }] },
      // Doble Salchicha Dog: 1 pan de perro + 2 salchichas pollo
      { productId: 'prod_doble_salchicha_dog', productName: 'Doble Salchicha Dog', items: [{ supplyId: 'sup_pan_perro', qty: 1 }, { supplyId: 'sup_salchicha_pollo', qty: 2 }] },

      // BEBIDAS
      { productId: 'prod_malta_lata_250', productName: 'Malta Lata 250 ml', items: [{ supplyId: 'sup_malta_lata', qty: 1 }] },
      { productId: 'prod_refresco_1lt', productName: 'Refresco 1 Litro', items: [{ supplyId: 'sup_refresco_1lt', qty: 1 }] }
    ];

    for (const rDef of recipesData) {
      const recId = `rec_${rDef.productId}`;
      insertRecipe.run(recId, rDef.productId, rDef.productName, null);

      // Limpiar ítems anteriores de la receta
      rawDb.prepare('DELETE FROM recipe_items WHERE recipe_id = ?').run(recId);

      for (let i = 0; i < rDef.items.length; i++) {
        const itm = rDef.items[i];
        insertRecipeItem.run(`ri_${recId}_${itm.supplyId}`, recId, itm.supplyId, itm.qty);
      }
    }
  });

  tx();
}

/**
 * 2. Calcula el Consumo Teórico de Insumos Críticos para una Jornada
 * Aplica la regla estricta:
 * Si la hamburguesa se pidió "Sin Pan / Envuelta en Lechuga", NO descuenta pan brioche del consumo teórico.
 */
export function calculateTheoreticalConsumption(
  rawDb: Database.Database,
  jornadaId: string
): Map<string, number> {
  const consumptionMap = new Map<string, number>();
  for (const s of CRITICAL_SUPPLIES) {
    consumptionMap.set(s.id, 0);
  }

  // Consultar todas las líneas vendidas (no anuladas) de la jornada
  // Excluimos COMBO_PARENT porque sus hijos COMBO_CHILD contienen los ítems desglosados
  const lines = rawDb.prepare(`
    SELECT ol.id, ol.product_id, ol.line_role, ol.quantity, ol.custom_instructions
    FROM order_lines ol
    JOIN orders o ON ol.order_id = o.id
    WHERE o.jornada_id = ?
      AND o.fulfillment_status != 'anulado'
      AND ol.line_role IN ('STANDARD', 'COMBO_CHILD')
  `).all(jornadaId) as Array<{
    id: string;
    product_id: string;
    line_role: string;
    quantity: number;
    custom_instructions: string | null;
  }>;

  // Modificadores de exclusión para detectar "Sin Pan" o "Envuelta en Lechuga"
  const getModifiersStmt = rawDb.prepare(`
    SELECT ingredient_id, ingredient_name, modifier_type
    FROM order_line_modifiers
    WHERE order_line_id = ?
  `);

  // Recetas pre-cargadas
  const getRecipeItemsStmt = rawDb.prepare(`
    SELECT ri.supply_item_id, ri.quantity_required
    FROM recipes r
    JOIN recipe_items ri ON r.id = ri.recipe_id
    WHERE r.product_id = ?
  `);

  for (const line of lines) {
    const qty = line.quantity || 1;
    const mods = getModifiersStmt.all(line.id) as Array<{
      ingredient_id: string | null;
      ingredient_name: string;
      modifier_type: string;
    }>;

    // Regla especial: Verificar si se pidió "Sin Pan" o "Envuelta en Lechuga"
    const isSinPan = mods.some(m =>
      m.modifier_type === 'SIN_INGREDIENTE' &&
      (m.ingredient_id === 'ing_base_pan_brioche' || m.ingredient_id === 'ing_base_pan_perro' ||
       /pan/i.test(m.ingredient_name))
    ) || (line.custom_instructions ? /sin pan|lechuga|envuelta/i.test(line.custom_instructions) : false);

    const recipeItems = getRecipeItemsStmt.all(line.product_id) as Array<{
      supply_item_id: string;
      quantity_required: number;
    }>;

    for (const ri of recipeItems) {
      // Si la hamburguesa o perro se pidió Sin Pan, no descontar Pan Brioche ni Pan de Perro
      if (isSinPan && (ri.supply_item_id === 'sup_pan_brioche' || ri.supply_item_id === 'sup_pan_perro')) {
        continue; // Ahorro de pan verificado
      }

      const current = consumptionMap.get(ri.supply_item_id) || 0;
      consumptionMap.set(ri.supply_item_id, current + (ri.quantity_required * qty));
    }
  }

  return consumptionMap;
}

/**
 * 3. Conciliación y Varianza de Cierre de Inventario Crítico
 * Compara Stock Teórico Esperado vs Conteo Físico Real
 * Formula:
 * Expected = Initial Stock + Inflows - Theoretical Consumption - Registered Losses
 * Variance = Physical - Expected
 */
export function reconcileCriticalInventory(
  rawDb: Database.Database,
  jornadaId: string,
  physicalCounts: Array<{ supplyItemId: string; physicalQty: number }>,
  countedByUserId?: string
): {
  jornadaId: string;
  reconciledAtMs: number;
  items: InventoryItemReconciliation[];
  totalVarianceUsdCents: number;
} {
  const now = Date.now();
  seedCriticalSuppliesAndRecipes(rawDb);

  const theoreticalConsumption = calculateTheoreticalConsumption(rawDb, jornadaId);

  // Consultar entradas registradas en la jornada
  const inflowsRows = rawDb.prepare(`
    SELECT supply_item_id, COALESCE(SUM(quantity), 0) as total_inflow
    FROM supply_inflows
    WHERE jornada_id = ?
    GROUP BY supply_item_id
  `).all(jornadaId) as Array<{ supply_item_id: string; total_inflow: number }>;

  const inflowsMap = new Map<string, number>();
  for (const inf of inflowsRows) {
    inflowsMap.set(inf.supply_item_id, inf.total_inflow);
  }

  // Consultar mermas registradas en la jornada (worker_incidents)
  // Las mermas de insumos se estiman o se vinculan si hay registro
  const lossesRows = rawDb.prepare(`
    SELECT description, estimated_loss_usd_cents
    FROM worker_incidents
    WHERE jornada_id = ? AND incident_type = 'MERMA_ALIMENTO'
  `).all(jornadaId) as Array<{ description: string; estimated_loss_usd_cents: number }>;

  const lossesBySupply = new Map<string, number>();
  for (const l of lossesRows) {
    for (const sup of CRITICAL_SUPPLIES) {
      if (l.description.toLowerCase().includes(sup.name.toLowerCase())) {
        const unitsLost = Math.max(1, Math.round(l.estimated_loss_usd_cents / sup.costPerUnitUsdCents));
        lossesBySupply.set(sup.id, (lossesBySupply.get(sup.id) || 0) + unitsLost);
      }
    }
  }

  const physicalMap = new Map<string, number>();
  for (const pc of physicalCounts) {
    physicalMap.set(pc.supplyItemId, pc.physicalQty);
  }

  const results: InventoryItemReconciliation[] = [];
  let totalVarianceUsdCents = 0;

  const insertStockCountStmt = rawDb.prepare(`
    INSERT INTO stock_counts (
      id, jornada_id, counted_by_user_id, supply_item_id,
      system_qty, physical_qty, difference_qty, difference_cost_usd_cents, counted_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = rawDb.transaction(() => {
    for (const sup of CRITICAL_SUPPLIES) {
      const supplyRow = rawDb.prepare('SELECT current_stock_qty, cost_per_unit_usd_cents FROM supply_items WHERE id = ?').get(sup.id) as any;
      const initialStock = supplyRow?.current_stock_qty ?? sup.initialStock;
      const unitCost = supplyRow?.cost_per_unit_usd_cents ?? sup.costPerUnitUsdCents;

      const inflows = inflowsMap.get(sup.id) || 0;
      const consumption = theoreticalConsumption.get(sup.id) || 0;
      const losses = lossesBySupply.get(sup.id) || 0;

      const expectedTheoretical = initialStock + inflows - consumption - losses;
      const physical = physicalMap.has(sup.id) ? physicalMap.get(sup.id)! : expectedTheoretical;

      const varianceUnits = physical - expectedTheoretical;
      const varianceCostUsdCents = Math.round(varianceUnits * unitCost);
      totalVarianceUsdCents += varianceCostUsdCents;

      let status: 'OPTIMO' | 'FALTANTE' | 'SOBRANTE' = 'OPTIMO';
      if (varianceUnits < 0) status = 'FALTANTE';
      else if (varianceUnits > 0) status = 'SOBRANTE';

      results.push({
        supplyItemId: sup.id,
        supplyName: sup.name,
        unit: sup.unit,
        unitCostUsdCents: unitCost,
        initialStockQty: initialStock,
        inflowsQty: inflows,
        theoreticalConsumptionQty: consumption,
        lossesQty: losses,
        expectedTheoreticalStockQty: expectedTheoretical,
        physicalCountQty: physical,
        varianceUnits,
        varianceCostUsdCents,
        status
      });

      // Guardar conteo físico en tabla stock_counts
      insertStockCountStmt.run(
        `sc_${generateUuidV7()}`,
        jornadaId,
        countedByUserId || 'usr_admin_olinelcys',
        sup.id,
        expectedTheoretical,
        physical,
        varianceUnits,
        varianceCostUsdCents,
        now
      );

      // Actualizar el stock actual en supply_items al conteo físico verificado
      rawDb.prepare('UPDATE supply_items SET current_stock_qty = ?, updated_at_ms = ? WHERE id = ?').run(
        physical,
        now,
        sup.id
      );
    }
  });

  tx();

  return {
    jornadaId,
    reconciledAtMs: now,
    items: results,
    totalVarianceUsdCents
  };
}
