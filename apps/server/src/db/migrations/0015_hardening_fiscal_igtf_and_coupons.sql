-- ============================================================================
-- HITO M16: ENDURECIMIENTO FISCAL, IGTF, REVERSIÓN DE CUPONES Y COMPATIBILIDAD
-- ============================================================================

-- 1. Campos de Módulo Fiscal e IGTF en business_settings
-- Nota: fiscal_module_enabled fue introducido en 0014; aseguramos los nuevos campos:
ALTER TABLE business_settings ADD COLUMN fiscal_price_mode TEXT NOT NULL DEFAULT 'INCLUSIVE' CHECK (fiscal_price_mode IN ('INCLUSIVE', 'EXCLUSIVE'));
ALTER TABLE business_settings ADD COLUMN igtf_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE business_settings ADD COLUMN igtf_rate_bps INTEGER NOT NULL DEFAULT 300;
ALTER TABLE business_settings ADD COLUMN igtf_applies_to TEXT NOT NULL DEFAULT 'CASH_USD' CHECK (igtf_applies_to IN ('CASH_USD', 'ALL_USD', 'NONE'));

-- 2. Timestamp de reversión de cupones al anular o reembolsar órdenes
ALTER TABLE coupon_redemptions ADD COLUMN reversed_at_ms INTEGER;
ALTER TABLE coupon_redemptions ADD COLUMN reversed_at INTEGER;
