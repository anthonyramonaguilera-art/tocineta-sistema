-- Migración 0011: Tabla de archivo para events_log (SUG-04)
-- Preserva los últimos 1.000 eventos en events_log para reconexión móvil (?since=<seq>)
-- y mueve eventos antiguos (> 30 días) a events_log_archive durante el Cierre Z.

CREATE TABLE IF NOT EXISTS events_log_archive (
  seq INTEGER PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  archived_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_log_archive_entity ON events_log_archive(entity_id);
CREATE INDEX IF NOT EXISTS idx_events_log_archive_created ON events_log_archive(created_at_ms);
