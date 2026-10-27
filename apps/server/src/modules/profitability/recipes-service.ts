import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';

export interface SubRecipeRecord {
  id: string;
  name: string;
  yieldQuantity: number;
  yieldUnit: string;
  costPerUnitUsdCents: number;
  notes?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  items: Array<{
    id: string;
    supplyId: string;
    supplyName: string;
    supplyUnit: string;
    quantityRequired: number;
    unitCostUsdCents: number;
    subtotalCostUsdCents: number;
  }>;
}

export interface RecipeItemDef {
  id?: string;
  supplyItemId?: string | null;
  supplyId?: string | null;
  subRecipeId?: string | null;
  quantityRequired: number;
  grossWeightGrams?: number | null;
  shrinkagePercentage?: number | null;
}

export interface ProductRecipeDetail {
  productId: string;
  productName: string;
  station: string;
  recipeMode: 'UNITS' | 'GRAMMAGE' | 'FINISHED_PRODUCT';
  targetMarginBps: number;
  currentPriceUsdCents: number;
  calculatedCostUsdCents: number;
  currentMarginBps: number;
  suggestedPriceUsdCents: number;
  notes?: string | null;
  items: Array<{
    id: string;
    supplyItemId?: string | null;
    supplyName?: string | null;
    supplyUnit?: string | null;
    subRecipeId?: string | null;
    subRecipeName?: string | null;
    quantityRequired: number;
    grossWeightGrams?: number | null;
    shrinkagePercentage?: number | null;
    unitCostUsdCents: number;
    totalCostUsdCents: number;
  }>;
}

// ----------------------------------------------------------------------------
// 1. SUB-RECETAS (Preparaciones con Rendimiento)
// ----------------------------------------------------------------------------

export function getSubRecipes(rawDb: Database.Database): SubRecipeRecord[] {
  const subRecipesRows = rawDb.prepare('SELECT * FROM sub_recipes ORDER BY name ASC').all() as any[];
  const results: SubRecipeRecord[] = [];

  for (const sr of subRecipesRows) {
    const itemsRows = rawDb.prepare(`
      SELECT sri.id, sri.supply_id, sri.quantity_required,
             s.name as supply_name, s.unit as supply_unit,
             COALESCE(s.weighted_avg_cost_usd_cents, s.cost_per_unit_usd_cents, 0) as unit_cost
      FROM sub_recipe_items sri
      JOIN supply_items s ON sri.supply_id = s.id
      WHERE sri.sub_recipe_id = ?
    `).all(sr.id) as any[];

    let totalSubRecipeCostCents = 0;
    const items = itemsRows.map(it => {
      const subtotal = Math.round(it.quantity_required * it.unit_cost);
      totalSubRecipeCostCents += subtotal;
      return {
        id: it.id,
        supplyId: it.supply_id,
        supplyName: it.supply_name,
        supplyUnit: it.supply_unit,
        quantityRequired: it.quantity_required,
        unitCostUsdCents: it.unit_cost,
        subtotalCostUsdCents: subtotal
      };
    });

    const yieldQty = sr.yield_quantity > 0 ? sr.yield_quantity : 1;
    const unitCost = Math.round(totalSubRecipeCostCents / yieldQty);

    results.push({
      id: sr.id,
      name: sr.name,
      yieldQuantity: sr.yield_quantity,
      yieldUnit: sr.yield_unit,
      costPerUnitUsdCents: unitCost,
      notes: sr.notes,
      createdAtMs: sr.created_at_ms,
      updatedAtMs: sr.updated_at_ms,
      items
    });
  }

  return results;
}

