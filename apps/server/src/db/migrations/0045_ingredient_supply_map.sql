CREATE TABLE IF NOT EXISTS ingredient_supply_map (
  ingredient_id TEXT PRIMARY KEY,
  supply_id TEXT NOT NULL REFERENCES supply_items(id)
);

INSERT OR IGNORE INTO ingredient_supply_map (ingredient_id, supply_id)
SELECT 'ing_base_pan_perro', 'sup_pan_perro'
WHERE EXISTS (SELECT 1 FROM supply_items WHERE id = 'sup_pan_perro');

INSERT OR IGNORE INTO ingredient_supply_map (ingredient_id, supply_id)
SELECT 'ing_base_pan_brioche', 'sup_pan_brioche'
WHERE EXISTS (SELECT 1 FROM supply_items WHERE id = 'sup_pan_brioche');

INSERT OR IGNORE INTO ingredient_supply_map (ingredient_id, supply_id)
SELECT 'ing_base_carne_smash', 'sup_carne_smash'
WHERE EXISTS (SELECT 1 FROM supply_items WHERE id = 'sup_carne_smash');

INSERT OR IGNORE INTO ingredient_supply_map (ingredient_id, supply_id)
SELECT 'ing_base_tocineta', 'sup_tocineta_crispy'
WHERE EXISTS (SELECT 1 FROM supply_items WHERE id = 'sup_tocineta_crispy');

INSERT OR IGNORE INTO ingredient_supply_map (ingredient_id, supply_id)
SELECT 'ing_base_salchicha_pollo', 'sup_salchicha_pollo'
WHERE EXISTS (SELECT 1 FROM supply_items WHERE id = 'sup_salchicha_pollo');

INSERT OR IGNORE INTO ingredient_supply_map (ingredient_id, supply_id)
SELECT 'ing_base_salchicha_polaca', 'sup_salchicha_polaca'
WHERE EXISTS (SELECT 1 FROM supply_items WHERE id = 'sup_salchicha_polaca');

INSERT OR IGNORE INTO ingredient_supply_map (ingredient_id, supply_id)
SELECT 'ing_base_pechuga_crispy', 'sup_pechuga_pollo'
WHERE EXISTS (SELECT 1 FROM supply_items WHERE id = 'sup_pechuga_pollo');
