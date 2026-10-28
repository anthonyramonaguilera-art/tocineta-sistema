-- ============================================================================
-- MIGRACIÓN 0029: REASIGNACIÓN DE SEDES OFICIALES Y JORNADA GLOBAL ÚNICA (R2 / P2-A)
-- ============================================================================

-- 1. ASEGURAR QUE LAS DOS SEDES OFICIALES EXISTEN ANTES DE REASIGNAR
INSERT OR IGNORE INTO locations (id, name, type, is_active, address, phone, created_at_ms, updated_at_ms)
VALUES ('loc_los_olivos', 'Sede A: Los Olivos', 'mixed', 1, 'Los Olivos, Puerto Ordaz', '0424-9000001', strftime('%s','now') * 1000, strftime('%s','now') * 1000);

INSERT OR IGNORE INTO locations (id, name, type, is_active, address, phone, created_at_ms, updated_at_ms)
VALUES ('loc_alta_vista', 'Sede B: Alta Vista', 'sale', 1, 'Detrás de Torre Movistar, Alta Vista, Puerto Ordaz', '0424-9728209', strftime('%s','now') * 1000, strftime('%s','now') * 1000);

-- 2. REASIGNACIÓN IDEMPOTENTE DE 'sede_alta_vista' -> 'loc_alta_vista' EN TABLAS HIJAS

-- location_inventory: combinar stock de insumos que ya existan en loc_alta_vista
UPDATE location_inventory
SET current_stock_qty = current_stock_qty + (
  SELECT li_old.current_stock_qty 
  FROM location_inventory li_old 
  WHERE li_old.location_id = 'sede_alta_vista' 
    AND li_old.supply_id = location_inventory.supply_id
),
updated_at_ms = strftime('%s','now') * 1000
WHERE location_id = 'loc_alta_vista'
  AND EXISTS (
    SELECT 1 FROM location_inventory li_old 
    WHERE li_old.location_id = 'sede_alta_vista' 
      AND li_old.supply_id = location_inventory.supply_id
  );

DELETE FROM location_inventory
WHERE location_id = 'sede_alta_vista'
  AND supply_id IN (
    SELECT supply_id FROM location_inventory WHERE location_id = 'loc_alta_vista'
  );

UPDATE location_inventory
SET location_id = 'loc_alta_vista'
WHERE location_id = 'sede_alta_vista';

-- monthly_closures: eliminar duplicados si existieran antes de reasignar
DELETE FROM monthly_closures
WHERE location_id = 'sede_alta_vista'
  AND (year || '-' || month) IN (
    SELECT (year || '-' || month) FROM monthly_closures WHERE location_id = 'loc_alta_vista'
  );

UPDATE monthly_closures
SET location_id = 'loc_alta_vista'
WHERE location_id = 'sede_alta_vista';

-- Resto de tablas hijas con location_id
UPDATE orders SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE jornadas SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE cash_sessions SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE deliveries SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE stock_counts SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE delivery_drivers SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE delivery_driver_settlements SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE purchases SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE inventory_movements SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE waste_logs SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE inter_location_transfers SET from_location_id = 'loc_alta_vista' WHERE from_location_id = 'sede_alta_vista';
UPDATE inter_location_transfers SET to_location_id = 'loc_alta_vista' WHERE to_location_id = 'sede_alta_vista';
UPDATE transfer_batches SET from_location_id = 'loc_alta_vista' WHERE from_location_id = 'sede_alta_vista';
UPDATE transfer_batches SET to_location_id = 'loc_alta_vista' WHERE to_location_id = 'sede_alta_vista';
UPDATE production_logs SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE operating_expenses SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE receivable_accounts SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE receivable_payments SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE payable_payments SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE tip_pools SET location_id = 'loc_alta_vista' WHERE location_id = 'sede_alta_vista';
UPDATE users SET default_location_id = 'loc_alta_vista' WHERE default_location_id = 'sede_alta_vista';
UPDATE users SET allowed_locations_json = REPLACE(allowed_locations_json, 'sede_alta_vista', 'loc_alta_vista') WHERE allowed_locations_json LIKE '%sede_alta_vista%';

-- 3. ELIMINAR EL ALIAS 'sede_alta_vista' DE LA TABLA PADRE
DELETE FROM locations WHERE id = 'sede_alta_vista';

-- 4. JORNADA GLOBAL ÚNICA (D1)
-- Cierre automático de jornadas abiertas inactivas (0 órdenes y 0 pagos), conservando la más reciente
UPDATE jornadas
SET status = 'cerrada',
    closed_at_ms = strftime('%s','now') * 1000,
    notes = CASE 
      WHEN notes IS NULL OR notes = '' THEN 'cerrada por migración R2'
      ELSE notes || ' | cerrada por migración R2'
    END
WHERE status = 'abierta'
  AND id != (SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1)
  AND (SELECT COUNT(*) FROM orders WHERE jornada_id = jornadas.id) = 0
  AND (SELECT COUNT(*) FROM payments p JOIN orders o ON p.order_id = o.id WHERE o.jornada_id = jornadas.id) = 0;

-- Si alguna otra jornada abierta tiene actividad previa, abortar la migración de forma segura
CREATE TEMP TABLE IF NOT EXISTS _check_jornada_conflict (id INTEGER);
CREATE TEMP TRIGGER IF NOT EXISTS _abort_conflicting_jornadas BEFORE INSERT ON _check_jornada_conflict
BEGIN
  SELECT RAISE(ABORT, 'MIGRACION_R2_ABORT: Existen multiples jornadas abiertas con actividad previa no cerradas. No se puede forzar el cierre.');
END;
INSERT INTO _check_jornada_conflict (id)
SELECT 1 WHERE (SELECT COUNT(*) FROM jornadas WHERE status = 'abierta') > 1;
DROP TRIGGER IF EXISTS _abort_conflicting_jornadas;
DROP TABLE IF EXISTS _check_jornada_conflict;

-- 5. ÍNDICE ÚNICO PARCIAL DE JORNADA ABIERTA
CREATE UNIQUE INDEX IF NOT EXISTS ux_jornada_abierta ON jornadas(status) WHERE status = 'abierta';
