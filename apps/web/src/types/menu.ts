export type Station = 'hot_dogs' | 'hamburguesas' | 'caja_bebidas';

export interface PosProductFlavor {
  id: string;
  flavorName: string;
  isAvailable: boolean;
}

export interface PosBaseIngredient {
  id: string;
  name: string;
  isRemovable: boolean;
  defaultState: 'normal' | 'none';
}

export interface PosProduct {
  id: string;
  name: string;
  description: string | null;
  priceUsdCents: number;
  priceBsCents: number;
  station: Station;
  isAvailable: boolean;
  isCombo: boolean;
  allowsFlavors: boolean;
  imageUrl: string | null;
  flavors: PosProductFlavor[];
  baseIngredients: PosBaseIngredient[];
}

export interface PosCategory {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
  station: Station;
  products: PosProduct[];
}

export interface PosBarraLibreIngredient {
  id: string;
  name: string;
  priceUsdCents: number;
  priceBsCents: number;
}

export interface PosComboSlotOption {
  productId: string;
  productName: string;
  isAvailable: boolean;
  defaultSelected: boolean;
}

export interface PosComboSlot {
  id: string;
  slotNumber: number;
  slotName: string;
  requiredStation: Station;
  options: PosComboSlotOption[];
}

export interface PosCombo {
  id: string;
  name: string;
  comboPriceUsdCents: number;
  comboPriceBsCents: number;
  description: string | null;
  slots: PosComboSlot[];
}

export interface PosDeliveryTier {
  usdCents: number;
  bsCents: number;
  label: string;
}

export interface PosMenuResponse {
  success: boolean;
  rateMicroBs: number;
  formattedRate: string;
  latestSeq: number;
  categories: PosCategory[];
  barraLibreIngredients: PosBarraLibreIngredient[];
  globalModifiers: string[];
  deliveryQuickTiers: PosDeliveryTier[];
  combos: PosCombo[];
}

export interface AdminCategory {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: number;
  is_internal: number;
  station: Station;
}

export interface AdminProduct {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price_usd_cents: number;
  estimated_cost_usd_cents: number;
  station: Station;
  is_active: number;
  is_available: number;
  is_combo: number;
  allows_flavors: number;
  image_url: string | null;
  updated_at_ms: number;
  priceBsCents: number;
  isActive: boolean;
  isAvailable: boolean;
  isCombo: boolean;
  allowsFlavors: boolean;
}

export interface AdminFlavor {
  id: string;
  product_id: string;
  flavor_name: string;
  is_active: number;
  is_available: number;
  display_order: number;
}

export interface AdminCoupon {
  id: string;
  code: string;
  description: string | null;
  coupon_type: string;
  discount_mode: string | null;
  discount_value: number | null;
  courtesy_product_id: string | null;
  max_uses: number | null;
  used_count: number;
  expires_at_ms: number | null;
  is_active: number;
}

export interface AdminBusinessSettings {
  id: string;
  business_name: string;
  rif: string;
  phone: string;
  address: string;
  delivery_accounting_mode: 'THIRD_PARTY_PASS_THROUGH' | 'HOUSE_REVENUE';
  delivery_quick_tiers_json: string;
}

export interface AdminMenuResponse {
  success: boolean;
  rateMicroBs: number;
  formattedRate: string;
  latestSeq: number;
  categories: AdminCategory[];
  products: AdminProduct[];
  flavors: AdminFlavor[];
  coupons: AdminCoupon[];
  businessSettings: AdminBusinessSettings;
}
