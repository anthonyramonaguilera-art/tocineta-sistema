-- Migración 0003_menu_events_and_availability.sql
-- Habilitar control de disponibilidad en tiempo real (Agotado/Disponible) y Bus de Eventos Secuenciales

-- 1. Agregar is_available a products
ALTER TABLE products ADD COLUMN is_available INTEGER NOT NULL DEFAULT 1;

-- 2. Agregar is_available a product_flavor_options
ALTER TABLE product_flavor_options ADD COLUMN is_available INTEGER NOT NULL DEFAULT 1;

-- 3. Reestructurar events_log para el bus de eventos secuenciales con seq autoincremental
DROP TABLE IF EXISTS events_log;

CREATE TABLE events_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_log_seq ON events_log(seq);
CREATE INDEX IF NOT EXISTS idx_events_log_type ON events_log(event_type);
