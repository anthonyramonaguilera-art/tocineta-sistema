import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';

export interface SupplyItemRecord {
  id: string;
  name: string;
  unit: string;
  currentStockQty: number;
  minimumStockQty: number;
  costPerUnitUsdCents: number;
  createdAtMs: number;
  updatedAtMs: number;
  isStaleCost: boolean; // Alerta si > 30 días sin actualizar
  daysSinceLastUpdate: number;
}

export interface SupplyBulkUpdateItem {
  id: string;
  costPerUnitUsdCents?: number;
  minimumStockQty?: number;
  currentStockQty?: number;
}

export interface CalculatedLineCost {
  productId: string;
  productName: string;
  quantity: number;
  baseRecipeCostUsdCents: number;
  extraIngredientsCostUsdCents: number;
  barraLibreCostUsdCents: number;
  courtesyMarketingCostUsdCents: number;
  totalFoodCostUsdCents: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const BARRA_LIBRE_INTERNAL_COST_USD_CENTS = 15; // 15¢ por cada ingrediente Barra Libre
export const COURTESY_ITEM_INTERNAL_COST_USD_CENTS = 35; // 35¢ partida Marketing / Fidelización

/**
 * 1. Obtiene la lista de todos los insumos con indicador de costo desactualizado (> 30 días)
 */
export function getSupplyItems(rawDb: Database.Database): SupplyItemRecord[] {
  const now = Date.now();
  const rows = rawDb.prepare(`
    SELECT id, name, unit, current_stock_qty, minimum_stock_qty,
           cost_per_unit_usd_cents, created_at_ms, updated_at_ms
    FROM supply_items
    ORDER BY name ASC
  `).all() as Array<{
    id: string;
    name: string;
    unit: string;
    current_stock_qty: number;
    minimum_stock_qty: number;
    cost_per_unit_usd_cents: number;
    created_at_ms: number;
    updated_at_ms: number;
  }>;

  return rows.map(r => {
    const elapsedMs = now - r.updated_at_ms;
    const daysSince = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
    return {
      id: r.id,
      name: r.name,
      unit: r.unit,
      currentStockQty: r.current_stock_qty,
      minimumStockQty: r.minimum_stock_qty,
      costPerUnitUsdCents: r.cost_per_unit_usd_cents,
      createdAtMs: r.created_at_ms,
      updatedAtMs: r.updated_at_ms,
      isStaleCost: elapsedMs > THIRTY_DAYS_MS,
      daysSinceLastUpdate: Math.max(0, daysSince)
    };
  });
}

/**
 * 2. Asistente de Carga Rápida en Tabla (Bulk Update de Costos)
 * Registra historial en supply_cost_history ante cualquier cambio de costo.
 */
export function bulkUpdateSupplyCosts(
  rawDb: Database.Database,
  updates: SupplyBulkUpdateItem[],
  actorUserId?: string
): { updatedCount: number; historyCount: number } {
  const now = Date.now();
  let updatedCount = 0;
  let historyCount = 0;

  const selectStmt = rawDb.prepare('SELECT cost_per_unit_usd_cents FROM supply_items WHERE id = ?');
  const updateStmt = rawDb.prepare(`
    UPDATE supply_items
    SET cost_per_unit_usd_cents = COALESCE(?, cost_per_unit_usd_cents),
        minimum_stock_qty = COALESCE(?, minimum_stock_qty),
        current_stock_qty = COALESCE(?, current_stock_qty),
        updated_at_ms = ?
    WHERE id = ?
  `);
  const historyStmt = rawDb.prepare(`
    INSERT INTO supply_cost_history (
      id, supply_item_id, old_cost_usd_cents, new_cost_usd_cents, changed_by_user_id, changed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const tx = rawDb.transaction(() => {
    for (const item of updates) {
      const existing = selectStmt.get(item.id) as { cost_per_unit_usd_cents: number } | undefined;
      if (!existing) continue;

      const oldCost = existing.cost_per_unit_usd_cents;
      const newCost = item.costPerUnitUsdCents !== undefined ? item.costPerUnitUsdCents : oldCost;

      updateStmt.run(
        item.costPerUnitUsdCents ?? null,
        item.minimumStockQty ?? null,
        item.currentStockQty ?? null,
        now,
        item.id
      );
      updatedCount++;

      if (item.costPerUnitUsdCents !== undefined && oldCost !== newCost) {
        historyStmt.run(
          `sch_${generateUuidV7()}`,
          item.id,
          oldCost,
          newCost,
          actorUserId || null,
          now
        );
        historyCount++;
      }
    }
  });

  tx();
  return { updatedCount, historyCount };
}

/**
 * 3. Cálculo de Costo Real de Receta por Plato Vendido considerando Modificadores
 * - Si pidió Extra Tocineta u otro extra: suma el costo interno del insumo.
 * - Si pidió Barra Libre ($0.00 venta): suma los 15¢ de costo interno por cada selección.
 * - Si canjeó un cupón COURTESY_ITEM (ej. Café o Snacks $0.00): 35¢ reportado a Marketing / Fidelización.
 */
export function calculateOrderLineRealCost(
  rawDb: Database.Database,
  line: {
    productId: string;
    quantity: number;
    lineRole?: string;
    modifiers?: Array<{
      modifierType: string;
      ingredientId?: string | null;
      ingredientName?: string;
      extraPriceUsdCents?: number;
      internalCostUsdCents?: number;
    }>;
  }
): CalculatedLineCost {
  const prod = rawDb.prepare(`
    SELECT name, estimated_cost_usd_cents
    FROM products
    WHERE id = ?
  `).get(line.productId) as { name: string; estimated_cost_usd_cents: number } | undefined;

  const productName = prod?.name || 'Plato';
  const qty = line.quantity || 1;

  // 1. Costo base de la receta desde recipe_items (o fallback al estimated_cost de products)
  const recipeRows = rawDb.prepare(`
    SELECT ri.quantity_required, si.cost_per_unit_usd_cents
    FROM recipes r
    JOIN recipe_items ri ON r.id = ri.recipe_id
    JOIN supply_items si ON ri.supply_item_id = si.id
    WHERE r.product_id = ?
  `).all(line.productId) as Array<{
    quantity_required: number;
    cost_per_unit_usd_cents: number;
  }>;

  let unitBaseRecipeCost = 0;
  if (recipeRows.length > 0) {
    for (const ri of recipeRows) {
      unitBaseRecipeCost += Math.round(ri.quantity_required * ri.cost_per_unit_usd_cents);
    }
  } else {
    unitBaseRecipeCost = prod?.estimated_cost_usd_cents || 0;
  }

  // 2. Modificadores
  let unitExtraCost = 0;
  let unitBarraLibreCost = 0;
  let courtesyMarketingCost = 0;

  if (line.lineRole === 'COURTESY_ITEM') {
    // Si es un obsequio de cupón (Café o Snacks), su costo interno es 35¢ por unidad
    courtesyMarketingCost = (COURTESY_ITEM_INTERNAL_COST_USD_CENTS * qty);
    unitBaseRecipeCost = 0; // Se contabiliza en partida de marketing
  }

  if (line.modifiers && line.modifiers.length > 0) {
    for (const mod of line.modifiers) {
      if (mod.modifierType === 'EXTRA_INGREDIENTE') {
        // Costo del ingrediente extra
        unitExtraCost += (mod.internalCostUsdCents ?? 30);
      } else if (mod.modifierType === 'BARRA_LIBRE') {
        // Barra Libre: 15¢ por ingrediente de cortesía
        unitBarraLibreCost += BARRA_LIBRE_INTERNAL_COST_USD_CENTS;
      }
    }
  }

  const baseRecipeTotal = unitBaseRecipeCost * qty;
  const extraTotal = unitExtraCost * qty;
  const barraLibreTotal = unitBarraLibreCost * qty;
  const totalFoodCost = baseRecipeTotal + extraTotal + barraLibreTotal;

  return {
    productId: line.productId,
    productName,
    quantity: qty,
    baseRecipeCostUsdCents: baseRecipeTotal,
    extraIngredientsCostUsdCents: extraTotal,
    barraLibreCostUsdCents: barraLibreTotal,
    courtesyMarketingCostUsdCents: courtesyMarketingCost,
    totalFoodCostUsdCents: totalFoodCost
  };
}
