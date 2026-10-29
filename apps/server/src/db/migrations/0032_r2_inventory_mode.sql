-- Migración 0032_r2_inventory_mode.sql
-- 1. Agregar inventory_operation_mode e inventory_tracking_since_ms a business_settings
ALTER TABLE business_settings ADD COLUMN inventory_operation_mode TEXT NOT NULL DEFAULT 'free' CHECK (inventory_operation_mode IN ('free', 'tracked'));
ALTER TABLE business_settings ADD COLUMN inventory_tracking_since_ms INTEGER;

-- 2. Corregir backfill de order_id en inventory_movements utilizando substr(reference_doc,1,4)='ord_' (evitando comodín de LIKE '_')
UPDATE inventory_movements
SET order_id = reference_doc
WHERE order_id IS NULL AND reference_doc IS NOT NULL AND substr(reference_doc, 1, 4) = 'ord_';
