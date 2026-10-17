-- Migración inicial 0000_init.sql
-- Creación de la tabla de control del sistema _system_meta

CREATE TABLE IF NOT EXISTS _system_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

INSERT OR IGNORE INTO _system_meta (key, value, updated_at_ms)
VALUES 
  ('schema_version', '0000', strftime('%s','now') * 1000),
  ('system_name', 'Tocineta Sonrie Local OS', strftime('%s','now') * 1000),
  ('architecture', 'single_process', strftime('%s','now') * 1000),
  ('db_mode', 'wal_full', strftime('%s','now') * 1000);
