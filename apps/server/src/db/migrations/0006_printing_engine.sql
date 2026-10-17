-- ============================================================================
-- HITO M6: MOTOR DE IMPRESIÓN ASÍNCRONO, TICKETS IR, ESTACIONES Y REIMPRESIONES
-- ============================================================================

-- 1. Actualizar tabla printers para soportar connection_type ampliado ('SPOOLER_RAW_USB', 'TCP_9100', 'windows_raw', 'tcp')
CREATE TABLE IF NOT EXISTS printers_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  connection_type TEXT NOT NULL CHECK(connection_type IN ('SPOOLER_RAW_USB', 'TCP_9100', 'windows_raw', 'tcp')),
  address TEXT NOT NULL,
  columns INTEGER NOT NULL DEFAULT 32,
  codepage INTEGER NOT NULL DEFAULT 850,
  is_active INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO printers_new (id, name, connection_type, address, columns, codepage, is_active)
SELECT id, name, connection_type, address, columns, codepage, is_active FROM printers;

DROP TABLE IF EXISTS printers;
ALTER TABLE printers_new RENAME TO printers;

-- 2. Asegurar impresoras iniciales por defecto (Caja USB y Cocina TCP)
INSERT OR IGNORE INTO printers (id, name, connection_type, address, columns, codepage, is_active)
VALUES 
  ('print_caja_usb', 'Impresora Caja 58mm (USB WinSpool RAW)', 'SPOOLER_RAW_USB', 'POS-58', 32, 850, 1),
  ('print_cocina', 'Impresora Cocina 58mm (TCP 9100)', 'TCP_9100', '192.168.1.200:9100', 32, 850, 1);

-- 3. Actualizar tabla print_jobs para soportar Ticket IR, estados ampliados, control de reintentos y reimpresión
CREATE TABLE IF NOT EXISTS print_jobs_new (
  id TEXT PRIMARY KEY,
  printer_id TEXT NOT NULL REFERENCES printers(id),
  order_id TEXT REFERENCES orders(id),
  job_type TEXT NOT NULL CHECK(job_type IN ('TICKET_COCINA', 'NOTA_ENTREGA', 'REPOSICION_COCINA', 'CAMBIO_ORDEN', 'REIMPRESION', 'CORTE_X', 'CIERRE_Z', 'TEST')),
  payload_bytes BLOB NOT NULL,
  ticket_ir_json TEXT,
  station TEXT,
  status TEXT NOT NULL CHECK(status IN ('en_cola', 'imprimiendo', 'impreso', 'fallido', 'requiere_atencion', 'pending', 'printed', 'failed')) DEFAULT 'en_cola',
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  reprint_count INTEGER NOT NULL DEFAULT 0,
  reprint_reason TEXT,
  reprinted_by_user_id TEXT REFERENCES users(id),
  created_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER
);

INSERT OR IGNORE INTO print_jobs_new (
  id, printer_id, order_id, job_type, payload_bytes, status, error_message, attempts, created_at_ms, completed_at_ms
)
SELECT 
  id, printer_id, order_id, job_type, payload_bytes,
  CASE status
    WHEN 'pending' THEN 'en_cola'
    WHEN 'printed' THEN 'impreso'
    WHEN 'failed' THEN 'fallido'
    ELSE status
  END,
  error_message, attempts, created_at_ms, completed_at_ms
FROM print_jobs;

DROP TABLE IF EXISTS print_jobs;
ALTER TABLE print_jobs_new RENAME TO print_jobs;

CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_order_id ON print_jobs(order_id);
