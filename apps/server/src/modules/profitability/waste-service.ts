import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';

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
      const prod = rawDb.prepare('SELECT id, name, estimated_cost_usd_cents FROM products WHERE id = ?').get(input.productId) as any;
      if (!prod) throw new Error(`Producto '${input.productId}' no encontrado`);
      itemName = prod.name;
      finalUnit = input.unit || 'porcion';
      const autoUnitCost = prod.estimated_cost_usd_cents || 0;
      finalCostCents = input.costUsdCents !== undefined && input.costUsdCents !== null
        ? input.costUsdCents
        : Math.round(input.quantity * autoUnitCost);

      // Si tiene insumo directo espejo, descontar
      const mirrorSupply = rawDb.prepare('SELECT id FROM supply_items WHERE id = ? OR id = ?').get(`sup_${prod.id.replace('prod_', '')}`, prod.id) as any;
      if (mirrorSupply) {
        rawDb.prepare('UPDATE location_inventory SET current_stock_qty = current_stock_qty - ?, updated_at_ms = ? WHERE location_id = ? AND supply_id = ?').run(
          input.quantity,
          now,
          input.locationId,
          mirrorSupply.id
        );
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

    // Registrar gasto operativo de merma para descontar de la utilidad neta
    const currentJornada = rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
    if (currentJornada) {
      rawDb.prepare(`
        INSERT INTO operating_expenses (
          id, location_id, jornada_id, category, amount_usd_cents, amount_bs_cents, description, authorized_by_user_id, created_at_ms
        ) VALUES (?, ?, ?, 'MERMAS_DESPERDICIOS', ?, 0, ?, ?, ?)
      `).run(
        `exp_${generateUuidV7()}`,
        input.locationId,
        currentJornada.id,
        finalCostCents,
        `Merma: ${itemName} (${input.quantity} ${finalUnit}) - ${input.reason}`,
        input.reportedByUserId,
        now
      );
    }
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
  const sql = locationId && locationId !== 'ALL'
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

  const rows = (locationId && locationId !== 'ALL'
    ? rawDb.prepare(sql).all(locationId)
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
