-- Migración 0048: variantes de sabor con producto e insumo propios.
-- Forward-only. Los productos de variante son internos (is_active=0, is_available=0),
-- no aparecen en carta y su precio es 0 porque el combo ya viene prorrateado.
-- Los sabores corresponden a product_flavor_options de prod_refresco_1lt:
-- Pepsi, 7Up, Frescolita, Manzanita, Piña y Naranja.

CREATE TABLE IF NOT EXISTS product_flavor_variants (
  product_id TEXT NOT NULL,
  flavor_name TEXT NOT NULL,
  variant_product_id TEXT NOT NULL REFERENCES products(id),
  PRIMARY KEY (product_id, flavor_name)
);

-- 1. Insumos de reventa por sabor (costo 0 hasta que la dueña registre la compra).
WITH variants(supply_id, supply_name) AS (
  VALUES
    ('sup_refresco_pepsi', 'Refresco Pepsi 1 Litro'),
    ('sup_refresco_7up', 'Refresco 7Up 1 Litro'),
    ('sup_refresco_frescolita', 'Refresco Frescolita 1 Litro'),
    ('sup_refresco_manzanita', 'Refresco Manzanita 1 Litro'),
    ('sup_refresco_pina', 'Refresco Piña 1 Litro'),
    ('sup_refresco_naranja', 'Refresco Naranja 1 Litro')
)
INSERT OR IGNORE INTO supply_items (
  id, name, unit, unit_measure, current_stock_qty, minimum_stock_qty,
  cost_per_unit_usd_cents, previous_cost_usd_cents, created_at_ms, updated_at_ms
)
SELECT supply_id, supply_name, 'unid', 'und', 0, 0, 0, 0, 1700000000000, 1700000000000
FROM variants;

-- 2. Productos internos de variante (categoría de bebidas si ya existe; si no, cat_libre).
WITH variants(product_id, variant_product_id, product_name) AS (
  VALUES
    ('prod_refresco_1lt', 'prod_refresco_pepsi', 'Refresco 1 Lt Pepsi'),
    ('prod_refresco_1lt', 'prod_refresco_7up', 'Refresco 1 Lt 7Up'),
    ('prod_refresco_1lt', 'prod_refresco_frescolita', 'Refresco 1 Lt Frescolita'),
    ('prod_refresco_1lt', 'prod_refresco_manzanita', 'Refresco 1 Lt Manzanita'),
    ('prod_refresco_1lt', 'prod_refresco_pina', 'Refresco 1 Lt Piña'),
    ('prod_refresco_1lt', 'prod_refresco_naranja', 'Refresco 1 Lt Naranja')
)
INSERT OR IGNORE INTO products (
  id, category_id, name, description, price_usd_cents, estimated_cost_usd_cents,
  station, is_active, is_combo, allows_flavors, created_at_ms, updated_at_ms,
  is_available, recipe_mode, target_margin_bps
)
SELECT
  v.variant_product_id,
  COALESCE(
    (SELECT id FROM categories WHERE id = 'cat_bebidas'),
    (SELECT id FROM categories WHERE id = 'cat_libre')
  ),
  v.product_name,
  'Variante interna de reventa para combo con sabor',
  0, 0, 'caja_bebidas', 0, 0, 0, 1700000000000, 1700000000000, 0, 'UNITS', 0
FROM variants v
WHERE EXISTS (SELECT 1 FROM categories WHERE id IN ('cat_bebidas', 'cat_libre'));

-- 3. Mapa sabor normalizado (minúsculas) -> producto de variante.
WITH variants(product_id, flavor_name, variant_product_id) AS (
  VALUES
    ('prod_refresco_1lt', 'pepsi', 'prod_refresco_pepsi'),
    ('prod_refresco_1lt', '7up', 'prod_refresco_7up'),
    ('prod_refresco_1lt', 'frescolita', 'prod_refresco_frescolita'),
    ('prod_refresco_1lt', 'manzanita', 'prod_refresco_manzanita'),
    ('prod_refresco_1lt', 'piña', 'prod_refresco_pina'),
    ('prod_refresco_1lt', 'naranja', 'prod_refresco_naranja')
)
INSERT OR IGNORE INTO product_flavor_variants (product_id, flavor_name, variant_product_id)
SELECT v.product_id, v.flavor_name, v.variant_product_id
FROM variants v
WHERE EXISTS (SELECT 1 FROM products WHERE id = v.variant_product_id);

-- 4. Receta de reventa 1 insumo x 1 unidad para cada variante.
WITH variants(variant_product_id, product_name) AS (
  VALUES
    ('prod_refresco_pepsi', 'Refresco 1 Lt Pepsi'),
    ('prod_refresco_7up', 'Refresco 1 Lt 7Up'),
    ('prod_refresco_frescolita', 'Refresco 1 Lt Frescolita'),
    ('prod_refresco_manzanita', 'Refresco 1 Lt Manzanita'),
    ('prod_refresco_pina', 'Refresco 1 Lt Piña'),
    ('prod_refresco_naranja', 'Refresco 1 Lt Naranja')
)
INSERT OR IGNORE INTO recipes (id, product_id, name)
SELECT 'rec_' || v.variant_product_id, v.variant_product_id, v.product_name
FROM variants v
WHERE EXISTS (SELECT 1 FROM products WHERE id = v.variant_product_id);

WITH variants(variant_product_id, supply_id) AS (
  VALUES
    ('prod_refresco_pepsi', 'sup_refresco_pepsi'),
    ('prod_refresco_7up', 'sup_refresco_7up'),
    ('prod_refresco_frescolita', 'sup_refresco_frescolita'),
    ('prod_refresco_manzanita', 'sup_refresco_manzanita'),
    ('prod_refresco_pina', 'sup_refresco_pina'),
    ('prod_refresco_naranja', 'sup_refresco_naranja')
)
INSERT OR IGNORE INTO recipe_items (id, recipe_id, supply_item_id, quantity_required)
SELECT 'ri_rec_' || v.variant_product_id, 'rec_' || v.variant_product_id, v.supply_id, 1
FROM variants v
WHERE EXISTS (SELECT 1 FROM recipes WHERE id = 'rec_' || v.variant_product_id)
  AND EXISTS (SELECT 1 FROM supply_items WHERE id = v.supply_id);
