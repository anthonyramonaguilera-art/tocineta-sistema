-- MIGRACIÓN 0026: FASE 6 — PERSONAL, PERMISOS, NÓMINA Y POOL DE PROPINAS

-- 1. Trazabilidad en Órdenes (Anulaciones y Descuentos)
ALTER TABLE orders ADD COLUMN cancelled_by_user_id TEXT REFERENCES users(id);
ALTER TABLE orders ADD COLUMN discount_by_user_id TEXT REFERENCES users(id);
ALTER TABLE orders ADD COLUMN discount_reason TEXT;

-- 2. Banderas de Nómina en Ajustes del Negocio
ALTER TABLE business_settings ADD COLUMN payroll_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE business_settings ADD COLUMN fixed_dinner_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE business_settings ADD COLUMN fixed_dinner_cost_usd_cents INTEGER NOT NULL DEFAULT 250;

-- 3. Perfiles de Nómina por Empleado (Esquema y Salario Base)
CREATE TABLE IF NOT EXISTS staff_payroll_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  frequency TEXT NOT NULL CHECK(frequency IN ('DIARIO', 'SEMANAL', 'QUINCENAL')) DEFAULT 'SEMANAL',
  base_salary_usd_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_profile_user ON staff_payroll_profiles(user_id);

-- 4. Liquidaciones de Nómina (Histórico y Recibos)
CREATE TABLE IF NOT EXISTS staff_payroll_settlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start_ms INTEGER NOT NULL,
  period_end_ms INTEGER NOT NULL,
  frequency TEXT NOT NULL CHECK(frequency IN ('DIARIO', 'SEMANAL', 'QUINCENAL')),
  base_salary_usd_cents INTEGER NOT NULL,
  bonuses_usd_cents INTEGER NOT NULL DEFAULT 0,
  advances_usd_cents INTEGER NOT NULL DEFAULT 0,
  consumptions_charged_usd_cents INTEGER NOT NULL DEFAULT 0,
  consumptions_forgiven_usd_cents INTEGER NOT NULL DEFAULT 0,
  fixed_dinner_count INTEGER NOT NULL DEFAULT 0,
  fixed_dinner_cost_usd_cents INTEGER NOT NULL DEFAULT 0,
  net_usd_cents INTEGER NOT NULL,
  net_bs_cents INTEGER NOT NULL,
  rate_micro_bs INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  notes TEXT,
  settled_by_user_id TEXT NOT NULL REFERENCES users(id),
  receipt_pdf_path TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payroll_settlements_user ON staff_payroll_settlements(user_id);
CREATE INDEX IF NOT EXISTS idx_payroll_settlements_date ON staff_payroll_settlements(created_at_ms);

-- 5. Ajustes de Nómina (Bonos y Adelantos)
CREATE TABLE IF NOT EXISTS staff_payroll_adjustments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('BONO', 'ADELANTO')),
  amount_usd_cents INTEGER NOT NULL,
  amount_bs_cents INTEGER NOT NULL DEFAULT 0,
  concept TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  settlement_id TEXT REFERENCES staff_payroll_settlements(id),
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_user ON staff_payroll_adjustments(user_id);
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_settlement ON staff_payroll_adjustments(settlement_id);

-- 6. Consumos del Personal (Cuenta del Empleado y Cena Fija)
CREATE TABLE IF NOT EXISTS staff_consumptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id TEXT REFERENCES orders(id),
  concept TEXT NOT NULL,
  amount_usd_cents INTEGER NOT NULL,
  is_fixed_dinner INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('PENDIENTE', 'COBRADO', 'PERDONADO')) DEFAULT 'PENDIENTE',
  settlement_id TEXT REFERENCES staff_payroll_settlements(id),
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_consumptions_user ON staff_consumptions(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_consumptions_settlement ON staff_consumptions(settlement_id);
CREATE INDEX IF NOT EXISTS idx_staff_consumptions_status ON staff_consumptions(status);

-- 7. Pool de Propinas de Turno
CREATE TABLE IF NOT EXISTS tip_pools (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id),
  jornada_id TEXT NOT NULL REFERENCES jornadas(id),
  split_mode TEXT NOT NULL CHECK(split_mode IN ('EQUAL', 'HOURS')) DEFAULT 'EQUAL',
  total_collected_usd_cents INTEGER NOT NULL DEFAULT 0,
  total_collected_bs_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('OPEN', 'CLOSED')) DEFAULT 'OPEN',
  closed_by_user_id TEXT REFERENCES users(id),
  closed_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tip_pools_jornada ON tip_pools(jornada_id);
CREATE INDEX IF NOT EXISTS idx_tip_pools_location ON tip_pools(location_id);

-- 8. Distribuciones del Pool de Propinas a Meseros
CREATE TABLE IF NOT EXISTS tip_pool_distributions (
  id TEXT PRIMARY KEY,
  tip_pool_id TEXT NOT NULL REFERENCES tip_pools(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  hours_worked REAL NOT NULL DEFAULT 1.0,
  share_percentage REAL NOT NULL,
  amount_usd_cents INTEGER NOT NULL,
  amount_bs_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDIENTE', 'PAGADO')) DEFAULT 'PENDIENTE',
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tip_distributions_pool ON tip_pool_distributions(tip_pool_id);
CREATE INDEX IF NOT EXISTS idx_tip_distributions_user ON tip_pool_distributions(user_id);
