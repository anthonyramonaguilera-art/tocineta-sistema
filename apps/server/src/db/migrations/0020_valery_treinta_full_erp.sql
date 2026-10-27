-- ============================================================================
-- HITO M20: MOTOR EMPRESARIAL GERENCIAL (ERP COMPLETO)
-- Módulo de Proveedores, Clientes/Socios, Compras, Kardex de Inventario y Nómina
-- ============================================================================

-- 1. Ampliación de supply_items con métricas de costo anterior y unidad de medida
ALTER TABLE supply_items ADD COLUMN unit_measure TEXT NOT NULL DEFAULT 'und';
ALTER TABLE supply_items ADD COLUMN previous_cost_usd_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supply_items ADD COLUMN last_supplier_id TEXT;

-- 2. Vista de compatibilidad para inventory_supplies
CREATE VIEW IF NOT EXISTS inventory_supplies AS
SELECT 
  id,
  name,
  unit,
  unit_measure,
  current_stock_qty,
  minimum_stock_qty,
  cost_per_unit_usd_cents,
  previous_cost_usd_cents,
  last_supplier_id,
  created_at_ms,
  updated_at_ms
FROM supply_items;

-- 3. Tabla de Proveedores (Suppliers)
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rif_phone TEXT,
  category TEXT,
  balance_owed_usd_cents INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);

-- 4. Tabla de Clientes y Socios (Customers)
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  identification TEXT,
  address TEXT,
  is_partner INTEGER NOT NULL DEFAULT 0,
  balance_receivable_usd_cents INTEGER NOT NULL DEFAULT 0,
  total_orders INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_partner ON customers(is_partner);

-- 5. Compras de Materia Prima (Purchases)
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  supplier_id TEXT REFERENCES suppliers(id),
  invoice_number TEXT,
  payment_condition TEXT NOT NULL CHECK (payment_condition IN ('CONTADO', 'CREDITO')),
  status TEXT NOT NULL DEFAULT 'PAGADA',
  total_usd_cents INTEGER NOT NULL,
  total_bs_cents INTEGER NOT NULL,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(created_at_ms);

-- 6. Ítems de la Factura de Compra (Purchase Items)
CREATE TABLE IF NOT EXISTS purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  supply_id TEXT NOT NULL REFERENCES supply_items(id),
  quantity REAL NOT NULL,
  unit_cost_usd_cents INTEGER NOT NULL,
  prev_unit_cost_usd_cents INTEGER NOT NULL DEFAULT 0,
  subtotal_usd_cents INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_supply ON purchase_items(supply_id);

-- 7. Kardex de Movimientos de Inventario (Inventory Movements)
CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  supply_id TEXT NOT NULL REFERENCES supply_items(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('COMPRA_ENTRADA', 'VENTA_RECETA', 'MERMA_SOCIOS', 'CENA_EMPLEADOS', 'GASTO_GAS_INSUMO', 'AJUSTE_PRODUCCION')),
  quantity_delta REAL NOT NULL,
  unit_cost_usd_cents INTEGER NOT NULL,
  total_cost_usd_cents INTEGER NOT NULL,
  partner_customer_id TEXT REFERENCES customers(id),
  reference_doc TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inv_movements_supply ON inventory_movements(supply_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_type ON inventory_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_inv_movements_date ON inventory_movements(created_at_ms);

-- 8. Pagos de Nómina y Adelantos al Personal (Staff Payroll Payments)
CREATE TABLE IF NOT EXISTS staff_payroll_payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  staff_name TEXT NOT NULL,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('SUELDO_TURNO', 'QUINCENA', 'BONO', 'ADELANTO_VALE')),
  amount_usd_cents INTEGER NOT NULL,
  amount_bs_cents INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  notes TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_user ON staff_payroll_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_payroll_date ON staff_payroll_payments(created_at_ms);

-- 9. (Datos Iniciales Demo eliminados para producción limpia)

