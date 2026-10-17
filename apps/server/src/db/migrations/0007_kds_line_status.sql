-- ============================================================================
-- HITO M7: PANTALLA DE COCINA (KDS), ESTADO DE LÍNEAS Y ENSAMBLE AUTOMÁTICO
-- ============================================================================

-- 1. Agregar columnas de estado y marcas de tiempo a order_lines
ALTER TABLE order_lines ADD COLUMN status TEXT NOT NULL DEFAULT 'pendiente' CHECK(status IN ('pendiente', 'preparando', 'listo'));
ALTER TABLE order_lines ADD COLUMN prepared_at_ms INTEGER;
ALTER TABLE order_lines ADD COLUMN ready_at_ms INTEGER;

-- 2. Agregar columna kitchen_passed_at_ms a orders para cronómetro KDS exacto
ALTER TABLE orders ADD COLUMN kitchen_passed_at_ms INTEGER;

-- 3. Crear índices para optimizar consultas de KDS
CREATE INDEX IF NOT EXISTS idx_order_lines_status ON order_lines(status);
CREATE INDEX IF NOT EXISTS idx_order_lines_station ON order_lines(station);

-- 4. Actualizar kitchen_passed_at_ms en órdenes activas
UPDATE orders
SET kitchen_passed_at_ms = updated_at_ms
WHERE fulfillment_status IN ('en_preparacion', 'listo') AND kitchen_passed_at_ms IS NULL;
