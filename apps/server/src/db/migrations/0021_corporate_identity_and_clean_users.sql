-- ============================================================================
-- MIGRACIÓN 0021: IDENTIDAD CORPORATIVA LIMPIA TOCINETA (PRD v2.0)
-- Agrega columna username y sanea repartidores a perfiles genéricos oficiales
-- ============================================================================

ALTER TABLE users ADD COLUMN username TEXT;
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Saneamiento de motorizados existentes
UPDATE delivery_drivers SET name = 'REPARTIDOR 1' WHERE id = 'drv_carlos_mora' OR name LIKE '%Carlos%';
UPDATE delivery_drivers SET name = 'REPARTIDOR 2' WHERE id = 'drv_jose_ramirez' OR name LIKE '%José%' OR name LIKE '%Jose%';
UPDATE delivery_drivers SET name = 'REPARTIDOR 3' WHERE id = 'drv_miguel_perez' OR name LIKE '%Miguel%';

-- Asegurar los 3 repartidores corporativos
INSERT OR IGNORE INTO delivery_drivers (id, name, phone, is_active, created_at_ms, updated_at_ms)
VALUES 
  ('drv_carlos_mora', 'REPARTIDOR 1', '04148523311', 1, 1700000000000, 1700000000000),
  ('drv_jose_ramirez', 'REPARTIDOR 2', '04249112233', 1, 1700000000000, 1700000000000),
  ('drv_miguel_perez', 'REPARTIDOR 3', '04128994455', 1, 1700000000000, 1700000000000);

-- Saneamiento de socios y clientes
UPDATE customers SET name = 'Socio Director', address = 'TOCINETA' WHERE id = 'cust_partner_olinelcys' OR name LIKE '%Olinelcys%';
UPDATE customers SET name = 'Cliente Frecuente 1' WHERE id = 'cust_vip_carlos' OR name LIKE '%Carlos%';
UPDATE business_settings SET business_name = 'TOCINETA' WHERE id = 'default';

