-- Migración 0005_cashier_and_ledger_adjustments.sql
-- Ampliación de métodos de pago (UBII, BINANCE) y asientos contables (ROUNDING_ADJUSTMENT, TIP_IN)

PRAGMA foreign_keys=OFF;

-- 1. Actualizar tabla payments para soportar UBII y BINANCE
CREATE TABLE payments_new (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK(method IN ('EFECTIVO_USD', 'EFECTIVO_BS', 'PAGO_MOVIL', 'PUNTO_DE_VENTA', 'UBII', 'BINANCE', 'ZELLE', 'OTROS')),
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

-- 2. Actualizar tabla ledger_entries para soportar ROUNDING_ADJUSTMENT y TIP_IN
DROP TRIGGER IF EXISTS trg_ledger_entries_no_update;
DROP TRIGGER IF EXISTS trg_ledger_entries_no_delete;

CREATE TABLE ledger_entries_new (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL UNIQUE,
  jornada_id TEXT NOT NULL REFERENCES jornadas(id),
  order_id TEXT REFERENCES orders(id),
  account_bucket TEXT NOT NULL CHECK(account_bucket IN (
    'FOOD_SALES', 'MOTORIZADO_FUND', 'MARKETING_COURTESY', 'CASH_USD',
    'CASH_BS', 'BANK_BS', 'BANK_USD', 'DISCOUNT_EXPENSE', 'OPERATING_EXPENSE',
    'ROUNDING_ADJUSTMENT', 'TIP_IN'
  )),
  debit_usd_cents INTEGER NOT NULL DEFAULT 0,
  credit_usd_cents INTEGER NOT NULL DEFAULT 0,
  rate_micro_bs INTEGER NOT NULL,
  description TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

INSERT INTO ledger_entries_new (
  seq, entry_id, jornada_id, order_id, account_bucket,
  debit_usd_cents, credit_usd_cents, rate_micro_bs, description, created_at_ms
)
SELECT 
  seq, entry_id, jornada_id, order_id, account_bucket,
  debit_usd_cents, credit_usd_cents, rate_micro_bs, description, created_at_ms
FROM ledger_entries;

DROP TABLE ledger_entries;
ALTER TABLE ledger_entries_new RENAME TO ledger_entries;

CREATE INDEX IF NOT EXISTS idx_ledger_jornada ON ledger_entries(jornada_id);
CREATE INDEX IF NOT EXISTS idx_ledger_bucket ON ledger_entries(account_bucket);

-- Restaurar triggers estrictos de inmutabilidad
CREATE TRIGGER trg_ledger_entries_no_update
BEFORE UPDATE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE: ledger_entries is append-only and immutable');
END;

CREATE TRIGGER trg_ledger_entries_no_delete
BEFORE DELETE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE: ledger_entries is append-only and immutable');
END;

-- 3. Ampliar change_deliveries con método y referencia
ALTER TABLE change_deliveries ADD COLUMN method TEXT DEFAULT 'MIXTO';
ALTER TABLE change_deliveries ADD COLUMN reference_code TEXT;

PRAGMA foreign_keys=ON;
