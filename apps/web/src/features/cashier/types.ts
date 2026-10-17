export type CashierPaymentMethod = 'cash_usd' | 'cash_bs' | 'pago_movil' | 'ubii' | 'binance';

export interface CashierTender {
  id: string;
  method: CashierPaymentMethod;
  amountCents: number; // En centavos de la moneda del método (USD o Bs)
  currency: 'USD' | 'BS';
  usdEquivalentCents: number;
  referenceCode?: string;
}

export interface CashierOrderLine {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_usd_cents: number;
  subtotal_usd_cents: number;
  station: string;
  flavor_choice?: string;
  custom_instructions?: string;
  line_role: string;
  modifiers?: Array<{
    id: string;
    ingredient_name: string;
    modifier_type: string;
    extra_price_usd_cents: number;
  }>;
}

export interface CashierOrder {
  id: string;
  order_number: number;
  table_number: string;
  fulfillment_type: string;
  payment_status: string;
  fulfillment_status: string;
  gross_food_subtotal_usd_cents: number;
  delivery_fee_usd_cents: number;
  discount_usd_cents: number;
  total_to_collect_usd_cents: number;
  rate_micro_bs: number;
  created_at_ms: number;
  created_by_name?: string;
  notes?: string;
  lines: CashierOrderLine[];
}
