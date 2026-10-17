import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const systemMeta = sqliteTable('_system_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const migrationsTable = sqliteTable('_migrations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  appliedAtMs: integer('applied_at_ms').notNull()
});

export const UserRoleValues = ['admin', 'supervisor', 'cajera', 'mesonero', 'cocinero', 'despachador'] as const;
export type UserRole = (typeof UserRoleValues)[number];

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role', { enum: UserRoleValues }).notNull(),
  pinHash: text('pin_hash').notNull(),
  pinSalt: text('pin_salt').notNull(),
  pinLength: integer('pin_length').notNull(), // 4 o 6
  mustChangePin: integer('must_change_pin').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockoutStage: integer('lockout_stage').notNull().default(0),
  lockedUntilMs: integer('locked_until_ms'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  role: text('role', { enum: UserRoleValues }).notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  expiresAtMs: integer('expires_at_ms').notNull(),
  lastActivityMs: integer('last_activity_ms').notNull(),
  sensitiveUnlockedUntilMs: integer('sensitive_unlocked_until_ms'),
  revokedAtMs: integer('revoked_at_ms')
});

export const auditEvents = sqliteTable('audit_events', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  eventId: text('event_id').notNull().unique(),
  actorUserId: text('actor_user_id').references(() => users.id),
  authorizerUserId: text('authorizer_user_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  payloadJson: text('payload_json').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  prevHash: text('prev_hash').notNull(),
  entryHash: text('entry_hash').notNull().unique()
});

export const idempotencyKeys = sqliteTable('idempotency_keys', {
  idempotencyKey: text('idempotency_key').primaryKey(),
  method: text('method').notNull(),
  route: text('route').notNull(),
  requestHash: text('request_hash').notNull(),
  statusCode: integer('status_code').notNull(),
  responseJson: text('response_json').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  expiresAtMs: integer('expires_at_ms').notNull()
});

export type SystemMeta = typeof systemMeta.$inferSelect;
export type InsertSystemMeta = typeof systemMeta.$inferInsert;
export type MigrationRecord = typeof migrationsTable.$inferSelect;
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type InsertAuditEvent = typeof auditEvents.$inferInsert;
export type IdempotencyRecord = typeof idempotencyKeys.$inferSelect;
export type InsertIdempotencyRecord = typeof idempotencyKeys.$inferInsert;

export function mapUserRow(row: any): User {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    pinHash: row.pin_hash ?? row.pinHash,
    pinSalt: row.pin_salt ?? row.pinSalt,
    pinLength: row.pin_length ?? row.pinLength,
    mustChangePin: row.must_change_pin ?? row.mustChangePin ?? 0,
    isActive: row.is_active ?? row.isActive ?? 1,
    failedAttempts: row.failed_attempts ?? row.failedAttempts ?? 0,
    lockoutStage: row.lockout_stage ?? row.lockoutStage ?? 0,
    lockedUntilMs: row.locked_until_ms ?? row.lockedUntilMs ?? null,
    createdAtMs: row.created_at_ms ?? row.createdAtMs,
    updatedAtMs: row.updated_at_ms ?? row.updatedAtMs
  };
}

export function mapSessionRow(row: any): Session {
  return {
    id: row.id,
    userId: row.user_id ?? row.userId,
    tokenHash: row.token_hash ?? row.tokenHash,
    role: row.role,
    createdAtMs: row.created_at_ms ?? row.createdAtMs,
    expiresAtMs: row.expires_at_ms ?? row.expiresAtMs,
    lastActivityMs: row.last_activity_ms ?? row.lastActivityMs,
    sensitiveUnlockedUntilMs: row.sensitive_unlocked_until_ms ?? row.sensitiveUnlockedUntilMs ?? null,
    revokedAtMs: row.revoked_at_ms ?? row.revokedAtMs ?? null
  };
}

// ----------------------------------------------------------------------------
// ENUMS Y TABLAS DE DOMINIO COMERCIAL Y CONTABLE (M2)
// ----------------------------------------------------------------------------

export const StationValues = ['hot_dogs', 'hamburguesas', 'caja_bebidas'] as const;
export type Station = (typeof StationValues)[number];

