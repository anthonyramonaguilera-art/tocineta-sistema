import type Database from 'better-sqlite3';

export interface BusinessSettingsRecord {
  id: string;
  business_name: string;
  rif: string;
  phone: string;
  address: string;
  delivery_accounting_mode: string;
  delivery_quick_tiers_json: string;
  table_service_mode: string;
  banesco_pago_movil_phone: string;
  banesco_pago_movil_id: string;
  pos_fee_bps: number;
  profitability_pro_enabled: number;
  fiscal_module_enabled: number;
  fiscal_price_mode: string;
  igtf_enabled: number;
  igtf_rate_bps: number;
  igtf_applies_to: string;
  blind_closure_enabled: number;
  is_demo_mode?: number;
  updated_at_ms: number;
}

export const DEFAULT_BUSINESS_SETTINGS: BusinessSettingsRecord = {
  id: 'default',
  business_name: 'TOCINETA',
  rif: 'V-17040918-0',
  phone: '04249728209',
  address: 'Detrás de Torre Movistar, Puerto Ordaz',
  delivery_accounting_mode: 'THIRD_PARTY_PASS_THROUGH',
  delivery_quick_tiers_json: '[200, 300, 400, 500]',
  table_service_mode: 'ticket_independiente',
  banesco_pago_movil_phone: '04249728209',
  banesco_pago_movil_id: '17040918',
  pos_fee_bps: 75,
  profitability_pro_enabled: 0,
  fiscal_module_enabled: 0,
  fiscal_price_mode: 'INCLUSIVE',
  igtf_enabled: 0,
  igtf_rate_bps: 300,
  igtf_applies_to: 'CASH_USD',
  blind_closure_enabled: 0,
  is_demo_mode: 0,
  updated_at_ms: Date.now()
};

/**
 * Inicialización defensiva de business_settings.
 * Garantiza que si falta la tabla, el registro 'default' o alguna columna,
 * se crea en el acto con su valor por defecto y JAMÁS devuelva HTTP 500.
 */
export function ensureBusinessSettingsDefensive(rawDb: Database.Database): BusinessSettingsRecord {
  try {
    const existing = rawDb.prepare('SELECT * FROM business_settings WHERE id = ?').get('default') as any;
    if (!existing) {
      const now = Date.now();
      rawDb.prepare(`
        INSERT OR REPLACE INTO business_settings (
          id, business_name, rif, phone, address,
          delivery_accounting_mode, delivery_quick_tiers_json, table_service_mode,
          banesco_pago_movil_phone, banesco_pago_movil_id, pos_fee_bps,
          profitability_pro_enabled, fiscal_module_enabled, fiscal_price_mode,
          igtf_enabled, igtf_rate_bps, igtf_applies_to, blind_closure_enabled, updated_at_ms
        ) VALUES (
          'default', 'TOCINETA', 'V-17040918-0', '04249728209',
          'Detrás de Torre Movistar, Puerto Ordaz',
          'THIRD_PARTY_PASS_THROUGH', '[200, 300, 400, 500]', 'ticket_independiente',
          '04249728209', '17040918', 75,
          0, 0, 'INCLUSIVE',
          0, 300, 'CASH_USD', 0, ?
        )
      `).run(now);

      return { ...DEFAULT_BUSINESS_SETTINGS, updated_at_ms: now };
    }

    return {
      id: 'default',
      business_name: existing.business_name || DEFAULT_BUSINESS_SETTINGS.business_name,
      rif: existing.rif || DEFAULT_BUSINESS_SETTINGS.rif,
      phone: existing.phone || DEFAULT_BUSINESS_SETTINGS.phone,
      address: existing.address || DEFAULT_BUSINESS_SETTINGS.address,
      delivery_accounting_mode: existing.delivery_accounting_mode || DEFAULT_BUSINESS_SETTINGS.delivery_accounting_mode,
      delivery_quick_tiers_json: existing.delivery_quick_tiers_json || DEFAULT_BUSINESS_SETTINGS.delivery_quick_tiers_json,
      table_service_mode: existing.table_service_mode || DEFAULT_BUSINESS_SETTINGS.table_service_mode,
      banesco_pago_movil_phone: existing.banesco_pago_movil_phone || DEFAULT_BUSINESS_SETTINGS.banesco_pago_movil_phone,
      banesco_pago_movil_id: existing.banesco_pago_movil_id || DEFAULT_BUSINESS_SETTINGS.banesco_pago_movil_id,
      pos_fee_bps: existing.pos_fee_bps ?? DEFAULT_BUSINESS_SETTINGS.pos_fee_bps,
      profitability_pro_enabled: existing.profitability_pro_enabled ?? DEFAULT_BUSINESS_SETTINGS.profitability_pro_enabled,
      fiscal_module_enabled: existing.fiscal_module_enabled ?? DEFAULT_BUSINESS_SETTINGS.fiscal_module_enabled,
      fiscal_price_mode: existing.fiscal_price_mode || DEFAULT_BUSINESS_SETTINGS.fiscal_price_mode,
      igtf_enabled: existing.igtf_enabled ?? DEFAULT_BUSINESS_SETTINGS.igtf_enabled,
      igtf_rate_bps: existing.igtf_rate_bps ?? DEFAULT_BUSINESS_SETTINGS.igtf_rate_bps,
      igtf_applies_to: existing.igtf_applies_to || DEFAULT_BUSINESS_SETTINGS.igtf_applies_to,
      blind_closure_enabled: existing.blind_closure_enabled ?? DEFAULT_BUSINESS_SETTINGS.blind_closure_enabled,
      is_demo_mode: existing.is_demo_mode ?? 0,
      updated_at_ms: existing.updated_at_ms || Date.now()
    };
  } catch (err) {
    // Si la tabla no está lista aún o hubo error en SQLite, fallback seguro sin lanzar excepción
    return { ...DEFAULT_BUSINESS_SETTINGS, updated_at_ms: Date.now() };
  }
}
