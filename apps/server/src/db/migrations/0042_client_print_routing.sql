-- Migración 0042_client_print_routing.sql
-- Enrutamiento de impresión para terminales cliente (móvil/Bluetooth) vs servidor (impresora fija)

ALTER TABLE print_jobs ADD COLUMN target TEXT NOT NULL DEFAULT 'server' CHECK (target IN ('server','client'));
ALTER TABLE print_jobs ADD COLUMN target_terminal_id TEXT;
ALTER TABLE print_jobs ADD COLUMN claimed_at_ms INTEGER;
CREATE INDEX IF NOT EXISTS idx_print_jobs_target ON print_jobs(target, target_terminal_id, status);

ALTER TABLE business_settings ADD COLUMN receipt_destination TEXT NOT NULL DEFAULT 'payer_device' CHECK (receipt_destination IN ('payer_device','fixed_printer'));
ALTER TABLE business_settings ADD COLUMN kitchen_destination TEXT NOT NULL DEFAULT 'payer_device' CHECK (kitchen_destination IN ('payer_device','fixed_printer'));
