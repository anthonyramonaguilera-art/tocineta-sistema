/**
 * SISTEMA OPERATIVO TOCINETA — MÓDULO DE ENVÍOS ENTRE SEDES (FASE 4)
 * Manejo atómico de transferencias, cálculo de equivalentes de platos,
 * lotes preconfigurados y notas de despacho con recepción en tránsito.
 */

import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';
import { verifyPin } from '../auth/pin.js';

export interface TransferItemInput {
  supplyId: string;
  quantity: number;
}

export interface DishEquivalentInput {
  productId: string;
  quantity: number;
}

export interface CreateTransferInput {
  fromLocationId: string;
  toLocationId: string;
  mode: 'DISH_EQUIVALENT' | 'LOOSE_SUPPLIES' | 'BATCH';
  items: TransferItemInput[];
  dishEquivalents?: DishEquivalentInput[];
  batchId?: string;
  notes?: string;
  forceWithPin?: boolean;
  forceReason?: string;
  supervisorPin?: string;
  requireTransit?: boolean;
  createdByUserId: string;
}

export interface TransferBatchInput {
  name: string;
  description?: string;
  fromLocationId?: string;
  toLocationId?: string;
  items: TransferItemInput[];
}

export interface DishCalculationResult {
  supplies: Array<{
    supplyId: string;
    name: string;
    unit: string;
    quantityRequired: number;
    currentStockOrigin: number;
    unitCostUsdCents: number;
    totalCostUsdCents: number;
    isSufficient: boolean;
  }>;
  hasInsufficientStock: boolean;
  missingSupplies: Array<{ supplyId: string; name: string; missingQty: number }>;
}

/**
 * 1. Calcula la lista de insumos agregada requerida a partir de una lista de platos y cantidades
 */
export function calculateDishEquivalents(
  rawDb: Database.Database,
  fromLocationIdOrDishes: string | any[],
  maybeDishes?: any[]
): DishCalculationResult & { items: any[]; dishes: any[] } {
  let fromLocationId = 'loc_los_olivos';
  let dishes: any[] = [];

  if (Array.isArray(fromLocationIdOrDishes)) {
    dishes = fromLocationIdOrDishes;
  } else {
    fromLocationId = fromLocationIdOrDishes;
    dishes = maybeDishes || [];
  }

  const aggregated = new Map<string, number>();

  for (const dish of dishes) {
    if (dish.quantity <= 0) continue;

    let prodId = dish.productId;
    if (!prodId && dish.dishName) {
      let prod = rawDb.prepare('SELECT id, name FROM products WHERE name LIKE ? LIMIT 1').get(`%${dish.dishName}%`) as any;
      if (!prod) {
        const nameLower = dish.dishName.toLowerCase();
        if (nameLower.includes('hamburguesa') || nameLower.includes('burger')) {
          prod = rawDb.prepare("SELECT id, name FROM products WHERE category_id = 'cat_hamburguesas' LIMIT 1").get() as any;
        } else if (nameLower.includes('perro') || nameLower.includes('dog')) {
          prod = rawDb.prepare("SELECT id, name FROM products WHERE category_id = 'cat_hot_dogs' LIMIT 1").get() as any;
        }
      }
      if (prod) {
        prodId = prod.id;
        dish.productId = prod.id;
        dish.productName = prod.name;
      }
    }

    if (!prodId) continue;

    // Buscar receta del producto
    const recipe = rawDb.prepare('SELECT id FROM recipes WHERE product_id = ?').get(prodId) as any;
    if (!recipe) continue;

    const items = rawDb.prepare('SELECT * FROM recipe_items WHERE recipe_id = ?').all(recipe.id) as any[];
    for (const itm of items) {
      if (itm.supply_item_id) {
        const current = aggregated.get(itm.supply_item_id) || 0;
        aggregated.set(itm.supply_item_id, current + itm.quantity_required * dish.quantity);
      } else if (itm.sub_recipe_id) {
        // Desglosar sub-receta
        const sub = rawDb.prepare('SELECT yield_quantity FROM sub_recipes WHERE id = ?').get(itm.sub_recipe_id) as any;
        const subYield = sub?.yield_quantity > 0 ? sub.yield_quantity : 1;
        const subItems = rawDb.prepare('SELECT supply_id, quantity_required FROM sub_recipe_items WHERE sub_recipe_id = ?').all(itm.sub_recipe_id) as any[];
        for (const sItm of subItems) {
          const factor = (itm.quantity_required / subYield) * dish.quantity;
          const current = aggregated.get(sItm.supply_id) || 0;
          aggregated.set(sItm.supply_id, current + sItm.quantity_required * factor);
        }
      }
    }
  }

  const supplies: DishCalculationResult['supplies'] = [];
  const missingSupplies: DishCalculationResult['missingSupplies'] = [];
  let hasInsufficientStock = false;

  for (const [supplyId, qtyNeeded] of aggregated.entries()) {
    const supply = rawDb.prepare('SELECT name, usage_unit, unit, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents FROM supply_items WHERE id = ?').get(supplyId) as any;
    const name = supply?.name || supplyId;
    const unit = supply?.usage_unit || supply?.unit || 'und';
    const unitCost = supply?.weighted_avg_cost_usd_cents || supply?.cost_per_unit_usd_cents || 0;

    const stockRow = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get(fromLocationId, supplyId) as any;
    const currentStock = stockRow ? stockRow.current_stock_qty : 0;
    const roundedQty = Math.round(qtyNeeded * 1000) / 1000;
    const isSufficient = currentStock >= roundedQty;

    if (!isSufficient) {
      hasInsufficientStock = true;
      missingSupplies.push({
        supplyId,
        name,
        missingQty: Math.round((roundedQty - currentStock) * 1000) / 1000
      });
    }

    supplies.push({
      supplyId,
      name,
      unit,
      quantityRequired: roundedQty,
      currentStockOrigin: currentStock,
      unitCostUsdCents: unitCost,
      totalCostUsdCents: Math.round(roundedQty * unitCost),
      isSufficient
    });
  }

  const items = supplies.map(s => ({
    supplyId: s.supplyId,
    supplyName: s.name,
    quantity: s.quantityRequired,
    unit: s.unit,
    unitCostUsdCents: s.unitCostUsdCents,
    totalCostUsdCents: s.totalCostUsdCents
  }));

  return { supplies, items, dishes, hasInsufficientStock, missingSupplies };
}

