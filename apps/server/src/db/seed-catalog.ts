import type Database from 'better-sqlite3';

/**
 * Semilla Oficial del Catálogo de Tocineta Sonríe (Hito M2)
 * Incorpora las 6 Reglas de Negocio Oficiales confirmadas por la Sra. Olinelcys:
 * 1. Feature Flag Malteadas: Categoría MALTEADAS_Y_HELADOS con is_active = 0.
 * 2. Descomposición transparente de combos (Street, Clásico, Para Ti).
 * 3. 6 Modificadores oficiales de Barra Libre ($0.00 venta, 15c costo interno).
 * 4. 6 Sabores oficiales Pepsi para Refresco 1 Lt.
 * 5. Liquidación contable de delivery (THIRD_PARTY_PASS_THROUGH, tiers 200, 300, 400, 500).
 * 6. Sistema dual de cupones (Descuentos y Cortesías OBSEQUIOS_CUPON).
 */
export function seedCatalog(rawDb: Database.Database): void {
  const now = Date.now();

  const seedTx = rawDb.transaction(() => {
    // ------------------------------------------------------------------------
    // 1. Configuración de Negocio (Business Settings)
    // ------------------------------------------------------------------------
    rawDb.prepare(`
      INSERT OR IGNORE INTO business_settings (
        id, business_name, rif, phone, address,
        delivery_accounting_mode, delivery_quick_tiers_json,
        banesco_pago_movil_phone, banesco_pago_movil_id, pos_fee_bps,
        updated_at_ms
      ) VALUES (
        'default', 'Tocineta Sonríe', 'V-17040918-0', '04249728209',
        'Detrás de Torre Movistar, Puerto Ordaz',
        'THIRD_PARTY_PASS_THROUGH', '[200, 300, 400, 500]',
        '04249728209', '17040918', 75,
        ?
      )
    `).run(now);

    // ------------------------------------------------------------------------
    // 2. Categorías del Menú
    // Regla 1: MALTEADAS_Y_HELADOS sembrada con is_active = 0
    // ------------------------------------------------------------------------
    const categoriesData = [
      { id: 'cat_hot_dogs', name: 'Hot Dogs', description: 'Perros calientes clásicos y especiales', display_order: 1, is_active: 1, is_internal: 0, station: 'hot_dogs' },
      { id: 'cat_hamburguesas', name: 'Hamburguesas', description: 'Hamburguesas smash y pechuga crispy', display_order: 2, is_active: 1, is_internal: 0, station: 'hamburguesas' },
      { id: 'cat_combos', name: 'Combos', description: 'Combos especiales con bebida incluida', display_order: 3, is_active: 1, is_internal: 0, station: 'hot_dogs' },
      { id: 'cat_extras', name: 'Extras y Raciones', description: 'Papas fritas y raciones para compartir', display_order: 4, is_active: 1, is_internal: 0, station: 'hot_dogs' },
      { id: 'cat_bebidas', name: 'Bebidas', description: 'Refrescos, maltas y agua mineral', display_order: 5, is_active: 1, is_internal: 0, station: 'caja_bebidas' },
      { id: 'cat_malteadas', name: 'Malteadas y Helados', description: 'Malteadas cremosas y postres (Feature Flag)', display_order: 6, is_active: 0, is_internal: 0, station: 'caja_bebidas' },
      { id: 'cat_obsequios', name: 'Obsequios Cupón', description: 'Ítems de cortesía canjeables por cupones', display_order: 7, is_active: 1, is_internal: 1, station: 'hot_dogs' }
    ];

    const insertCat = rawDb.prepare(`
      INSERT OR REPLACE INTO categories (
        id, name, description, display_order, is_active, is_internal, station
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const cat of categoriesData) {
      insertCat.run(cat.id, cat.name, cat.description, cat.display_order, cat.is_active, cat.is_internal, cat.station);
    }

    // ------------------------------------------------------------------------
    // 3. Ingredientes Base y de Barra Libre
    // Regla 3: 6 ingredientes Barra Libre (is_barra_libre = 1, extra = 0, cost = 15)
    // ------------------------------------------------------------------------
    const ingredientsData = [
      // 6 Ingredientes oficiales de Barra Libre ($0.00 venta / 15c costo interno)
      { id: 'ing_bl_tomate', name: 'Tomate', is_barra_libre: 1, extra_price_usd_cents: 0, internal_cost_usd_cents: 15 },
      { id: 'ing_bl_cebolla_caramelizada', name: 'Cebolla Caramelizada', is_barra_libre: 1, extra_price_usd_cents: 0, internal_cost_usd_cents: 15 },
      { id: 'ing_bl_maiz', name: 'Maíz', is_barra_libre: 1, extra_price_usd_cents: 0, internal_cost_usd_cents: 15 },
      { id: 'ing_bl_chimichurri', name: 'Chimichurri', is_barra_libre: 1, extra_price_usd_cents: 0, internal_cost_usd_cents: 15 },
      { id: 'ing_bl_relish', name: 'Relish', is_barra_libre: 1, extra_price_usd_cents: 0, internal_cost_usd_cents: 15 },
      { id: 'ing_bl_cebolla', name: 'Cebolla', is_barra_libre: 1, extra_price_usd_cents: 0, internal_cost_usd_cents: 15 },

      // Ingredientes base (removibles: Pan de perro y Pan brioche para "Sin Pan")
      { id: 'ing_base_pan_perro', name: 'Pan de perro', is_barra_libre: 0, extra_price_usd_cents: 0, internal_cost_usd_cents: 25 },
      { id: 'ing_base_pan_brioche', name: 'Pan brioche', is_barra_libre: 0, extra_price_usd_cents: 0, internal_cost_usd_cents: 35 },
      { id: 'ing_base_salchicha', name: 'Salchicha', is_barra_libre: 0, extra_price_usd_cents: 0, internal_cost_usd_cents: 40 },
      { id: 'ing_base_carne_smash', name: 'Carne Smash', is_barra_libre: 0, extra_price_usd_cents: 0, internal_cost_usd_cents: 70 },
      { id: 'ing_base_pechuga_crispy', name: 'Pechuga de Pollo Crispy', is_barra_libre: 0, extra_price_usd_cents: 0, internal_cost_usd_cents: 80 },
      { id: 'ing_base_tocineta', name: 'Tocineta Crispy', is_barra_libre: 0, extra_price_usd_cents: 0, internal_cost_usd_cents: 30 },
      { id: 'ing_base_queso_cheddar', name: 'Queso Amarillo Cheddar', is_barra_libre: 0, extra_price_usd_cents: 0, internal_cost_usd_cents: 25 },
      { id: 'ing_base_queso_parmesano', name: 'Queso Parmesano', is_barra_libre: 0, extra_price_usd_cents: 0, internal_cost_usd_cents: 30 },
      { id: 'ing_base_queso_mozzarella', name: 'Queso Mozzarella', is_barra_libre: 0, extra_price_usd_cents: 0, internal_cost_usd_cents: 30 },
      { id: 'ing_base_doritos', name: 'Doritos Snacks', is_barra_libre: 0, extra_price_usd_cents: 0, internal_cost_usd_cents: 25 },
      { id: 'ing_base_jalapenos', name: 'Jalapeños Encurtidos', is_barra_libre: 0, extra_price_usd_cents: 0, internal_cost_usd_cents: 20 },
      { id: 'ing_base_salsa_ajo', name: 'Salsa de Ajo', is_barra_libre: 0, extra_price_usd_cents: 0, internal_cost_usd_cents: 10 },
      { id: 'ing_base_papas_hilo', name: 'Papas Ralladas Hilo', is_barra_libre: 0, extra_price_usd_cents: 0, internal_cost_usd_cents: 15 },
      { id: 'ing_base_lechuga', name: 'Lechuga Fresca', is_barra_libre: 0, extra_price_usd_cents: 0, internal_cost_usd_cents: 10 }
    ];

    const insertIng = rawDb.prepare(`
      INSERT OR REPLACE INTO ingredients (
        id, name, is_barra_libre, extra_price_usd_cents, internal_cost_usd_cents, is_active
      ) VALUES (?, ?, ?, ?, ?, 1)
    `);

    for (const ing of ingredientsData) {
      insertIng.run(ing.id, ing.name, ing.is_barra_libre, ing.extra_price_usd_cents, ing.internal_cost_usd_cents);
    }

    // ------------------------------------------------------------------------
    // 4. Catálogo de 27 Productos Oficiales + 2 Cortesías de Cupones
    // ------------------------------------------------------------------------
    const productsData = [
      // --- HOT DOGS (7) ---
      { id: 'prod_street_dog', category_id: 'cat_hot_dogs', name: 'Street Dog', price: 250, cost: 70, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_tocineta_dog_parmesano', category_id: 'cat_hot_dogs', name: 'Tocineta Dog Parmesano', price: 350, cost: 110, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_doritos_dog_snacks', category_id: 'cat_hot_dogs', name: 'Doritos Dog Snacks', price: 350, cost: 105, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_jalapenos_dog', category_id: 'cat_hot_dogs', name: 'Jalapeños Dog', price: 350, cost: 100, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_brazil_dog', category_id: 'cat_hot_dogs', name: 'Brazil Dog', price: 350, cost: 95, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_classic_dog', category_id: 'cat_hot_dogs', name: 'Classic Dog', price: 250, cost: 70, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_doble_salchicha_dog', category_id: 'cat_hot_dogs', name: 'Doble Salchicha Dog', price: 380, cost: 120, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },

      // --- HAMBURGUESAS (10: 7 a $6.90 + Smash Clásica, Doble Smash, Kids Burger) ---
      { id: 'prod_texas_mex', category_id: 'cat_hamburguesas', name: 'Texas Mex', price: 690, cost: 230, station: 'hamburguesas', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_pechuga_cesar', category_id: 'cat_hamburguesas', name: 'Pechuga Cesar', price: 690, cost: 240, station: 'hamburguesas', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_grill', category_id: 'cat_hamburguesas', name: 'Grill', price: 690, cost: 235, station: 'hamburguesas', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_nuggets_meat', category_id: 'cat_hamburguesas', name: 'Nuggets Meat', price: 690, cost: 245, station: 'hamburguesas', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_miami', category_id: 'cat_hamburguesas', name: 'Miami', price: 690, cost: 230, station: 'hamburguesas', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_new_york', category_id: 'cat_hamburguesas', name: 'New York', price: 690, cost: 235, station: 'hamburguesas', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_mozarrella', category_id: 'cat_hamburguesas', name: 'Mozarrella', price: 690, cost: 240, station: 'hamburguesas', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_smash_clasica', category_id: 'cat_hamburguesas', name: 'Smash Clásica', price: 350, cost: 110, station: 'hamburguesas', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_doble_smash', category_id: 'cat_hamburguesas', name: 'Doble Smash', price: 480, cost: 160, station: 'hamburguesas', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_kids_burger', category_id: 'cat_hamburguesas', name: 'Kids Burger', price: 220, cost: 75, station: 'hamburguesas', is_combo: 0, allows_flavors: 0 },

      // --- COMBOS (3) ---
      { id: 'prod_combo_street', category_id: 'cat_combos', name: 'Combo Street', price: 550, cost: 190, station: 'hot_dogs', is_combo: 1, allows_flavors: 0 },
      { id: 'prod_combo_clasico', category_id: 'cat_combos', name: 'Combo Clásico', price: 790, cost: 260, station: 'hot_dogs', is_combo: 1, allows_flavors: 0 },
      { id: 'prod_combo_para_ti', category_id: 'cat_combos', name: 'Combo Para Ti', price: 1390, cost: 480, station: 'hamburguesas', is_combo: 1, allows_flavors: 0 },

      // --- EXTRAS Y RACIONES OFICIALES ---
      { id: 'prod_papas_fritas_extra_150', category_id: 'cat_extras', name: 'Papas Fritas Extra 150g', price: 100, cost: 30, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_carne_extra', category_id: 'cat_extras', name: 'Carne Extra', price: 100, cost: 50, station: 'hamburguesas', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_tocineta_extra', category_id: 'cat_extras', name: 'Tocineta Extra', price: 100, cost: 30, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_pepinillo_extra', category_id: 'cat_extras', name: 'Pepinillo Extra', price: 100, cost: 20, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_jalapenos_extra', category_id: 'cat_extras', name: 'Jalapeños Extra', price: 100, cost: 20, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_papas_fritas_racion_250', category_id: 'cat_extras', name: 'Papas Fritas Ración 250g', price: 350, cost: 90, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_papas_fritas_tradicionales', category_id: 'cat_extras', name: 'Papas Fritas Tradicionales', price: 200, cost: 50, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_papas_queso_tocineta', category_id: 'cat_extras', name: 'Papas Fritas con Queso y Tocineta', price: 320, cost: 90, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_nuggets_pollo_6', category_id: 'cat_extras', name: 'Nuggets de Pollo (6 unid)', price: 300, cost: 85, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },

      // --- BEBIDAS (3) ---
      { id: 'prod_refresco_1lt', category_id: 'cat_bebidas', name: 'Refresco 1 Lt', price: 180, cost: 90, station: 'caja_bebidas', is_combo: 0, allows_flavors: 1 },
      { id: 'prod_malta_lata_250', category_id: 'cat_bebidas', name: 'Malta Lata 250 ml', price: 150, cost: 65, station: 'caja_bebidas', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_agua_mineral_500', category_id: 'cat_bebidas', name: 'Agua Mineral 500 ml', price: 100, cost: 40, station: 'caja_bebidas', is_combo: 0, allows_flavors: 0 },

      // --- MALTEADAS Y HELADOS (1 - Feature Flag Categoría Inactiva) ---
      { id: 'prod_malteada_especial', category_id: 'cat_malteadas', name: 'Malteada Especial Tocineta', price: 350, cost: 130, station: 'caja_bebidas', is_combo: 0, allows_flavors: 0 },

      // --- OBSEQUIOS CUPÓN (2 - Cortesías internas $0.00 venta) ---
      { id: 'prod_snacks_cortesia', category_id: 'cat_obsequios', name: 'Snacks de Cortesía', price: 0, cost: 35, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 },
      { id: 'prod_cafe_cortesia', category_id: 'cat_obsequios', name: 'Café de Cortesía', price: 0, cost: 35, station: 'hot_dogs', is_combo: 0, allows_flavors: 0 }
    ];

    const insertProd = rawDb.prepare(`
      INSERT OR REPLACE INTO products (
        id, category_id, name, description, price_usd_cents, estimated_cost_usd_cents,
        station, is_active, is_combo, allows_flavors, image_url, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?)
    `);

    for (const p of productsData) {
      insertProd.run(p.id, p.category_id, p.name, null, p.price, p.cost, p.station, p.is_combo, p.allows_flavors, now, now);
    }

    // ------------------------------------------------------------------------
    // 5. Ingredientes Asociados a Productos (para exclusión/personalización)
    // ------------------------------------------------------------------------
    const insertProdIng = rawDb.prepare(`
      INSERT OR REPLACE INTO product_ingredients (
        id, product_id, ingredient_id, is_removable, display_order
      ) VALUES (?, ?, ?, 1, ?)
    `);

    // Vincular Pan y Salchicha a todos los perros
    const dogProductIds = [
      'prod_street_dog', 'prod_tocineta_dog_parmesano', 'prod_doritos_dog_snacks',
      'prod_jalapenos_dog', 'prod_brazil_dog', 'prod_classic_dog', 'prod_doble_salchicha_dog'
    ];
    for (const dId of dogProductIds) {
      insertProdIng.run(`pi_${dId}_pan`, dId, 'ing_base_pan_perro', 1);
      insertProdIng.run(`pi_${dId}_salchicha`, dId, 'ing_base_salchicha', 2);
      insertProdIng.run(`pi_${dId}_hilo`, dId, 'ing_base_papas_hilo', 3);
    }

    // Ingredientes específicos para perros
    insertProdIng.run('pi_doritos_snk', 'prod_doritos_dog_snacks', 'ing_base_doritos', 4);
    insertProdIng.run('pi_doritos_cheddar', 'prod_doritos_dog_snacks', 'ing_base_queso_cheddar', 5);
    insertProdIng.run('pi_brazil_ajo', 'prod_brazil_dog', 'ing_base_salsa_ajo', 4);
    insertProdIng.run('pi_jalapenos_jal', 'prod_jalapenos_dog', 'ing_base_jalapenos', 4);
    insertProdIng.run('pi_tocineta_parm', 'prod_tocineta_dog_parmesano', 'ing_base_queso_parmesano', 4);
    insertProdIng.run('pi_tocineta_toc', 'prod_tocineta_dog_parmesano', 'ing_base_tocineta', 5);

    // Vincular Pan Brioche y Carne/Pollo a hamburguesas
    const burgerProductIds = [
      'prod_texas_mex', 'prod_pechuga_cesar', 'prod_grill', 'prod_nuggets_meat',
      'prod_miami', 'prod_new_york', 'prod_mozarrella', 'prod_smash_clasica',
      'prod_doble_smash', 'prod_kids_burger'
    ];
    for (const bId of burgerProductIds) {
      insertProdIng.run(`pi_${bId}_pan`, bId, 'ing_base_pan_brioche', 1);
      if (bId === 'prod_pechuga_cesar') {
        insertProdIng.run(`pi_${bId}_carne`, bId, 'ing_base_pechuga_crispy', 2);
      } else {
        insertProdIng.run(`pi_${bId}_carne`, bId, 'ing_base_carne_smash', 2);
      }
      insertProdIng.run(`pi_${bId}_queso`, bId, 'ing_base_queso_cheddar', 3);
      insertProdIng.run(`pi_${bId}_lechuga`, bId, 'ing_base_lechuga', 4);
    }

    // ------------------------------------------------------------------------
    // 6. Sabores Oficiales Pepsi para Refresco 1 Lt
    // Regla 4: Únicamente los 6 sabores oficiales Pepsi
    // ------------------------------------------------------------------------
    const pepsiFlavors = ['Pepsi', '7Up', 'Frescolita', 'Manzanita', 'Piña', 'Naranja'];
    // Limpiar cualquier sabor previo
    rawDb.prepare("DELETE FROM product_flavor_options WHERE product_id = 'prod_refresco_1lt'").run();

    const insertFlavor = rawDb.prepare(`
      INSERT INTO product_flavor_options (
        id, product_id, flavor_name, is_active, display_order
      ) VALUES (?, 'prod_refresco_1lt', ?, 1, ?)
    `);

    for (let i = 0; i < pepsiFlavors.length; i++) {
      insertFlavor.run(`flav_pepsi_${i + 1}`, pepsiFlavors[i], i + 1);
    }

    // ------------------------------------------------------------------------
    // 7. Configuración de Combos y Descomposición
    // Regla 2: Combo Street, Combo Clásico, Combo Para Ti
    // ------------------------------------------------------------------------
    const insertCombo = rawDb.prepare(`
      INSERT OR REPLACE INTO combos (id, name, combo_price_usd_cents, description)
      VALUES (?, ?, ?, ?)
    `);
    const insertSlot = rawDb.prepare(`
      INSERT OR REPLACE INTO combo_slots (id, combo_id, slot_number, slot_name, required_station)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertSlotOpt = rawDb.prepare(`
      INSERT OR REPLACE INTO combo_slot_options (id, slot_id, product_id, default_selected)
      VALUES (?, ?, ?, ?)
    `);

    // A. Combo Street ($5.50 / 550 cents): 2 Street Dog + 1 Malta Lata 250 ml
    insertCombo.run('prod_combo_street', 'Combo Street', 550, '2 Street Dogs + 1 Malta Lata 250 ml');
    insertSlot.run('slot_street_1', 'prod_combo_street', 1, 'Primer Street Dog', 'hot_dogs');
    insertSlotOpt.run('sopt_street_1_sd', 'slot_street_1', 'prod_street_dog', 1);

    insertSlot.run('slot_street_2', 'prod_combo_street', 2, 'Segundo Street Dog', 'hot_dogs');
    insertSlotOpt.run('sopt_street_2_sd', 'slot_street_2', 'prod_street_dog', 1);

    insertSlot.run('slot_street_3', 'prod_combo_street', 3, 'Bebida', 'caja_bebidas');
    insertSlotOpt.run('sopt_street_3_malta', 'slot_street_3', 'prod_malta_lata_250', 1);

    // B. Combo Clásico ($7.90 / 790 cents): 2 Perros Clásicos a elegir + 1 Malta Lata
    insertCombo.run('prod_combo_clasico', 'Combo Clásico', 790, 'Elige 2 Perros Clásicos + 1 Malta Lata 250 ml');
    const classicDogOptions = [
      'prod_tocineta_dog_parmesano',
      'prod_doritos_dog_snacks',
      'prod_jalapenos_dog',
      'prod_brazil_dog'
    ];

    insertSlot.run('slot_clasico_1', 'prod_combo_clasico', 1, 'Primer Perro Clásico', 'hot_dogs');
    for (const optId of classicDogOptions) {
      insertSlotOpt.run(`sopt_c1_${optId}`, 'slot_clasico_1', optId, optId === 'prod_tocineta_dog_parmesano' ? 1 : 0);
    }

    insertSlot.run('slot_clasico_2', 'prod_combo_clasico', 2, 'Segundo Perro Clásico', 'hot_dogs');
    for (const optId of classicDogOptions) {
      insertSlotOpt.run(`sopt_c2_${optId}`, 'slot_clasico_2', optId, optId === 'prod_doritos_dog_snacks' ? 1 : 0);
    }

    insertSlot.run('slot_clasico_3', 'prod_combo_clasico', 3, 'Bebida', 'caja_bebidas');
    insertSlotOpt.run('sopt_clasico_3_malta', 'slot_clasico_3', 'prod_malta_lata_250', 1);

    // C. Combo Para Ti ($13.90 / 1390 cents): 2 Hamburguesas de $6.90 a elegir + 1 Refresco 1 Lt
    insertCombo.run('prod_combo_para_ti', 'Combo Para Ti', 1390, 'Elige 2 Hamburguesas de $6.90 + 1 Refresco 1 Lt con sabor a elegir');
    const burgerOptions690 = [
      'prod_texas_mex', 'prod_pechuga_cesar', 'prod_grill',
      'prod_nuggets_meat', 'prod_miami', 'prod_new_york', 'prod_mozarrella'
    ];

    insertSlot.run('slot_parati_1', 'prod_combo_para_ti', 1, 'Primera Hamburguesa', 'hamburguesas');
    for (const optId of burgerOptions690) {
      insertSlotOpt.run(`sopt_p1_${optId}`, 'slot_parati_1', optId, optId === 'prod_texas_mex' ? 1 : 0);
    }

    insertSlot.run('slot_parati_2', 'prod_combo_para_ti', 2, 'Segunda Hamburguesa', 'hamburguesas');
    for (const optId of burgerOptions690) {
      insertSlotOpt.run(`sopt_p2_${optId}`, 'slot_parati_2', optId, optId === 'prod_pechuga_cesar' ? 1 : 0);
    }

    insertSlot.run('slot_parati_3', 'prod_combo_para_ti', 3, 'Refresco 1 Litro', 'caja_bebidas');
    insertSlotOpt.run('sopt_parati_3_refresco', 'slot_parati_3', 'prod_refresco_1lt', 1);

    // ------------------------------------------------------------------------
    // 8. Cupones Oficiales y Ejemplos de Cortesía (Regla 6)
    // ------------------------------------------------------------------------
    const couponsData = [
      {
        id: 'coup_cafe_gratis',
        code: 'CAFEGRATIS',
        description: 'Café de Cortesía con tu compra',
        coupon_type: 'COURTESY_ITEM',
        discount_mode: null,
        discount_value: null,
        courtesy_product_id: 'prod_cafe_cortesia',
        max_uses: 200
      },
      {
        id: 'coup_snacks_gratis',
        code: 'SNACKSGRATIS',
        description: 'Snacks de Cortesía para ti',
        coupon_type: 'COURTESY_ITEM',
        discount_mode: null,
        discount_value: null,
        courtesy_product_id: 'prod_snacks_cortesia',
        max_uses: 200
      },
      {
        id: 'coup_parati_10',
        code: 'PARATI10',
        description: '10% de descuento en comida',
        coupon_type: 'DISCOUNT',
        discount_mode: 'PERCENTAGE_BPS',
        discount_value: 1000, // 10.00%
        courtesy_product_id: null,
        max_uses: 100
      },
      {
        id: 'coup_bienvenida_1',
        code: 'BIENVENIDA1',
        description: '$1.00 de descuento en tu orden',
        coupon_type: 'DISCOUNT',
        discount_mode: 'FIXED_USD',
        discount_value: 100, // $1.00
        courtesy_product_id: null,
        max_uses: 100
      }
    ];

    const insertCoupon = rawDb.prepare(`
      INSERT OR REPLACE INTO coupons (
        id, code, description, coupon_type, discount_mode, discount_value,
        courtesy_product_id, max_uses, used_count, expires_at_ms, is_active, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 1, ?)
    `);

    for (const coup of couponsData) {
      insertCoupon.run(
        coup.id, coup.code, coup.description, coup.coupon_type,
        coup.discount_mode, coup.discount_value, coup.courtesy_product_id,
        coup.max_uses, now
      );
    }

    // ------------------------------------------------------------------------
    // 9. Configuración de Impresoras Térmicas 58mm
    // Impresora Caja USB (OneNote / USB RAW) e Impresora Cocina (TCP 9100)
    // ------------------------------------------------------------------------
    const printersData = [
      {
        id: 'print_caja_usb',
        name: 'Impresora Caja USB',
        connection_type: 'SPOOLER_RAW_USB',
        address: 'OneNote for Windows 10',
        columns: 32,
        codepage: 850,
        is_active: 1
      },
      {
        id: 'print_cocina',
        name: 'Impresora Cocina',
        connection_type: 'TCP_9100',
        address: '192.168.31.200:9100',
        columns: 32,
        codepage: 850,
        is_active: 1
      }
    ];

    const insertPrinter = rawDb.prepare(`
      INSERT OR REPLACE INTO printers (
        id, name, connection_type, address, columns, codepage, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const pr of printersData) {
      insertPrinter.run(pr.id, pr.name, pr.connection_type, pr.address, pr.columns, pr.codepage, pr.is_active);
    }
  });

  seedTx();
}
