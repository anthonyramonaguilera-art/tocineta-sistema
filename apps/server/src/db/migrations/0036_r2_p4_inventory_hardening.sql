-- Migración 0036: Endurecimiento de inventario, recetas, mermas, compras y trazabilidad por orden (P4-A)

-- 1. Agregar order_id a inventory_movements para anulación exacta por orden (B24)
ALTER TABLE inventory_movements ADD COLUMN order_id TEXT REFERENCES orders(id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_order ON inventory_movements(order_id);

-- 2. Agregar invoice_photo_path a purchases para foto de factura de compras
ALTER TABLE purchases ADD COLUMN invoice_photo_path TEXT;

-- 3. Agregar inventory_consumed_at_ms a orders para idempotencia de descuento de inventario (D2)
ALTER TABLE orders ADD COLUMN inventory_consumed_at_ms INTEGER;

-- 4. Eliminar gastos espejo duplicados de mermas en operating_expenses (D3, B29)
DELETE FROM operating_expenses
WHERE category = 'MERMAS_DESPERDICIOS'
  AND (description LIKE 'Merma:%' OR description LIKE 'Desperdicio:%');
