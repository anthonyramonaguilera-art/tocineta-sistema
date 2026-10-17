-- Migración 0002_domain_schema_and_ledger.sql
-- Dominio Comercial, Catálogo, Combos Descompuestos, Barra Libre, Pedidos, Ledger Contable e Inmutabilidad

-- 1. Configuración de Negocio y Reglas Financieras
CREATE TABLE IF NOT EXISTS business_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  business_name TEXT NOT NULL DEFAULT 'Tocineta Sonríe',
  rif TEXT NOT NULL DEFAULT 'V-17040918-0',
  phone TEXT NOT NULL DEFAULT '04249728209',
  address TEXT NOT NULL DEFAULT 'Detrás de Torre Movistar, Puerto Ordaz',
  delivery_accounting_mode TEXT NOT NULL CHECK(delivery_accounting_mode IN ('THIRD_PARTY_PASS_THROUGH', 'HOUSE_REVENUE')) DEFAULT 'THIRD_PARTY_PASS_THROUGH',
  delivery_quick_tiers_json TEXT NOT NULL DEFAULT '[200, 300, 400, 500]',
  banesco_pago_movil_phone TEXT NOT NULL DEFAULT '04249728209',
  banesco_pago_movil_id TEXT NOT NULL DEFAULT '17040918',
  pos_fee_bps INTEGER NOT NULL DEFAULT 75,
  updated_at_ms INTEGER NOT NULL
);

-- 2. Historial de Tasas de Cambio (BCV en micro-Bs)
CREATE TABLE IF NOT EXISTS exchange_rates (
  id TEXT PRIMARY KEY,
  rate_micro_bs INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('BCV_API', 'MANUAL_SUPERVISOR', 'MANUAL_ADMIN')),
  set_by_user_id TEXT REFERENCES users(id),
  created_at_ms INTEGER NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_created_at ON exchange_rates(created_at_ms);

