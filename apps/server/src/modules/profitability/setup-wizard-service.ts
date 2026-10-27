import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { seedCatalog } from '../../db/seed-catalog.js';
import { seedInitialUsers } from '../auth/seed-users.js';
import { ensureOfficialLocations } from './locations-service.js';

export interface SetupWizardPayload {
  supplies: Array<{
    id?: string;
    name: string;
    purchaseUnit: string;
    usageUnit: string;
    conversionFactor: number;
    category: string;
    minStock: number;
    costPerUnitUsdCents: number;
  }>;
  suppliers: Array<{
    id?: string;
    name: string;
    rifPhone?: string;
    category?: string;
  }>;
  recipes: Array<{
    productId: string;
    recipeMode: 'UNITS' | 'GRAMMAGE' | 'FINISHED_PRODUCT';
    targetMarginBps: number;
    items: Array<{
      supplyId: string;
      quantityRequired: number;
      grossWeightGrams?: number;
      shrinkagePercentage?: number;
    }>;
  }>;
  initialStock: Array<{
    locationId: string;
    supplyId: string;
    quantity: number;
  }>;
}

export function generateTemplateCsv(type: 'supplies' | 'initial_stock' | 'full'): string {
  if (type === 'supplies') {
    return [
      'nombre,unidad_compra,unidad_uso,factor_conversion,categoria,stock_minimo,costo_compra_usd',
      'Pan Brioche Hamburguesa,paquete,und,1,panaderia,25,0.35',
      'Medallon Carne Prime Smash (100g),kg,g,1000,carnes,10,7.50',
      'Tocineta Ahumada Premium,kg,g,1000,embutidos,5,12.00',
      'Queso Cheddar Rebanadas,kg,g,1000,lacteos,4,8.50'
    ].join('\n');
  }

  if (type === 'initial_stock') {
    return [
      'sede_id,nombre_insumo,cantidad_stock_uso',
      'loc_alta_vista,Pan Brioche Hamburguesa,100',
      'loc_alta_vista,Medallon Carne Prime Smash (100g),150',
      'loc_los_olivos,Pan Brioche Hamburguesa,50',
      'loc_los_olivos,Medallon Carne Prime Smash (100g),80'
    ].join('\n');
  }

  return [
    'seccion,nombre,unidad_compra,unidad_uso,factor_conversion,categoria,costo_usd,stock_alta_vista,stock_los_olivos',
    'INSUMO,Pan Brioche Hamburguesa,paquete,und,1,panaderia,0.35,100,50',
    'INSUMO,Pan de Perro Caliente,paquete,und,1,panaderia,0.25,100,50',
    'INSUMO,Carne Prime Smash (100g),unid,und,1,carnes,0.75,150,80',
    'INSUMO,Tocineta Ahumada Premium,kg,kg,1,embutidos,12.00,15,5',
    'INSUMO,Queso Cheddar Rebanadas,kg,kg,1,lacteos,8.50,12,4',
    'INSUMO,Papas Francesas Congeladas,kg,kg,1,vegetales,2.80,40,15'
  ].join('\n');
}

export function exportSetupCsv(rawDb: Database.Database): string {
  const supplies = rawDb.prepare(`
    SELECT s.id, s.name, s.purchase_unit, s.usage_unit, s.conversion_factor,
           s.category, s.cost_per_unit_usd_cents, s.weighted_avg_cost_usd_cents,
           COALESCE(la.current_stock_qty, 0) as stock_alta_vista,
           COALESCE(lo.current_stock_qty, 0) as stock_los_olivos
    FROM supply_items s
    LEFT JOIN location_inventory la ON s.id = la.supply_id AND la.location_id = 'loc_alta_vista'
    LEFT JOIN location_inventory lo ON s.id = lo.supply_id AND lo.location_id = 'loc_los_olivos'
    WHERE s.is_active = 1
    ORDER BY s.name ASC
  `).all() as any[];

  const rows = [
    'id,nombre,unidad_compra,unidad_uso,factor_conversion,categoria,costo_unitario_usd,costo_promedio_usd,stock_alta_vista,stock_los_olivos'
  ];

  for (const s of supplies) {
    const cost = (s.cost_per_unit_usd_cents / 100).toFixed(2);
    const wac = (s.weighted_avg_cost_usd_cents / 100).toFixed(2);
    rows.push(
      `"${s.id}","${s.name}","${s.purchase_unit}","${s.usage_unit}",${s.conversion_factor},"${s.category}",${cost},${wac},${s.stock_alta_vista},${s.stock_los_olivos}`
    );
  }

  return rows.join('\n');
}

