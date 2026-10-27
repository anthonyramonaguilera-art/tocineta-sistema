export interface PartnerTransaction {
  id: string;
  partner_id: string;
  type: 'APORTE' | 'RETIRO_UTILIDADES' | 'REPARTO_DIVIDENDOS';
  amount_usd_cents: number;
  amount_bs_cents: number;
  rate_micro_bs: number;
  rateFormatted?: string;
  payment_method: string;
  notes?: string | null;
  registered_by_name?: string;
  created_at_ms: number;
}

export interface BusinessPartner {
  id: string;
  name: string;
  doc_id?: string | null;
  phone?: string | null;
  email?: string | null;
  share_percentage: number;
  sharePercentageFormatted?: string;
  total_capital_contributed_usd_cents: number;
  total_withdrawn_usd_cents: number;
  current_balance_usd_cents: number;
  is_active: number;
  notes?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  transactions?: PartnerTransaction[];
}

export interface PartnersSummary {
  totalPartners: number;
  totalShares: number;
  totalCapitalUsdCents: number;
  totalWithdrawnUsdCents: number;
  totalBalanceUsdCents: number;
}
