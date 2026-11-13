-- tocineta:fk-off
-- Migración 0043_printers_client_bt.sql
-- Ampliar connection_type con 'CLIENT_BT' y añadir owner_terminal_id reconstruyendo la tabla printers de forma segura

CREATE TABLE printers_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  connection_type TEXT NOT NULL CHECK (connection_type IN ('SPOOLER_RAW_USB', 'TCP_9100', 'windows_raw', 'tcp', 'CLIENT_BT')),
  address TEXT NOT NULL,
  columns INTEGER NOT NULL DEFAULT 32,
  codepage INTEGER NOT NULL DEFAULT 16,
  has_cutter INTEGER NOT NULL DEFAULT 0,
  has_buzzer INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  owner_terminal_id TEXT
);

INSERT INTO printers_new (id, name, connection_type, address, columns, codepage, has_cutter, has_buzzer, is_active)
SELECT id, name, connection_type, address, columns, codepage, has_cutter, has_buzzer, is_active FROM printers;

DROP TABLE printers;

ALTER TABLE printers_new RENAME TO printers;
