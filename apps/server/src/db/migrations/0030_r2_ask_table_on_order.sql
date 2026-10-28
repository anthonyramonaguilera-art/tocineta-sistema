-- ============================================================================
-- MIGRACIÓN 0030: AJUSTE DE MESA OPCIONAL AL TOMAR PEDIDO (R2 / P3)
-- ============================================================================

ALTER TABLE business_settings ADD COLUMN ask_table_on_order INTEGER NOT NULL DEFAULT 0;

