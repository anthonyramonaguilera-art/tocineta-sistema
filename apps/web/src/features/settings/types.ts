export interface BusinessSettings {
  id: string;
  business_name: string;
  rif: string;
  phone: string;
  address: string;
  slogan: string;
  logo_url: string | null;
  primary_color: string;
  rate_change_hour: string;
  ticket_header_message: string;
  ticket_footer_message: string;
  delivery_accounting_mode: string;
  delivery_quick_tiers_json: string;
  table_service_mode: string;
  ask_table_on_order?: number;
  inventory_operation_mode?: string;
  inventory_tracking_since_ms?: number | null;
  banesco_pago_movil_phone: string;
  banesco_pago_movil_id: string;
  pos_fee_bps: number;
  profitability_pro_enabled: number;
  fiscal_module_enabled: number;
  fiscal_price_mode: string;
  iva_enabled: number;
  iva_rate_bps: number;
  igtf_enabled: number;
  igtf_rate_bps: number;
  igtf_applies_to: string;
  blind_closure_enabled: number;
  partners_module_enabled: number;
  events_quote_enabled: number;
  onboarding_completed: number;
  updated_at_ms: number;
}

export interface BusinessLocation {
  id: string;
  name: string;
  type?: string;
  address?: string | null;
  phone?: string | null;
  is_active: number;
}
