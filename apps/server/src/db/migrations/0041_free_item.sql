-- Migración 0041: Ítem libre de mostrador (cat_libre, prod_libre y custom_name en order_lines)

INSERT OR IGNORE INTO categories (
  id,
  name,
  description,
  display_order,
  is_active,
  is_internal,
  station
) VALUES (
  'cat_libre',
  'Item Libre',
  'Categoría interna para ítems libres de mostrador',
  999,
  1,
  1,
  'caja_bebidas'
);

INSERT OR IGNORE INTO products (
  id,
  category_id,
  name,
  description,
  price_usd_cents,
  estimated_cost_usd_cents,
  station,
  is_active,
  is_combo,
  allows_flavors,
  image_url,
  created_at_ms,
  updated_at_ms,
  is_available,
  recipe_mode,
  target_margin_bps
) VALUES (
  'prod_libre',
  'cat_libre',
  'Item libre',
  'Item libre de mostrador',
  0,
  0,
  'caja_bebidas',
  1,
  0,
  0,
  NULL,
  1700000000000,
  1700000000000,
  1,
  'UNITS',
  6500
);

ALTER TABLE order_lines ADD COLUMN custom_name TEXT;
