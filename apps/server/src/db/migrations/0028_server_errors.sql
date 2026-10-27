-- ============================================================================
-- MIGRACIÓN 0028: TABLA SERVER_ERRORS (REGISTRO GLOBAL DE ERRORES DEL SERVIDOR)
-- ============================================================================

CREATE TABLE IF NOT EXISTS server_errors (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  status INTEGER NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  body_json TEXT,
  user_id TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_errors_created ON server_errors(created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_server_errors_request_id ON server_errors(request_id);
