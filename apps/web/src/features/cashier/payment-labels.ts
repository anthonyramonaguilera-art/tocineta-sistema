export type CashierPaymentMethod =
  | 'cash_usd'
  | 'cash_bs'
  | 'pago_movil'
  | 'punto_de_venta'
  | 'ubii'
  | 'transferencia'
  | 'binance'
  | 'zelle'
  | 'otros';

export const paymentLabels: Record<string, string> = {
  cash_usd: 'Efectivo $',
  cash_bs: 'Efectivo Bs',
  pago_movil: 'Pago Móvil',
  punto_de_venta: 'Punto de Venta',
  ubii: 'Punto UBI',
  transferencia: 'Transferencia',
  binance: 'Binance Pay',
  zelle: 'Zelle',
  otros: 'Otros',
  credit: 'Crédito'
};

export function getPaymentMethodHumanLabel(method: string): string {
  const normalized = (method || '').toLowerCase().trim();
  if (normalized === 'efectivo_usd') return paymentLabels.cash_usd;
  if (normalized === 'efectivo_bs') return paymentLabels.cash_bs;
  if (normalized === 'pagomovil') return paymentLabels.pago_movil;
  if (normalized === 'punto') return paymentLabels.punto_de_venta;
  if (normalized === 'otro') return paymentLabels.otros;
  return paymentLabels[normalized] || method;
}
