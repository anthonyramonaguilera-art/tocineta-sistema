-- Migración 0004_orders_version_and_concurrency.sql
-- Concurrencia optimista (version), autorización sin pago, snapshot de líneas y modos de mesa

PRAGMA foreign_keys=OFF;

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
  payment_status TEXT NOT NULL CHECK(payment_status IN ('sin_pago', 'parcial', 'pagado', 'autorizado_sin_pago')) DEFAULT 'sin_pago',
  fulfillment_status TEXT NOT NULL CHECK(fulfillment_status IN ('pendiente', 'enviado', 'en_cocina', 'en_preparacion', 'listo', 'entregado', 'cerrado', 'anulado')) DEFAULT 'pendiente',
  station_status_hot_dogs TEXT NOT NULL CHECK(station_status_hot_dogs IN ('na', 'pendiente', 'en_preparacion', 'listo')) DEFAULT 'na',
  station_status_hamburguesas TEXT NOT NULL CHECK(station_status_hamburguesas IN ('na', 'pendiente', 'en_preparacion', 'listo')) DEFAULT 'na',
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  authorized_without_payment_by TEXT REFERENCES users(id),
  table_service_mode TEXT NOT NULL DEFAULT 'ticket_independiente',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  closed_at_ms INTEGER
);

INSERT INTO orders_new (
  id, order_number, jornada_id, cash_session_id, created_by_user_id,
  fulfillment_type, table_number, customer_name, customer_phone, delivery_address,
  delivery_fee_usd_cents, gross_food_subtotal_usd_cents, discount_usd_cents, coupon_id,
  net_food_sales_usd_cents, total_to_collect_usd_cents, rate_micro_bs,
  payment_status, fulfillment_status, station_status_hot_dogs, station_status_hamburguesas,
  notes, version, created_at_ms, updated_at_ms, closed_at_ms
)
SELECT 
  id, order_number, jornada_id, cash_session_id, created_by_user_id,
  fulfillment_type, table_number, customer_name, customer_phone, delivery_address,
  delivery_fee_usd_cents, gross_food_subtotal_usd_cents, discount_usd_cents, coupon_id,
  net_food_sales_usd_cents, total_to_collect_usd_cents, rate_micro_bs,
  payment_status, fulfillment_status, station_status_hot_dogs, station_status_hamburguesas,
  notes, 1, created_at_ms, updated_at_ms, closed_at_ms
FROM orders;

DROP TABLE orders;

ALTER TABLE orders_new RENAME TO orders;

CREATE INDEX IF NOT EXISTS idx_orders_jornada ON orders(jornada_id);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment ON orders(fulfillment_status);
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

ALTER TABLE order_lines ADD COLUMN snapshot_json TEXT;
ALTER TABLE business_settings ADD COLUMN table_service_mode TEXT NOT NULL DEFAULT 'ticket_independiente';

PRAGMA foreign_keys=ON;
