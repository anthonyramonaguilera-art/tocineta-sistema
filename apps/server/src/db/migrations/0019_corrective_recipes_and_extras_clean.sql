-- 0019_corrective_recipes_and_extras_clean.sql
-- M21-A: Limpieza correctiva de recetas, desvinculación de extras/bebidas y desactivación de productos fantasma

-- 1. Eliminar vínculos erróneos de ingredientes en Extras y Bebidas (las extras no tienen pan ni salsas desglosables)
DELETE FROM product_ingredients
WHERE product_id IN (
  SELECT id FROM products WHERE category_id IN ('cat_extras', 'cat_bebidas')
);

-- 2. Eliminar pan de perro o salsas tradicionales de cualquier hamburguesa
DELETE FROM product_ingredients
WHERE product_id IN (
  SELECT id FROM products WHERE category_id = 'cat_hamburguesas'
) AND ingredient_id IN (
  SELECT id FROM ingredients WHERE LOWER(name) LIKE '%pan de perro%' OR LOWER(name) LIKE '%salsas tradicionales%'
);

-- 3. Desactivar productos fantasma de prueba
UPDATE products
SET is_active = 0
WHERE id IN (
  'prod_classic_dog',
  'prod_doble_salchicha_dog',
  'prod_smash_clasica',
  'prod_doble_smash',
  'prod_kids_burger',
  'prod_papas_fritas_tradicionales',
  'prod_papas_queso_tocineta',
  'prod_nuggets_pollo_6'
);

