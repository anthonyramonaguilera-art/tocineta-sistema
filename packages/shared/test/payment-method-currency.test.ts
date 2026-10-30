import { describe, it, expect } from 'vitest';
import { getPaymentMethodNativeCurrency } from '../src/utils/payment-method-currency.js';

describe('Payment Method Native Currency', () => {
  it('retorna USD para métodos en dólares', () => {
    expect(getPaymentMethodNativeCurrency('EFECTIVO_USD')).toBe('USD');
    expect(getPaymentMethodNativeCurrency('ZELLE')).toBe('USD');
    expect(getPaymentMethodNativeCurrency('BINANCE')).toBe('USD');
  });

  it('retorna BS para métodos en bolívares', () => {
    expect(getPaymentMethodNativeCurrency('EFECTIVO_BS')).toBe('BS');
    expect(getPaymentMethodNativeCurrency('PAGO_MOVIL')).toBe('BS');
    expect(getPaymentMethodNativeCurrency('PUNTO_DE_VENTA')).toBe('BS');
    expect(getPaymentMethodNativeCurrency('UBII')).toBe('BS');
  });

  it('retorna BOTH para otros métodos mixtos', () => {
    expect(getPaymentMethodNativeCurrency('OTROS')).toBe('BOTH');
    expect(getPaymentMethodNativeCurrency('OTRO')).toBe('BOTH');
  });

  it('maneja valores nulos o desconocidos por defecto', () => {
    expect(getPaymentMethodNativeCurrency(null)).toBe('USD');
    expect(getPaymentMethodNativeCurrency(undefined)).toBe('USD');
    expect(getPaymentMethodNativeCurrency('UNKNOWN')).toBe('USD');
  });
});
