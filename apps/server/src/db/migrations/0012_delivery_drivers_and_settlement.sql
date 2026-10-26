-- ============================================================================
-- HITO M11: MÓDULO OPERATIVO DE DELIVERY, MOTORIZADOS Y LIQUIDACIÓN NOCTURNA
-- ============================================================================

-- 1. Tabla de Repartidores / Motorizados Habituales del Food Truck
CREATE TABLE IF NOT EXISTS delivery_drivers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delivery_drivers_active ON delivery_drivers(is_active);

-- Sembrar los 3 repartidores corporativos oficiales
INSERT OR IGNORE INTO delivery_drivers (id, name, phone, is_active, created_at_ms, updated_at_ms)
VALUES 
  ('drv_carlos_mora', 'REPARTIDOR 1', '04148523311', 1, 1700000000000, 1700000000000),
  ('drv_jose_ramirez', 'REPARTIDOR 2', '04249112233', 1, 1700000000000, 1700000000000),
  ('drv_miguel_perez', 'REPARTIDOR 3', '04128994455', 1, 1700000000000, 1700000000000);

-- 2. Ampliar tabla orders con campos de delivery
ALTER TABLE orders ADD COLUMN delivery_reference TEXT;
ALTER TABLE orders ADD COLUMN motorizado_id TEXT REFERENCES delivery_drivers(id);

-- 3. Ampliar tabla deliveries para control de efectivo en mano y liquidación
ALTER TABLE deliveries ADD COLUMN driver_id TEXT REFERENCES delivery_drivers(id);
ALTER TABLE deliveries ADD COLUMN delivery_reference TEXT;
ALTER TABLE deliveries ADD COLUMN cash_collected_by_driver INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN food_cash_amount_usd_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN settlement_id TEXT;
ALTER TABLE deliveries ADD COLUMN updated_at_ms INTEGER;

-- 4. Tabla de Liquidaciones Nocturnas de Motorizados
CREATE TABLE IF NOT EXISTS delivery_driver_settlements (
  id TEXT PRIMARY KEY,
  jornada_id TEXT NOT NULL REFERENCES jornadas(id),
  driver_id TEXT NOT NULL REFERENCES delivery_drivers(id),
  driver_name TEXT NOT NULL,
  total_trips INTEGER NOT NULL,
  total_delivery_fees_usd_cents INTEGER NOT NULL,
  total_food_cash_collected_usd_cents INTEGER NOT NULL,
  net_balance_usd_cents INTEGER NOT NULL,
  balance_direction TEXT NOT NULL CHECK(balance_direction IN ('DRIVER_PAYS_CASHIER', 'CASHIER_PAYS_DRIVER', 'BALANCED')),
  delivery_accounting_mode TEXT NOT NULL DEFAULT 'THIRD_PARTY_PASS_THROUGH',
  settled_by_user_id TEXT NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settlements_jornada ON delivery_driver_settlements(jornada_id);
CREATE INDEX IF NOT EXISTS idx_settlements_driver ON delivery_driver_settlements(driver_id);
