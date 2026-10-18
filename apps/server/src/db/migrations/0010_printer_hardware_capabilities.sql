-- ============================================================================
-- HITO M10.1: CAPACIDADES FÍSICAS DE HARDWARE PARA IMPRESORAS TÉRMICAS (F1-F3)
-- Hardware validado: DP58U-03 (Driver POS-58, WPC1252 ESC t 16, sin cutter, sin buzzer)
-- ============================================================================

-- C.2: PRESERVACIÓN DE LA FILA MP583 (print_cocina):
-- Conserva intacta la fila de la impresora de cocina en printers con su transporte TCP actual
-- y su dirección placeholder ('192.168.1.200:9100') para no romper compatibilidad con M2/M6;
-- el usuario actualizará su transporte/IP tras la prueba física en local.

ALTER TABLE printers ADD COLUMN has_cutter INTEGER NOT NULL DEFAULT 0;
ALTER TABLE printers ADD COLUMN has_buzzer INTEGER NOT NULL DEFAULT 0;

UPDATE printers SET codepage = 16, has_cutter = 0, has_buzzer = 0;
