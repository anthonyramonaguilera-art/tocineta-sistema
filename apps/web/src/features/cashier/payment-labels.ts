export const paymentLabels: Record<string, string> = {
  cash_usd: 'Efectivo dólares',
  cash_bs: 'Efectivo bolívares',
  pago_movil: 'Pago móvil',
  ubii: 'Punto de venta',
  binance: 'Binance Pay',
  credit: 'Crédito'
};

export function getPaymentMethodHumanLabel(method: string): string {
  const normalized = (method || '').toLowerCase().trim();
  return paymentLabels[normalized] || method;
}