-- 3. Jornadas de Operación Diaria (Apertura / Cierre de Día)
CREATE TABLE IF NOT EXISTS jornadas (
  id TEXT PRIMARY KEY,
  opened_by_user_id TEXT NOT NULL REFERENCES users(id),
  closed_by_user_id TEXT REFERENCES users(id),
  opened_at_ms INTEGER NOT NULL,
  closed_at_ms INTEGER,
  status TEXT NOT NULL CHECK(status IN ('abierta', 'cerrada')) DEFAULT 'abierta',
  initial_cash_usd_cents INTEGER NOT NULL DEFAULT 0,
  initial_cash_bs_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_jornadas_status ON jornadas(status);

-- 4. Sesiones de Caja por Cajera/Turno
CREATE TABLE IF NOT EXISTS cash_sessions (
  id TEXT PRIMARY KEY,
  jornada_id TEXT NOT NULL REFERENCES jornadas(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  opened_at_ms INTEGER NOT NULL,
  closed_at_ms INTEGER,
  status TEXT NOT NULL CHECK(status IN ('abierta', 'cerrada')) DEFAULT 'abierta',
  opening_cash_usd_cents INTEGER NOT NULL DEFAULT 0,
  opening_cash_bs_cents INTEGER NOT NULL DEFAULT 0,
  closing_cash_usd_cents INTEGER,
  closing_cash_bs_cents INTEGER,
  closing_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_jornada ON cash_sessions(jornada_id);

-- 5. Categorías de Menú
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_internal INTEGER NOT NULL DEFAULT 0,
  station TEXT NOT NULL CHECK(station IN ('hot_dogs', 'hamburguesas', 'caja_bebidas'))
);

CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(is_active);

-- 6. Productos del Catálogo
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  description TEXT,
  price_usd_cents INTEGER NOT NULL,
  estimated_cost_usd_cents INTEGER NOT NULL DEFAULT 0,
  station TEXT NOT NULL CHECK(station IN ('hot_dogs', 'hamburguesas', 'caja_bebidas')),
  is_active INTEGER NOT NULL DEFAULT 1,
  is_combo INTEGER NOT NULL DEFAULT 0,
  allows_flavors INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

-- 7. Sabores de Productos (ej. Refresco 1 Lt)
CREATE TABLE IF NOT EXISTS product_flavor_options (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  flavor_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_flavors_product ON product_flavor_options(product_id);

-- 8. Ingredientes y Modificadores (incluye Barra Libre a $0.00)
CREATE TABLE IF NOT EXISTS ingredients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_barra_libre INTEGER NOT NULL DEFAULT 0,
  extra_price_usd_cents INTEGER NOT NULL DEFAULT 0,
  internal_cost_usd_cents INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- 9. Ingredientes Base de cada Producto (para soportar exclusiones "Sin ...")
CREATE TABLE IF NOT EXISTS product_ingredients (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
  is_removable INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_prod_ing_product ON product_ingredients(product_id);

-- 10. Combos y Reglas de Descomposición
CREATE TABLE IF NOT EXISTS combos (
  id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  combo_price_usd_cents INTEGER NOT NULL,
  description TEXT
);

-- 11. Ranuras (Slots) de Combos
CREATE TABLE IF NOT EXISTS combo_slots (
  id TEXT PRIMARY KEY,
  combo_id TEXT NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
  slot_number INTEGER NOT NULL,
  slot_name TEXT NOT NULL,
  required_station TEXT NOT NULL CHECK(required_station IN ('hot_dogs', 'hamburguesas', 'caja_bebidas'))
);

CREATE INDEX IF NOT EXISTS idx_combo_slots_combo ON combo_slots(combo_id);

-- 12. Opciones por Ranura de Combo
CREATE TABLE IF NOT EXISTS combo_slot_options (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES combo_slots(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  default_selected INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_combo_slot_options_slot ON combo_slot_options(slot_id);

-- 13. Cupones de Descuento y Cortesía
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  coupon_type TEXT NOT NULL CHECK(coupon_type IN ('DISCOUNT', 'COURTESY_ITEM')),
  discount_mode TEXT CHECK(discount_mode IN ('FIXED_USD', 'PERCENTAGE_BPS')),
  discount_value INTEGER,
  courtesy_product_id TEXT REFERENCES products(id),
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at_ms INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL
);

-- 14. Órdenes / Comandas
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number INTEGER NOT NULL,
  jornada_id TEXT NOT NULL REFERENCES jornadas(id),
  cash_session_id TEXT REFERENCES cash_sessions(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  fulfillment_type TEXT NOT NULL CHECK(fulfillment_type IN ('salon', 'para_llevar', 'delivery')) DEFAULT 'salon',
  table_number TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  delivery_address TEXT,
  delivery_fee_usd_cents INTEGER NOT NULL DEFAULT 0,
  gross_food_subtotal_usd_cents INTEGER NOT NULL DEFAULT 0,
  discount_usd_cents INTEGER NOT NULL DEFAULT 0,
  coupon_id TEXT REFERENCES coupons(id),
  net_food_sales_usd_cents INTEGER NOT NULL DEFAULT 0,
  total_to_collect_usd_cents INTEGER NOT NULL DEFAULT 0,
  rate_micro_bs INTEGER NOT NULL,
  payment_status TEXT NOT NULL CHECK(payment_status IN ('sin_pago', 'parcial', 'pagado', 'autorizado_sin_pago')) DEFAULT 'sin_pago',
  fulfillment_status TEXT NOT NULL CHECK(fulfillment_status IN ('pendiente', 'enviado', 'en_cocina', 'en_preparacion', 'listo', 'entregado', 'cerrado', 'anulado')) DEFAULT 'pendiente',
  station_status_hot_dogs TEXT NOT NULL CHECK(station_status_hot_dogs IN ('na', 'pendiente', 'en_preparacion', 'listo')) DEFAULT 'na',
  station_status_hamburguesas TEXT NOT NULL CHECK(station_status_hamburguesas IN ('na', 'pendiente', 'en_preparacion', 'listo')) DEFAULT 'na',
  notes TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  closed_at_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_orders_jornada ON orders(jornada_id);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment ON orders(fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(payment_status);

-- Trigger SQLite Obligatorio: Bloqueo de cierre de orden con deuda abierta
CREATE TRIGGER IF NOT EXISTS trg_orders_no_close_with_debt
BEFORE UPDATE ON orders
WHEN NEW.fulfillment_status = 'cerrado' AND NEW.payment_status IN ('sin_pago', 'parcial', 'autorizado_sin_pago')
BEGIN
  SELECT RAISE(ABORT, 'ORDER_CLOSE_DEBT_BLOCKED: No se puede cerrar una orden con saldo pendiente de pago');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_no_insert_closed_with_debt
BEFORE INSERT ON orders
WHEN NEW.fulfillment_status = 'cerrado' AND NEW.payment_status IN ('sin_pago', 'parcial', 'autorizado_sin_pago')
BEGIN
  SELECT RAISE(ABORT, 'ORDER_CLOSE_DEBT_BLOCKED: No se puede registrar como cerrada una orden con saldo pendiente de pago');
END;

-- 15. Líneas de Orden
CREATE TABLE IF NOT EXISTS order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  line_role TEXT NOT NULL CHECK(line_role IN ('STANDARD', 'COMBO_PARENT', 'COMBO_CHILD', 'COURTESY_ITEM')) DEFAULT 'STANDARD',
  parent_line_id TEXT REFERENCES order_lines(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_usd_cents INTEGER NOT NULL,
  prorated_unit_price_usd_cents INTEGER NOT NULL,
  subtotal_usd_cents INTEGER NOT NULL,
  station TEXT NOT NULL CHECK(station IN ('hot_dogs', 'hamburguesas', 'caja_bebidas')),
  flavor_choice TEXT,
  custom_instructions TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_role ON order_lines(line_role);
CREATE INDEX IF NOT EXISTS idx_order_lines_parent ON order_lines(parent_line_id);

-- 16. Modificadores por Línea (Ingredientes excluidos, extras o Barra Libre)
CREATE TABLE IF NOT EXISTS order_line_modifiers (
  id TEXT PRIMARY KEY,
  order_line_id TEXT NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  ingredient_id TEXT REFERENCES ingredients(id),
  ingredient_name TEXT NOT NULL,
  modifier_type TEXT NOT NULL CHECK(modifier_type IN ('SIN_INGREDIENTE', 'EXTRA_INGREDIENTE', 'BARRA_LIBRE')),
  extra_price_usd_cents INTEGER NOT NULL DEFAULT 0,
  internal_cost_usd_cents INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_line_mods_line ON order_line_modifiers(order_line_id);

-- 17. Pagos de Orden
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK(method IN ('EFECTIVO_USD', 'EFECTIVO_BS', 'PAGO_MOVIL', 'PUNTO_DE_VENTA', 'UBII', 'BINANCE', 'ZELLE', 'OTROS')),
  currency TEXT NOT NULL CHECK(currency IN ('USD', 'BS')),
  amount_cents INTEGER NOT NULL,
  rate_micro_bs INTEGER NOT NULL,
  usd_equivalent_cents INTEGER NOT NULL,
  reference_code TEXT,
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(reference_code);

-- 18. Entregas de Vuelto
CREATE TABLE IF NOT EXISTS change_deliveries (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  change_usd_cents INTEGER NOT NULL DEFAULT 0,
  change_bs_cents INTEGER NOT NULL DEFAULT 0,
  rate_micro_bs INTEGER NOT NULL,
  delivered_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_change_order ON change_deliveries(order_id);

-- 19. Libro Diario Contable Inmutable (Ledger Entries)
CREATE TABLE IF NOT EXISTS ledger_entries (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL UNIQUE,
  jornada_id TEXT NOT NULL REFERENCES jornadas(id),
  order_id TEXT REFERENCES orders(id),
  account_bucket TEXT NOT NULL CHECK(account_bucket IN (
    'FOOD_SALES', 'MOTORIZADO_FUND', 'MARKETING_COURTESY', 'CASH_USD',
    'CASH_BS', 'BANK_BS', 'BANK_USD', 'DISCOUNT_EXPENSE', 'OPERATING_EXPENSE',
    'ROUNDING_ADJUSTMENT', 'TIP_IN'
  )),
  debit_usd_cents INTEGER NOT NULL DEFAULT 0,
  credit_usd_cents INTEGER NOT NULL DEFAULT 0,
  rate_micro_bs INTEGER NOT NULL,
  description TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_jornada ON ledger_entries(jornada_id);
CREATE INDEX IF NOT EXISTS idx_ledger_bucket ON ledger_entries(account_bucket);

-- Triggers SQLite Obligatorios: Inmutabilidad estricta de ledger_entries
CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_update
BEFORE UPDATE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE: ledger_entries is append-only and immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_delete
BEFORE DELETE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE: ledger_entries is append-only and immutable');
END;

-- 20. Impresoras Físicas
CREATE TABLE IF NOT EXISTS printers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  connection_type TEXT NOT NULL CHECK(connection_type IN ('SPOOLER_RAW_USB', 'TCP_9100')),
  address TEXT NOT NULL,
  columns INTEGER NOT NULL DEFAULT 32,
  codepage INTEGER NOT NULL DEFAULT 850,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- 21. Trabajos de Impresión Asíncrona
CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  printer_id TEXT NOT NULL REFERENCES printers(id),
  order_id TEXT REFERENCES orders(id),
  job_type TEXT NOT NULL CHECK(job_type IN ('TICKET_COCINA', 'NOTA_ENTREGA', 'CORTE_X', 'CIERRE_Z', 'TEST')),
  payload_bytes BLOB NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'printed', 'failed')) DEFAULT 'pending',
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);

-- 22. Incidencias Operativas y Mermas
CREATE TABLE IF NOT EXISTS worker_incidents (
  id TEXT PRIMARY KEY,
  jornada_id TEXT NOT NULL REFERENCES jornadas(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  incident_type TEXT NOT NULL CHECK(incident_type IN ('MERMA_ALIMENTO', 'EQUIPO_FALLA', 'DISCREPANCIA_CAJA', 'OTRO')),
  description TEXT NOT NULL,
  estimated_loss_usd_cents INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL
);

-- 23. Despachos de Delivery a Domicilio
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  motorizado_name TEXT,
  delivery_fee_usd_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('asignado', 'en_camino', 'entregado', 'fallido')) DEFAULT 'asignado',
  settled_to_motorizado INTEGER NOT NULL DEFAULT 0,
  settled_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL
);

-- 24. Redenciones de Cupones
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id TEXT PRIMARY KEY,
  coupon_id TEXT NOT NULL REFERENCES coupons(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  benefit_usd_cents INTEGER NOT NULL,
  redeemed_at_ms INTEGER NOT NULL
);

-- 25. Insumos y Materia Prima (Inventario)
CREATE TABLE IF NOT EXISTS supply_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  current_stock_qty REAL NOT NULL DEFAULT 0,
  minimum_stock_qty REAL NOT NULL DEFAULT 0,
  cost_per_unit_usd_cents INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

-- 26. Recetas Técnicas
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  notes TEXT
);

-- 27. Ítems de Receta
CREATE TABLE IF NOT EXISTS recipe_items (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  supply_item_id TEXT NOT NULL REFERENCES supply_items(id),
  quantity_required REAL NOT NULL
);

-- 28. Conteos Físicos de Stock
CREATE TABLE IF NOT EXISTS stock_counts (
  id TEXT PRIMARY KEY,
  jornada_id TEXT NOT NULL REFERENCES jornadas(id),
  counted_by_user_id TEXT NOT NULL REFERENCES users(id),
  supply_item_id TEXT NOT NULL REFERENCES supply_items(id),
  system_qty REAL NOT NULL,
  physical_qty REAL NOT NULL,
  difference_qty REAL NOT NULL,
  difference_cost_usd_cents INTEGER NOT NULL,
  counted_at_ms INTEGER NOT NULL
);

-- 29. Gastos Operativos Menores (Caja Chica)
CREATE TABLE IF NOT EXISTS operating_expenses (
  id TEXT PRIMARY KEY,
  jornada_id TEXT NOT NULL REFERENCES jornadas(id),
  category TEXT NOT NULL CHECK(category IN ('HIELO', 'VERDURAS', 'GAS', 'TRANSPORTE', 'MANTENIMIENTO', 'VARIOS')),
  amount_usd_cents INTEGER NOT NULL,
  amount_bs_cents INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  authorized_by_user_id TEXT NOT NULL REFERENCES users(id),
  receipt_photo_path TEXT,
  created_at_ms INTEGER NOT NULL
);

-- 30. Bitácora de Eventos Operativos del Sistema
CREATE TABLE IF NOT EXISTS events_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL CHECK(level IN ('info', 'warn', 'error')),
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_log_created_at ON events_log(created_at_ms);
