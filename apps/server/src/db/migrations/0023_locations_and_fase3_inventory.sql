-- ============================================================================
-- HITO FASE 3: SEDES COMO DATO + INVENTARIO + RECETAS + COMPRAS + COSTOS + MERMAS
-- ============================================================================

-- 1. Tabla de Sedes Oficiales
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('production', 'sale', 'mixed')),
  is_active INTEGER NOT NULL DEFAULT 1,
  address TEXT,
  phone TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

-- Sembrar las 2 sedes oficiales obligatorias
INSERT OR REPLACE INTO locations (id, name, type, is_active, address, phone, created_at_ms, updated_at_ms)
VALUES
  ('loc_los_olivos', 'Sede A: Los Olivos', 'mixed', 1, 'Los Olivos, Puerto Ordaz', '0424-9000001', 1729800000000, 1729800000000),
  ('loc_alta_vista', 'Sede B: Alta Vista', 'sale', 1, 'Detrás de Torre Movistar, Alta Vista, Puerto Ordaz', '0424-9728209', 1729800000000, 1729800000000);

-- 2. Vincular location_id a pedidos, turnos, sesiones, movimientos, gastos, entregas, compras y conteos
ALTER TABLE orders ADD COLUMN location_id TEXT NOT NULL DEFAULT 'loc_alta_vista';
ALTER TABLE jornadas ADD COLUMN location_id TEXT NOT NULL DEFAULT 'loc_alta_vista';
ALTER TABLE cash_sessions ADD COLUMN location_id TEXT NOT NULL DEFAULT 'loc_alta_vista';
ALTER TABLE inventory_movements ADD COLUMN location_id TEXT NOT NULL DEFAULT 'loc_alta_vista';
ALTER TABLE operating_expenses ADD COLUMN location_id TEXT NOT NULL DEFAULT 'loc_alta_vista';
ALTER TABLE deliveries ADD COLUMN location_id TEXT NOT NULL DEFAULT 'loc_alta_vista';
ALTER TABLE purchases ADD COLUMN location_id TEXT NOT NULL DEFAULT 'loc_alta_vista';
ALTER TABLE purchases ADD COLUMN due_date_ms INTEGER;
ALTER TABLE stock_counts ADD COLUMN location_id TEXT NOT NULL DEFAULT 'loc_alta_vista';
ALTER TABLE users ADD COLUMN default_location_id TEXT NOT NULL DEFAULT 'loc_alta_vista';
ALTER TABLE users ADD COLUMN allowed_locations_json TEXT NOT NULL DEFAULT '["loc_los_olivos", "loc_alta_vista"]';
ALTER TABLE business_settings ADD COLUMN is_demo_mode INTEGER NOT NULL DEFAULT 0;

-- Asignar registros existentes a Sede B (Alta Vista)
UPDATE orders SET location_id = 'loc_alta_vista' WHERE location_id IS NULL OR location_id = '';
UPDATE jornadas SET location_id = 'loc_alta_vista' WHERE location_id IS NULL OR location_id = '';
UPDATE cash_sessions SET location_id = 'loc_alta_vista' WHERE location_id IS NULL OR location_id = '';
UPDATE inventory_movements SET location_id = 'loc_alta_vista' WHERE location_id IS NULL OR location_id = '';
UPDATE purchases SET location_id = 'loc_alta_vista' WHERE location_id IS NULL OR location_id = '';

