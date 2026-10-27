import { getDatabaseContext } from '../apps/server/src/db/connection.js';
import { saveSubRecipe, saveProductRecipe } from '../apps/server/src/modules/profitability/recipes-service.js';

const dbCtx = getDatabaseContext();
const db = dbCtx.rawDb;

console.log('--- Configurando las 3 Recetas Reales de Prueba ---');

const now = Date.now();

// 1. Insumos Clave
const supplies = [
  { id: 'sup_pan_brioche', name: 'Pan Brioche Artesanal', purchase_unit: 'paquete', usage_unit: 'und', conversion_factor: 10, category: 'panaderia', min_stock: 30, cost: 60 },
  { id: 'sup_carne_smash_150g', name: 'Carne Prime Smash (150g)', purchase_unit: 'kg', usage_unit: 'und', conversion_factor: 6.67, category: 'carnes', min_stock: 40, cost: 180 },
  { id: 'sup_queso_cheddar', name: 'Queso Cheddar Fundido', purchase_unit: 'paquete', usage_unit: 'rebanada', conversion_factor: 24, category: 'lacteos', min_stock: 50, cost: 30 },
  { id: 'sup_tocineta_ahumada', name: 'Tocineta Ahumada Crujiente', purchase_unit: 'paquete', usage_unit: 'tira', conversion_factor: 30, category: 'carnes', min_stock: 60, cost: 35 },
  { id: 'sup_cebolla_morada', name: 'Cebolla Morada Fresca', purchase_unit: 'kg', usage_unit: 'porcion', conversion_factor: 20, category: 'vegetales', min_stock: 15, cost: 15 },
  { id: 'sup_carne_molida_cruda', name: 'Carne Molida Especial (Cruda)', purchase_unit: 'kg', usage_unit: 'kg', conversion_factor: 1, category: 'carnes', min_stock: 10, cost: 850 },
  { id: 'sup_pan_clasico', name: 'Pan Clásico Tocineta', purchase_unit: 'paquete', usage_unit: 'und', conversion_factor: 12, category: 'panaderia', min_stock: 25, cost: 45 },
  { id: 'sup_malta_lata_250', name: 'Malta Lata 250 ml', purchase_unit: 'caja', usage_unit: 'lata', conversion_factor: 24, category: 'bebidas', min_stock: 48, cost: 65 }
];

