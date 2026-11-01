/**
 * Determina la moneda ('USD' | 'BS') de un método de pago en TOCINETA
 * Tabla A-1:
 * USD: cash_usd, binance, zelle, otros
 * BS: cash_bs, pago_movil, punto_de_venta, ubii, transferencia
 */
export function getMethodCurrency(method?: string | null): 'USD' | 'BS' {
  const m = (method || '').toLowerCase().trim();
  switch (m) {
    case 'cash_usd':
    case 'efectivo_usd':
    case 'binance':
    case 'zelle':
    case 'otros':
    case 'otro':
    case 'usd':
      return 'USD';
    case 'cash_bs':
    case 'efectivo_bs':
    case 'pago_movil':
    case 'pagomovil':
    case 'punto_de_venta':
    case 'punto':
    case 'ubii':
    case 'transferencia':
    case 'bs':
      return 'BS';
    default:
      return 'USD';
  }
}
