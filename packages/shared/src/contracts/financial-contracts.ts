import { z } from 'zod';

export const PaymentMethodEnum = z.enum([
  'EFECTIVO_USD',
  'EFECTIVO_BS',
  'PAGO_MOVIL',
  'PUNTO_DE_VENTA',
  'TARJETA',
  'BINANCE',
  'OTRO'
]);
export type PaymentMethod = z.infer<typeof PaymentMethodEnum>;

export const ByMethodItemSchema = z.object({
  method: z.string(),
  count: z.number().int(),
  totalUsdCents: z.number().int(),
  totalBsCents: z.number().int().optional(),
  changeUsdCents: z.number().int().optional(),
  changeBsCents: z.number().int().optional(),
  netUsdCents: z.number().int().optional(),
  netBsCents: z.number().int().optional()
});
export type ByMethodItem = z.infer<typeof ByMethodItemSchema>;

export const BySedeItemSchema = z.object({
  locationId: z.string(),
  locationName: z.string(),
  totalOrders: z.number().int(),
  netSalesUsdCents: z.number().int(),
  expectedCashUsdCents: z.number().int(),
  expectedCashBsCents: z.number().int()
});
export type BySedeItem = z.infer<typeof BySedeItemSchema>;

export const ZSummaryResponseSchema = z.object({
  success: z.boolean(),
  summary: z.object({
    jornada: z.any().optional(),
    rateMicroBs: z.number().int().positive(),
    netFoodSalesUsdCents: z.number().int(),
    discountUsdCents: z.number().int(),
    deliveryFeesUsdCents: z.number().int(),
    totalCollectedUsdCents: z.number().int(),
    cashUsdCents: z.number().int(),
    cashBsCents: z.number().int(),
    pagoMovilBsCents: z.number().int(),
    ubiiGrossBsCents: z.number().int(),
    ubiiFeeBsCents: z.number().int(),
    ubiiNetBsCents: z.number().int(),
    binanceUsdCents: z.number().int(),
    zelleUsdCents: z.number().int(),
    expensesUsdCents: z.number().int(),
    mermasUsdCents: z.number().int(),
    ordersCount: z.number().int(),
    auditHeadHash: z.string().optional(),
    ledgerEntries: z.array(z.any()).optional(),
    incidents: z.array(z.any()).optional(),
    // Claves R2 requeridas por CashierClosureWizard y verdad única
    expectedCashUsdCents: z.number().int(),
    expectedCashBsCents: z.number().int(),
    totalOrders: z.number().int(),
    byMethod: z.array(ByMethodItemSchema),
    bySede: z.array(BySedeItemSchema)
  })
});
export type ZSummaryResponse = z.infer<typeof ZSummaryResponseSchema>;

export const CashSaleItemSchema = z.object({
  orderId: z.string(),
  orderNumber: z.string(),
  customerName: z.string(),
  tableLabel: z.string().nullable().optional(),
  totalUsdCents: z.number().int(),
  totalBsCents: z.number().int(),
  primaryMethod: z.string(),
  paidAtMs: z.number().int(),
  locationId: z.string(),
  status: z.string().optional()
});
export type CashSaleItem = z.infer<typeof CashSaleItemSchema>;

export const CashSalesResponseSchema = z.object({
  success: z.boolean(),
  sales: z.array(CashSaleItemSchema),
  nextCursor: z.string().nullable().optional()
});
export type CashSalesResponse = z.infer<typeof CashSalesResponseSchema>;

export const OwnerMetricItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number().int(),
  formattedValue: z.string(),
  format: z.enum(['currency_usd', 'integer'])
});
export type OwnerMetricItem = z.infer<typeof OwnerMetricItemSchema>;

export const OwnerNumbersResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    timestampMs: z.number().int(),
    configuredKeys: z.array(z.string()),
    metrics: z.array(OwnerMetricItemSchema)
  })
});
export type OwnerNumbersResponse = z.infer<typeof OwnerNumbersResponseSchema>;

export const ExpenseCreateRequestSchema = z.object({
  category: z.string().min(1),
  amountUsdCents: z.number().int().positive(),
  amountBsCents: z.number().int().nonnegative().optional(),
  paymentMethod: PaymentMethodEnum,
  description: z.string().min(1),
  clientRequestId: z.string().min(1),
  confirmDuplicate: z.boolean().optional(),
  locationId: z.string().optional(),
  receiptPhotoPath: z.string().nullable().optional(),
  isRecurring: z.boolean().optional(),
  recurringInterval: z.string().nullable().optional(),
  notes: z.string().nullable().optional()
});
export type ExpenseCreateRequest = z.infer<typeof ExpenseCreateRequestSchema>;

export const ExpenseCreateResponseSchema = z.object({
  success: z.boolean(),
  expense: z.object({
    id: z.string(),
    locationId: z.string(),
    jornadaId: z.string(),
    category: z.string(),
    amountUsdCents: z.number().int(),
    amountBsCents: z.number().int(),
    paymentMethod: z.string(),
    description: z.string(),
    authorizedByUserId: z.string(),
    receiptPhotoPath: z.string().nullable(),
    isRecurring: z.number().int(),
    recurringInterval: z.string().nullable(),
    notes: z.string().nullable(),
    createdAtMs: z.number().int()
  }).optional(),
  error: z.string().optional(),
  code: z.string().optional()
});
export type ExpenseCreateResponse = z.infer<typeof ExpenseCreateResponseSchema>;