export function importSetupCsv(
  rawDb: Database.Database,
  csvContent: string,
  _targetLocationId: string,
  _userId: string
): { importedCount: number; errors: string[] } {
  const lines = csvContent.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) {
    return { importedCount: 0, errors: ['El archivo CSV no contiene renglones de datos válidos'] };
  }

  const dataLines = lines.slice(1);
  const now = Date.now();
  let importedCount = 0;
  const errors: string[] = [];

  const tx = rawDb.transaction(() => {
    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i];
      const cols = line.split(',').map(c => c.replace(/^["']|["']$/g, '').trim());
      if (cols.length < 3) continue;

      try {
        const name = cols[0] || `Insumo ${i + 1}`;
        const pUnit = cols[1] || 'paquete';
        const uUnit = cols[2] || 'und';
        const factor = parseFloat(cols[3]) || 1.0;
        const category = cols[4] || 'general';
        const minStock = parseFloat(cols[5]) || 0;
        const costUsd = parseFloat(cols[6]) || 0;
        const costCents = Math.round(costUsd * 100);

        const supplyId = `sup_${name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30)}`;

        rawDb.prepare(`
          INSERT INTO supply_items (
            id, name, unit, unit_measure, purchase_unit, usage_unit, conversion_factor,
            category, min_stock, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents,
            last_cost_usd_cents, is_active, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            purchase_unit = excluded.purchase_unit,
            usage_unit = excluded.usage_unit,
            conversion_factor = excluded.conversion_factor,
            category = excluded.category,
            cost_per_unit_usd_cents = excluded.cost_per_unit_usd_cents,
            weighted_avg_cost_usd_cents = excluded.weighted_avg_cost_usd_cents,
            updated_at_ms = excluded.updated_at_ms
        `).run(
          supplyId,
          name,
          pUnit,
          uUnit,
          pUnit,
          uUnit,
          factor,
          category,
          minStock,
          costCents,
          costCents,
          costCents,
          now,
          now
        );

        importedCount++;
      } catch (err: any) {
        errors.push(`Línea ${i + 2}: ${err.message}`);
      }
    }
  });

  tx();
  return { importedCount, errors };
}