export const LineRoleValues = ['STANDARD', 'COMBO_PARENT', 'COMBO_CHILD', 'COURTESY_ITEM'] as const;
export type LineRole = (typeof LineRoleValues)[number];

export const ModifierTypeValues = ['SIN_INGREDIENTE', 'EXTRA_INGREDIENTE', 'BARRA_LIBRE'] as const;
export type ModifierType = (typeof ModifierTypeValues)[number];

export const FulfillmentTypeValues = ['salon', 'para_llevar', 'delivery'] as const;
export type FulfillmentType = (typeof FulfillmentTypeValues)[number];

export const PaymentStatusValues = ['sin_pago', 'parcial', 'pagado', 'autorizado_sin_pago', 'anulado', 'reembolsado'] as const;
export type PaymentStatus = (typeof PaymentStatusValues)[number];

export const FulfillmentStatusValues = ['pendiente', 'enviado', 'en_cocina', 'en_preparacion', 'listo', 'entregado', 'cerrado', 'anulado'] as const;
export type FulfillmentStatus = (typeof FulfillmentStatusValues)[number];

export const AccountBucketValues = [
  'FOOD_SALES',
  'MOTORIZADO_FUND',
  'MARKETING_COURTESY',
  'CASH_USD',
  'CASH_BS',
  'BANK_BS',
  'BANK_USD',
  'DISCOUNT_EXPENSE',
  'OPERATING_EXPENSE',
  'ROUNDING_ADJUSTMENT',
  'TIP_IN'
] as const;
export type AccountBucket = (typeof AccountBucketValues)[number];

export const businessSettings = sqliteTable('business_settings', {
  id: text('id').primaryKey().default('default'),
  businessName: text('business_name').notNull().default('Tocineta Sonríe'),
  rif: text('rif').notNull().default('V-17040918-0'),
  phone: text('phone').notNull().default('04249728209'),
  address: text('address').notNull().default('Detrás de Torre Movistar, Puerto Ordaz'),
  deliveryAccountingMode: text('delivery_accounting_mode').notNull().default('THIRD_PARTY_PASS_THROUGH'),
  deliveryQuickTiersJson: text('delivery_quick_tiers_json').notNull().default('[200, 300, 400, 500]'),
  tableServiceMode: text('table_service_mode').notNull().default('ticket_independiente'),
  banescoPagoMovilPhone: text('banesco_pago_movil_phone').notNull().default('04249728209'),
  banescoPagoMovilId: text('banesco_pago_movil_id').notNull().default('17040918'),
  posFeeBps: integer('pos_fee_bps').notNull().default(75),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const exchangeRates = sqliteTable('exchange_rates', {
  id: text('id').primaryKey(),
  rateMicroBs: integer('rate_micro_bs').notNull(),
  source: text('source').notNull(),
  setByUserId: text('set_by_user_id').references(() => users.id),
  createdAtMs: integer('created_at_ms').notNull(),
  isCurrent: integer('is_current').notNull().default(1)
});

export const jornadas = sqliteTable('jornadas', {
  id: text('id').primaryKey(),
  openedByUserId: text('opened_by_user_id').notNull().references(() => users.id),
  closedByUserId: text('closed_by_user_id').references(() => users.id),
  openedAtMs: integer('opened_at_ms').notNull(),
  closedAtMs: integer('closed_at_ms'),
  status: text('status').notNull().default('abierta'),
  initialCashUsdCents: integer('initial_cash_usd_cents').notNull().default(0),
  initialCashBsCents: integer('initial_cash_bs_cents').notNull().default(0),
  auditHeadHash: text('audit_head_hash'),
  zReportJson: text('z_report_json'),
  notes: text('notes')
});

export const cashSessions = sqliteTable('cash_sessions', {
  id: text('id').primaryKey(),
  jornadaId: text('jornada_id').notNull().references(() => jornadas.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
  openedAtMs: integer('opened_at_ms').notNull(),
  closedAtMs: integer('closed_at_ms'),
  status: text('status').notNull().default('abierta'),
  openingCashUsdCents: integer('opening_cash_usd_cents').notNull().default(0),
  openingCashBsCents: integer('opening_cash_bs_cents').notNull().default(0),
  closingCashUsdCents: integer('closing_cash_usd_cents'),
  closingCashBsCents: integer('closing_cash_bs_cents'),
  recountUsed: integer('recount_used').notNull().default(0),
  closingUbiiVoucherBsCents: integer('closing_ubii_voucher_bs_cents'),
  expectedCashUsdCents: integer('expected_cash_usd_cents'),
  expectedCashBsCents: integer('expected_cash_bs_cents'),
  expectedUbiiGrossBsCents: integer('expected_ubii_gross_bs_cents'),
  diffUsdCents: integer('diff_usd_cents'),
  diffBsCents: integer('diff_bs_cents'),
  diffUbiiBsCents: integer('diff_ubii_bs_cents'),
  closingNotes: text('closing_notes')
});

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  displayOrder: integer('display_order').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  isInternal: integer('is_internal').notNull().default(0),
  station: text('station', { enum: StationValues }).notNull()
});

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  categoryId: text('category_id').notNull().references(() => categories.id),
  name: text('name').notNull(),
  description: text('description'),
  priceUsdCents: integer('price_usd_cents').notNull(),
  estimatedCostUsdCents: integer('estimated_cost_usd_cents').notNull().default(0),
  station: text('station', { enum: StationValues }).notNull(),
  isActive: integer('is_active').notNull().default(1),
  isAvailable: integer('is_available').notNull().default(1),
  isCombo: integer('is_combo').notNull().default(0),
  allowsFlavors: integer('allows_flavors').notNull().default(0),
  imageUrl: text('image_url'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const productFlavorOptions = sqliteTable('product_flavor_options', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  flavorName: text('flavor_name').notNull(),
  isActive: integer('is_active').notNull().default(1),
  isAvailable: integer('is_available').notNull().default(1),
  displayOrder: integer('display_order').notNull().default(0)
});

export const ingredients = sqliteTable('ingredients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isBarraLibre: integer('is_barra_libre').notNull().default(0),
  extraPriceUsdCents: integer('extra_price_usd_cents').notNull().default(0),
  internalCostUsdCents: integer('internal_cost_usd_cents').notNull().default(0),
  isActive: integer('is_active').notNull().default(1)
});

