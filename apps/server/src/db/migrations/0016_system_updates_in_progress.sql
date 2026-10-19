-- ============================================================================
-- HITO M16: PERMITIR ESTADO IN_PROGRESS EN system_updates
-- ============================================================================

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS system_updates_new (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  previous_version TEXT,
  description TEXT,
  manifest_sha256 TEXT NOT NULL,
  applied_by_user_id TEXT REFERENCES users(id),
  applied_at_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('APPLIED', 'FAILED_ROLLBACK', 'IN_PROGRESS')),
  error_details TEXT
);

INSERT INTO system_updates_new SELECT * FROM system_updates;

DROP TABLE system_updates;

ALTER TABLE system_updates_new RENAME TO system_updates;

CREATE INDEX IF NOT EXISTS idx_system_updates_version ON system_updates(version);

PRAGMA foreign_keys = ON;
