-- ============================================================================
-- MIGRACIÓN 0025: FINANZAS INTEGRALES, GASTOS, POR COBRAR, POR PAGAR,
-- UTILIDAD REAL Y CIERRES (FASE 5)
-- ============================================================================

-- 1. Ampliación y flexibilización de categorías en operating_expenses
CREATE TABLE IF NOT EXISTS operating_expenses_f5 (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL DEFAULT 'loc_alta_vista',
  jornada_id TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_usd_cents INTEGER NOT NULL,
  amount_bs_cents INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'EFECTIVO_USD',
  description TEXT NOT NULL,
  authorized_by_user_id TEXT NOT NULL,
  receipt_photo_path TEXT,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurring_interval TEXT,
  notes TEXT,
  created_at_ms INTEGER NOT NULL
);

INSERT OR IGNORE INTO operating_expenses_f5 (
  id, location_id, jornada_id, category, amount_usd_cents, amount_bs_cents,
  payment_method, description, authorized_by_user_id, receipt_photo_path,
  is_recurring, recurring_interval, notes, created_at_ms
)
SELECT 
  id, 
  COALESCE(location_id, 'loc_alta_vista'),
  jornada_id,
  category,
  amount_usd_cents,
  amount_bs_cents,
  'EFECTIVO_USD',
  description,
  authorized_by_user_id,
  receipt_photo_path,
  0,
  NULL,
  NULL,
  created_at_ms
FROM operating_expenses;

DROP TABLE IF EXISTS operating_expenses;
ALTER TABLE operating_expenses_f5 RENAME TO operating_expenses;

CREATE INDEX IF NOT EXISTS idx_operating_expenses_location ON operating_expenses(location_id);
CREATE INDEX IF NOT EXISTS idx_operating_expenses_date ON operating_expenses(created_at_ms);
CREATE INDEX IF NOT EXISTS idx_operating_expenses_category ON operating_expenses(category);
CREATE INDEX IF NOT EXISTS idx_operating_expenses_method ON operating_expenses(payment_method);

-- 2. Tabla de Categorías de Gastos Configurables
CREATE TABLE IF NOT EXISTS expense_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL
);

INSERT OR IGNORE INTO expense_categories (id, name, is_default, created_at_ms) VALUES
  ('cat_exp_insumos', 'INSUMOS Y SUMINISTROS', 1, 1700000000000),
  ('cat_exp_servicios', 'SERVICIOS PUBLICOS (LUZ/AGUA/GAS)', 1, 1700000000000),
  ('cat_exp_nomina', 'NOMINA Y PERSONAL', 1, 1700000000000),
  ('cat_exp_mantenimiento', 'MANTENIMIENTO Y REPARACIONES', 1, 1700000000000),
  ('cat_exp_alquiler', 'ALQUILER Y CONDIMINIO', 1, 1700000000000),
  ('cat_exp_transporte', 'TRANSPORTE Y LOGISTICA', 1, 1700000000000),
  ('cat_exp_marketing', 'MARKETING Y PUBLICIDAD', 1, 1700000000000),
  ('cat_exp_varios', 'VARIOS Y CAJA CHICA', 1, 1700000000000);

-- 3. Cuentas por Cobrar (Clientes a Crédito / Fiado / Socios / Eventos)
CREATE TABLE IF NOT EXISTS receivable_accounts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  order_id TEXT REFERENCES orders(id),
  concept TEXT NOT NULL,
  total_usd_cents INTEGER NOT NULL,
  balance_usd_cents INTEGER NOT NULL,
  due_date_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDIENTE', 'PARCIAL', 'PAGADA', 'VENCIDA')) DEFAULT 'PENDIENTE',
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_receivables_customer ON receivable_accounts(customer_id);
CREATE INDEX IF NOT EXISTS idx_receivables_location ON receivable_accounts(location_id);
CREATE INDEX IF NOT EXISTS idx_receivables_status ON receivable_accounts(status);
CREATE INDEX IF NOT EXISTS idx_receivables_due ON receivable_accounts(due_date_ms);

-- 4. Abonos a Cuentas por Cobrar
CREATE TABLE IF NOT EXISTS receivable_payments (
  id TEXT PRIMARY KEY,
  receivable_id TEXT NOT NULL REFERENCES receivable_accounts(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  amount_usd_cents INTEGER NOT NULL,
  amount_bs_cents INTEGER NOT NULL DEFAULT 0,
  exchange_rate_micro_bs INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  reference_code TEXT,
  receipt_photo_path TEXT,
  notes TEXT,
  received_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_receivable_payments_account ON receivable_payments(receivable_id);
CREATE INDEX IF NOT EXISTS idx_receivable_payments_date ON receivable_payments(created_at_ms);
CREATE INDEX IF NOT EXISTS idx_receivable_payments_method ON receivable_payments(payment_method);

-- 5. Ampliación de Facturas de Compra a Proveedores (Cuentas por Pagar)
ALTER TABLE purchases ADD COLUMN balance_owed_usd_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN due_date_ms INTEGER;

UPDATE purchases
SET balance_owed_usd_cents = CASE 
  WHEN payment_condition = 'CREDITO' AND status != 'PAGADA' THEN total_usd_cents 
  ELSE 0 
END;

CREATE INDEX IF NOT EXISTS idx_purchases_due ON purchases(due_date_ms);
CREATE INDEX IF NOT EXISTS idx_purchases_location ON purchases(location_id);

-- 6. Abonos a Cuentas por Pagar (Facturas de Proveedores)
CREATE TABLE IF NOT EXISTS payable_payments (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  amount_usd_cents INTEGER NOT NULL,
  amount_bs_cents INTEGER NOT NULL DEFAULT 0,
  exchange_rate_micro_bs INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  reference_code TEXT,
  receipt_photo_path TEXT,
  notes TEXT,
  paid_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payable_payments_purchase ON payable_payments(purchase_id);
CREATE INDEX IF NOT EXISTS idx_payable_payments_date ON payable_payments(created_at_ms);
CREATE INDEX IF NOT EXISTS idx_payable_payments_method ON payable_payments(payment_method);

-- 7. Cierres Mensuales Inmutables
CREATE TABLE IF NOT EXISTS monthly_closures (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  location_id TEXT NOT NULL,
  total_sales_usd_cents INTEGER NOT NULL,
  total_cogs_usd_cents INTEGER NOT NULL,
  total_waste_usd_cents INTEGER NOT NULL,
  total_expenses_usd_cents INTEGER NOT NULL,
  net_profit_usd_cents INTEGER NOT NULL,
  metrics_json TEXT NOT NULL,
  closed_by_user_id TEXT NOT NULL REFERENCES users(id),
  closed_at_ms INTEGER NOT NULL,
  notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_closures_ym_loc ON monthly_closures(year, month, location_id);

-- 8. Configuración de 5 Números del Inicio
ALTER TABLE business_settings ADD COLUMN owner_5_numbers_config TEXT NOT NULL DEFAULT '["sales_today","profit_today","cash_today","receivable_total","payable_total"]';