export const productIngredients = sqliteTable('product_ingredients', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  ingredientId: text('ingredient_id').notNull().references(() => ingredients.id),
  isRemovable: integer('is_removable').notNull().default(1),
  displayOrder: integer('display_order').notNull().default(0)
});

export const combos = sqliteTable('combos', {
  id: text('id').primaryKey().references(() => products.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  comboPriceUsdCents: integer('combo_price_usd_cents').notNull(),
  description: text('description')
});

export const comboSlots = sqliteTable('combo_slots', {
  id: text('id').primaryKey(),
  comboId: text('combo_id').notNull().references(() => combos.id, { onDelete: 'cascade' }),
  slotNumber: integer('slot_number').notNull(),
  slotName: text('slot_name').notNull(),
  requiredStation: text('required_station', { enum: StationValues }).notNull()
});

export const comboSlotOptions = sqliteTable('combo_slot_options', {
  id: text('id').primaryKey(),
  slotId: text('slot_id').notNull().references(() => comboSlots.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  defaultSelected: integer('default_selected').notNull().default(0)
});

export const coupons = sqliteTable('coupons', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  description: text('description'),
  couponType: text('coupon_type').notNull(),
  discountMode: text('discount_mode'),
  discountValue: integer('discount_value'),
  courtesyProductId: text('courtesy_product_id').references(() => products.id),
  maxUses: integer('max_uses'),
  usedCount: integer('used_count').notNull().default(0),
  expiresAtMs: integer('expires_at_ms'),
  isActive: integer('is_active').notNull().default(1),
  createdAtMs: integer('created_at_ms').notNull()
});

export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  orderNumber: integer('order_number').notNull(),
  jornadaId: text('jornada_id').notNull().references(() => jornadas.id),
  cashSessionId: text('cash_session_id').references(() => cashSessions.id),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id),
  fulfillmentType: text('fulfillment_type', { enum: FulfillmentTypeValues }).notNull().default('salon'),
  tableNumber: text('table_number'),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  deliveryAddress: text('delivery_address'),
  deliveryFeeUsdCents: integer('delivery_fee_usd_cents').notNull().default(0),
  grossFoodSubtotalUsdCents: integer('gross_food_subtotal_usd_cents').notNull().default(0),
  discountUsdCents: integer('discount_usd_cents').notNull().default(0),
  couponId: text('coupon_id').references(() => coupons.id),
  netFoodSalesUsdCents: integer('net_food_sales_usd_cents').notNull().default(0),
  totalToCollectUsdCents: integer('total_to_collect_usd_cents').notNull().default(0),
  rateMicroBs: integer('rate_micro_bs').notNull(),
  paymentStatus: text('payment_status', { enum: PaymentStatusValues }).notNull().default('sin_pago'),
  fulfillmentStatus: text('fulfillment_status', { enum: FulfillmentStatusValues }).notNull().default('pendiente'),
  stationStatusHotDogs: text('station_status_hot_dogs').notNull().default('na'),
  stationStatusHamburguesas: text('station_status_hamburguesas').notNull().default('na'),
  notes: text('notes'),
  version: integer('version').notNull().default(1),
  authorizedWithoutPaymentBy: text('authorized_without_payment_by').references(() => users.id),
  tableServiceMode: text('table_service_mode').notNull().default('ticket_independiente'),
  kitchenPassedAtMs: integer('kitchen_passed_at_ms'),
  emergencySlipNumber: text('emergency_slip_number').unique(),
  isDeferredPaper: integer('is_deferred_paper').notNull().default(0),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
  closedAtMs: integer('closed_at_ms')
});

