-- ============================================================================
-- HITO FASE 4: ENVÍOS ENTRE SEDES + DELIVERY POR SEDE + PANEL DE LA DUEÑA + PRODUCCIÓN
-- ============================================================================

-- 1. Tabla de Transferencias entre Sedes (Notas de Despacho)
CREATE TABLE IF NOT EXISTS inter_location_transfers (
  id TEXT PRIMARY KEY,
  transfer_number INTEGER NOT NULL,
  dispatch_note_code TEXT NOT NULL UNIQUE,
  from_location_id TEXT NOT NULL REFERENCES locations(id),
  to_location_id TEXT NOT NULL REFERENCES locations(id),
  status TEXT NOT NULL CHECK(status IN ('EN_TRANSITO', 'RECIBIDO', 'COMPLETADO', 'CANCELADO')),
  mode TEXT NOT NULL CHECK(mode IN ('DISH_EQUIVALENT', 'LOOSE_SUPPLIES', 'BATCH')),
  items_json TEXT NOT NULL,
  dish_equivalents_json TEXT,
  batch_id TEXT,
  total_cost_usd_cents INTEGER NOT NULL DEFAULT 0,
  forced_with_pin INTEGER NOT NULL DEFAULT 0,
  force_reason TEXT,
  forced_by_user_id TEXT REFERENCES users(id),
  notes TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  received_by_user_id TEXT REFERENCES users(id),
  received_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transfers_from ON inter_location_transfers(from_location_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON inter_location_transfers(to_location_id);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON inter_location_transfers(status);
CREATE INDEX IF NOT EXISTS idx_transfers_code ON inter_location_transfers(dispatch_note_code);

-- 2. Tabla de Lotes Preconfigurados de Envíos (Batches)
CREATE TABLE IF NOT EXISTS transfer_batches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  from_location_id TEXT REFERENCES locations(id),
  to_location_id TEXT REFERENCES locations(id),
  items_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_batches_active ON transfer_batches(is_active);

-- 3. Tabla de Registro de Producción en Sede A (Producción de sub-recetas o productos terminados)
CREATE TABLE IF NOT EXISTS production_logs (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id),
  target_type TEXT NOT NULL CHECK(target_type IN ('SUB_RECIPE', 'PRODUCT')),
  target_id TEXT NOT NULL,
  target_name TEXT NOT NULL,
  quantity_produced REAL NOT NULL,
  unit TEXT NOT NULL,
  total_cost_usd_cents INTEGER NOT NULL DEFAULT 0,
  consumed_supplies_json TEXT NOT NULL,
  produced_by_user_id TEXT NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_production_loc ON production_logs(location_id);
CREATE INDEX IF NOT EXISTS idx_production_created ON production_logs(created_at_ms);

-- 4. Ampliaciones en Repartidores y Liquidación por Sede
ALTER TABLE delivery_drivers ADD COLUMN location_id TEXT REFERENCES locations(id);
ALTER TABLE delivery_driver_settlements ADD COLUMN location_id TEXT REFERENCES locations(id);

UPDATE delivery_drivers SET location_id = 'loc_alta_vista' WHERE location_id IS NULL;
UPDATE delivery_driver_settlements SET location_id = 'loc_alta_vista' WHERE location_id IS NULL;

-- 5. Banderas y Ajustes en Business Settings
ALTER TABLE business_settings ADD COLUMN production_module_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE business_settings ADD COLUMN transfers_require_transit INTEGER NOT NULL DEFAULT 0;

-- 6. Sembrar Lotes Preconfigurados Iniciales de Alta Rotación
INSERT OR IGNORE INTO transfer_batches (id, name, description, from_location_id, to_location_id, items_json, is_active, created_at_ms, updated_at_ms)
VALUES
  (
    'batch_fin_de_semana',
    'Lote Fin de Semana (Carga Completa)',
    'Reposición para viernes a domingo: 100 panes brioche, 100 carnes smash, 50 salchichas, 5kg tocineta',
    'loc_los_olivos',
    'loc_alta_vista',
    '[{"supplyId":"sup_pan_brioche","quantity":100},{"supplyId":"sup_carne_smash","quantity":100},{"supplyId":"sup_salchicha_pollo","quantity":50},{"supplyId":"sup_tocineta_crispy","quantity":5}]',
    1,
    1730000000000,
    1730000000000
  ),
  (
    'batch_reposicion_rapida_perros',
    'Lote Reposición Perros Calientes',
    '50 panes de perro + 50 salchichas de pollo',
    'loc_los_olivos',
    'loc_alta_vista',
    '[{"supplyId":"sup_pan_perro","quantity":50},{"supplyId":"sup_salchicha_pollo","quantity":50}]',
    1,
    1730000000000,
    1730000000000
  ),
  (
    'batch_reposicion_burgers',
    'Lote Reposición Hamburguesas Smash',
    '50 panes brioche + 100 carnes smash + 3kg queso cheddar',
    'loc_los_olivos',
    'loc_alta_vista',
    '[{"supplyId":"sup_pan_brioche","quantity":50},{"supplyId":"sup_carne_smash","quantity":100},{"supplyId":"sup_queso_cheddar","quantity":3}]',
    1,
    1730000000000,
    1730000000000
  );
