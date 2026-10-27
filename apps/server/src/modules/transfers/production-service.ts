/**
 * SISTEMA OPERATIVO TOCINETA — MÓDULO DE PRODUCCIÓN (FASE 4)
 * Registro de producción para sub-recetas y platos terminados (Sede A / Taller Central)
 */

import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';

export interface ProductionInput {
  locationId: string;
  targetType: 'SUB_RECIPE' | 'PRODUCT';
  targetId: string;
  quantityProduced: number;
  producedByUserId: string;
  notes?: string;
}

export function registerProduction(rawDb: Database.Database, input: ProductionInput) {
  if (input.quantityProduced <= 0) {
    const err: any = new Error('La cantidad producida debe ser mayor a cero');
    err.statusCode = 400;
    throw err;
  }

  // Verificar bandera de producción en business_settings
  const setting = rawDb.prepare('SELECT production_module_enabled FROM business_settings LIMIT 1').get() as any;
  if (setting && setting.production_module_enabled === 0) {
    const err: any = new Error('El módulo de producción está temporalmente deshabilitado en configuración');
    err.statusCode = 403;
    throw err;
  }

  const now = Date.now();
  let targetName = '';
  let targetUnit = 'und';
  const suppliesNeeded: Array<{ supplyId: string; name: string; quantity: number; unit: string; unitCost: number }> = [];

  const normalizedTargetType = input.targetType.toUpperCase() as 'SUB_RECIPE' | 'PRODUCT';
  const isSubRecipe = normalizedTargetType === 'SUB_RECIPE';
  if (isSubRecipe) {
    const sub = rawDb.prepare('SELECT * FROM sub_recipes WHERE id = ?').get(input.targetId) as any;
    if (!sub) {
      const err: any = new Error(`Sub-receta '${input.targetId}' no encontrada`);
      err.statusCode = 404;
      throw err;
    }
    targetName = sub.name;
    targetUnit = sub.yield_unit || 'und';
    const subYield = sub.yield_quantity > 0 ? sub.yield_quantity : 1;
    const factor = input.quantityProduced / subYield;

    const subItems = rawDb.prepare('SELECT supply_id, quantity_required FROM sub_recipe_items WHERE sub_recipe_id = ?').all(sub.id) as any[];
    for (const sItm of subItems) {
      const supply = rawDb.prepare('SELECT name, unit, usage_unit, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents FROM supply_items WHERE id = ?').get(sItm.supply_id) as any;
      const unitCost = supply?.weighted_avg_cost_usd_cents || supply?.cost_per_unit_usd_cents || 0;
      suppliesNeeded.push({
        supplyId: sItm.supply_id,
        name: supply?.name || sItm.supply_id,
        quantity: Math.round(sItm.quantity_required * factor * 1000) / 1000,
        unit: supply?.usage_unit || supply?.unit || 'und',
        unitCost
      });
    }
  } else {
    // PRODUCT
    const product = rawDb.prepare('SELECT * FROM products WHERE id = ?').get(input.targetId) as any;
    if (!product) {
      const err: any = new Error(`Producto '${input.targetId}' no encontrado`);
      err.statusCode = 404;
      throw err;
    }
    targetName = product.name;
    targetUnit = 'und';

    const recipe = rawDb.prepare('SELECT id FROM recipes WHERE product_id = ?').get(product.id) as any;
    if (!recipe) {
      const err: any = new Error(`El producto '${product.name}' no tiene una receta técnica configurada`);
      err.statusCode = 400;
      throw err;
    }

    const items = rawDb.prepare('SELECT * FROM recipe_items WHERE recipe_id = ?').all(recipe.id) as any[];
    for (const itm of items) {
      if (itm.supply_item_id) {
        const supply = rawDb.prepare('SELECT name, unit, usage_unit, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents FROM supply_items WHERE id = ?').get(itm.supply_item_id) as any;
        const unitCost = supply?.weighted_avg_cost_usd_cents || supply?.cost_per_unit_usd_cents || 0;
        suppliesNeeded.push({
          supplyId: itm.supply_item_id,
          name: supply?.name || itm.supply_item_id,
          quantity: Math.round(itm.quantity_required * input.quantityProduced * 1000) / 1000,
          unit: supply?.usage_unit || supply?.unit || 'und',
          unitCost
        });
      } else if (itm.sub_recipe_id) {
        const sub = rawDb.prepare('SELECT yield_quantity FROM sub_recipes WHERE id = ?').get(itm.sub_recipe_id) as any;
        const subYield = sub?.yield_quantity > 0 ? sub.yield_quantity : 1;
        const subItems = rawDb.prepare('SELECT supply_id, quantity_required FROM sub_recipe_items WHERE sub_recipe_id = ?').all(itm.sub_recipe_id) as any[];
        for (const sItm of subItems) {
          const factor = (itm.quantity_required / subYield) * input.quantityProduced;
          const supply = rawDb.prepare('SELECT name, unit, usage_unit, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents FROM supply_items WHERE id = ?').get(sItm.supply_id) as any;
          const unitCost = supply?.weighted_avg_cost_usd_cents || supply?.cost_per_unit_usd_cents || 0;
          suppliesNeeded.push({
            supplyId: sItm.supply_id,
            name: supply?.name || sItm.supply_id,
            quantity: Math.round(sItm.quantity_required * factor * 1000) / 1000,
            unit: supply?.usage_unit || supply?.unit || 'und',
            unitCost
          });
        }
      }
    }
  }

  // Calcular costo total
  let totalCostUsdCents = 0;
  for (const itm of suppliesNeeded) {
    totalCostUsdCents += Math.round(itm.quantity * itm.unitCost);
  }

  const prodLogId = `prod_${generateUuidV7()}`;
  const userId = input.producedByUserId || (input as any).createdBy || 'usr_admin';
  let logRecord: any = null;

  rawDb.transaction(() => {
    // 1. Descontar materias primas en location_inventory
    for (const itm of suppliesNeeded) {
      rawDb.prepare(`
        UPDATE location_inventory
        SET current_stock_qty = current_stock_qty - ?, updated_at_ms = ?
        WHERE location_id = ? AND supply_id = ?
      `).run(itm.quantity, now, input.locationId, itm.supplyId);

      rawDb.prepare(`
        INSERT INTO inventory_movements (
          id, location_id, supply_id, movement_type, quantity_delta,
          unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
        ) VALUES (?, ?, ?, 'AJUSTE_PRODUCCION', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `mov_${generateUuidV7()}`,
        input.locationId,
        itm.supplyId,
        -itm.quantity,
        itm.unitCost,
        Math.round(itm.quantity * itm.unitCost),
        `PROD-${prodLogId.slice(-6).toUpperCase()}`,
        `Consumo para producción de ${input.quantityProduced} ${targetUnit} de ${targetName}`,
        userId,
        now
      );
    }

    // 2. Si el producto o sub-receta existe como ítem en supply_items, incrementar su stock
    const matchingSupply = rawDb.prepare('SELECT id, unit FROM supply_items WHERE id = ? OR name = ?').get(input.targetId, targetName) as any;
    if (matchingSupply) {
      const existingLocRow = rawDb.prepare('SELECT id, current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get(input.locationId, matchingSupply.id) as any;
      if (existingLocRow) {
        rawDb.prepare('UPDATE location_inventory SET current_stock_qty = current_stock_qty + ?, updated_at_ms = ? WHERE id = ?').run(
          input.quantityProduced,
          now,
          existingLocRow.id
        );
      } else {
        rawDb.prepare(`
          INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
          VALUES (?, ?, ?, ?, 0, ?)
        `).run(
          `${input.locationId}_${matchingSupply.id}`,
          input.locationId,
          matchingSupply.id,
          input.quantityProduced,
          now
        );
      }

      rawDb.prepare('UPDATE supply_items SET current_stock_qty = current_stock_qty + ?, updated_at_ms = ? WHERE id = ?').run(
        input.quantityProduced,
        now,
        matchingSupply.id
      );

      const unitCostTarget = input.quantityProduced > 0 ? Math.round(totalCostUsdCents / input.quantityProduced) : 0;
      rawDb.prepare(`
        INSERT INTO inventory_movements (
          id, location_id, supply_id, movement_type, quantity_delta,
          unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
        ) VALUES (?, ?, ?, 'AJUSTE_PRODUCCION', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `mov_${generateUuidV7()}`,
        input.locationId,
        matchingSupply.id,
        input.quantityProduced,
        unitCostTarget,
        totalCostUsdCents,
        `PROD-${prodLogId.slice(-6).toUpperCase()}`,
        `Ingreso por producción de ${targetName}`,
        userId,
        now
      );
    }

    // 3. Registrar en production_logs
    rawDb.prepare(`
      INSERT INTO production_logs (
        id, location_id, target_type, target_id, target_name,
        quantity_produced, unit, total_cost_usd_cents, consumed_supplies_json,
        produced_by_user_id, notes, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      prodLogId,
      input.locationId,
      normalizedTargetType,
      input.targetId,
      targetName,
      input.quantityProduced,
      targetUnit,
      totalCostUsdCents,
      JSON.stringify(suppliesNeeded),
      userId,
      input.notes || null,
      now
    );

    appendAuditEvent(rawDb, {
      actorUserId: userId,
      action: 'PRODUCTION_REGISTERED',
      entityType: 'production_log',
      entityId: prodLogId,
      payload: {
        locationId: input.locationId,
        targetType: input.targetType,
        targetName,
        quantityProduced: input.quantityProduced,
        totalCostUsdCents
      }
    });

    publishDomainEvent(rawDb, {
      eventType: 'PRODUCTION_REGISTERED',
      entityId: prodLogId,
      payload: {
        prodLogId,
        locationId: input.locationId,
        targetName,
        quantityProduced: input.quantityProduced
      }
    });

    logRecord = rawDb.prepare('SELECT * FROM production_logs WHERE id = ?').get(prodLogId);
  })();

  return {
    ...logRecord,
    productionLogId: logRecord.id,
    consumedSupplies: JSON.parse(logRecord.consumed_supplies_json)
  };
}

export function getProductionLogs(rawDb: Database.Database, locationId?: string, limit = 20) {
  let query = 'SELECT * FROM production_logs WHERE 1=1';
  const params: any[] = [];
  if (locationId) {
    query += ' AND location_id = ?';
    params.push(locationId);
  }
  query += ' ORDER BY created_at_ms DESC LIMIT ?';
  params.push(limit);

  const rows = rawDb.prepare(query).all(...params) as any[];
  return rows.map(r => ({
    ...r,
    consumedSupplies: JSON.parse(r.consumed_supplies_json)
  }));
}