export const OrderLineStatusValues = ['pendiente', 'preparando', 'listo'] as const;
export type OrderLineStatus = (typeof OrderLineStatusValues)[number];

export const orderLines = sqliteTable('order_lines', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => products.id),
  lineRole: text('line_role', { enum: LineRoleValues }).notNull().default('STANDARD'),
  parentLineId: text('parent_line_id'),
  quantity: integer('quantity').notNull().default(1),
  unitPriceUsdCents: integer('unit_price_usd_cents').notNull(),
  proratedUnitPriceUsdCents: integer('prorated_unit_price_usd_cents').notNull(),
  subtotalUsdCents: integer('subtotal_usd_cents').notNull(),
  station: text('station', { enum: StationValues }).notNull(),
  flavorChoice: text('flavor_choice'),
  customInstructions: text('custom_instructions'),
  status: text('status', { enum: OrderLineStatusValues }).notNull().default('pendiente'),
  preparedAtMs: integer('prepared_at_ms'),
  readyAtMs: integer('ready_at_ms'),
  snapshotJson: text('snapshot_json'),
  createdAtMs: integer('created_at_ms').notNull()
});

export const orderLineModifiers = sqliteTable('order_line_modifiers', {
  id: text('id').primaryKey(),
  orderLineId: text('order_line_id').notNull().references(() => orderLines.id, { onDelete: 'cascade' }),
  ingredientId: text('ingredient_id').references(() => ingredients.id),
  ingredientName: text('ingredient_name').notNull(),
  modifierType: text('modifier_type', { enum: ModifierTypeValues }).notNull(),
  extraPriceUsdCents: integer('extra_price_usd_cents').notNull().default(0),
  internalCostUsdCents: integer('internal_cost_usd_cents').notNull().default(0)
});

export const payments = sqliteTable('payments', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  method: text('method').notNull(),
  currency: text('currency').notNull(),
  amountCents: integer('amount_cents').notNull(),
  rateMicroBs: integer('rate_micro_bs').notNull(),
  usdEquivalentCents: integer('usd_equivalent_cents').notNull(),
  referenceCode: text('reference_code'),
  recordedByUserId: text('recorded_by_user_id').notNull().references(() => users.id),
  createdAtMs: integer('created_at_ms').notNull()
});

