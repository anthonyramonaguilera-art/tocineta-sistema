-- ============================================================================
-- HITO M14: MÓDULO DE RENTABILIDAD PROFESIONAL (NIVELES 1 AL 4) Y MÓDULO FISCAL
-- ============================================================================

-- 1. Interruptores en business_settings
ALTER TABLE business_settings ADD COLUMN profitability_pro_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE business_settings ADD COLUMN fiscal_module_enabled INTEGER NOT NULL DEFAULT 0;

-- 2. Historial de Cambios de Costos de Insumos
CREATE TABLE IF NOT EXISTS supply_cost_history (
  id TEXT PRIMARY KEY,
  supply_item_id TEXT NOT NULL REFERENCES supply_items(id) ON DELETE CASCADE,
  old_cost_usd_cents INTEGER NOT NULL,
  new_cost_usd_cents INTEGER NOT NULL,
  changed_by_user_id TEXT REFERENCES users(id),
  changed_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_supply_cost_history_item ON supply_cost_history(supply_item_id);
CREATE INDEX IF NOT EXISTS idx_supply_cost_history_date ON supply_cost_history(changed_at_ms);

-- 3. Entradas / Compras de Insumos para Control de Inventario
CREATE TABLE IF NOT EXISTS supply_inflows (
  id TEXT PRIMARY KEY,
  jornada_id TEXT NOT NULL REFERENCES jornadas(id),
  supply_item_id TEXT NOT NULL REFERENCES supply_items(id),
  quantity REAL NOT NULL,
  unit_cost_usd_cents INTEGER NOT NULL,
  total_cost_usd_cents INTEGER NOT NULL,
  supplier_name TEXT,
  receipt_number TEXT,
  received_by_user_id TEXT NOT NULL REFERENCES users(id),
  received_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_supply_inflows_jornada ON supply_inflows(jornada_id);
CREATE INDEX IF NOT EXISTS idx_supply_inflows_item ON supply_inflows(supply_item_id);