export function saveWizardData(rawDb: Database.Database, input: SetupWizardPayload, userId: string): void {
  const now = Date.now();

  const tx = rawDb.transaction(() => {
    // 1. Guardar o actualizar insumos
    for (const sup of input.supplies) {
      const id = sup.id || `sup_${sup.name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30)}`;
      rawDb.prepare(`
        INSERT INTO supply_items (
          id, name, unit, unit_measure, purchase_unit, usage_unit, conversion_factor,
          category, min_stock, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents,
          last_cost_usd_cents, is_active, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          purchase_unit = excluded.purchase_unit,
          usage_unit = excluded.usage_unit,
          conversion_factor = excluded.conversion_factor,
          category = excluded.category,
          min_stock = excluded.min_stock,
          cost_per_unit_usd_cents = excluded.cost_per_unit_usd_cents,
          weighted_avg_cost_usd_cents = excluded.weighted_avg_cost_usd_cents,
          updated_at_ms = excluded.updated_at_ms
      `).run(
        id,
        sup.name.trim(),
        sup.purchaseUnit,
        sup.usageUnit,
        sup.purchaseUnit,
        sup.usageUnit,
        sup.conversionFactor || 1.0,
        sup.category || 'general',
        sup.minStock || 0,
        sup.costPerUnitUsdCents,
        sup.costPerUnitUsdCents,
        sup.costPerUnitUsdCents,
        now,
        now
      );
    }

    // 2. Guardar proveedores
    for (const pr of input.suppliers) {
      const id = pr.id || `sup_${generateUuidV7()}`;
      rawDb.prepare(`
        INSERT INTO suppliers (id, name, rif_phone, category, created_at_ms)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          rif_phone = excluded.rif_phone,
          category = excluded.category
      `).run(id, pr.name.trim(), pr.rifPhone || null, pr.category || null, now);
    }

    // 3. Guardar recetas
    for (const r of input.recipes) {
      rawDb.prepare(`
        UPDATE products
        SET recipe_mode = ?, target_margin_bps = ?, updated_at_ms = ?
        WHERE id = ?
      `).run(r.recipeMode, r.targetMarginBps, now, r.productId);

      const rec = rawDb.prepare('SELECT id FROM recipes WHERE product_id = ?').get(r.productId) as any;
      const recId = rec?.id || `rec_${generateUuidV7()}`;
      if (!rec) {
        rawDb.prepare('INSERT INTO recipes (id, product_id, name) VALUES (?, ?, ?)').run(recId, r.productId, r.productId);
      }

      rawDb.prepare('DELETE FROM recipe_items WHERE recipe_id = ?').run(recId);
      const insItem = rawDb.prepare(`
        INSERT INTO recipe_items (id, recipe_id, supply_item_id, quantity_required, gross_weight_grams, shrinkage_percentage)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const it of r.items) {
        insItem.run(
          `ritem_${generateUuidV7()}`,
          recId,
          it.supplyId,
          it.quantityRequired,
          it.grossWeightGrams || null,
          it.shrinkagePercentage || 0
        );
      }
    }

    // 4. Guardar stock inicial en location_inventory y registrar movimiento
    for (const st of input.initialStock) {
      const locId = st.locationId || 'loc_alta_vista';
      const supply = rawDb.prepare('SELECT cost_per_unit_usd_cents FROM supply_items WHERE id = ?').get(st.supplyId) as any;
      const unitCost = supply?.cost_per_unit_usd_cents || 0;

      rawDb.prepare(`
        INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
        VALUES (?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO UPDATE SET
          current_stock_qty = excluded.current_stock_qty,
          updated_at_ms = excluded.updated_at_ms
      `).run(`${locId}_${st.supplyId}`, locId, st.supplyId, st.quantity, now);

      rawDb.prepare(`
        INSERT INTO inventory_movements (
          id, location_id, supply_id, movement_type, quantity_delta,
          unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
        ) VALUES (?, ?, ?, 'AJUSTE_PRODUCCION', ?, ?, ?, 'CARGA_INICIAL', 'Carga inicial por asistente', ?, ?)
      `).run(
        `mov_${generateUuidV7()}`,
        locId,
        st.supplyId,
        st.quantity,
        unitCost,
        Math.round(st.quantity * unitCost),
        userId,
        now
      );
    }
  });

  tx();
}

// ----------------------------------------------------------------------------
// LIMPIEZA DE PRODUCCIÓN (db:init-prod) Y MODO DEMO (db:seed-demo)
// ----------------------------------------------------------------------------

export function resetToProductionClean(rawDb: Database.Database): void {
  const now = Date.now();
  const tx = rawDb.transaction(() => {
    // 1. Desactivar modo demo
    rawDb.prepare(`
      UPDATE business_settings
      SET is_demo_mode = 0, updated_at_ms = ?
      WHERE id = 'default'
    `).run(now);

    // 2. Eliminar proveedores y clientes ficticios
    rawDb.prepare("UPDATE purchases SET supplier_id = NULL WHERE supplier_id IN (SELECT id FROM suppliers WHERE id LIKE 'sup_demo_%' OR name LIKE '%San Félix%' OR name LIKE '%Ficticio%')").run();
    rawDb.prepare("UPDATE supply_items SET last_supplier_id = NULL WHERE last_supplier_id IN (SELECT id FROM suppliers WHERE id LIKE 'sup_demo_%' OR name LIKE '%San Félix%' OR name LIKE '%Ficticio%')").run();
    rawDb.prepare("UPDATE inventory_movements SET partner_customer_id = NULL WHERE partner_customer_id IN (SELECT id FROM customers WHERE id LIKE 'cust_demo_%' OR name LIKE '%Ficticio%' OR is_partner = 1)").run();
    rawDb.prepare("DELETE FROM suppliers WHERE id LIKE 'sup_demo_%' OR name LIKE '%San Félix%' OR name LIKE '%Ficticio%'").run();
    rawDb.prepare("DELETE FROM customers WHERE id LIKE 'cust_demo_%' OR name LIKE '%Ficticio%' OR is_partner = 1").run();

    // 3. Eliminar movimientos de prueba
    rawDb.prepare("DELETE FROM waste_logs WHERE reason LIKE '%DEMO%'").run();

    // 4. Asegurar 2 sedes oficiales
    ensureOfficialLocations(rawDb);

    // 5. Asegurar usuarios corporativos limpios
    seedInitialUsers(rawDb);

    // 6. Asegurar catálogo de 27 productos
    seedCatalog(rawDb);
  });

  tx();
}

export function seedDemoData(rawDb: Database.Database): void {
  const now = Date.now();
  const tx = rawDb.transaction(() => {
    // 1. Activar modo demo para mostrar badge "DEMO"
    rawDb.prepare(`
      UPDATE business_settings
      SET is_demo_mode = 1, updated_at_ms = ?
      WHERE id = 'default'
    `).run(now);

    // 2. Sembrar proveedor demo
    rawDb.prepare(`
      INSERT OR REPLACE INTO suppliers (id, name, rif_phone, category, created_at_ms)
      VALUES ('sup_demo_distribuidor', 'Distribuidora Central DEMO', '0414-0000000', 'viveres', ?)
    `).run(now);

    // 3. Sembrar stock demo en ambas sedes
    const sampleSupplies = [
      { id: 'sup_pan_brioche', name: 'Pan Brioche Hamburguesa', qtyA: 80, qtyB: 120, cost: 35 },
      { id: 'sup_pan_perro', name: 'Pan de Perro Caliente', qtyA: 90, qtyB: 110, cost: 25 },
      { id: 'sup_carne_smash', name: 'Medallón Carne Prime Smash (100g)', qtyA: 100, qtyB: 180, cost: 75 },
      { id: 'sup_tocineta_crispy', name: 'Tocineta Ahumada Premium', qtyA: 10, qtyB: 20, cost: 1200 },
      { id: 'sup_queso_cheddar', name: 'Queso Cheddar Rebanadas', qtyA: 8, qtyB: 15, cost: 850 }
    ];

    for (const sup of sampleSupplies) {
      // Sede A (Los Olivos)
      rawDb.prepare(`
        INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
        VALUES (?, 'loc_los_olivos', ?, ?, 10, ?)
      `).run(`loc_los_olivos_${sup.id}`, sup.id, sup.qtyA, now);

      // Sede B (Alta Vista)
      rawDb.prepare(`
        INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
        VALUES (?, 'loc_alta_vista', ?, ?, 20, ?)
      `).run(`loc_alta_vista_${sup.id}`, sup.id, sup.qtyB, now);

      // Actualizar supply_items
      rawDb.prepare(`
        UPDATE supply_items
        SET current_stock_qty = ?, updated_at_ms = ?
        WHERE id = ?
      `).run(sup.qtyA + sup.qtyB, now, sup.id);
    }
  });

  tx();
}
