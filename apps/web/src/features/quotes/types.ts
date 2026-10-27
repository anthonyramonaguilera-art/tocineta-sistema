export interface QuoteItem {
  id: string;
  quotation_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_usd_cents: number;
  subtotal_usd_cents: number;
  unit_cost_usd_cents: number;
  total_cost_usd_cents: number;
  notes?: string | null;
}

export interface QuoteExtra {
  id: string;
  quotation_id: string;
  concept: string;
  category: 'LOGISTICA' | 'PERSONAL' | 'DESCARTABLES' | 'OTROS';
  price_usd_cents: number;
  cost_usd_cents: number;
}

export interface ShoppingListItem {
  ingredientId: string;
  ingredientName: string;
  requiredCount: number;
  unitCostUsdCents: number;
  totalCostUsdCents: number;
}

export interface EventQuotation {
  id: string;
  quotation_number: string;
  customer_name: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  event_date_ms?: number | null;
  event_location?: string | null;
  guest_count: number;
  subtotal_food_usd_cents: number;
  discount_percent: number;
  discount_usd_cents: number;
  extra_costs_usd_cents: number;
  total_price_usd_cents: number;
  totalPriceBsCents?: number;
  estimated_cost_usd_cents: number;
  estimated_profit_usd_cents: number;
  rate_micro_bs: number;
  rateFormatted?: string;
  status: 'BORRADOR' | 'ENVIADA' | 'RESERVADA' | 'RECHAZADA';
  notes?: string | null;
  created_by_user_id: string;
  created_by_name?: string;
  created_at_ms: number;
  updated_at_ms: number;
  items_count?: number;
  extras_count?: number;
  items?: QuoteItem[];
  extras?: QuoteExtra[];
  shoppingList?: ShoppingListItem[];
  shoppingListTotalCostUsdCents?: number;
}

export interface CreateQuotePayload {
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  eventDateMs?: number;
  eventLocation?: string;
  guestCount?: number;
  discountPercent?: number;
  discountUsdCents?: number;
  items: Array<{
    productId: string;
    productName?: string;
    quantity: number;
    unitPriceUsdCents?: number;
    notes?: string;
  }>;
  extras?: Array<{
    concept: string;
    category: 'LOGISTICA' | 'PERSONAL' | 'DESCARTABLES' | 'OTROS';
    priceUsdCents: number;
    costUsdCents?: number;
  }>;
  notes?: string;
}
