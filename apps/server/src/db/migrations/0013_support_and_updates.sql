-- ============================================================================
-- HITO M12: MODO SOPORTE AUDITADO Y MOTOR DE ACTUALIZACIONES FIRMADAS ED25519
-- ============================================================================

-- 1. Tabla de Sesiones de Modo Soporte
CREATE TABLE IF NOT EXISTS support_sessions (
  id TEXT PRIMARY KEY,
  started_by_user_id TEXT NOT NULL REFERENCES users(id),
  started_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ENDED', 'EXPIRED')),
  quick_assist_launched INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_support_sessions_status ON support_sessions(status);

-- 2. Tabla de Registro Histórico de Actualizaciones del Sistema
CREATE TABLE IF NOT EXISTS system_updates (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  previous_version TEXT,
  description TEXT,
  manifest_sha256 TEXT NOT NULL,
  applied_by_user_id TEXT REFERENCES users(id),
  applied_at_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('APPLIED', 'FAILED_ROLLBACK')),
  error_details TEXT
);

CREATE INDEX IF NOT EXISTS idx_system_updates_version ON system_updates(version);

-- 3. Asegurar versión inicial del sistema en _system_meta
INSERT OR IGNORE INTO _system_meta (key, value, updated_at_ms)
VALUES ('version', '1.0.0', strftime('%s','now') * 1000);
