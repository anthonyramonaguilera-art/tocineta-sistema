-- 0049: restaura la cantidad por ingrediente que la 0047 colapsó al imponer
-- un solo vínculo por (producto, ingrediente). Forward-only.
-- Cada vínculo conserva su cantidad en product_ingredients.quantity (default 1)
-- y el índice único uq_prod_ing sigue vigente.

ALTER TABLE product_ingredients ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;

-- Cantidades por (producto, ingrediente) tomadas de las filas que 0047 eliminó.
-- Se localiza por los IDs reales de la semilla, nunca por nombre.
WITH quantities(product_id, ingredient_id, quantity) AS (
  VALUES
    ('prod_americana_deluxe', 'ing_base_carne_smash', 4),
    ('prod_americana_deluxe', 'ing_base_queso_americano', 2),
    ('prod_miami', 'ing_base_carne_smash', 3),
    ('prod_miami', 'ing_base_queso_americano', 3),
    ('prod_texas_mex', 'ing_base_carne_smash', 2),
    ('prod_texas_mex', 'ing_base_queso_americano', 2),
    ('prod_texas_mex', 'ing_base_tocineta', 2),
    ('prod_pechuga_cesar', 'ing_base_pechuga_crispy', 2),
    ('prod_new_york', 'ing_base_carne_smash', 2),
    ('prod_new_york', 'ing_base_queso_americano', 2),
    ('prod_mozarrella', 'ing_base_carne_smash', 2)
)
UPDATE product_ingredients
SET quantity = (
  SELECT q.quantity
  FROM quantities q
  WHERE q.product_id = product_ingredients.product_id
    AND q.ingredient_id = product_ingredients.ingredient_id
)
WHERE EXISTS (
  SELECT 1
  FROM quantities q
  WHERE q.product_id = product_ingredients.product_id
    AND q.ingredient_id = product_ingredients.ingredient_id
);
