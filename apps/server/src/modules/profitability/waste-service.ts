import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { appendAuditEvent } from '../audit/audit-service.js';
import { normalizeLocationFilter } from '../finances/financial-truth-helpers.js';

export interface RegisterWasteInput {
  locationId: string;
  itemType: 'supply' | 'product';
  supplyId?: string | null;
  productId?: string | null;
  quantity: number;
  unit?: string | null;
  costUsdCents?: number | null; // Editable; si no se provee, se auto-calcula
  reason: string;
  reportedByUserId: string;
}

export interface WasteRecord {
  id: string;
  locationId: string;
  locationName: string;
  itemType: 'supply' | 'product';
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  costUsdCents: number;
  reason: string;
  reportedByUserId: string;
  reportedByUserName: string;
  createdAtMs: number;
}

export interface StockCountItemInput {
  supplyId: string;
  physicalQty: number;
  reason?: string;
}

export interface PhysicalCountResult {
  reconciledAtMs: number;
  locationId: string;
  items: Array<{
    supplyId: string;
    supplyName: string;
    unit: string;
    systemQty: number;
    physicalQty: number;
    differenceQty: number;
    unitCostUsdCents: number;
    differenceCostUsdCents: number;
    status: 'OPTIMO' | 'FALTANTE' | 'SOBRANTE';
  }>;
  totalDifferenceCostUsdCents: number;
}

export function resolveProductRecipeDeductions(
  rawDb: Database.Database,
  productId: string,
  quantity: number,
  recipeMode?: string
): Map<string, number> {
  const deductions = new Map<string, number>();

  const addDeduction = (supplyId: string, qty: number) => {
    if (!supplyId || qty <= 0) return;
    const current = deductions.get(supplyId) || 0;
    deductions.set(supplyId, current + qty);
  };

  const recipe = rawDb.prepare('SELECT id FROM recipes WHERE product_id = ?').get(productId) as any;
  if (!recipe) return deductions;

  const recipeItems = rawDb.prepare('SELECT * FROM recipe_items WHERE recipe_id = ?').all(recipe.id) as any[];
  const mode = recipeMode || 'UNITS';

  for (const ri of recipeItems) {
    if (ri.sub_recipe_id) {
      // Sub-receta: desglosar en sus insumos componentes
      const subItems = rawDb.prepare('SELECT * FROM sub_recipe_items WHERE sub_recipe_id = ?').all(ri.sub_recipe_id) as any[];
      const subRecipe = rawDb.prepare('SELECT yield_quantity FROM sub_recipes WHERE id = ?').get(ri.sub_recipe_id) as any;
      const yieldQty = subRecipe?.yield_quantity > 0 ? subRecipe.yield_quantity : 1;
      for (const si of subItems) {
        const portionPerUnit = (si.quantity_required / yieldQty) * ri.quantity_required;
        const portionNeeded = portionPerUnit * quantity;
        addDeduction(si.supply_id, portionNeeded);
      }
    } else if (ri.supply_item_id) {
      let portionPerUnit = 0;
      if (mode === 'GRAMMAGE' && ri.gross_weight_grams) {
        const shrinkageFactor = 1 + ((ri.shrinkage_percentage || 0) / 100);
        portionPerUnit = (ri.gross_weight_grams * shrinkageFactor) / 1000;
      } else {
        portionPerUnit = ri.quantity_required;
      }
      const portionNeeded = portionPerUnit * quantity;
      addDeduction(ri.supply_item_id, portionNeeded);
    }
  }

  return deductions;
}