for (const s of supplies) {
  db.prepare(`
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
    s.id, s.name, s.purchase_unit, s.usage_unit, s.purchase_unit, s.usage_unit,
    s.conversion_factor, s.category, s.min_stock, s.cost, s.cost, s.cost, now, now
  );

  // Sembrar stock en Sede B (Alta Vista) y Sede A (Los Olivos)
  db.prepare(`
    INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
    VALUES (?, 'loc_alta_vista', ?, 100, ?, ?)
    ON CONFLICT(id) DO UPDATE SET current_stock_qty = 100, updated_at_ms = excluded.updated_at_ms
  `).run(`loc_alta_vista_${s.id}`, s.id, s.min_stock, now);

  db.prepare(`
    INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
    VALUES (?, 'loc_los_olivos', ?, 50, ?, ?)
    ON CONFLICT(id) DO UPDATE SET current_stock_qty = 50, updated_at_ms = excluded.updated_at_ms
  `).run(`loc_los_olivos_${s.id}`, s.id, s.min_stock, now);
}

// 2. Sub-Receta: Salsa Especial Tocinetera (Rendimiento: 2 Litros)
const subRecipe = saveSubRecipe(db, {
  id: 'sub_salsa_especial',
  name: 'Salsa Especial Tocinetera',
  yieldQuantity: 2.0,
  yieldUnit: 'litro',
  notes: 'Salsa especial de la casa con base de tocineta',
  items: [
    { supplyId: 'sup_tocineta_ahumada', quantityRequired: 5 },
    { supplyId: 'sup_cebolla_morada', quantityRequired: 2 }
  ]
});
console.log('🥣 Sub-receta guardada:', subRecipe.name, `(${subRecipe.yieldQuantity} ${subRecipe.yieldUnit}) - Costo Unitario: $${(subRecipe.costPerUnitUsdCents / 100).toFixed(2)}/${subRecipe.yieldUnit}`);

// 3. RECETA 1: "Americana Deluxe" -> Modo UNITS (Por Unidades)
const prod1Id = 'prod_americana_deluxe';
const rec1 = saveProductRecipe(db, prod1Id, {
  recipeMode: 'UNITS',
  targetMarginBps: 6500,
  notes: 'Ficha técnica oficial de Americana Deluxe por unidades',
  items: [
    { supplyItemId: 'sup_pan_brioche', quantityRequired: 1, shrinkagePercentage: 0 },
    { supplyItemId: 'sup_carne_smash_150g', quantityRequired: 1, shrinkagePercentage: 0 },
    { supplyItemId: 'sup_queso_cheddar', quantityRequired: 2, shrinkagePercentage: 0 },
    { supplyItemId: 'sup_tocineta_ahumada', quantityRequired: 3, shrinkagePercentage: 0 },
    { subRecipeId: 'sub_salsa_especial', quantityRequired: 0.05, shrinkagePercentage: 0 }
  ]
});
console.log('🍔 Receta 1 Guardada:', rec1.productName, `Modo: ${rec1.recipeMode}, Costo: $${(rec1.calculatedCostUsdCents / 100).toFixed(2)}, Margen: ${(rec1.currentMarginBps / 100).toFixed(1)}%, Sugerido: $${(rec1.suggestedPriceUsdCents / 100).toFixed(2)}`);

// 4. RECETA 2: "Clásica Tocinetera" -> Modo GRAMMAGE (Por Gramaje con Merma Cocción)
let prod2 = db.prepare("SELECT id FROM products WHERE id = 'prod_clasica' OR name LIKE '%clasica%' LIMIT 1").get() as any;
let prod2Id = prod2?.id;
if (!prod2Id) {
  prod2Id = 'prod_clasica';
  db.prepare(`
    INSERT INTO products (id, name, station, category_id, price_usd_cents, recipe_mode, target_margin_bps, is_active, created_at_ms, updated_at_ms)
    VALUES (?, 'Clásica Tocinetera', 'hamburguesas', 'cat_hamburguesas', 850, 'GRAMMAGE', 6500, 1, ?, ?)
  `).run(prod2Id, now, now);
}

const rec2 = saveProductRecipe(db, prod2Id, {
  recipeMode: 'GRAMMAGE',
  targetMarginBps: 6500,
  notes: 'Carne molida cruda 180g con 15% de merma en cocción',
  items: [
    { supplyItemId: 'sup_pan_clasico', quantityRequired: 1, shrinkagePercentage: 0 },
    { supplyItemId: 'sup_carne_molida_cruda', quantityRequired: 180, grossWeightGrams: 180, shrinkagePercentage: 15 },
    { supplyItemId: 'sup_queso_cheddar', quantityRequired: 1, shrinkagePercentage: 0 },
    { subRecipeId: 'sub_salsa_especial', quantityRequired: 0.03, shrinkagePercentage: 0 }
  ]
});
console.log('🍔 Receta 2 Guardada:', rec2.productName, `Modo: ${rec2.recipeMode}, Costo: $${(rec2.calculatedCostUsdCents / 100).toFixed(2)}, Margen: ${(rec2.currentMarginBps / 100).toFixed(1)}%, Sugerido: $${(rec2.suggestedPriceUsdCents / 100).toFixed(2)}`);

// 5. RECETA 3: "Malta Lata 250 ml" -> Modo FINISHED_PRODUCT (Plato Terminado)
const prod3Id = 'prod_malta_lata_250';
const rec3 = saveProductRecipe(db, prod3Id, {
  recipeMode: 'FINISHED_PRODUCT',
  targetMarginBps: 6500,
  notes: 'Descuenta stock directo de la lata de malta',
  items: [
    { supplyItemId: 'sup_malta_lata_250', quantityRequired: 1, shrinkagePercentage: 0 }
  ]
});
console.log('🥤 Receta 3 Guardada:', rec3.productName, `Modo: ${rec3.recipeMode}, Costo: $${(rec3.calculatedCostUsdCents / 100).toFixed(2)}, Margen: ${(rec3.currentMarginBps / 100).toFixed(1)}%, Sugerido: $${(rec3.suggestedPriceUsdCents / 100).toFixed(2)}`);

console.log('\n🎉 LAS 3 RECETAS REALES DE PRUEBA HAN SIDO CARGADAS CON ÉXITO:');
console.log('   1. Americana Deluxe (Modo UNITS: Pan Brioche, Carne Smash 150g, Queso Cheddar x2, Tocineta x3, Salsa Especial)');
console.log('   2. Clásica Tocinetera (Modo GRAMMAGE: Pan Clásico, Carne molida cruda 180g con 15% merma cocción, Queso, Salsa)');
console.log('   3. Malta Lata 250 ml (Modo FINISHED_PRODUCT: Descuenta 1 lata directo)');
