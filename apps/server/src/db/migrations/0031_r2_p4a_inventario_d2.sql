-- Migración 0031_r2_p4a_inventario_d2.sql
-- 1. Agregar order_id a inventory_movements para reversa exacta (B24)
ALTER TABLE inventory_movements ADD COLUMN order_id TEXT;
CREATE INDEX IF NOT EXISTS idx_inventory_movements_order_id ON inventory_movements(order_id);

-- 2. Agregar invoice_photo_path a purchases para foto de factura (B18 / D6)
ALTER TABLE purchases ADD COLUMN invoice_photo_path TEXT;

-- 3. Agregar inventory_consumed_at_ms a orders para consumo de inventario una sola vez (D2)
ALTER TABLE orders ADD COLUMN inventory_consumed_at_ms INTEGER;

-- 4. Backfill inicial defensivo de order_id en inventory_movements existentes donde reference_doc empiece por 'ORD-'
UPDATE inventory_movements
SET order_id = reference_doc
WHERE order_id IS NULL AND reference_doc IS NOT NULL AND reference_doc LIKE 'ord_%';

