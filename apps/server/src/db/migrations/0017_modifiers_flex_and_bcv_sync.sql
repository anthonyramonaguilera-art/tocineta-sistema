-- ============================================================================
-- HITO M19: FLEXIBILIDAD EN MODIFICADORES Y LIMPIEZA DE CONTAMINACIÓN
-- ============================================================================

-- 1. Desvincular órdenes de cupones de pruebas y eliminarlos limpiamente
UPDATE orders SET coupon_id = NULL 
WHERE coupon_id IN (SELECT id FROM coupons WHERE code LIKE 'AGOTADO_%' OR code LIKE 'ONETIME_%');

DELETE FROM coupon_redemptions 
WHERE coupon_id IN (SELECT id FROM coupons WHERE code LIKE 'AGOTADO_%' OR code LIKE 'ONETIME_%');

DELETE FROM coupons 
WHERE code LIKE 'AGOTADO_%' OR code LIKE 'ONETIME_%';

-- 2. Restaurar tasa BCV real eliminando la tasa contaminante de 850,0 Bs/$ de pruebas
DELETE FROM exchange_rates WHERE rate_micro_bs = 850000000;

UPDATE exchange_rates SET is_current = 0;
UPDATE exchange_rates SET is_current = 1 
WHERE id = (SELECT id FROM exchange_rates ORDER BY created_at_ms DESC LIMIT 1);

-- 3. Recrear order_line_modifiers sin FK estricta a ingredients
CREATE TABLE IF NOT EXISTS order_line_modifiers_new (
  id TEXT PRIMARY KEY,
  order_line_id TEXT NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  ingredient_id TEXT,
  ingredient_name TEXT NOT NULL,
  modifier_name TEXT,
  modifier_type TEXT NOT NULL,
  state TEXT DEFAULT 'normal',
  extra_price_usd_cents INTEGER NOT NULL DEFAULT 0,
  internal_cost_usd_cents INTEGER NOT NULL DEFAULT 0
);

INSERT INTO order_line_modifiers_new (id, order_line_id, ingredient_id, ingredient_name, modifier_name, modifier_type, state, extra_price_usd_cents, internal_cost_usd_cents)
SELECT 
  id, 
  order_line_id, 
  ingredient_id, 
  ingredient_name, 
  ingredient_name, 
  modifier_type, 
  'normal',
  extra_price_usd_cents, 
  internal_cost_usd_cents
FROM order_line_modifiers;

DROP TABLE order_line_modifiers;

ALTER TABLE order_line_modifiers_new RENAME TO order_line_modifiers;

CREATE INDEX IF NOT EXISTS idx_line_mods_line ON order_line_modifiers(order_line_id);

-- 4. Recrear exchange_rates para soportar AUTO_INTERNET y fuentes dinámicas
CREATE TABLE IF NOT EXISTS exchange_rates_new (
  id TEXT PRIMARY KEY,
  rate_micro_bs INTEGER NOT NULL,
  source TEXT NOT NULL,
  set_by_user_id TEXT REFERENCES users(id),
  created_at_ms INTEGER NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1
);

INSERT INTO exchange_rates_new (id, rate_micro_bs, source, set_by_user_id, created_at_ms, is_current)
SELECT id, rate_micro_bs, source, set_by_user_id, created_at_ms, is_current
FROM exchange_rates;

DROP TABLE exchange_rates;

ALTER TABLE exchange_rates_new RENAME TO exchange_rates;

CREATE INDEX IF NOT EXISTS idx_exchange_rates_created_at ON exchange_rates(created_at_ms);
