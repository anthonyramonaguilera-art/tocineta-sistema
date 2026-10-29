import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

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

export const LocationTypeValues = ['production', 'sale', 'mixed'] as const;
export type LocationType = (typeof LocationTypeValues)[number];

export const locations = sqliteTable('locations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type', { enum: LocationTypeValues }).notNull(),
  isActive: integer('is_active').notNull().default(1),
  address: text('address'),
  phone: text('phone'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const UserRoleValues = ['admin', 'supervisor', 'cajera', 'mesonero', 'cocinero', 'despachador'] as const;
export type UserRole = (typeof UserRoleValues)[number];

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  username: text('username'),
  role: text('role', { enum: UserRoleValues }).notNull(),
  pinHash: text('pin_hash').notNull(),
  pinSalt: text('pin_salt').notNull(),
  pinLength: integer('pin_length').notNull(), // 4 o 6
  mustChangePin: integer('must_change_pin').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockoutStage: integer('lockout_stage').notNull().default(0),
  lockedUntilMs: integer('locked_until_ms'),
  cedula: text('cedula'),
  phone: text('phone'),
  passwordHash: text('password_hash'),
  passwordSalt: text('password_salt'),
  approvalStatus: text('approval_status', { enum: ['PENDING', 'APPROVED', 'REJECTED'] }).notNull().default('APPROVED'),
  permissionsJson: text('permissions_json').notNull().default('[]'),
  defaultLocationId: text('default_location_id').notNull().default('loc_alta_vista').references(() => locations.id),
  allowedLocationsJson: text('allowed_locations_json').notNull().default('["loc_los_olivos", "loc_alta_vista"]'),
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
export type Location = typeof locations.$inferSelect;
export type InsertLocation = typeof locations.$inferInsert;
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
    username: row.username ?? null,
    role: row.role,
    pinHash: row.pin_hash ?? row.pinHash,
    pinSalt: row.pin_salt ?? row.pinSalt,
    pinLength: row.pin_length ?? row.pinLength,
    mustChangePin: row.must_change_pin ?? row.mustChangePin ?? 0,
    isActive: row.is_active ?? row.isActive ?? 1,
    failedAttempts: row.failed_attempts ?? row.failedAttempts ?? 0,
    lockoutStage: row.lockout_stage ?? row.lockoutStage ?? 0,
    lockedUntilMs: row.locked_until_ms ?? row.lockedUntilMs ?? null,
    cedula: row.cedula ?? null,
    phone: row.phone ?? null,
    passwordHash: row.password_hash ?? row.passwordHash ?? null,
    passwordSalt: row.password_salt ?? row.passwordSalt ?? null,
    approvalStatus: row.approval_status ?? row.approvalStatus ?? 'APPROVED',
    permissionsJson: row.permissions_json ?? row.permissionsJson ?? '[]',
    defaultLocationId: row.default_location_id ?? row.defaultLocationId ?? 'loc_alta_vista',
    allowedLocationsJson: row.allowed_locations_json ?? row.allowedLocationsJson ?? '["loc_los_olivos", "loc_alta_vista"]',
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
  businessName: text('business_name').notNull().default('TOCINETA'),
  rif: text('rif').notNull().default('V-17040918-0'),
  phone: text('phone').notNull().default('04249728209'),
  address: text('address').notNull().default('Detrás de Torre Movistar, Puerto Ordaz'),
  slogan: text('slogan').notNull().default('Cocinamos con amor y servimos como mereces'),
  logoUrl: text('logo_url'),
  primaryColor: text('primary_color').notNull().default('#EAB308'),
  rateChangeHour: text('rate_change_hour').notNull().default('13:00'),
  ticketHeaderMessage: text('ticket_header_message').notNull().default('¡BIENVENIDOS!'),
  ticketFooterMessage: text('ticket_footer_message').notNull().default('¡GRACIAS POR SU PREFERENCIA! Dios le bendiga'),
  deliveryAccountingMode: text('delivery_accounting_mode').notNull().default('THIRD_PARTY_PASS_THROUGH'),
  deliveryQuickTiersJson: text('delivery_quick_tiers_json').notNull().default('[200, 300, 400, 500]'),
  tableServiceMode: text('table_service_mode').notNull().default('ticket_independiente'),
  banescoPagoMovilPhone: text('banesco_pago_movil_phone').notNull().default('04249728209'),
  banescoPagoMovilId: text('banesco_pago_movil_id').notNull().default('17040918'),
  posFeeBps: integer('pos_fee_bps').notNull().default(75),
  profitabilityProEnabled: integer('profitability_pro_enabled').notNull().default(0),
  fiscalModuleEnabled: integer('fiscal_module_enabled').notNull().default(0),
  fiscalPriceMode: text('fiscal_price_mode').notNull().default('INCLUSIVE'),
  ivaEnabled: integer('iva_enabled').notNull().default(0),
  ivaRateBps: integer('iva_rate_bps').notNull().default(1600),
  igtfEnabled: integer('igtf_enabled').notNull().default(0),
  igtfRateBps: integer('igtf_rate_bps').notNull().default(300),
  igtfAppliesTo: text('igtf_applies_to').notNull().default('CASH_USD'),
  isDemoMode: integer('is_demo_mode').notNull().default(0),
  owner5NumbersConfig: text('owner_5_numbers_config').notNull().default('["sales_today","profit_today","cash_today","receivable_total","payable_total"]'),
  partnersModuleEnabled: integer('partners_module_enabled').notNull().default(0),
  eventsQuoteEnabled: integer('events_quote_enabled').notNull().default(1),
  onboardingCompleted: integer('onboarding_completed').notNull().default(1),
  askTableOnOrder: integer('ask_table_on_order').notNull().default(0),
  inventoryOperationMode: text('inventory_operation_mode').notNull().default('free'),
  inventoryTrackingSinceMs: integer('inventory_tracking_since_ms'),
  printMode: text('print_mode').notNull().default('one'),
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
  locationId: text('location_id').notNull().default('loc_alta_vista').references(() => locations.id),
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
  locationId: text('location_id').notNull().default('loc_alta_vista').references(() => locations.id),
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

export const RecipeModeValues = ['UNITS', 'GRAMMAGE', 'FINISHED_PRODUCT'] as const;
export type RecipeMode = (typeof RecipeModeValues)[number];

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  categoryId: text('category_id').notNull().references(() => categories.id),
  name: text('name').notNull(),
  description: text('description'),
  priceUsdCents: integer('price_usd_cents').notNull(),
  estimatedCostUsdCents: integer('estimated_cost_usd_cents').notNull().default(0),
  recipeMode: text('recipe_mode', { enum: RecipeModeValues }).notNull().default('UNITS'),
  targetMarginBps: integer('target_margin_bps').notNull().default(6500),
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
  locationId: text('location_id').notNull().default('loc_alta_vista').references(() => locations.id),
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
  ingredientId: text('ingredient_id'),
  ingredientName: text('ingredient_name').notNull(),
  modifierName: text('modifier_name'),
  modifierType: text('modifier_type').notNull(),
  state: text('state').default('normal'),
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
  codepage: integer('codepage').notNull().default(16),
  hasCutter: integer('has_cutter').notNull().default(0),
  hasBuzzer: integer('has_buzzer').notNull().default(0),
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
  locationId: text('location_id').notNull().default('loc_alta_vista').references(() => locations.id),
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
  redeemedAtMs: integer('redeemed_at_ms').notNull(),
  reversedAtMs: integer('reversed_at_ms'),
  reversedAt: integer('reversed_at')
});

