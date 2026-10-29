-- Migración 0034_r2_print_mode.sql
-- Agregar print_mode a business_settings ('one' = comanda y nota por caja, 'two' = comanda por cocina y nota por caja)
ALTER TABLE business_settings ADD COLUMN print_mode TEXT NOT NULL DEFAULT 'one' CHECK (print_mode IN ('one', 'two'));
