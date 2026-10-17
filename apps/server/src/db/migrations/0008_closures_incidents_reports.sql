-- ============================================================================
-- HITO M8: CIERRE DE TURNO, ARQUEO CIEGO, CIERRE Z, INCIDENTES Y REPORTES
-- ============================================================================

-- 1. Actualizar tabla orders para soportar payment_status ampliado ('anulado', 'reembolsado')
PRAGMA foreign_keys = OFF;

CREATE TABLE orders_new (
  id TEXT PRIMARY KEY,
  order_number INTEGER NOT NULL,
  jornada_id TEXT NOT NULL REFERENCES jornadas(id),
  cash_session_id TEXT REFERENCES cash_sessions(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  fulfillment_type TEXT NOT NULL CHECK(fulfillment_type IN ('salon', 'para_llevar', 'delivery')) DEFAULT 'salon',
  table_number TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  delivery_address TEXT,
  delivery_fee_usd_cents INTEGER NOT NULL DEFAULT 0,
  gross_food_subtotal_usd_cents INTEGER NOT NULL DEFAULT 0,
  discount_usd_cents INTEGER NOT NULL DEFAULT 0,
  coupon_id TEXT REFERENCES coupons(id),
  net_food_sales_usd_cents INTEGER NOT NULL DEFAULT 0,
  total_to_collect_usd_cents INTEGER NOT NULL DEFAULT 0,
  rate_micro_bs INTEGER NOT NULL,
  payment_status TEXT NOT NULL CHECK(payment_status IN ('sin_pago', 'parcial', 'pagado', 'autorizado_sin_pago', 'anulado', 'reembolsado')) DEFAULT 'sin_pago',
  fulfillment_status TEXT NOT NULL CHECK(fulfillment_status IN ('pendiente', 'enviado', 'en_cocina', 'en_preparacion', 'listo', 'entregado', 'cerrado', 'anulado')) DEFAULT 'pendiente',
  station_status_hot_dogs TEXT NOT NULL CHECK(station_status_hot_dogs IN ('na', 'pendiente', 'en_preparacion', 'listo')) DEFAULT 'na',
  station_status_hamburguesas TEXT NOT NULL CHECK(station_status_hamburguesas IN ('na', 'pendiente', 'en_preparacion', 'listo')) DEFAULT 'na',
  kitchen_passed_at_ms INTEGER,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  authorized_without_payment_by TEXT REFERENCES users(id),
  table_service_mode TEXT NOT NULL DEFAULT 'ticket_independiente',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  closed_at_ms INTEGER
);

INSERT OR IGNORE INTO orders_new (
  id, order_number, jornada_id, cash_session_id, created_by_user_id, fulfillment_type,
  table_number, customer_name, customer_phone, delivery_address, delivery_fee_usd_cents,
  gross_food_subtotal_usd_cents, discount_usd_cents, coupon_id, net_food_sales_usd_cents,
  total_to_collect_usd_cents, rate_micro_bs, payment_status, fulfillment_status,
  station_status_hot_dogs, station_status_hamburguesas, kitchen_passed_at_ms,
  notes, version, authorized_without_payment_by, table_service_mode,
  created_at_ms, updated_at_ms, closed_at_ms
)
SELECT 
  id, order_number, jornada_id, cash_session_id, created_by_user_id, fulfillment_type,
  table_number, customer_name, customer_phone, delivery_address, delivery_fee_usd_cents,
  gross_food_subtotal_usd_cents, discount_usd_cents, coupon_id, net_food_sales_usd_cents,
  total_to_collect_usd_cents, rate_micro_bs, payment_status, fulfillment_status,
  station_status_hot_dogs, station_status_hamburguesas, kitchen_passed_at_ms,
  notes, version, authorized_without_payment_by, table_service_mode,
  created_at_ms, updated_at_ms, closed_at_ms
FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

CREATE INDEX IF NOT EXISTS idx_orders_jornada ON orders(jornada_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(payment_status);

-- Recrear triggers de control de deuda
CREATE TRIGGER IF NOT EXISTS trg_orders_no_close_with_debt
BEFORE UPDATE ON orders
WHEN NEW.fulfillment_status = 'cerrado' AND NEW.payment_status IN ('sin_pago', 'parcial', 'autorizado_sin_pago')
BEGIN
  SELECT RAISE(ABORT, 'ORDER_CLOSE_DEBT_BLOCKED: No se puede cerrar una orden con saldo pendiente de pago');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_no_insert_closed_with_debt
BEFORE INSERT ON orders
WHEN NEW.fulfillment_status = 'cerrado' AND NEW.payment_status IN ('sin_pago', 'parcial', 'autorizado_sin_pago')
BEGIN
  SELECT RAISE(ABORT, 'ORDER_CLOSE_DEBT_BLOCKED: No se puede registrar como cerrada una orden con saldo pendiente de pago');
END;

PRAGMA foreign_keys = ON;

-- 2. Ampliar cash_sessions para Arqueo Ciego, control anti-tanteo y conciliación Ubii
ALTER TABLE cash_sessions ADD COLUMN recount_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cash_sessions ADD COLUMN closing_ubii_voucher_bs_cents INTEGER;
ALTER TABLE cash_sessions ADD COLUMN expected_cash_usd_cents INTEGER;
ALTER TABLE cash_sessions ADD COLUMN expected_cash_bs_cents INTEGER;
ALTER TABLE cash_sessions ADD COLUMN expected_ubii_gross_bs_cents INTEGER;
ALTER TABLE cash_sessions ADD COLUMN diff_usd_cents INTEGER;
ALTER TABLE cash_sessions ADD COLUMN diff_bs_cents INTEGER;
ALTER TABLE cash_sessions ADD COLUMN diff_ubii_bs_cents INTEGER;

-- 3. Ampliar jornadas para Cierre Z y Hash de Cabeza de Auditoría
ALTER TABLE jornadas ADD COLUMN audit_head_hash TEXT;
ALTER TABLE jornadas ADD COLUMN z_report_json TEXT;

-- 4. Ampliar worker_incidents para gestión de reposiciones vs reembolsos
ALTER TABLE worker_incidents ADD COLUMN order_id TEXT REFERENCES orders(id);
ALTER TABLE worker_incidents ADD COLUMN reason_code TEXT;
ALTER TABLE worker_incidents ADD COLUMN responsible_area TEXT;
ALTER TABLE worker_incidents ADD COLUMN resolution TEXT;
ALTER TABLE worker_incidents ADD COLUMN authorized_by_user_id TEXT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_worker_incidents_order ON worker_incidents(order_id);
CREATE INDEX IF NOT EXISTS idx_worker_incidents_user ON worker_incidents(user_id);