-- 3. Stock por (insumo, sede)
CREATE TABLE IF NOT EXISTS location_inventory (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  supply_id TEXT NOT NULL REFERENCES supply_items(id) ON DELETE CASCADE,
  current_stock_qty REAL NOT NULL DEFAULT 0,
  minimum_stock_qty REAL NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_loc_inv_loc ON location_inventory(location_id);
CREATE INDEX IF NOT EXISTS idx_loc_inv_sup ON location_inventory(supply_id);

-- 4. Ampliación de supply_items (Unidad compra, uso, factor, costo promedio ponderado)
ALTER TABLE supply_items ADD COLUMN purchase_unit TEXT NOT NULL DEFAULT 'paquete';
ALTER TABLE supply_items ADD COLUMN usage_unit TEXT NOT NULL DEFAULT 'und';
ALTER TABLE supply_items ADD COLUMN conversion_factor REAL NOT NULL DEFAULT 1.0;
ALTER TABLE supply_items ADD COLUMN category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE supply_items ADD COLUMN min_stock REAL NOT NULL DEFAULT 0;
ALTER TABLE supply_items ADD COLUMN weighted_avg_cost_usd_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supply_items ADD COLUMN last_cost_usd_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supply_items ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

-- 5. Modos de receta en productos
ALTER TABLE products ADD COLUMN recipe_mode TEXT NOT NULL CHECK(recipe_mode IN ('UNITS', 'GRAMMAGE', 'FINISHED_PRODUCT')) DEFAULT 'UNITS';
ALTER TABLE products ADD COLUMN target_margin_bps INTEGER NOT NULL DEFAULT 6500;

-- 6. Sub-recetas con rendimiento
CREATE TABLE IF NOT EXISTS sub_recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  yield_quantity REAL NOT NULL,
  yield_unit TEXT NOT NULL,
  cost_per_unit_usd_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sub_recipe_items (
  id TEXT PRIMARY KEY,
  sub_recipe_id TEXT NOT NULL REFERENCES sub_recipes(id) ON DELETE CASCADE,
  supply_id TEXT NOT NULL REFERENCES supply_items(id) ON DELETE CASCADE,
  quantity_required REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sub_recipe_items_sub ON sub_recipe_items(sub_recipe_id);

-- Recrear inventory_movements para admitir todos los tipos de movimiento (transferencias, mermas, ajustes) y location_id
CREATE TABLE IF NOT EXISTS inventory_movements_v2 (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL DEFAULT 'loc_alta_vista' REFERENCES locations(id),
  supply_id TEXT NOT NULL REFERENCES supply_items(id),
  movement_type TEXT NOT NULL,
  quantity_delta REAL NOT NULL,
  unit_cost_usd_cents INTEGER NOT NULL,
  total_cost_usd_cents INTEGER NOT NULL,
  partner_customer_id TEXT REFERENCES customers(id),
  reference_doc TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

INSERT OR IGNORE INTO inventory_movements_v2 (id, location_id, supply_id, movement_type, quantity_delta, unit_cost_usd_cents, total_cost_usd_cents, partner_customer_id, reference_doc, notes, created_by, created_at_ms)
SELECT id, 'loc_alta_vista', supply_id, movement_type, quantity_delta, unit_cost_usd_cents, total_cost_usd_cents, partner_customer_id, reference_doc, notes, created_by, created_at_ms
FROM inventory_movements;

DROP TABLE IF EXISTS inventory_movements;
ALTER TABLE inventory_movements_v2 RENAME TO inventory_movements;

CREATE INDEX IF NOT EXISTS idx_inv_movements_supply ON inventory_movements(supply_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_type ON inventory_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_inv_movements_loc ON inventory_movements(location_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_date ON inventory_movements(created_at_ms);

-- 7. Renglones de receta con soporte a gramaje, merma y sub-recetas (supply_item_id nullable para sub-recetas)
CREATE TABLE IF NOT EXISTS recipe_items_v2 (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  supply_item_id TEXT REFERENCES supply_items(id),
  quantity_required REAL NOT NULL,
  gross_weight_grams REAL,
  shrinkage_percentage REAL DEFAULT 0,
  sub_recipe_id TEXT REFERENCES sub_recipes(id)
);

INSERT OR IGNORE INTO recipe_items_v2 (id, recipe_id, supply_item_id, quantity_required)
SELECT id, recipe_id, supply_item_id, quantity_required
FROM recipe_items;

DROP TABLE IF EXISTS recipe_items;
ALTER TABLE recipe_items_v2 RENAME TO recipe_items;

CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe ON recipe_items(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_supply ON recipe_items(supply_item_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_sub ON recipe_items(sub_recipe_id);

-- 8. Historial de Precios de Venta (Inmutable)
CREATE TABLE IF NOT EXISTS price_history (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  old_price_usd_cents INTEGER NOT NULL,
  new_price_usd_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  confirmed_by_user_id TEXT REFERENCES users(id),
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_prod ON price_history(product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(created_at_ms);

-- 9. Registro de Mermas (Waste Logs)
CREATE TABLE IF NOT EXISTS waste_logs (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id),
  item_type TEXT NOT NULL CHECK(item_type IN ('supply', 'product')),
  supply_id TEXT REFERENCES supply_items(id),
  product_id TEXT REFERENCES products(id),
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  cost_usd_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reported_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_waste_logs_loc ON waste_logs(location_id);
CREATE INDEX IF NOT EXISTS idx_waste_logs_date ON waste_logs(created_at_ms);

-- 10. Saneamiento obligatorio: Eliminar proveedores y clientes ficticios
UPDATE purchases SET supplier_id = NULL WHERE supplier_id IN ('sup_polar', 'sup_pan_guayana', 'sup_carnes_sf', 'sup_empaques_bolivar');
UPDATE supply_items SET last_supplier_id = NULL WHERE last_supplier_id IN ('sup_polar', 'sup_pan_guayana', 'sup_carnes_sf', 'sup_empaques_bolivar');
UPDATE inventory_movements SET partner_customer_id = NULL WHERE partner_customer_id IN ('cust_partner_admin', 'cust_partner_aliado', 'cust_vip_cliente1');
DELETE FROM suppliers WHERE id IN ('sup_polar', 'sup_pan_guayana', 'sup_carnes_sf', 'sup_empaques_bolivar');
DELETE FROM customers WHERE id IN ('cust_partner_admin', 'cust_partner_aliado', 'cust_vip_cliente1');
