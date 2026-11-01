-- Migración 0039_add_transferencia_payment_method.sql
-- Agregar 'TRANSFERENCIA' al CHECK constraint de la tabla payments

PRAGMA foreign_keys=OFF;

CREATE TABLE payments_new (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK(method IN ('EFECTIVO_USD', 'EFECTIVO_BS', 'PAGO_MOVIL', 'PUNTO_DE_VENTA', 'UBII', 'TRANSFERENCIA', 'BINANCE', 'ZELLE', 'OTROS')),
  currency TEXT NOT NULL CHECK(currency IN ('USD', 'BS')),
  amount_cents INTEGER NOT NULL,
  rate_micro_bs INTEGER NOT NULL,
  usd_equivalent_cents INTEGER NOT NULL,
  reference_code TEXT,
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at_ms INTEGER NOT NULL
);

INSERT INTO payments_new (
  id, order_id, method, currency, amount_cents, rate_micro_bs,
  usd_equivalent_cents, reference_code, recorded_by_user_id, created_at_ms
)
SELECT 
  id, order_id, method, currency, amount_cents, rate_micro_bs,
  usd_equivalent_cents, reference_code, recorded_by_user_id, created_at_ms
FROM payments;

DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(reference_code);

PRAGMA foreign_keys=ON;
