-- 0047: un solo vínculo por (producto, ingrediente) en product_ingredients.
-- Forward-only: limpia duplicados históricos y blinda la tabla con índice único.
-- Se conserva la fila con menor display_order; en empate se conserva el menor id
-- para que el resultado sea determinista.

DELETE FROM product_ingredients
WHERE EXISTS (
  SELECT 1
  FROM product_ingredients AS dup
  WHERE dup.product_id = product_ingredients.product_id
    AND dup.ingredient_id = product_ingredients.ingredient_id
    AND (
      dup.display_order < product_ingredients.display_order
      OR (
        dup.display_order = product_ingredients.display_order
        AND dup.id < product_ingredients.id
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_prod_ing
  ON product_ingredients(product_id, ingredient_id);
