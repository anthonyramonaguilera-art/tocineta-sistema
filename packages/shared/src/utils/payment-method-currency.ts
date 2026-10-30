/**
 * Determina la moneda nativa de un método de pago en TOCINETA
 */
export type PaymentMethodNativeCurrency = 'USD' | 'BS' | 'BOTH';

export function getPaymentMethodNativeCurrency(method?: string | null): PaymentMethodNativeCurrency {
  if (!method) return 'USD';
  const m = method.toUpperCase().trim();

  if (m === 'EFECTIVO_USD' || m === 'ZELLE' || m === 'BINANCE' || m === 'USD') {
    return 'USD';
  }
  if (
    m === 'EFECTIVO_BS' ||
    m === 'PAGO_MOVIL' ||
    m === 'PAGOMOVIL' ||
    m === 'PUNTO_DE_VENTA' ||
    m === 'PUNTO' ||
    m === 'UBII' ||
    m === 'TARJETA' ||
    m === 'BS'
  ) {
    return 'BS';
  }
  if (m === 'OTROS' || m === 'OTRO' || m === 'MIXTO') {
    return 'BOTH';
  }

  return 'USD';
}
