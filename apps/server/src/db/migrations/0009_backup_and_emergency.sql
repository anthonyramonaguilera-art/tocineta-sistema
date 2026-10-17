-- ============================================================================
-- HITO M9: RESPALDOS CIFRADOS (AGE), SNAPSHOTS Y MODO EMERGENCIA EN PAPEL
-- ============================================================================

-- 1. Ampliar orders con campos para trazabilidad de comandas de papel de emergencia
ALTER TABLE orders ADD COLUMN emergency_slip_number TEXT;
ALTER TABLE orders ADD COLUMN is_deferred_paper INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_emergency_slip 
ON orders(emergency_slip_number) 
WHERE emergency_slip_number IS NOT NULL;

-- 2. Tabla para bitácora y auditoría de respaldos locales y en caliente
CREATE TABLE IF NOT EXISTS backups_log (
  id TEXT PRIMARY KEY,
  backup_type TEXT NOT NULL CHECK(backup_type IN ('SNAPSHOT_HOT', 'ENCRYPTED_USB_DAILY', 'MANUAL_EXPORT')),
  destination_path TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  sha256_hash TEXT NOT NULL,
  jornada_id TEXT REFERENCES jornadas(id),
  audit_head_hash TEXT,
  recipients_count INTEGER DEFAULT 0,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backups_created ON backups_log(created_at_ms);