export function registerWasteLog(rawDb: Database.Database, input: RegisterWasteInput): WasteRecord {
  if (input.quantity <= 0) {
    const err: any = new Error('La cantidad de merma debe ser mayor a 0');
    err.statusCode = 400;
    throw err;
  }

  const now = Date.now();
  const wasteId = `wst_${generateUuidV7()}`;
  let finalUnit = input.unit || 'und';
  let finalCostCents = 0;
  let itemName = '';

  const tx = rawDb.transaction(() => {
    if (input.itemType === 'supply') {
      const supply = rawDb.prepare('SELECT id, name, unit, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents FROM supply_items WHERE id = ?').get(input.supplyId) as any;
      if (!supply) throw new Error(`Insumo '${input.supplyId}' no encontrado`);
      itemName = supply.name;
      finalUnit = input.unit || supply.unit || 'und';
      const autoUnitCost = supply.weighted_avg_cost_usd_cents || supply.cost_per_unit_usd_cents || 0;
      finalCostCents = input.costUsdCents !== undefined && input.costUsdCents !== null
        ? input.costUsdCents
        : Math.round(input.quantity * autoUnitCost);

      // Descontar del inventario de la sede
      const locInv = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get(input.locationId, supply.id) as any;
      if (locInv) {
        rawDb.prepare('UPDATE location_inventory SET current_stock_qty = current_stock_qty - ?, updated_at_ms = ? WHERE location_id = ? AND supply_id = ?').run(
          input.quantity,
          now,
          input.locationId,
          supply.id
        );
      } else {
        rawDb.prepare('INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, ?, 0, ?)').run(
          `${input.locationId}_${supply.id}`,
          input.locationId,
          supply.id,
          -input.quantity,
          now
        );
      }

      // Actualizar global supply_items
      rawDb.prepare('UPDATE supply_items SET current_stock_qty = current_stock_qty - ?, updated_at_ms = ? WHERE id = ?').run(
        input.quantity,
        now,
        supply.id
      );

      // Registrar movimiento inmutable
      rawDb.prepare(`
        INSERT INTO inventory_movements (
          id, location_id, supply_id, movement_type, quantity_delta,
          unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
        ) VALUES (?, ?, ?, 'MERMA_DESECHO', ?, ?, ?, 'MERMA', ?, ?, ?)
      `).run(
        `mov_${generateUuidV7()}`,
        input.locationId,
        supply.id,
        -input.quantity,
        autoUnitCost,
        finalCostCents,
        input.reason,
        input.reportedByUserId,
        now
      );
    } else {
      // Merma de plato/producto terminado
      const prod = rawDb.prepare('SELECT id, name, estimated_cost_usd_cents, recipe_mode FROM products WHERE id = ?').get(input.productId) as any;
      if (!prod) throw new Error(`Producto '${input.productId}' no encontrado`);
      itemName = prod.name;
      finalUnit = input.unit || 'porcion';

      const deductions = resolveProductRecipeDeductions(rawDb, prod.id, input.quantity, prod.recipe_mode);

      if (deductions.size > 0) {
        let totalCalculatedCostCents = 0;

        for (const [supplyId, qtyToDeduct] of deductions.entries()) {
          if (qtyToDeduct <= 0) continue;
          const supply = rawDb.prepare('SELECT id, name, unit, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents FROM supply_items WHERE id = ?').get(supplyId) as any;
          if (!supply) continue;

          const autoUnitCost = supply.weighted_avg_cost_usd_cents || supply.cost_per_unit_usd_cents || 0;
          const lineCostCents = Math.round(qtyToDeduct * autoUnitCost);
          totalCalculatedCostCents += lineCostCents;

          // Descontar del inventario de la sede
          const locInv = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get(input.locationId, supply.id) as any;
          if (locInv) {
            rawDb.prepare('UPDATE location_inventory SET current_stock_qty = current_stock_qty - ?, updated_at_ms = ? WHERE location_id = ? AND supply_id = ?').run(
              qtyToDeduct,
              now,
              input.locationId,
              supply.id
            );
          } else {
            rawDb.prepare('INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, ?, 0, ?)').run(
              `${input.locationId}_${supply.id}`,
              input.locationId,
              supply.id,
              -qtyToDeduct,
              now
            );
          }

          // Actualizar global supply_items
          rawDb.prepare('UPDATE supply_items SET current_stock_qty = current_stock_qty - ?, updated_at_ms = ? WHERE id = ?').run(
            qtyToDeduct,
            now,
            supply.id
          );

          // Registrar movimiento inmutable
          rawDb.prepare(`
            INSERT INTO inventory_movements (
              id, location_id, supply_id, movement_type, quantity_delta,
              unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
            ) VALUES (?, ?, ?, 'MERMA', ?, ?, ?, 'MERMA', ?, ?, ?)
          `).run(
            `mov_${generateUuidV7()}`,
            input.locationId,
            supply.id,
            -qtyToDeduct,
            autoUnitCost,
            lineCostCents,
            input.reason,
            input.reportedByUserId,
            now
          );
        }

        finalCostCents = input.costUsdCents !== undefined && input.costUsdCents !== null
          ? input.costUsdCents
          : totalCalculatedCostCents;
      } else {
        // Si no tiene receta con insumos, verificar si tiene insumo directo espejo
        const mirrorSupply = rawDb.prepare('SELECT id, name, unit, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents FROM supply_items WHERE id = ? OR id = ?').get(`sup_${prod.id.replace('prod_', '')}`, prod.id) as any;
        if (mirrorSupply) {
          const autoUnitCost = mirrorSupply.weighted_avg_cost_usd_cents || mirrorSupply.cost_per_unit_usd_cents || 0;
          const lineCostCents = Math.round(input.quantity * autoUnitCost);
          finalCostCents = input.costUsdCents !== undefined && input.costUsdCents !== null
            ? input.costUsdCents
            : lineCostCents;

          // Descontar del inventario de la sede
          const locInv = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get(input.locationId, mirrorSupply.id) as any;
          if (locInv) {
            rawDb.prepare('UPDATE location_inventory SET current_stock_qty = current_stock_qty - ?, updated_at_ms = ? WHERE location_id = ? AND supply_id = ?').run(
              input.quantity,
              now,
              input.locationId,
              mirrorSupply.id
            );
          } else {
            rawDb.prepare('INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, ?, 0, ?)').run(
              `${input.locationId}_${mirrorSupply.id}`,
              input.locationId,
              mirrorSupply.id,
              -input.quantity,
              now
            );
          }

          // Actualizar global supply_items
          rawDb.prepare('UPDATE supply_items SET current_stock_qty = current_stock_qty - ?, updated_at_ms = ? WHERE id = ?').run(
            input.quantity,
            now,
            mirrorSupply.id
          );

          // Registrar movimiento inmutable
          rawDb.prepare(`
            INSERT INTO inventory_movements (
              id, location_id, supply_id, movement_type, quantity_delta,
              unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
            ) VALUES (?, ?, ?, 'MERMA', ?, ?, ?, 'MERMA', ?, ?, ?)
          `).run(
            `mov_${generateUuidV7()}`,
            input.locationId,
            mirrorSupply.id,
            -input.quantity,
            autoUnitCost,
            lineCostCents,
            input.reason,
            input.reportedByUserId,
            now
          );
        } else {
          // Si no tiene ni receta ni espejo: valorada con estimated_cost y emite appendAuditEvent 'WASTE_WITHOUT_RECIPE'
          const autoUnitCost = prod.estimated_cost_usd_cents || 0;
          finalCostCents = input.costUsdCents !== undefined && input.costUsdCents !== null
            ? input.costUsdCents
            : Math.round(input.quantity * autoUnitCost);

          appendAuditEvent(rawDb, {
            action: 'WASTE_WITHOUT_RECIPE',
            actorUserId: input.reportedByUserId,
            entityType: 'product',
            entityId: prod.id,
            payload: {
              productId: prod.id,
              productName: prod.name,
              quantity: input.quantity,
              locationId: input.locationId,
              reason: input.reason,
              costUsdCents: finalCostCents
            }
          });
        }
      }
    }

    // Insertar en waste_logs
    rawDb.prepare(`
      INSERT INTO waste_logs (
        id, location_id, item_type, supply_id, product_id,
        quantity, unit, cost_usd_cents, reason, reported_by_user_id, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      wasteId,
      input.locationId,
      input.itemType,
      input.supplyId || null,
      input.productId || null,
      input.quantity,
      finalUnit,
      finalCostCents,
      input.reason,
      input.reportedByUserId,
      now
    );

    // Nota R2: Ya no se inserta en operating_expenses como 'MERMAS_DESPERDICIOS'
    // para evitar el doble conteo de mermas (P2-B). Las pérdidas se contabilizan
    // directamente desde waste_logs a través de financial-truth-service.
  });

  tx();

  const loc = rawDb.prepare('SELECT name FROM locations WHERE id = ?').get(input.locationId) as any;
  const user = rawDb.prepare('SELECT name FROM users WHERE id = ?').get(input.reportedByUserId) as any;

  return {
    id: wasteId,
    locationId: input.locationId,
    locationName: loc?.name || 'Sede',
    itemType: input.itemType,
    itemId: (input.itemType === 'supply' ? input.supplyId : input.productId) || '',
    itemName,
    quantity: input.quantity,
    unit: finalUnit,
    costUsdCents: finalCostCents,
    reason: input.reason,
    reportedByUserId: input.reportedByUserId,
    reportedByUserName: user?.name || 'Usuario',
    createdAtMs: now
  };
}

export function getWasteLogs(rawDb: Database.Database, locationId?: string): WasteRecord[] {
  const normalizedLocationId = normalizeLocationFilter(locationId);
  const sql = normalizedLocationId
    ? `
      SELECT w.*, l.name as location_name, u.name as user_name,
             s.name as supply_name, p.name as product_name
      FROM waste_logs w
      JOIN locations l ON w.location_id = l.id
      JOIN users u ON w.reported_by_user_id = u.id
      LEFT JOIN supply_items s ON w.supply_id = s.id
      LEFT JOIN products p ON w.product_id = p.id
      WHERE w.location_id = ?
      ORDER BY w.created_at_ms DESC
      LIMIT 100
    `
    : `
      SELECT w.*, l.name as location_name, u.name as user_name,
             s.name as supply_name, p.name as product_name
      FROM waste_logs w
      JOIN locations l ON w.location_id = l.id
      JOIN users u ON w.reported_by_user_id = u.id
      LEFT JOIN supply_items s ON w.supply_id = s.id
      LEFT JOIN products p ON w.product_id = p.id
      ORDER BY w.created_at_ms DESC
      LIMIT 100
    `;

  const rows = (normalizedLocationId
    ? rawDb.prepare(sql).all(normalizedLocationId)
    : rawDb.prepare(sql).all()) as any[];

  return rows.map(r => ({
    id: r.id,
    locationId: r.location_id,
    locationName: r.location_name,
    itemType: r.item_type,
    itemId: r.supply_id || r.product_id || '',
    itemName: r.supply_name || r.product_name || 'Item',
    quantity: r.quantity,
    unit: r.unit,
    costUsdCents: r.cost_usd_cents,
    reason: r.reason,
    reportedByUserId: r.reported_by_user_id,
    reportedByUserName: r.user_name,
    createdAtMs: r.created_at_ms
  }));
}

export function performPhysicalStockCount(
  rawDb: Database.Database,
  input: {
    locationId: string;
    jornadaId?: string;
    countedByUserId: string;
    counts: StockCountItemInput[];
  }
): PhysicalCountResult {
  const now = Date.now();
  let targetJornadaId = input.jornadaId;
  if (!targetJornadaId) {
    const currentJornada = rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
    targetJornadaId = currentJornada?.id || 'jornada_default';
  }

  const items: PhysicalCountResult['items'] = [];
  let totalDifferenceCostUsdCents = 0;

  const tx = rawDb.transaction(() => {
    const insertCount = rawDb.prepare(`
      INSERT INTO stock_counts (
        id, location_id, jornada_id, counted_by_user_id, supply_item_id,
        system_qty, physical_qty, difference_qty, difference_cost_usd_cents, counted_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMovement = rawDb.prepare(`
      INSERT INTO inventory_movements (
        id, location_id, supply_id, movement_type, quantity_delta,
        unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
      ) VALUES (?, ?, ?, 'AJUSTE_CONTEO', ?, ?, ?, 'CONTEO_FISICO', ?, ?, ?)
    `);

    for (const c of input.counts) {
      const supply = rawDb.prepare('SELECT id, name, unit, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents FROM supply_items WHERE id = ?').get(c.supplyId) as any;
      if (!supply) continue;

      const locInv = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get(input.locationId, supply.id) as any;
      const systemQty = locInv ? locInv.current_stock_qty : 0;
      const physicalQty = c.physicalQty;
      const diffQty = physicalQty - systemQty;
      const unitCost = supply.weighted_avg_cost_usd_cents || supply.cost_per_unit_usd_cents || 0;
      const diffCost = Math.round(diffQty * unitCost);
      totalDifferenceCostUsdCents += diffCost;

      let status: 'OPTIMO' | 'FALTANTE' | 'SOBRANTE' = 'OPTIMO';
      if (diffQty < 0) status = 'FALTANTE';
      else if (diffQty > 0) status = 'SOBRANTE';

      // 1. Guardar conteo físico
      insertCount.run(
        `sc_${generateUuidV7()}`,
        input.locationId,
        targetJornadaId,
        input.countedByUserId,
        supply.id,
        systemQty,
        physicalQty,
        diffQty,
        diffCost,
        now
      );

      // 2. Si hay diferencia, registrar movimiento inmutable de ajuste
      if (diffQty !== 0) {
        insertMovement.run(
          `mov_${generateUuidV7()}`,
          input.locationId,
          supply.id,
          diffQty,
          unitCost,
          Math.abs(diffCost),
          c.reason || `Ajuste por conteo físico (${status})`,
          input.countedByUserId,
          now
        );
      }

      // 3. Ajustar location_inventory al valor físico exacto
      if (locInv) {
        rawDb.prepare('UPDATE location_inventory SET current_stock_qty = ?, updated_at_ms = ? WHERE location_id = ? AND supply_id = ?').run(
          physicalQty,
          now,
          input.locationId,
          supply.id
        );
      } else {
        rawDb.prepare('INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, ?, 0, ?)').run(
          `${input.locationId}_${supply.id}`,
          input.locationId,
          supply.id,
          physicalQty,
          now
        );
      }

      // 4. Actualizar global en supply_items con la diferencia
      rawDb.prepare('UPDATE supply_items SET current_stock_qty = current_stock_qty + ?, updated_at_ms = ? WHERE id = ?').run(
        diffQty,
        now,
        supply.id
      );

      items.push({
        supplyId: supply.id,
        supplyName: supply.name,
        unit: supply.unit,
        systemQty,
        physicalQty,
        differenceQty: diffQty,
        unitCostUsdCents: unitCost,
        differenceCostUsdCents: diffCost,
        status
      });
    }
  });

  tx();

  return {
    reconciledAtMs: now,
    locationId: input.locationId,
    items,
    totalDifferenceCostUsdCents
  };
}
