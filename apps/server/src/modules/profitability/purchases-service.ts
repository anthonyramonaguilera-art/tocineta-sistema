import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { getProductRecipe, type ProductRecipeDetail } from './recipes-service.js';

export interface PurchaseItemInput {
  supplyId: string;
  purchaseQuantity: number; // En unidad de compra (ej. 2 cajas, 5 paquetes, 10 kg)
  unitCostUsdCents: number; // Costo por unidad de compra
}

export interface RegisterPurchaseInput {
  locationId: string;
  supplierId?: string | null;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  paymentCondition: 'CONTADO' | 'CREDITO';
  dueDateMs?: number | null;
  notes?: string | null;
  createdBy: string;
  items: PurchaseItemInput[];
}

export interface RecipeCostImpact {
  productId: string;
  productName: string;
  station: string;
  oldCostUsdCents: number;
  newCostUsdCents: number;
  costDeltaUsdCents: number;
  currentPriceUsdCents: number;
  suggestedPriceUsdCents: number;
  targetMarginBps: number;
  currentMarginBps: number;
  newMarginIfKeptBps: number;
}

export interface PurchaseResult {
  purchaseId: string;
  totalUsdCents: number;
  locationId: string;
  affectedRecipes: RecipeCostImpact[];
}

export function registerPurchase(rawDb: Database.Database, input: RegisterPurchaseInput): PurchaseResult {
  if (!input.items || input.items.length === 0) {
    const err: any = new Error('La compra debe contener al menos un insumo');
    err.statusCode = 400;
    throw err;
  }

  const now = Date.now();
  const purchaseId = `pur_${generateUuidV7()}`;
  let totalUsdCents = 0;

  // 1. Obtener costo inicial de recetas para comparar impacto
  const affectedProductIds = new Set<string>();
  for (const it of input.items) {
    // Buscar recetas directas
    const recRows = rawDb.prepare(`
      SELECT r.product_id
      FROM recipe_items ri
      JOIN recipes r ON ri.recipe_id = r.id
      WHERE ri.supply_item_id = ?
    `).all(it.supplyId) as Array<{ product_id: string }>;
    for (const r of recRows) affectedProductIds.add(r.product_id);

    // Buscar recetas con sub-recetas que usan este insumo
    const subRecRows = rawDb.prepare(`
      SELECT r.product_id
      FROM sub_recipe_items sri
      JOIN recipe_items ri ON ri.sub_recipe_id = sri.sub_recipe_id
      JOIN recipes r ON ri.recipe_id = r.id
      WHERE sri.supply_id = ?
    `).all(it.supplyId) as Array<{ product_id: string }>;
    for (const r of subRecRows) affectedProductIds.add(r.product_id);
  }

  const initialRecipesMap = new Map<string, ProductRecipeDetail>();
  for (const pid of affectedProductIds) {
    const detail = getProductRecipe(rawDb, pid);
    if (detail) initialRecipesMap.set(pid, detail);
  }

  const tx = rawDb.transaction(() => {
    // Si se especificó proveedor por nombre y no id, buscarlo o crearlo limpiamente
    let finalSupplierId = input.supplierId || null;
    if (!finalSupplierId && input.supplierName?.trim()) {
      const existing = rawDb.prepare('SELECT id FROM suppliers WHERE LOWER(name) = ?').get(input.supplierName.trim().toLowerCase()) as any;
      if (existing) {
        finalSupplierId = existing.id;
      } else {
        finalSupplierId = `sup_${generateUuidV7()}`;
        rawDb.prepare('INSERT INTO suppliers (id, name, created_at_ms) VALUES (?, ?, ?)').run(
          finalSupplierId,
          input.supplierName.trim(),
          now
        );
      }
    }

    // 2. Procesar cada renglón de compra
    const purchaseItemsData: Array<{
      supplyId: string;
      purchaseQuantity: number;
      usageQuantity: number;
      purchaseUnitCostCents: number;
      usageUnitCostCents: number;
      subtotalCents: number;
      prevUnitCostCents: number;
    }> = [];

    for (const it of input.items) {
      const supply = rawDb.prepare(`
        SELECT id, name, conversion_factor, current_stock_qty,
               cost_per_unit_usd_cents, weighted_avg_cost_usd_cents
        FROM supply_items WHERE id = ?
      `).get(it.supplyId) as any;

      if (!supply) {
        throw new Error(`Insumo '${it.supplyId}' no encontrado`);
      }

      const conversionFactor = supply.conversion_factor > 0 ? supply.conversion_factor : 1.0;
      const usageQuantity = it.purchaseQuantity * conversionFactor;
      const usageUnitCostCents = Math.round(it.unitCostUsdCents / conversionFactor);
      const subtotalCents = Math.round(it.purchaseQuantity * it.unitCostUsdCents);
      totalUsdCents += subtotalCents;

      // Calcular Costo Promedio Ponderado (WAC)
      const currentStock = supply.current_stock_qty || 0;
      const currentWac = supply.weighted_avg_cost_usd_cents || supply.cost_per_unit_usd_cents || usageUnitCostCents;
      const newTotalStock = currentStock + usageQuantity;

      let newWac = usageUnitCostCents;
      if (newTotalStock > 0) {
        newWac = Math.round(
          ((Math.max(0, currentStock) * currentWac) + (usageQuantity * usageUnitCostCents)) / newTotalStock
        );
      }

      // Actualizar supply_items
      rawDb.prepare(`
        UPDATE supply_items
        SET weighted_avg_cost_usd_cents = ?,
            last_cost_usd_cents = ?,
            previous_cost_usd_cents = cost_per_unit_usd_cents,
            cost_per_unit_usd_cents = ?,
            current_stock_qty = current_stock_qty + ?,
            last_supplier_id = COALESCE(?, last_supplier_id),
            updated_at_ms = ?
        WHERE id = ?
      `).run(
        newWac,
        usageUnitCostCents,
        usageUnitCostCents,
        usageQuantity,
        finalSupplierId,
        now,
        supply.id
      );

      // Actualizar location_inventory
      const locInv = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get(input.locationId, supply.id) as any;
      if (locInv) {
        rawDb.prepare('UPDATE location_inventory SET current_stock_qty = current_stock_qty + ?, updated_at_ms = ? WHERE location_id = ? AND supply_id = ?').run(
          usageQuantity,
          now,
          input.locationId,
          supply.id
        );
      } else {
        rawDb.prepare('INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, ?, 0, ?)').run(
          `${input.locationId}_${supply.id}`,
          input.locationId,
          supply.id,
          usageQuantity,
          now
        );
      }

      // Registrar movimiento inmutable de inventario
      rawDb.prepare(`
        INSERT INTO inventory_movements (
          id, location_id, supply_id, movement_type, quantity_delta,
          unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
        ) VALUES (?, ?, ?, 'COMPRA_ENTRADA', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `mov_${generateUuidV7()}`,
        input.locationId,
        supply.id,
        usageQuantity,
        usageUnitCostCents,
        subtotalCents,
        input.invoiceNumber || 'FACT-COMPRA',
        input.notes || `Entrada por compra (${it.purchaseQuantity} unidades de compra)`,
        input.createdBy,
        now
      );

      purchaseItemsData.push({
        supplyId: supply.id,
        purchaseQuantity: it.purchaseQuantity,
        usageQuantity,
        purchaseUnitCostCents: it.unitCostUsdCents,
        usageUnitCostCents,
        subtotalCents,
        prevUnitCostCents: currentWac
      });
    }

    // Insertar cabecera de compra
    rawDb.prepare(`
      INSERT INTO purchases (
        id, location_id, supplier_id, invoice_number, payment_condition,
        status, total_usd_cents, total_bs_cents, due_date_ms, notes, created_by, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, 'PAGADA', ?, 0, ?, ?, ?, ?)
    `).run(
      purchaseId,
      input.locationId,
      finalSupplierId,
      input.invoiceNumber || null,
      input.paymentCondition,
      totalUsdCents,
      input.dueDateMs || null,
      input.notes || null,
      input.createdBy,
      now
    );

    // Insertar ítems de compra
    const insertPurchItem = rawDb.prepare(`
      INSERT INTO purchase_items (id, purchase_id, supply_id, quantity, unit_cost_usd_cents, prev_unit_cost_usd_cents, subtotal_usd_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const pIt of purchaseItemsData) {
      insertPurchItem.run(
        `pi_${generateUuidV7()}`,
        purchaseId,
        pIt.supplyId,
        pIt.purchaseQuantity,
        pIt.purchaseUnitCostCents,
        pIt.prevUnitCostCents,
        pIt.subtotalCents
      );
    }
  });

  tx();

  // 3. Evaluar impacto en las recetas afectadas
  const affectedRecipes: RecipeCostImpact[] = [];
  for (const pid of affectedProductIds) {
    const initial = initialRecipesMap.get(pid);
    const updated = getProductRecipe(rawDb, pid);
    if (!initial || !updated) continue;

    const oldCost = initial.calculatedCostUsdCents;
    const newCost = updated.calculatedCostUsdCents;
    const currentPrice = updated.currentPriceUsdCents;

    const newMarginIfKept = currentPrice > 0
      ? Math.round(((currentPrice - newCost) / currentPrice) * 10000)
      : 0;

    affectedRecipes.push({
      productId: updated.productId,
      productName: updated.productName,
      station: updated.station,
      oldCostUsdCents: oldCost,
      newCostUsdCents: newCost,
      costDeltaUsdCents: newCost - oldCost,
      currentPriceUsdCents: currentPrice,
      suggestedPriceUsdCents: updated.suggestedPriceUsdCents,
      targetMarginBps: updated.targetMarginBps,
      currentMarginBps: initial.currentMarginBps,
      newMarginIfKeptBps: newMarginIfKept
    });
  }

  return {
    purchaseId,
    totalUsdCents,
    locationId: input.locationId,
    affectedRecipes
  };
}

export function confirmPriceAdjustments(
  rawDb: Database.Database,
  adjustments: Array<{ productId: string; newPriceUsdCents: number; reason?: string }>,
  confirmedByUserId: string
): { adjustedCount: number; historyRecords: any[] } {
  const now = Date.now();
  const historyRecords: any[] = [];

  const tx = rawDb.transaction(() => {
    const insertHistory = rawDb.prepare(`
      INSERT INTO price_history (id, product_id, old_price_usd_cents, new_price_usd_cents, reason, confirmed_by_user_id, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const updateProduct = rawDb.prepare(`
      UPDATE products
      SET price_usd_cents = ?,
          updated_at_ms = ?
      WHERE id = ?
    `);

    for (const adj of adjustments) {
      if (!adj.productId || adj.newPriceUsdCents <= 0) continue;

      const prod = rawDb.prepare('SELECT price_usd_cents, name FROM products WHERE id = ?').get(adj.productId) as any;
      if (!prod) continue;

      const oldPrice = prod.price_usd_cents;
      const historyId = `ph_${generateUuidV7()}`;
      const reason = adj.reason || 'Ajuste de precio por variación de costo de compra';

      insertHistory.run(historyId, adj.productId, oldPrice, adj.newPriceUsdCents, reason, confirmedByUserId, now);
      updateProduct.run(adj.newPriceUsdCents, now, adj.productId);

      historyRecords.push({
        id: historyId,
        productId: adj.productId,
        productName: prod.name,
        oldPriceUsdCents: oldPrice,
        newPriceUsdCents: adj.newPriceUsdCents,
        reason,
        confirmedByUserId,
        createdAtMs: now
      });
    }
  });

  tx();
  return {
    adjustedCount: historyRecords.length,
    historyRecords
  };
}

export function getPriceHistory(rawDb: Database.Database, productId?: string): any[] {
  if (productId) {
    return rawDb.prepare(`
      SELECT ph.*, p.name as product_name, u.name as confirmed_by_user_name
      FROM price_history ph
      JOIN products p ON ph.product_id = p.id
      LEFT JOIN users u ON ph.confirmed_by_user_id = u.id
      WHERE ph.product_id = ?
      ORDER BY ph.created_at_ms DESC
    `).all(productId);
  }

  return rawDb.prepare(`
    SELECT ph.*, p.name as product_name, u.name as confirmed_by_user_name
    FROM price_history ph
    JOIN products p ON ph.product_id = p.id
    LEFT JOIN users u ON ph.confirmed_by_user_id = u.id
    ORDER BY ph.created_at_ms DESC
    LIMIT 100
  `).all();
}