export function saveSubRecipe(
  rawDb: Database.Database,
  input: {
    id?: string;
    name: string;
    yieldQuantity: number;
    yieldUnit: string;
    notes?: string;
    items: Array<{ supplyId: string; quantityRequired: number }>;
  }
): SubRecipeRecord {
  const now = Date.now();
  const subRecipeId = input.id || `subrec_${generateUuidV7()}`;

  const tx = rawDb.transaction(() => {
    rawDb.prepare(`
      INSERT INTO sub_recipes (id, name, yield_quantity, yield_unit, notes, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        yield_quantity = excluded.yield_quantity,
        yield_unit = excluded.yield_unit,
        notes = excluded.notes,
        updated_at_ms = excluded.updated_at_ms
    `).run(subRecipeId, input.name.trim(), input.yieldQuantity, input.yieldUnit, input.notes || null, now, now);

    rawDb.prepare('DELETE FROM sub_recipe_items WHERE sub_recipe_id = ?').run(subRecipeId);

    const insertItemStmt = rawDb.prepare(`
      INSERT INTO sub_recipe_items (id, sub_recipe_id, supply_id, quantity_required)
      VALUES (?, ?, ?, ?)
    `);

    for (const it of input.items) {
      insertItemStmt.run(`sri_${generateUuidV7()}`, subRecipeId, it.supplyId, it.quantityRequired);
    }
  });

  tx();
  const list = getSubRecipes(rawDb);
  return list.find(s => s.id === subRecipeId)!;
}

// ----------------------------------------------------------------------------
// 2. RECETAS DE PRODUCTOS (3 MODOS, COSTO EN VIVO, MARGEN Y PRECIO SUGERIDO)
// ----------------------------------------------------------------------------

export function getProductRecipe(rawDb: Database.Database, productId: string): ProductRecipeDetail | null {
  const product = rawDb.prepare(`
    SELECT id, name, station, price_usd_cents,
           COALESCE(recipe_mode, 'UNITS') as recipe_mode,
           COALESCE(target_margin_bps, 6500) as target_margin_bps
    FROM products
    WHERE id = ?
  `).get(productId) as any;

  if (!product) return null;

  const recipe = rawDb.prepare('SELECT * FROM recipes WHERE product_id = ?').get(productId) as any;

  const rawItems = recipe
    ? (rawDb.prepare(`
        SELECT ri.*,
               s.name as supply_name, s.unit as supply_unit,
               COALESCE(s.weighted_avg_cost_usd_cents, s.cost_per_unit_usd_cents, 0) as supply_unit_cost,
               sr.name as sub_recipe_name, sr.cost_per_unit_usd_cents as sub_recipe_unit_cost
        FROM recipe_items ri
        LEFT JOIN supply_items s ON ri.supply_item_id = s.id
        LEFT JOIN sub_recipes sr ON ri.sub_recipe_id = sr.id
        WHERE ri.recipe_id = ?
      `).all(recipe.id) as any[])
    : [];

  let totalCostCents = 0;
  const items = rawItems.map(ri => {
    let itemUnitCost = 0;
    let itemTotalCost = 0;

    if (ri.sub_recipe_id) {
      // Sub-receta
      itemUnitCost = ri.sub_recipe_unit_cost || 0;
      itemTotalCost = Math.round(ri.quantity_required * itemUnitCost);
    } else {
      // Insumo normal o por gramaje
      itemUnitCost = ri.supply_unit_cost || 0;
      if (product.recipe_mode === 'GRAMMAGE' && ri.gross_weight_grams) {
        // En gramaje, si el insumo está en kg (costo por kg), convertir gramos
        // Si unit_measure es kg, unitCost es por 1000g
        const weightGrams = ri.gross_weight_grams;
        const shrinkageFactor = 1 + ((ri.shrinkage_percentage || 0) / 100);
        const actualGrossNeeded = weightGrams * shrinkageFactor;
        itemTotalCost = Math.round((actualGrossNeeded / 1000) * itemUnitCost);
      } else {
        itemTotalCost = Math.round(ri.quantity_required * itemUnitCost);
      }
    }

    totalCostCents += itemTotalCost;

    return {
      id: ri.id,
      supplyItemId: ri.supply_item_id,
      supplyName: ri.supply_name,
      supplyUnit: ri.supply_unit,
      subRecipeId: ri.sub_recipe_id,
      subRecipeName: ri.sub_recipe_name,
      quantityRequired: ri.quantity_required,
      grossWeightGrams: ri.gross_weight_grams,
      shrinkagePercentage: ri.shrinkage_percentage,
      unitCostUsdCents: itemUnitCost,
      totalCostUsdCents: itemTotalCost
    };
  });

  // Si es FINISHED_PRODUCT y no tiene recipe_items, calcular costo directo del insumo espejo si existe
  if (product.recipe_mode === 'FINISHED_PRODUCT' && totalCostCents === 0) {
    const mirrorSupply = rawDb.prepare('SELECT cost_per_unit_usd_cents, weighted_avg_cost_usd_cents FROM supply_items WHERE id = ? OR id = ?').get(`sup_${product.id.replace('prod_', '')}`, product.id) as any;
    if (mirrorSupply) {
      totalCostCents = mirrorSupply.weighted_avg_cost_usd_cents || mirrorSupply.cost_per_unit_usd_cents || 0;
    }
  }

  const currentPrice = product.price_usd_cents;
  const currentMarginBps = currentPrice > 0
    ? Math.round(((currentPrice - totalCostCents) / currentPrice) * 10000)
    : 0;

  const targetMarginBps = product.target_margin_bps || 6500;
  const marginRatio = (10000 - targetMarginBps) / 10000;
  const suggestedPrice = marginRatio > 0 && totalCostCents > 0
    ? Math.ceil(totalCostCents / marginRatio)
    : currentPrice;

  return {
    productId: product.id,
    productName: product.name,
    station: product.station,
    recipeMode: product.recipe_mode,
    targetMarginBps,
    currentPriceUsdCents: currentPrice,
    calculatedCostUsdCents: totalCostCents,
    currentMarginBps,
    suggestedPriceUsdCents: suggestedPrice,
    notes: recipe?.notes || null,
    items
  };
}