export const supplyItems = sqliteTable('supply_items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  unitMeasure: text('unit_measure').notNull().default('und'),
  purchaseUnit: text('purchase_unit').notNull().default('paquete'),
  usageUnit: text('usage_unit').notNull().default('und'),
  conversionFactor: real('conversion_factor').notNull().default(1.0),
  category: text('category').notNull().default('general'),
  minStock: real('min_stock').notNull().default(0),
  currentStockQty: real('current_stock_qty').notNull().default(0),
  minimumStockQty: real('minimum_stock_qty').notNull().default(0),
  costPerUnitUsdCents: integer('cost_per_unit_usd_cents').notNull().default(0),
  weightedAvgCostUsdCents: integer('weighted_avg_cost_usd_cents').notNull().default(0),
  lastCostUsdCents: integer('last_cost_usd_cents').notNull().default(0),
  previousCostUsdCents: integer('previous_cost_usd_cents').notNull().default(0),
  lastSupplierId: text('last_supplier_id'),
  isActive: integer('is_active').notNull().default(1),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const locationInventory = sqliteTable('location_inventory', {
  id: text('id').primaryKey(),
  locationId: text('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
  supplyId: text('supply_id').notNull().references(() => supplyItems.id, { onDelete: 'cascade' }),
  currentStockQty: real('current_stock_qty').notNull().default(0),
  minimumStockQty: real('minimum_stock_qty').notNull().default(0),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const subRecipes = sqliteTable('sub_recipes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  yieldQuantity: real('yield_quantity').notNull(),
  yieldUnit: text('yield_unit').notNull(),
  costPerUnitUsdCents: integer('cost_per_unit_usd_cents').notNull().default(0),
  notes: text('notes'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const subRecipeItems = sqliteTable('sub_recipe_items', {
  id: text('id').primaryKey(),
  subRecipeId: text('sub_recipe_id').notNull().references(() => subRecipes.id, { onDelete: 'cascade' }),
  supplyId: text('supply_id').notNull().references(() => supplyItems.id, { onDelete: 'cascade' }),
  quantityRequired: real('quantity_required').notNull()
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
  supplyItemId: text('supply_item_id').references(() => supplyItems.id),
  quantityRequired: real('quantity_required').notNull(),
  grossWeightGrams: real('gross_weight_grams'),
  shrinkagePercentage: real('shrinkage_percentage').default(0),
  subRecipeId: text('sub_recipe_id').references(() => subRecipes.id)
});

export const stockCounts = sqliteTable('stock_counts', {
  id: text('id').primaryKey(),
  locationId: text('location_id').notNull().default('loc_alta_vista').references(() => locations.id),
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
  locationId: text('location_id').notNull().default('loc_alta_vista').references(() => locations.id),
  jornadaId: text('jornada_id').notNull().references(() => jornadas.id),
  category: text('category').notNull(),
  amountUsdCents: integer('amount_usd_cents').notNull(),
  amountBsCents: integer('amount_bs_cents').notNull().default(0),
  paymentMethod: text('payment_method').notNull().default('EFECTIVO_USD'),
  isRecurring: integer('is_recurring').notNull().default(0),
  recurringInterval: text('recurring_interval'),
  notes: text('notes'),
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

export const eventsLogArchive = sqliteTable('events_log_archive', {
  seq: integer('seq').primaryKey(),
  eventType: text('event_type').notNull(),
  entityId: text('entity_id').notNull(),
  payloadJson: text('payload_json').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  archivedAtMs: integer('archived_at_ms').notNull()
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
export type CouponRedemption = typeof couponRedemptions.$inferSelect & {
  reversed_at?: number | null;
  reversed_at_ms?: number | null;
};
export type SupplyItem = typeof supplyItems.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
export type RecipeItem = typeof recipeItems.$inferSelect;
export type StockCount = typeof stockCounts.$inferSelect;
export type OperatingExpense = typeof operatingExpenses.$inferSelect;
export type EventLog = typeof eventsLog.$inferSelect;
export type EventLogArchive = typeof eventsLogArchive.$inferSelect;

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

export const supportSessions = sqliteTable('support_sessions', {
  id: text('id').primaryKey(),
  startedByUserId: text('started_by_user_id').notNull().references(() => users.id),
  startedAtMs: integer('started_at_ms').notNull(),
  expiresAtMs: integer('expires_at_ms').notNull(),
  endedAtMs: integer('ended_at_ms'),
  status: text('status', { enum: ['ACTIVE', 'ENDED', 'EXPIRED'] }).notNull(),
  quickAssistLaunched: integer('quick_assist_launched').notNull().default(0),
  notes: text('notes')
});

export const systemUpdates = sqliteTable('system_updates', {
  id: text('id').primaryKey(),
  version: text('version').notNull(),
  previousVersion: text('previous_version'),
  description: text('description'),
  manifestSha256: text('manifest_sha256').notNull(),
  appliedByUserId: text('applied_by_user_id').references(() => users.id),
  appliedAtMs: integer('applied_at_ms').notNull(),
  status: text('status', { enum: ['APPLIED', 'FAILED_ROLLBACK', 'IN_PROGRESS'] }).notNull(),
  errorDetails: text('error_details')
});

export type SupportSession = typeof supportSessions.$inferSelect;
export type SystemUpdate = typeof systemUpdates.$inferSelect;

export const suppliers = sqliteTable('suppliers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rifPhone: text('rif_phone'),
  category: text('category'),
  balanceOwedUsdCents: integer('balance_owed_usd_cents').notNull().default(0),
  createdAtMs: integer('created_at_ms').notNull()
});

export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  identification: text('identification'),
  address: text('address'),
  isPartner: integer('is_partner').notNull().default(0),
  balanceReceivableUsdCents: integer('balance_receivable_usd_cents').notNull().default(0),
  totalOrders: integer('total_orders').notNull().default(0),
  createdAtMs: integer('created_at_ms').notNull()
});

export const purchases = sqliteTable('purchases', {
  id: text('id').primaryKey(),
  locationId: text('location_id').notNull().default('loc_alta_vista').references(() => locations.id),
  supplierId: text('supplier_id').references(() => suppliers.id),
  invoiceNumber: text('invoice_number'),
  paymentCondition: text('payment_condition', { enum: ['CONTADO', 'CREDITO'] }).notNull(),
  status: text('status').notNull().default('PAGADA'),
  totalUsdCents: integer('total_usd_cents').notNull(),
  totalBsCents: integer('total_bs_cents').notNull(),
  balanceOwedUsdCents: integer('balance_owed_usd_cents').notNull().default(0),
  dueDateMs: integer('due_date_ms'),
  notes: text('notes'),
  createdBy: text('created_by').notNull(),
  createdAtMs: integer('created_at_ms').notNull()
});

export const purchaseItems = sqliteTable('purchase_items', {
  id: text('id').primaryKey(),
  purchaseId: text('purchase_id').notNull().references(() => purchases.id, { onDelete: 'cascade' }),
  supplyId: text('supply_id').notNull().references(() => supplyItems.id),
  quantity: real('quantity').notNull(),
  unitCostUsdCents: integer('unit_cost_usd_cents').notNull(),
  prevUnitCostUsdCents: integer('prev_unit_cost_usd_cents').notNull().default(0),
  subtotalUsdCents: integer('subtotal_usd_cents').notNull()
});

export const inventoryMovements = sqliteTable('inventory_movements', {
  id: text('id').primaryKey(),
  locationId: text('location_id').notNull().default('loc_alta_vista').references(() => locations.id),
  supplyId: text('supply_id').notNull().references(() => supplyItems.id),
  movementType: text('movement_type', {
    enum: [
      'COMPRA_ENTRADA',
      'VENTA_RECETA',
      'MERMA_SOCIOS',
      'CENA_EMPLEADOS',
      'GASTO_GAS_INSUMO',
      'AJUSTE_PRODUCCION',
      'TRANSFERENCIA_SALIDA',
      'TRANSFERENCIA_ENTRADA',
      'MERMA_DESECHO',
      'AJUSTE_CONTEO'
    ]
  }).notNull(),
  quantityDelta: real('quantity_delta').notNull(),
  unitCostUsdCents: integer('unit_cost_usd_cents').notNull(),
  totalCostUsdCents: integer('total_cost_usd_cents').notNull(),
  partnerCustomerId: text('partner_customer_id').references(() => customers.id),
  referenceDoc: text('reference_doc'),
  notes: text('notes'),
  createdBy: text('created_by').notNull(),
  createdAtMs: integer('created_at_ms').notNull()
});

export const priceHistory = sqliteTable('price_history', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  oldPriceUsdCents: integer('old_price_usd_cents').notNull(),
  newPriceUsdCents: integer('new_price_usd_cents').notNull(),
  reason: text('reason').notNull(),
  confirmedByUserId: text('confirmed_by_user_id').references(() => users.id),
  createdAtMs: integer('created_at_ms').notNull()
});

export const wasteLogs = sqliteTable('waste_logs', {
  id: text('id').primaryKey(),
  locationId: text('location_id').notNull().references(() => locations.id),
  itemType: text('item_type', { enum: ['supply', 'product'] }).notNull(),
  supplyId: text('supply_id').references(() => supplyItems.id),
  productId: text('product_id').references(() => products.id),
  quantity: real('quantity').notNull(),
  unit: text('unit').notNull(),
  costUsdCents: integer('cost_usd_cents').notNull(),
  reason: text('reason').notNull(),
  reportedByUserId: text('reported_by_user_id').notNull().references(() => users.id),
  createdAtMs: integer('created_at_ms').notNull()
});

export const staffPayrollPayments = sqliteTable('staff_payroll_payments', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  staffName: text('staff_name').notNull(),
  paymentType: text('payment_type', {
    enum: ['SUELDO_TURNO', 'QUINCENA', 'BONO', 'ADELANTO_VALE']
  }).notNull(),
  amountUsdCents: integer('amount_usd_cents').notNull(),
  amountBsCents: integer('amount_bs_cents').notNull(),
  paymentMethod: text('payment_method').notNull(),
  notes: text('notes'),
  createdAtMs: integer('created_at_ms').notNull()
});

export type LocationInventory = typeof locationInventory.$inferSelect;
export type InsertLocationInventory = typeof locationInventory.$inferInsert;
export type SubRecipe = typeof subRecipes.$inferSelect;
export type InsertSubRecipe = typeof subRecipes.$inferInsert;
export type SubRecipeItem = typeof subRecipeItems.$inferSelect;
export type InsertSubRecipeItem = typeof subRecipeItems.$inferInsert;
export type PriceHistory = typeof priceHistory.$inferSelect;
export type InsertPriceHistory = typeof priceHistory.$inferInsert;
export type WasteLog = typeof wasteLogs.$inferSelect;
export type InsertWasteLog = typeof wasteLogs.$inferInsert;
export type Supplier = typeof suppliers.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
export type PurchaseItem = typeof purchaseItems.$inferSelect;
export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type StaffPayrollPayment = typeof staffPayrollPayments.$inferSelect;

export const clientErrors = sqliteTable('client_errors', {
  id: text('id').primaryKey(),
  viewName: text('view_name').notNull(),
  errorMessage: text('error_message').notNull(),
  errorStack: text('error_stack'),
  userId: text('user_id'),
  userRole: text('user_role'),
  createdAtMs: integer('created_at_ms').notNull()
});

export type ClientError = typeof clientErrors.$inferSelect;

export const interLocationTransfers = sqliteTable('inter_location_transfers', {
  id: text('id').primaryKey(),
  transferNumber: integer('transfer_number').notNull(),
  dispatchNoteCode: text('dispatch_note_code').notNull().unique(),
  fromLocationId: text('from_location_id').notNull().references(() => locations.id),
  toLocationId: text('to_location_id').notNull().references(() => locations.id),
  status: text('status', { enum: ['EN_TRANSITO', 'RECIBIDO', 'COMPLETADO', 'CANCELADO'] }).notNull(),
  mode: text('mode', { enum: ['DISH_EQUIVALENT', 'LOOSE_SUPPLIES', 'BATCH'] }).notNull(),
  itemsJson: text('items_json').notNull(),
  dishEquivalentsJson: text('dish_equivalents_json'),
  batchId: text('batch_id'),
  totalCostUsdCents: integer('total_cost_usd_cents').notNull().default(0),
  forcedWithPin: integer('forced_with_pin').notNull().default(0),
  forceReason: text('force_reason'),
  forcedByUserId: text('forced_by_user_id').references(() => users.id),
  notes: text('notes'),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id),
  receivedByUserId: text('received_by_user_id').references(() => users.id),
  receivedAtMs: integer('received_at_ms'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const transferBatches = sqliteTable('transfer_batches', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  fromLocationId: text('from_location_id').references(() => locations.id),
  toLocationId: text('to_location_id').references(() => locations.id),
  itemsJson: text('items_json').notNull(),
  isActive: integer('is_active').notNull().default(1),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const productionLogs = sqliteTable('production_logs', {
  id: text('id').primaryKey(),
  locationId: text('location_id').notNull().references(() => locations.id),
  targetType: text('target_type', { enum: ['SUB_RECIPE', 'PRODUCT'] }).notNull(),
  targetId: text('target_id').notNull(),
  targetName: text('target_name').notNull(),
  quantityProduced: real('quantity_produced').notNull(),
  unit: text('unit').notNull(),
  totalCostUsdCents: integer('total_cost_usd_cents').notNull().default(0),
  consumedSuppliesJson: text('consumed_supplies_json').notNull(),
  producedByUserId: text('produced_by_user_id').notNull().references(() => users.id),
  notes: text('notes'),
  createdAtMs: integer('created_at_ms').notNull()
});

export type InterLocationTransfer = typeof interLocationTransfers.$inferSelect;
export type InsertInterLocationTransfer = typeof interLocationTransfers.$inferInsert;
export type TransferBatch = typeof transferBatches.$inferSelect;
export type InsertTransferBatch = typeof transferBatches.$inferInsert;
export type ProductionLog = typeof productionLogs.$inferSelect;
export type InsertProductionLog = typeof productionLogs.$inferInsert;

export const expenseCategories = sqliteTable('expense_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  isDefault: integer('is_default').notNull().default(0),
  createdAtMs: integer('created_at_ms').notNull()
});

export const receivableAccounts = sqliteTable('receivable_accounts', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull().references(() => customers.id),
  locationId: text('location_id').notNull().references(() => locations.id),
  orderId: text('order_id').references(() => orders.id),
  concept: text('concept').notNull(),
  totalUsdCents: integer('total_usd_cents').notNull(),
  balanceUsdCents: integer('balance_usd_cents').notNull(),
  dueDateMs: integer('due_date_ms').notNull(),
  status: text('status', { enum: ['PENDIENTE', 'PARCIAL', 'PAGADA', 'VENCIDA'] }).notNull().default('PENDIENTE'),
  notes: text('notes'),
  createdBy: text('created_by').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const receivablePayments = sqliteTable('receivable_payments', {
  id: text('id').primaryKey(),
  receivableId: text('receivable_id').notNull().references(() => receivableAccounts.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').notNull().references(() => customers.id),
  locationId: text('location_id').notNull().references(() => locations.id),
  amountUsdCents: integer('amount_usd_cents').notNull(),
  amountBsCents: integer('amount_bs_cents').notNull().default(0),
  exchangeRateMicroBs: integer('exchange_rate_micro_bs').notNull(),
  paymentMethod: text('payment_method').notNull(),
  referenceCode: text('reference_code'),
  receiptPhotoPath: text('receipt_photo_path'),
  notes: text('notes'),
  receivedBy: text('received_by').notNull(),
  createdAtMs: integer('created_at_ms').notNull()
});

export const payablePayments = sqliteTable('payable_payments', {
  id: text('id').primaryKey(),
  purchaseId: text('purchase_id').notNull().references(() => purchases.id, { onDelete: 'cascade' }),
  supplierId: text('supplier_id').notNull().references(() => suppliers.id),
  locationId: text('location_id').notNull().references(() => locations.id),
  amountUsdCents: integer('amount_usd_cents').notNull(),
  amountBsCents: integer('amount_bs_cents').notNull().default(0),
  exchangeRateMicroBs: integer('exchange_rate_micro_bs').notNull(),
  paymentMethod: text('payment_method').notNull(),
  referenceCode: text('reference_code'),
  receiptPhotoPath: text('receipt_photo_path'),
  notes: text('notes'),
  paidBy: text('paid_by').notNull(),
  createdAtMs: integer('created_at_ms').notNull()
});

export const monthlyClosures = sqliteTable('monthly_closures', {
  id: text('id').primaryKey(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  locationId: text('location_id').notNull(),
  totalSalesUsdCents: integer('total_sales_usd_cents').notNull(),
  totalCogsUsdCents: integer('total_cogs_usd_cents').notNull(),
  totalWasteUsdCents: integer('total_waste_usd_cents').notNull(),
  totalExpensesUsdCents: integer('total_expenses_usd_cents').notNull(),
  netProfitUsdCents: integer('net_profit_usd_cents').notNull(),
  metricsJson: text('metrics_json').notNull(),
  closedByUserId: text('closed_by_user_id').notNull().references(() => users.id),
  closedAtMs: integer('closed_at_ms').notNull(),
  notes: text('notes')
});

export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type InsertExpenseCategory = typeof expenseCategories.$inferInsert;
export type ReceivableAccount = typeof receivableAccounts.$inferSelect;
export type InsertReceivableAccount = typeof receivableAccounts.$inferInsert;
export type ReceivablePayment = typeof receivablePayments.$inferSelect;
export type InsertReceivablePayment = typeof receivablePayments.$inferInsert;
export type PayablePayment = typeof payablePayments.$inferSelect;
export type InsertPayablePayment = typeof payablePayments.$inferInsert;
export type MonthlyClosure = typeof monthlyClosures.$inferSelect;
export type InsertMonthlyClosure = typeof monthlyClosures.$inferInsert;

export const staffPayrollProfiles = sqliteTable('staff_payroll_profiles', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  frequency: text('frequency', { enum: ['DIARIO', 'SEMANAL', 'QUINCENAL'] }).notNull().default('SEMANAL'),
  baseSalaryUsdCents: integer('base_salary_usd_cents').notNull().default(0),
  notes: text('notes'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const staffPayrollSettlements = sqliteTable('staff_payroll_settlements', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  periodStartMs: integer('period_start_ms').notNull(),
  periodEndMs: integer('period_end_ms').notNull(),
  frequency: text('frequency', { enum: ['DIARIO', 'SEMANAL', 'QUINCENAL'] }).notNull(),
  baseSalaryUsdCents: integer('base_salary_usd_cents').notNull(),
  bonusesUsdCents: integer('bonuses_usd_cents').notNull().default(0),
  advancesUsdCents: integer('advances_usd_cents').notNull().default(0),
  consumptionsChargedUsdCents: integer('consumptions_charged_usd_cents').notNull().default(0),
  consumptionsForgivenUsdCents: integer('consumptions_forgiven_usd_cents').notNull().default(0),
  fixedDinnerCount: integer('fixed_dinner_count').notNull().default(0),
  fixedDinnerCostUsdCents: integer('fixed_dinner_cost_usd_cents').notNull().default(0),
  netUsdCents: integer('net_usd_cents').notNull(),
  netBsCents: integer('net_bs_cents').notNull(),
  rateMicroBs: integer('rate_micro_bs').notNull(),
  paymentMethod: text('payment_method').notNull(),
  notes: text('notes'),
  settledByUserId: text('settled_by_user_id').notNull().references(() => users.id),
  receiptPdfPath: text('receipt_pdf_path'),
  createdAtMs: integer('created_at_ms').notNull()
});

export const staffPayrollAdjustments = sqliteTable('staff_payroll_adjustments', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['BONO', 'ADELANTO'] }).notNull(),
  amountUsdCents: integer('amount_usd_cents').notNull(),
  amountBsCents: integer('amount_bs_cents').notNull().default(0),
  concept: text('concept').notNull(),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id),
  settlementId: text('settlement_id').references(() => staffPayrollSettlements.id),
  createdAtMs: integer('created_at_ms').notNull()
});

export const staffConsumptions = sqliteTable('staff_consumptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orderId: text('order_id').references(() => orders.id),
  concept: text('concept').notNull(),
  amountUsdCents: integer('amount_usd_cents').notNull(),
  isFixedDinner: integer('is_fixed_dinner').notNull().default(0),
  status: text('status', { enum: ['PENDIENTE', 'COBRADO', 'PERDONADO'] }).notNull().default('PENDIENTE'),
  settlementId: text('settlement_id').references(() => staffPayrollSettlements.id),
  createdAtMs: integer('created_at_ms').notNull()
});

export const tipPools = sqliteTable('tip_pools', {
  id: text('id').primaryKey(),
  locationId: text('location_id').notNull().references(() => locations.id),
  jornadaId: text('jornada_id').notNull().references(() => jornadas.id),
  splitMode: text('split_mode', { enum: ['EQUAL', 'HOURS'] }).notNull().default('EQUAL'),
  totalCollectedUsdCents: integer('total_collected_usd_cents').notNull().default(0),
  totalCollectedBsCents: integer('total_collected_bs_cents').notNull().default(0),
  status: text('status', { enum: ['OPEN', 'CLOSED'] }).notNull().default('OPEN'),
  closedByUserId: text('closed_by_user_id').references(() => users.id),
  closedAtMs: integer('closed_at_ms'),
  createdAtMs: integer('created_at_ms').notNull()
});

export const tipPoolDistributions = sqliteTable('tip_pool_distributions', {
  id: text('id').primaryKey(),
  tipPoolId: text('tip_pool_id').notNull().references(() => tipPools.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
  hoursWorked: real('hours_worked').notNull().default(1.0),
  sharePercentage: real('share_percentage').notNull(),
  amountUsdCents: integer('amount_usd_cents').notNull(),
  amountBsCents: integer('amount_bs_cents').notNull(),
  status: text('status', { enum: ['PENDIENTE', 'PAGADO'] }).notNull().default('PENDIENTE'),
  createdAtMs: integer('created_at_ms').notNull()
});

export type StaffPayrollProfile = typeof staffPayrollProfiles.$inferSelect;
export type InsertStaffPayrollProfile = typeof staffPayrollProfiles.$inferInsert;
export type StaffPayrollSettlement = typeof staffPayrollSettlements.$inferSelect;
export type InsertStaffPayrollSettlement = typeof staffPayrollSettlements.$inferInsert;
export type StaffPayrollAdjustment = typeof staffPayrollAdjustments.$inferSelect;
export type InsertStaffPayrollAdjustment = typeof staffPayrollAdjustments.$inferInsert;
export type StaffConsumption = typeof staffConsumptions.$inferSelect;
export type InsertStaffConsumption = typeof staffConsumptions.$inferInsert;
export type TipPool = typeof tipPools.$inferSelect;
export type InsertTipPool = typeof tipPools.$inferInsert;
export type TipPoolDistribution = typeof tipPoolDistributions.$inferSelect;
export type InsertTipPoolDistribution = typeof tipPoolDistributions.$inferInsert;

export const eventQuotations = sqliteTable('event_quotations', {
  id: text('id').primaryKey(),
  quotationNumber: text('quotation_number').notNull().unique(),
  customerName: text('customer_name').notNull(),
  customerPhone: text('customer_phone'),
  customerEmail: text('customer_email'),
  eventDateMs: integer('event_date_ms'),
  eventLocation: text('event_location'),
  guestCount: integer('guest_count').notNull().default(1),
  subtotalFoodUsdCents: integer('subtotal_food_usd_cents').notNull().default(0),
  discountPercent: real('discount_percent').default(0),
  discountUsdCents: integer('discount_usd_cents').default(0),
  extraCostsUsdCents: integer('extra_costs_usd_cents').notNull().default(0),
  totalPriceUsdCents: integer('total_price_usd_cents').notNull().default(0),
  estimatedCostUsdCents: integer('estimated_cost_usd_cents').notNull().default(0),
  estimatedProfitUsdCents: integer('estimated_profit_usd_cents').notNull().default(0),
  rateMicroBs: integer('rate_micro_bs').notNull(),
  status: text('status', { enum: ['BORRADOR', 'ENVIADA', 'RESERVADA', 'RECHAZADA'] }).notNull().default('BORRADOR'),
  notes: text('notes'),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const eventQuotationItems = sqliteTable('event_quotation_items', {
  id: text('id').primaryKey(),
  quotationId: text('quotation_id').notNull().references(() => eventQuotations.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => products.id),
  productName: text('product_name').notNull(),
  quantity: integer('quantity').notNull(),
  unitPriceUsdCents: integer('unit_price_usd_cents').notNull(),
  subtotalUsdCents: integer('subtotal_usd_cents').notNull(),
  unitCostUsdCents: integer('unit_cost_usd_cents').notNull().default(0),
  totalCostUsdCents: integer('total_cost_usd_cents').notNull().default(0),
  notes: text('notes')
});

export const eventQuotationExtras = sqliteTable('event_quotation_extras', {
  id: text('id').primaryKey(),
  quotationId: text('quotation_id').notNull().references(() => eventQuotations.id, { onDelete: 'cascade' }),
  concept: text('concept').notNull(),
  category: text('category', { enum: ['LOGISTICA', 'PERSONAL', 'DESCARTABLES', 'OTROS'] }).notNull().default('LOGISTICA'),
  priceUsdCents: integer('price_usd_cents').notNull(),
  costUsdCents: integer('cost_usd_cents').notNull().default(0)
});

export const businessPartners = sqliteTable('business_partners', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  docId: text('doc_id'),
  phone: text('phone'),
  email: text('email'),
  sharePercentage: real('share_percentage').notNull().default(0),
  totalCapitalContributedUsdCents: integer('total_capital_contributed_usd_cents').notNull().default(0),
  totalWithdrawnUsdCents: integer('total_withdrawn_usd_cents').notNull().default(0),
  currentBalanceUsdCents: integer('current_balance_usd_cents').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  notes: text('notes'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const partnerTransactions = sqliteTable('partner_transactions', {
  id: text('id').primaryKey(),
  partnerId: text('partner_id').notNull().references(() => businessPartners.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['APORTE', 'RETIRO_UTILIDADES', 'REPARTO_DIVIDENDOS'] }).notNull(),
  amountUsdCents: integer('amount_usd_cents').notNull(),
  amountBsCents: integer('amount_bs_cents').notNull().default(0),
  rateMicroBs: integer('rate_micro_bs').notNull(),
  paymentMethod: text('payment_method').notNull().default('EFECTIVO_USD'),
  notes: text('notes'),
  registeredByUserId: text('registered_by_user_id').notNull().references(() => users.id),
  createdAtMs: integer('created_at_ms').notNull()
});

export type EventQuotation = typeof eventQuotations.$inferSelect;
export type InsertEventQuotation = typeof eventQuotations.$inferInsert;
export type EventQuotationItem = typeof eventQuotationItems.$inferSelect;
export type InsertEventQuotationItem = typeof eventQuotationItems.$inferInsert;
export type EventQuotationExtra = typeof eventQuotationExtras.$inferSelect;
export type InsertEventQuotationExtra = typeof eventQuotationExtras.$inferInsert;
export type BusinessPartner = typeof businessPartners.$inferSelect;
export type InsertBusinessPartner = typeof businessPartners.$inferInsert;
export type PartnerTransaction = typeof partnerTransactions.$inferSelect;
export type InsertPartnerTransaction = typeof partnerTransactions.$inferInsert;

export const serverErrors = sqliteTable('server_errors', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull(),
  method: text('method').notNull(),
  url: text('url').notNull(),
  status: integer('status').notNull(),
  code: text('code').notNull(),
  message: text('message').notNull(),
  stack: text('stack'),
  bodyJson: text('body_json'),
  userId: text('user_id'),
  createdAtMs: integer('created_at_ms').notNull()
});

export type ServerError = typeof serverErrors.$inferSelect;
export type InsertServerError = typeof serverErrors.$inferInsert;
