-- ============================================================================
-- MIGRACIÓN 0022: TABLA CLIENT_ERRORS Y AJUSTE DE ARQUEO CIEGO EN CIERRE DE CAJA
-- Permite registrar fallas en frontend (ErrorBoundary) y alternar arqueo ciego/guiado
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_errors (
  id TEXT PRIMARY KEY,
  view_name TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  user_id TEXT,
  user_role TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_client_errors_created ON client_errors(created_at_ms DESC);

ALTER TABLE business_settings ADD COLUMN blind_closure_enabled INTEGER NOT NULL DEFAULT 0;
