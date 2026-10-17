import { z } from 'zod';

export const RateMicroBsSchema = z.number().int().positive();
export const UsdCentsSchema = z.number().int();
export const BsCentsSchema = z.number().int();

export const SettlementStatusSchema = z.enum([
  'PAID',
  'OVERPAID',
  'UNDERPAID'
]);

export type SettlementStatus = z.infer<typeof SettlementStatusSchema>;

export const SettlementResultSchema = z.object({
  status: SettlementStatusSchema,
  totalUsdCents: UsdCentsSchema,
  paidUsdCents: UsdCentsSchema,
  paidBsCents: BsCentsSchema,
  rateMicroBs: RateMicroBsSchema,
  remUsdBeforeBs: UsdCentsSchema,
  expectedBsCents: BsCentsSchema,
  differenceBsCents: BsCentsSchema,
  maxToleranceBsCents: BsCentsSchema,
  roundingAdjustmentBsCents: BsCentsSchema,
  roundingAdjustmentUsdCents: UsdCentsSchema,
  isFullySettled: z.boolean()
});

export type SettlementResult = z.infer<typeof SettlementResultSchema>;

export const MixedChangeResultSchema = z.object({
  changeTotalUsdCents: UsdCentsSchema,
  changeGivenUsdCents: UsdCentsSchema,
  remChangeUsdCents: UsdCentsSchema,
  changeGivenBsCents: BsCentsSchema,
  rateMicroBs: RateMicroBsSchema
});

export type MixedChangeResult = z.infer<typeof MixedChangeResultSchema>;

export const ComboItemInputSchema = z.object({
  id: z.string(),
  normalPriceUsdCents: z.number().int().positive(),
  order: z.number().int().nonnegative()
});

export type ComboItemInput = z.infer<typeof ComboItemInputSchema>;

export const ComboProrateItemResultSchema = z.object({
  id: z.string(),
  normalPriceUsdCents: z.number().int().positive(),
  proratedUsdCents: z.number().int().positive(),
  order: z.number().int().nonnegative()
});

export type ComboProrateItemResult = z.infer<typeof ComboProrateItemResultSchema>;

export const ComboProrateResultSchema = z.object({
  comboPriceUsdCents: z.number().int().positive(),
  sumNormalPricesUsdCents: z.number().int().positive(),
  items: z.array(ComboProrateItemResultSchema)
});

export type ComboProrateResult = z.infer<typeof ComboProrateResultSchema>;

export const CouponTypeSchema = z.enum(['DISCOUNT', 'COURTESY_ITEM']);
export type CouponType = z.infer<typeof CouponTypeSchema>;

export const CouponSchema = z.object({
  code: z.string(),
  type: CouponTypeSchema,
  fixedUsdCents: z.number().int().nonnegative().optional(),
  percentageBps: z.number().int().min(0).max(10000).optional(), // 10% = 1000 bps
  courtesyItem: z.object({
    id: z.string(),
    name: z.string(),
    internalCostUsdCents: z.number().int().nonnegative()
  }).optional()
});

export type Coupon = z.infer<typeof CouponSchema>;

export const DeliveryAccountingModeSchema = z.enum([
  'THIRD_PARTY_PASS_THROUGH',
  'HOUSE_REVENUE'
]);

export type DeliveryAccountingMode = z.infer<typeof DeliveryAccountingModeSchema>;

export const OrderFinancialsResultSchema = z.object({
  grossFoodSubtotalUsdCents: UsdCentsSchema,
  discountUsdCents: UsdCentsSchema,
  netFoodSalesUsdCents: UsdCentsSchema,
  deliveryFeeUsdCents: UsdCentsSchema,
  totalToCollectUsdCents: UsdCentsSchema,
  deliveryAccountingMode: DeliveryAccountingModeSchema,
  motorizadoLiabilityUsdCents: UsdCentsSchema,
  marketingCourtesyCostUsdCents: UsdCentsSchema
});

export type OrderFinancialsResult = z.infer<typeof OrderFinancialsResultSchema>;