export const changeDeliveries = sqliteTable('change_deliveries', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  changeUsdCents: integer('change_usd_cents').notNull().default(0),
  changeBsCents: integer('change_bs_cents').notNull().default(0),
  rateMicroBs: integer('rate_micro_bs').notNull(),
  deliveredByUserId: text('delivered_by_user_id').notNull().references(() => users.id),
  createdAtMs: integer('created_at_ms').notNull()
});

export const ledgerEntries = sqliteTable('ledger_entries', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  entryId: text('entry_id').notNull().unique(),
  jornadaId: text('jornada_id').notNull().references(() => jornadas.id),
  orderId: text('order_id').references(() => orders.id),
  accountBucket: text('account_bucket', { enum: AccountBucketValues }).notNull(),
  debitUsdCents: integer('debit_usd_cents').notNull().default(0),
  creditUsdCents: integer('credit_usd_cents').notNull().default(0),
  rateMicroBs: integer('rate_micro_bs').notNull(),
  description: text('description').notNull(),
  createdAtMs: integer('created_at_ms').notNull()
});

export const printers = sqliteTable('printers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  connectionType: text('connection_type').notNull(),
  address: text('address').notNull(),
  columns: integer('columns').notNull().default(32),
  codepage: integer('codepage').notNull().default(850),
  isActive: integer('is_active').notNull().default(1)
});

export const printJobs = sqliteTable('print_jobs', {
  id: text('id').primaryKey(),
  printerId: text('printer_id').notNull().references(() => printers.id),
  orderId: text('order_id').references(() => orders.id),
  jobType: text('job_type').notNull(),
  payloadBytes: text('payload_bytes').notNull(),
  ticketIrJson: text('ticket_ir_json'),
  station: text('station'),
  status: text('status').notNull().default('en_cola'),
  errorMessage: text('error_message'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  reprintCount: integer('reprint_count').notNull().default(0),
  reprintReason: text('reprint_reason'),
  reprintedByUserId: text('reprinted_by_user_id').references(() => users.id),
  createdAtMs: integer('created_at_ms').notNull(),
  completedAtMs: integer('completed_at_ms')
});

export const workerIncidents = sqliteTable('worker_incidents', {
  id: text('id').primaryKey(),
  jornadaId: text('jornada_id').notNull().references(() => jornadas.id),
  userId: text('user_id').notNull().references(() => users.id),
  orderId: text('order_id').references(() => orders.id),
  incidentType: text('incident_type').notNull(),
  reasonCode: text('reason_code'),
  responsibleArea: text('responsible_area'),
  resolution: text('resolution'),
  description: text('description').notNull(),
  estimatedLossUsdCents: integer('estimated_loss_usd_cents').notNull().default(0),
  authorizedByUserId: text('authorized_by_user_id').references(() => users.id),
  createdAtMs: integer('created_at_ms').notNull()
});

export const deliveries = sqliteTable('deliveries', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  motorizadoName: text('motorizado_name'),
  deliveryFeeUsdCents: integer('delivery_fee_usd_cents').notNull(),
  status: text('status').notNull().default('asignado'),
  settledToMotorizado: integer('settled_to_motorizado').notNull().default(0),
  settledAtMs: integer('settled_at_ms'),
  createdAtMs: integer('created_at_ms').notNull()
});

export const couponRedemptions = sqliteTable('coupon_redemptions', {
  id: text('id').primaryKey(),
  couponId: text('coupon_id').notNull().references(() => coupons.id),
  orderId: text('order_id').notNull().references(() => orders.id),
  userId: text('user_id').notNull().references(() => users.id),
  benefitUsdCents: integer('benefit_usd_cents').notNull(),
  redeemedAtMs: integer('redeemed_at_ms').notNull()
});

