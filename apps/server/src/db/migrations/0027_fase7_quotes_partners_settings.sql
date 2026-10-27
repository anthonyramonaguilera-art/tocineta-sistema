-- MIGRACIÓN 0027: FASE 7 — COTIZADOR DE EVENTOS, SOCIOS, MENÚ QR Y CONFIGURACIÓN MULTI-RESTAURANTE

-- 1. Nuevas columnas en business_settings para personalización multi-restaurante
ALTER TABLE business_settings ADD COLUMN slogan TEXT NOT NULL DEFAULT 'Cocinamos con amor y servimos como mereces';
ALTER TABLE business_settings ADD COLUMN logo_url TEXT;
ALTER TABLE business_settings ADD COLUMN primary_color TEXT NOT NULL DEFAULT '#EAB308';
ALTER TABLE business_settings ADD COLUMN rate_change_hour TEXT NOT NULL DEFAULT '13:00';
ALTER TABLE business_settings ADD COLUMN ticket_header_message TEXT NOT NULL DEFAULT '¡BIENVENIDOS!';
ALTER TABLE business_settings ADD COLUMN ticket_footer_message TEXT NOT NULL DEFAULT '¡GRACIAS POR SU PREFERENCIA! Dios le bendiga';
ALTER TABLE business_settings ADD COLUMN iva_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE business_settings ADD COLUMN iva_rate_bps INTEGER NOT NULL DEFAULT 1600;
ALTER TABLE business_settings ADD COLUMN partners_module_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE business_settings ADD COLUMN events_quote_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE business_settings ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 1;

-- 2. Cotizador de Eventos y Presupuestos
CREATE TABLE IF NOT EXISTS event_quotations (
  id TEXT PRIMARY KEY,
  quotation_number TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  event_date_ms INTEGER,
  event_location TEXT,
  guest_count INTEGER NOT NULL DEFAULT 1,
  subtotal_food_usd_cents INTEGER NOT NULL DEFAULT 0,
  discount_percent REAL DEFAULT 0,
  discount_usd_cents INTEGER DEFAULT 0,
  extra_costs_usd_cents INTEGER NOT NULL DEFAULT 0,
  total_price_usd_cents INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd_cents INTEGER NOT NULL DEFAULT 0,
  estimated_profit_usd_cents INTEGER NOT NULL DEFAULT 0,
  rate_micro_bs INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('BORRADOR', 'ENVIADA', 'RESERVADA', 'RECHAZADA')) DEFAULT 'BORRADOR',
  notes TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_quotations_number ON event_quotations(quotation_number);
CREATE INDEX IF NOT EXISTS idx_event_quotations_date ON event_quotations(event_date_ms);
CREATE INDEX IF NOT EXISTS idx_event_quotations_status ON event_quotations(status);

-- 3. Items / Platos de la Cotización
CREATE TABLE IF NOT EXISTS event_quotation_items (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES event_quotations(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_usd_cents INTEGER NOT NULL,
  subtotal_usd_cents INTEGER NOT NULL,
  unit_cost_usd_cents INTEGER NOT NULL DEFAULT 0,
  total_cost_usd_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_eq_items_quotation ON event_quotation_items(quotation_id);

-- 4. Costos Extras de la Cotización (Traslado, Personal, Descartables, etc.)
CREATE TABLE IF NOT EXISTS event_quotation_extras (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES event_quotations(id) ON DELETE CASCADE,
  concept TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('LOGISTICA', 'PERSONAL', 'DESCARTABLES', 'OTROS')) DEFAULT 'LOGISTICA',
  price_usd_cents INTEGER NOT NULL,
  cost_usd_cents INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_eq_extras_quotation ON event_quotation_extras(quotation_id);

-- 5. Socios del Negocio (Partners)
CREATE TABLE IF NOT EXISTS business_partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  doc_id TEXT,
  phone TEXT,
  email TEXT,
  share_percentage REAL NOT NULL DEFAULT 0,
  total_capital_contributed_usd_cents INTEGER NOT NULL DEFAULT 0,
  total_withdrawn_usd_cents INTEGER NOT NULL DEFAULT 0,
  current_balance_usd_cents INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_business_partners_active ON business_partners(is_active);

-- 6. Transacciones de Socios (Aportes, Retiros a Cuenta y Reparto de Dividendos)
CREATE TABLE IF NOT EXISTS partner_transactions (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('APORTE', 'RETIRO_UTILIDADES', 'REPARTO_DIVIDENDOS')),
  amount_usd_cents INTEGER NOT NULL,
  amount_bs_cents INTEGER NOT NULL DEFAULT 0,
  rate_micro_bs INTEGER NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'EFECTIVO_USD',
  notes TEXT,
  registered_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_partner_transactions_partner ON partner_transactions(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_transactions_type ON partner_transactions(type);