/**
 * 2. Crear una transferencia entre sedes (con transacción atómica SQLite)
 */
export function createTransfer(
  rawDb: Database.Database,
  input: CreateTransferInput
) {
  if (input.fromLocationId === input.toLocationId) {
    const err: any = new Error('La sede de origen y destino deben ser distintas');
    err.statusCode = 400;
    throw err;
  }

  if (!input.items || input.items.length === 0) {
    const err: any = new Error('Debe especificar al menos un insumo para el despacho');
    err.statusCode = 400;
    throw err;
  }

  const now = Date.now();
  let supervisorUser: any = null;

  // Verificar stock en origen
  const insufficientItems: Array<{ supplyId: string; name: string; required: number; available: number }> = [];

  for (const itm of input.items) {
    if (itm.quantity <= 0) continue;
    const stockRow = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get(input.fromLocationId, itm.supplyId) as any;
    const available = stockRow ? stockRow.current_stock_qty : 0;
    if (available < itm.quantity) {
      const sup = rawDb.prepare('SELECT name FROM supply_items WHERE id = ?').get(itm.supplyId) as any;
      insufficientItems.push({
        supplyId: itm.supplyId,
        name: sup?.name || itm.supplyId,
        required: itm.quantity,
        available
      });
    }
  }

  // Si hay stock insuficiente, verificar PIN y motivo
  if (insufficientItems.length > 0) {
    if (!input.forceWithPin) {
      const err: any = new Error(`Stock insuficiente en origen: ${insufficientItems.map(i => `${i.name} (disp: ${i.available}, req: ${i.required})`).join(', ')}`);
      err.statusCode = 400;
      err.insufficientItems = insufficientItems;
      throw err;
    }

    if (!input.forceReason || input.forceReason.trim().length < 4) {
      const err: any = new Error('Para forzar el despacho con stock insuficiente debe ingresar un motivo válido');
      err.statusCode = 400;
      throw err;
    }

    if (!input.supervisorPin) {
      const err: any = new Error('Debe ingresar el PIN de supervisor/admin para forzar el despacho');
      err.statusCode = 403;
      throw err;
    }

    // Validar PIN contra usuarios admin o supervisor
    const supervisors = rawDb.prepare("SELECT id, name, role, pin_hash, pin_salt FROM users WHERE role IN ('admin', 'supervisor') AND is_active = 1").all() as any[];
    supervisorUser = supervisors.find(s => verifyPin(input.supervisorPin!, s.pin_salt, s.pin_hash));

    if (!supervisorUser) {
      const err: any = new Error('PIN de supervisor/admin incorrecto');
      err.statusCode = 403;
      throw err;
    }
  }

  // Determinar número consecutivo y código de nota de despacho
  let transferRecord: any = null;

  rawDb.transaction(() => {
    const maxRow = rawDb.prepare('SELECT MAX(transfer_number) as maxNum FROM inter_location_transfers').get() as any;
    const transferNumber = (maxRow?.maxNum || 0) + 1;
    const dispatchNoteCode = `NDP-${String(transferNumber).padStart(4, '0')}`;
    const transferId = `trf_${generateUuidV7()}`;

    // Construir detalles enriquecidos de items y calcular costo total
    let totalCostUsdCents = 0;
    const enrichedItems = input.items.map(itm => {
      const sup = rawDb.prepare('SELECT name, unit, usage_unit, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents FROM supply_items WHERE id = ?').get(itm.supplyId) as any;
      const unitCost = sup?.weighted_avg_cost_usd_cents || sup?.cost_per_unit_usd_cents || 0;
      const itemCost = Math.round(itm.quantity * unitCost);
      totalCostUsdCents += itemCost;
      return {
        supplyId: itm.supplyId,
        supplyName: sup?.name || itm.supplyId,
        unit: sup?.usage_unit || sup?.unit || 'und',
        quantity: itm.quantity,
        unitCostUsdCents: unitCost,
        totalCostUsdCents: itemCost
      };
    });

    const createdBy = input.createdByUserId || (input as any).createdBy || 'usr_admin';
    const isEnTransito = Boolean(input.requireTransit ?? (input as any).requiresConfirmation);
    let mode = 'LOOSE_SUPPLIES';
    const rawMode = String(input.mode || '').toUpperCase();
    if (rawMode.includes('DISH')) {
      mode = 'DISH_EQUIVALENT';
    } else if (rawMode.includes('BATCH')) {
      mode = 'BATCH';
    } else {
      mode = 'LOOSE_SUPPLIES';
    }
    const initialStatus = isEnTransito ? 'EN_TRANSITO' : 'COMPLETADO';

    // 1. Descontar stock en sede origen
    for (const itm of enrichedItems) {
      rawDb.prepare(`
        UPDATE location_inventory
        SET current_stock_qty = current_stock_qty - ?, updated_at_ms = ?
        WHERE location_id = ? AND supply_id = ?
      `).run(itm.quantity, now, input.fromLocationId, itm.supplyId);

      // Movimiento TRANSFERENCIA_SALIDA
      rawDb.prepare(`
        INSERT INTO inventory_movements (
          id, location_id, supply_id, movement_type, quantity_delta,
          unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
        ) VALUES (?, ?, ?, 'TRANSFERENCIA_SALIDA', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `mov_${generateUuidV7()}`,
        input.fromLocationId,
        itm.supplyId,
        -itm.quantity,
        itm.unitCostUsdCents,
        itm.totalCostUsdCents,
        dispatchNoteCode,
        `Despacho a ${input.toLocationId}. Nota: ${input.notes || ''}`,
        createdBy,
        now
      );
    }

    // 2. Si no requiere recepción en destino, sumar stock de inmediato en una sola transacción atómica
    if (!isEnTransito) {
      for (const itm of enrichedItems) {
        rawDb.prepare(`
          INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
          VALUES (?, ?, ?, ?, 0, ?)
          ON CONFLICT(id) DO UPDATE SET
            current_stock_qty = current_stock_qty + excluded.current_stock_qty,
            updated_at_ms = excluded.updated_at_ms
        `).run(
          `${input.toLocationId}_${itm.supplyId}`,
          input.toLocationId,
          itm.supplyId,
          itm.quantity,
          now
        );

        // Movimiento TRANSFERENCIA_ENTRADA
        rawDb.prepare(`
          INSERT INTO inventory_movements (
          id, location_id, supply_id, movement_type, quantity_delta,
          unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
        ) VALUES (?, ?, ?, 'TRANSFERENCIA_ENTRADA', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `mov_${generateUuidV7()}`,
          input.toLocationId,
          itm.supplyId,
          itm.quantity,
          itm.unitCostUsdCents,
          itm.totalCostUsdCents,
          dispatchNoteCode,
          `Recepción inmediata desde ${input.fromLocationId}`,
          createdBy,
          now
        );
      }
    }

    // 3. Crear registro de transferencia
    rawDb.prepare(`
      INSERT INTO inter_location_transfers (
        id, transfer_number, dispatch_note_code, from_location_id, to_location_id,
        status, mode, items_json, dish_equivalents_json, batch_id,
        total_cost_usd_cents, forced_with_pin, force_reason, forced_by_user_id,
        notes, created_by_user_id, received_by_user_id, received_at_ms,
        created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transferId,
      transferNumber,
      dispatchNoteCode,
      input.fromLocationId,
      input.toLocationId,
      initialStatus,
      mode,
      JSON.stringify(enrichedItems),
      input.dishEquivalents ? JSON.stringify(input.dishEquivalents) : null,
      input.batchId || null,
      totalCostUsdCents,
      supervisorUser ? 1 : 0,
      input.forceReason || null,
      supervisorUser ? supervisorUser.id : null,
      input.notes || null,
      createdBy,
      !isEnTransito ? createdBy : null,
      !isEnTransito ? now : null,
      now,
      now
    );

    // Auditoría
    appendAuditEvent(rawDb, {
      actorUserId: createdBy,
      action: supervisorUser ? 'TRANSFER_FORCED' : 'TRANSFER_CREATED',
      entityType: 'transfer',
      entityId: transferId,
      payload: {
        dispatchNoteCode,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        status: initialStatus,
        itemsCount: enrichedItems.length,
        totalCostUsdCents,
        forcedWithPin: Boolean(supervisorUser),
        supervisorId: supervisorUser?.id
      }
    });

    // Publicación de evento de dominio en tiempo real
    publishDomainEvent(rawDb, {
      eventType: 'TRANSFER_CREATED',
      entityId: transferId,
      payload: {
        transferId,
        dispatchNoteCode,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        status: initialStatus
      }
    });

    transferRecord = rawDb.prepare('SELECT * FROM inter_location_transfers WHERE id = ?').get(transferId);
  })();

  return {
    ...transferRecord,
    dispatchNoteCode: transferRecord.dispatch_note_code,
    transferNumber: transferRecord.transfer_number,
    forcedWithPin: transferRecord.forced_with_pin,
    forceReason: transferRecord.force_reason,
    totalCostUsdCents: transferRecord.total_cost_usd_cents,
    items: JSON.parse(transferRecord.items_json),
    dishEquivalents: transferRecord.dish_equivalents_json ? JSON.parse(transferRecord.dish_equivalents_json) : null
  };
}

/**
 * 3. Confirmar recepción en sede destino (para envíos "en tránsito")
 */
export function confirmTransferReception(
  rawDb: Database.Database,
  transferId: string,
  receivedByUserId: string
) {
  const now = Date.now();
  let updatedRecord: any = null;

  rawDb.transaction(() => {
    const transfer = rawDb.prepare('SELECT * FROM inter_location_transfers WHERE id = ?').get(transferId) as any;
    if (!transfer) {
      const err: any = new Error(`Nota de despacho '${transferId}' no encontrada`);
      err.statusCode = 404;
      throw err;
    }

    if (transfer.status !== 'EN_TRANSITO') {
      const err: any = new Error(`La transferencia ya se encuentra en estado '${transfer.status}'`);
      err.statusCode = 400;
      throw err;
    }

    const items = JSON.parse(transfer.items_json) as Array<{
      supplyId: string;
      supplyName: string;
      quantity: number;
      unitCostUsdCents: number;
      totalCostUsdCents: number;
    }>;

    // Sumar stock en destino
    for (const itm of items) {
      rawDb.prepare(`
        INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
        VALUES (?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO UPDATE SET
          current_stock_qty = current_stock_qty + excluded.current_stock_qty,
          updated_at_ms = excluded.updated_at_ms
      `).run(
        `${transfer.to_location_id}_${itm.supplyId}`,
        transfer.to_location_id,
        itm.supplyId,
        itm.quantity,
        now
      );

      rawDb.prepare(`
        INSERT INTO inventory_movements (
          id, location_id, supply_id, movement_type, quantity_delta,
          unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
        ) VALUES (?, ?, ?, 'TRANSFERENCIA_ENTRADA', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `mov_${generateUuidV7()}`,
        transfer.to_location_id,
        itm.supplyId,
        itm.quantity,
        itm.unitCostUsdCents,
        itm.totalCostUsdCents,
        transfer.dispatch_note_code,
        `Recepción confirmada en destino desde ${transfer.from_location_id}`,
        receivedByUserId,
        now
      );
    }

    rawDb.prepare(`
      UPDATE inter_location_transfers
      SET status = 'RECIBIDO',
          received_by_user_id = ?,
          received_at_ms = ?,
          updated_at_ms = ?
      WHERE id = ?
    `).run(receivedByUserId, now, now, transferId);

    appendAuditEvent(rawDb, {
      actorUserId: receivedByUserId,
      action: 'TRANSFER_RECEIVED',
      entityType: 'transfer',
      entityId: transferId,
      payload: {
        dispatchNoteCode: transfer.dispatch_note_code,
        toLocationId: transfer.to_location_id
      }
    });

    publishDomainEvent(rawDb, {
      eventType: 'TRANSFER_RECEIVED',
      entityId: transferId,
      payload: {
        transferId,
        dispatchNoteCode: transfer.dispatch_note_code,
        toLocationId: transfer.to_location_id,
        status: 'RECIBIDO'
      }
    });

    updatedRecord = rawDb.prepare('SELECT * FROM inter_location_transfers WHERE id = ?').get(transferId);
  })();

  return {
    ...updatedRecord,
    items: JSON.parse(updatedRecord.items_json)
  };
}

/**
 * 4. Listar transferencias
 */
export function getTransfers(rawDb: Database.Database, filter?: { status?: string; locationId?: string; limit?: number }) {
  let query = 'SELECT * FROM inter_location_transfers WHERE 1=1';
  const params: any[] = [];

  if (filter?.status) {
    query += ' AND status = ?';
    params.push(filter.status);
  }
  if (filter?.locationId) {
    query += ' AND (from_location_id = ? OR to_location_id = ?)';
    params.push(filter.locationId, filter.locationId);
  }

  query += ' ORDER BY created_at_ms DESC';
  if (filter?.limit) {
    query += ' LIMIT ?';
    params.push(filter.limit);
  }

  const rows = rawDb.prepare(query).all(...params) as any[];
  return rows.map(r => ({
    ...r,
    items: JSON.parse(r.items_json),
    dishEquivalents: r.dish_equivalents_json ? JSON.parse(r.dish_equivalents_json) : null
  }));
}

export function getInTransitTransfers(rawDb: Database.Database, destinationLocationId?: string) {
  let query = "SELECT * FROM inter_location_transfers WHERE status = 'EN_TRANSITO'";
  const params: any[] = [];
  if (destinationLocationId) {
    query += ' AND to_location_id = ?';
    params.push(destinationLocationId);
  }
  query += ' ORDER BY created_at_ms DESC';
  const rows = rawDb.prepare(query).all(...params) as any[];
  return rows.map(r => ({
    ...r,
    items: JSON.parse(r.items_json),
    dishEquivalents: r.dish_equivalents_json ? JSON.parse(r.dish_equivalents_json) : null
  }));
}

/**
 * 5. Lotes Preconfigurados (CRUD)
 */
export function getTransferBatches(rawDb: Database.Database) {
  const rows = rawDb.prepare('SELECT * FROM transfer_batches WHERE is_active = 1 ORDER BY name ASC').all() as any[];
  return rows.map(r => ({
    ...r,
    items: JSON.parse(r.items_json)
  }));
}

export function createTransferBatch(rawDb: Database.Database, input: TransferBatchInput) {
  const now = Date.now();
  const id = `batch_${generateUuidV7()}`;
  rawDb.prepare(`
    INSERT INTO transfer_batches (id, name, description, from_location_id, to_location_id, items_json, is_active, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    input.name.trim(),
    input.description?.trim() || null,
    input.fromLocationId || null,
    input.toLocationId || null,
    JSON.stringify(input.items),
    now,
    now
  );
  return { id, ...input, isActive: true, createdAtMs: now, updatedAtMs: now };
}

export function updateTransferBatch(rawDb: Database.Database, id: string, input: Partial<TransferBatchInput>) {
  const now = Date.now();
  const existing = rawDb.prepare('SELECT * FROM transfer_batches WHERE id = ?').get(id) as any;
  if (!existing) {
    const err: any = new Error(`Lote '${id}' no encontrado`);
    err.statusCode = 404;
    throw err;
  }
  const name = input.name !== undefined ? input.name.trim() : existing.name;
  const description = input.description !== undefined ? input.description?.trim() : existing.description;
  const itemsJson = input.items !== undefined ? JSON.stringify(input.items) : existing.items_json;
  const fromLoc = input.fromLocationId !== undefined ? input.fromLocationId : existing.from_location_id;
  const toLoc = input.toLocationId !== undefined ? input.toLocationId : existing.to_location_id;

  rawDb.prepare(`
    UPDATE transfer_batches
    SET name = ?, description = ?, items_json = ?, from_location_id = ?, to_location_id = ?, updated_at_ms = ?
    WHERE id = ?
  `).run(name, description, itemsJson, fromLoc, toLoc, now, id);

  return { id, name, description, items: JSON.parse(itemsJson), fromLocationId: fromLoc, toLocationId: toLoc, updatedAtMs: now };
}

export function deleteTransferBatch(rawDb: Database.Database, id: string) {
  rawDb.prepare('UPDATE transfer_batches SET is_active = 0, updated_at_ms = ? WHERE id = ?').run(Date.now(), id);
  return { success: true };
}

export const listTransferBatches = getTransferBatches;