export const supplyItems = sqliteTable('supply_items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  currentStockQty: integer('current_stock_qty').notNull().default(0),
  minimumStockQty: integer('minimum_stock_qty').notNull().default(0),
  costPerUnitUsdCents: integer('cost_per_unit_usd_cents').notNull().default(0),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const recipes = sqliteTable('recipes', {
  id: text('id').primaryKey().references(() => products.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  notes: text('notes')
});

export const recipeItems = sqliteTable('recipe_items', {
  id: text('id').primaryKey(),
  recipeId: text('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  supplyItemId: text('supply_item_id').notNull().references(() => supplyItems.id),
  quantityRequired: integer('quantity_required').notNull()
});

export const stockCounts = sqliteTable('stock_counts', {
  id: text('id').primaryKey(),
  jornadaId: text('jornada_id').notNull().references(() => jornadas.id),
  countedByUserId: text('counted_by_user_id').notNull().references(() => users.id),
  supplyItemId: text('supply_item_id').notNull().references(() => supplyItems.id),
  systemQty: integer('system_qty').notNull(),
  physicalQty: integer('physical_qty').notNull(),
  differenceQty: integer('difference_qty').notNull(),
  differenceCostUsdCents: integer('difference_cost_usd_cents').notNull(),
  countedAtMs: integer('counted_at_ms').notNull()
});

export const operatingExpenses = sqliteTable('operating_expenses', {
  id: text('id').primaryKey(),
  jornadaId: text('jornada_id').notNull().references(() => jornadas.id),
  category: text('category').notNull(),
  amountUsdCents: integer('amount_usd_cents').notNull(),
  amountBsCents: integer('amount_bs_cents').notNull().default(0),
  description: text('description').notNull(),
  authorizedByUserId: text('authorized_by_user_id').notNull().references(() => users.id),
  receiptPhotoPath: text('receipt_photo_path'),
  createdAtMs: integer('created_at_ms').notNull()
});

export const eventsLog = sqliteTable('events_log', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  eventType: text('event_type').notNull(),
  entityId: text('entity_id').notNull(),
  payloadJson: text('payload_json').notNull(),
  createdAtMs: integer('created_at_ms').notNull()
});

export type BusinessSettings = typeof businessSettings.$inferSelect;
export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type Jornada = typeof jornadas.$inferSelect;
export type CashSession = typeof cashSessions.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductFlavorOption = typeof productFlavorOptions.$inferSelect;
export type Ingredient = typeof ingredients.$inferSelect;
export type ProductIngredient = typeof productIngredients.$inferSelect;
export type Combo = typeof combos.$inferSelect;
export type ComboSlot = typeof comboSlots.$inferSelect;
export type ComboSlotOption = typeof comboSlotOptions.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderLine = typeof orderLines.$inferSelect;
export type OrderLineModifier = typeof orderLineModifiers.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type ChangeDelivery = typeof changeDeliveries.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type Printer = typeof printers.$inferSelect;
export type PrintJob = typeof printJobs.$inferSelect;
export type WorkerIncident = typeof workerIncidents.$inferSelect;
export type Delivery = typeof deliveries.$inferSelect;
export type CouponRedemption = typeof couponRedemptions.$inferSelect;
export type SupplyItem = typeof supplyItems.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
export type RecipeItem = typeof recipeItems.$inferSelect;
export type StockCount = typeof stockCounts.$inferSelect;
export type OperatingExpense = typeof operatingExpenses.$inferSelect;
export type EventLog = typeof eventsLog.$inferSelect;

export const BackupTypeValues = ['SNAPSHOT_HOT', 'ENCRYPTED_USB_DAILY', 'MANUAL_EXPORT'] as const;
export type BackupType = (typeof BackupTypeValues)[number];

export const backupsLog = sqliteTable('backups_log', {
  id: text('id').primaryKey(),
  backupType: text('backup_type', { enum: BackupTypeValues }).notNull(),
  destinationPath: text('destination_path').notNull(),
  fileSizeBytes: integer('file_size_bytes').notNull(),
  sha256Hash: text('sha256_hash').notNull(),
  jornadaId: text('jornada_id').references(() => jornadas.id),
  auditHeadHash: text('audit_head_hash'),
  recipientsCount: integer('recipients_count').default(0),
  createdAtMs: integer('created_at_ms').notNull()
});

export type BackupLog = typeof backupsLog.$inferSelect;
export type InsertBackupLog = typeof backupsLog.$inferInsert;
