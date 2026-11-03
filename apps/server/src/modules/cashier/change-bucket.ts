/**
 * Regla unificada para determinar si un método de entrega de vuelto en Bs
 * corresponde a salida bancaria (Pago Móvil / BANK_BS) o efectivo físico (CASH_BS).
 */
export function isBankBsChangeMethod(method: string | null | undefined): boolean {
  return (method || '').toLowerCase().includes('pago_movil');
}
