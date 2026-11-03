-- Migración 0040: Arqueo Ciego Multimétodo
-- Registro de conteos esperados, contados y diferencias por método de pago y por intento

CREATE TABLE IF NOT EXISTS cash_session_method_counts (
  id TEXT PRIMARY KEY,
  cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
  method TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('USD','BS')),
  expected_cents INTEGER NOT NULL,
  counted_cents INTEGER NOT NULL,
  diff_cents INTEGER NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  UNIQUE (cash_session_id, method, attempt)
);

CREATE INDEX IF NOT EXISTS idx_csmc_session ON cash_session_method_counts(cash_session_id);
