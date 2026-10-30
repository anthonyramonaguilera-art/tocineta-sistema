-- Migración 0035_r2_printer_roles.sql
-- Agregar receipt_printer_id y kitchen_printer_id a business_settings para impresoras configurables
ALTER TABLE business_settings ADD COLUMN receipt_printer_id TEXT NOT NULL DEFAULT 'print_caja_usb';
ALTER TABLE business_settings ADD COLUMN kitchen_printer_id TEXT NOT NULL DEFAULT 'print_caja_usb';