export function getAllProductRecipes(rawDb: Database.Database): ProductRecipeDetail[] {
  const prods = rawDb.prepare('SELECT id FROM products WHERE is_active = 1 ORDER BY name ASC').all() as any[];
  const list: ProductRecipeDetail[] = [];
  for (const p of prods) {
    const detail = getProductRecipe(rawDb, p.id);
    if (detail) list.push(detail);
  }
  return list;
}

export function saveProductRecipe(
  rawDb: Database.Database,
  productId: string,
  input: {
    recipeMode?: 'UNITS' | 'GRAMMAGE' | 'FINISHED_PRODUCT';
    targetMarginBps?: number;
    notes?: string;
    items: RecipeItemDef[];
  }
): ProductRecipeDetail {
  const now = Date.now();
  const tx = rawDb.transaction(() => {
    if (input.recipeMode || input.targetMarginBps !== undefined) {
      const mode = input.recipeMode || 'UNITS';
      const margin = input.targetMarginBps ?? 6500;
      rawDb.prepare('UPDATE products SET recipe_mode = ?, target_margin_bps = ?, updated_at_ms = ? WHERE id = ?').run(
        mode,
        margin,
        now,
        productId
      );
    }

    const recipe = rawDb.prepare('SELECT id FROM recipes WHERE product_id = ?').get(productId) as any;
    let recipeId = recipe?.id;

    if (!recipeId) {
      recipeId = `rec_${generateUuidV7()}`;
      rawDb.prepare('INSERT INTO recipes (id, product_id, name, notes) VALUES (?, ?, ?, ?)').run(
        recipeId,
        productId,
        productId,
        input.notes || null
      );
    } else if (input.notes !== undefined) {
      rawDb.prepare('UPDATE recipes SET notes = ? WHERE id = ?').run(input.notes || null, recipeId);
    }

    rawDb.prepare('DELETE FROM recipe_items WHERE recipe_id = ?').run(recipeId);

    const insertItem = rawDb.prepare(`
      INSERT INTO recipe_items (id, recipe_id, supply_item_id, sub_recipe_id, quantity_required, gross_weight_grams, shrinkage_percentage)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const it of input.items) {
      insertItem.run(
        `ritem_${generateUuidV7()}`,
        recipeId,
        it.supplyItemId || it.supplyId || null,
        it.subRecipeId || null,
        it.quantityRequired || 1,
        it.grossWeightGrams || null,
        it.shrinkagePercentage || 0
      );
    }

    // Actualizar el estimated_cost_usd_cents en products
    const detail = getProductRecipe(rawDb, productId);
    if (detail) {
      rawDb.prepare('UPDATE products SET estimated_cost_usd_cents = ? WHERE id = ?').run(
        detail.calculatedCostUsdCents,
        productId
      );
    }
  });

  tx();
  return getProductRecipe(rawDb, productId)!;
}

// ----------------------------------------------------------------------------
// 3. DESCUENTO ATÓMICO EN FACTURACIÓN CON MODIFICADORES Y SUB-RECETAS
// ----------------------------------------------------------------------------

export interface DeductionItem {
  supplyId: string;
  quantityToDeduct: number;
}

/**
 * Deduce atómicamente el stock en la sede de la venta al cerrar/pagar el pedido.
 * Debe invocarse dentro de la transacción payTx de cobro.
 */
export function deductInventoryForOrder(
  rawDb: Database.Database,
  orderId: string,
  locationId: string,
  now: number,
  cashierUserId: string
): void {
  const order = rawDb.prepare('SELECT order_number FROM orders WHERE id = ?').get(orderId) as any;
  const orderNum = order?.order_number || 0;

  // 1. Obtener renglones de la orden (sin los combos padres abstractos)
  const lines = rawDb.prepare(`
    SELECT ol.id, ol.product_id, ol.quantity, p.recipe_mode
    FROM order_lines ol
    JOIN products p ON ol.product_id = p.id
    WHERE ol.order_id = ? AND ol.line_role != 'COMBO_PARENT'
  `).all(orderId) as any[];

  const deductions = new Map<string, number>();

  const addDeduction = (supplyId: string, qty: number) => {
    if (!supplyId || qty === 0) return;
    const current = deductions.get(supplyId) || 0;
    deductions.set(supplyId, current + qty);
  };

  for (const line of lines) {
    const qty = line.quantity || 1;
    const mode = line.recipe_mode || 'UNITS';

    if (mode === 'FINISHED_PRODUCT') {
      // Plato terminado: descontar insumo directo espejo
      const candidateId = `sup_${line.product_id.replace('prod_', '')}`;
      const found = rawDb.prepare('SELECT id FROM supply_items WHERE id = ? OR id = ?').get(candidateId, line.product_id) as any;
      if (found) {
        addDeduction(found.id, qty);
      }
    } else {
      // UNITS o GRAMMAGE: consultar recipe_items
      const recipe = rawDb.prepare('SELECT id FROM recipes WHERE product_id = ?').get(line.product_id) as any;
      if (recipe) {
        const recipeItems = rawDb.prepare('SELECT * FROM recipe_items WHERE recipe_id = ?').all(recipe.id) as any[];
        for (const ri of recipeItems) {
          if (ri.sub_recipe_id) {
            // Sub-receta: desglosar en sus insumos componentes
            const subItems = rawDb.prepare('SELECT * FROM sub_recipe_items WHERE sub_recipe_id = ?').all(ri.sub_recipe_id) as any[];
            const subRecipe = rawDb.prepare('SELECT yield_quantity FROM sub_recipes WHERE id = ?').get(ri.sub_recipe_id) as any;
            const yieldQty = subRecipe?.yield_quantity > 0 ? subRecipe.yield_quantity : 1;
            for (const si of subItems) {
              const portionNeeded = (si.quantity_required / yieldQty) * ri.quantity_required * qty;
              addDeduction(si.supply_id, portionNeeded);
            }
          } else if (ri.supply_item_id) {
            if (mode === 'GRAMMAGE' && ri.gross_weight_grams) {
              const shrinkageFactor = 1 + ((ri.shrinkage_percentage || 0) / 100);
              const totalGrossGrams = ri.gross_weight_grams * shrinkageFactor * qty;
              addDeduction(ri.supply_item_id, totalGrossGrams / 1000); // en kg
            } else {
              addDeduction(ri.supply_item_id, ri.quantity_required * qty);
            }
          }
        }
      }
    }

    // 2. Modificadores del renglón (Sin pan, Extra carne, etc.)
    const modifiers = rawDb.prepare('SELECT * FROM order_line_modifiers WHERE order_line_id = ?').all(line.id) as any[];
    for (const mod of modifiers) {
      const type = (mod.modifier_type || '').toUpperCase();
      const ingName = (mod.ingredient_name || '').toLowerCase();
      const ingId = mod.ingredient_id || '';

      // Mapeo inteligente de ingrediente a supply_item
      let targetSupplyId: string | null = null;
      if (ingId.includes('pan_perro') || ingName.includes('pan de perro')) targetSupplyId = 'sup_pan_perro';
      else if (ingId.includes('pan_brioche') || ingName.includes('pan brioche') || ingName.includes('pan')) targetSupplyId = 'sup_pan_brioche';
      else if (ingId.includes('carne') || ingName.includes('carne') || ingName.includes('smash')) targetSupplyId = 'sup_carne_smash';
      else if (ingId.includes('tocineta') || ingName.includes('tocineta')) targetSupplyId = 'sup_tocineta_crispy';
      else if (ingId.includes('salchicha_pollo') || ingName.includes('pollo')) targetSupplyId = 'sup_salchicha_pollo';
      else if (ingId.includes('salchicha_polaca') || ingName.includes('polaca')) targetSupplyId = 'sup_salchicha_polaca';
      else if (ingId.includes('pechuga') || ingName.includes('pechuga')) targetSupplyId = 'sup_pechuga_pollo';

      if (targetSupplyId) {
        if (type === 'SIN_INGREDIENTE' || type === 'SIN') {
          // Resta de la deducción
          const curr = deductions.get(targetSupplyId) || 0;
          deductions.set(targetSupplyId, Math.max(0, curr - (1 * qty)));
        } else if (type === 'EXTRA_INGREDIENTE' || type === 'EXTRA') {
          // Suma a la deducción
          addDeduction(targetSupplyId, 1 * qty);
        }
      }
    }
  }

  // 3. Aplicar deducciones en location_inventory e inventory_movements
  const insertMovement = rawDb.prepare(`
    INSERT INTO inventory_movements (
      id, location_id, supply_id, movement_type, quantity_delta,
      unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
    ) VALUES (?, ?, ?, 'VENTA_RECETA', ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [supplyId, qtyToDeduct] of deductions.entries()) {
    if (qtyToDeduct <= 0) continue;

    const supply = rawDb.prepare('SELECT cost_per_unit_usd_cents, weighted_avg_cost_usd_cents FROM supply_items WHERE id = ?').get(supplyId) as any;
    if (!supply) continue;
    const unitCost = supply?.weighted_avg_cost_usd_cents || supply?.cost_per_unit_usd_cents || 0;
    const totalCost = Math.round(qtyToDeduct * unitCost);

    // Registro inmutable de movimiento
    insertMovement.run(
      `mov_${generateUuidV7()}`,
      locationId,
      supplyId,
      -qtyToDeduct,
      unitCost,
      totalCost,
      `#CMD-${orderNum}`,
      `Consumo por venta orden #${orderNum}`,
      cashierUserId,
      now
    );

    // Actualizar stock por sede
    const locInvId = `${locationId}_${supplyId}`;
    const existing = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get(locationId, supplyId) as any;
    if (existing) {
      rawDb.prepare('UPDATE location_inventory SET current_stock_qty = current_stock_qty - ?, updated_at_ms = ? WHERE location_id = ? AND supply_id = ?').run(
        qtyToDeduct,
        now,
        locationId,
        supplyId
      );
    } else {
      rawDb.prepare('INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, ?, 0, ?)').run(
        locInvId,
        locationId,
        supplyId,
        -qtyToDeduct,
        now
      );
    }

    // Actualizar global supply_items
    rawDb.prepare('UPDATE supply_items SET current_stock_qty = current_stock_qty - ?, updated_at_ms = ? WHERE id = ?').run(
      qtyToDeduct,
      now,
      supplyId
    );
  }
}

/**
 * Reversión limpia e inmutable de inventario ante anulación de comanda en Caja o Incidente.
 * Si la orden tuvo movimientos de stock previos, se revierten dentro de la transacción con ese locationId.
 * Si el producto aún no tiene receta configurada o falta alguna referencia, se maneja de forma limpia
 * sin lanzar excepción no controlada (JAMÁS devuelve HTTP 500 al anular).
 */
export function revertInventoryForOrder(
  rawDb: Database.Database,
  orderId: string,
  rawLocationId?: string,
  reason: string = 'Anulación de comanda',
  actorUserId: string = 'usr_cajera'
): void {
  try {
    const order = rawDb.prepare('SELECT order_number, location_id FROM orders WHERE id = ?').get(orderId) as any;
    const orderNum = order?.order_number || 0;
    const locationId = rawLocationId || order?.location_id || 'sede_alta_vista';
    const now = Date.now();

    // 1. Buscar si esta orden ya tuvo movimientos previos en inventory_movements
    const prevMovements = rawDb.prepare(`
      SELECT * FROM inventory_movements
      WHERE (reference_doc LIKE ? OR notes LIKE ?)
        AND quantity_delta < 0
    `).all(`%${orderNum}%`, `%${orderNum}%`) as any[];

    if (prevMovements.length > 0) {
      const insertMovement = rawDb.prepare(`
        INSERT INTO inventory_movements (
          id, location_id, supply_id, movement_type, quantity_delta,
          unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
        ) VALUES (?, ?, ?, 'REVERSION_VENTA', ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const m of prevMovements) {
        const qtyToRestore = Math.abs(m.quantity_delta);
        const movId = `mov_${generateUuidV7()}`;

        insertMovement.run(
          movId,
          locationId,
          m.supply_id,
          qtyToRestore,
          m.unit_cost_usd_cents,
          m.total_cost_usd_cents,
          `#CMD-${orderNum}`,
          `Reversión por anulación orden #${orderNum}: ${reason}`,
          actorUserId,
          now
        );

        // Actualizar stock en location_inventory
        const locInvId = `${locationId}_${m.supply_id}`;
        const existing = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get(locationId, m.supply_id) as any;
        if (existing) {
          rawDb.prepare('UPDATE location_inventory SET current_stock_qty = current_stock_qty + ?, updated_at_ms = ? WHERE location_id = ? AND supply_id = ?').run(
            qtyToRestore,
            now,
            locationId,
            m.supply_id
          );
        } else {
          rawDb.prepare('INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, ?, 0, ?)').run(
            locInvId,
            locationId,
            m.supply_id,
            qtyToRestore,
            now
          );
        }

        // Actualizar global supply_items
        rawDb.prepare('UPDATE supply_items SET current_stock_qty = current_stock_qty + ?, updated_at_ms = ? WHERE id = ?').run(
          qtyToRestore,
          now,
          m.supply_id
        );
      }
    }
  } catch (err: any) {
    console.warn(`[InventoryReversal] Reversión de inventario para orden ${orderId} manejada limpiamente:`, err?.message);
  }
}

