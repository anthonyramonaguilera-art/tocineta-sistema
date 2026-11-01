import { describe, it, expect } from 'vitest';
import { getPaymentMethodNativeCurrency } from '../src/utils/payment-method-currency.js';
import { getMethodCurrency } from '../src/money/payment-method-currency.js';

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

describe('getMethodCurrency (A-1 & A-2 parity)', () => {
  it('retorna USD para los métodos correspondientes (cash_usd, binance, zelle, otros)', () => {
    expect(getMethodCurrency('cash_usd')).toBe('USD');
    expect(getMethodCurrency('binance')).toBe('USD');
    expect(getMethodCurrency('zelle')).toBe('USD');
    expect(getMethodCurrency('otros')).toBe('USD');
  });

  it('retorna BS para los métodos correspondientes (cash_bs, pago_movil, punto_de_venta, ubii, transferencia)', () => {
    expect(getMethodCurrency('cash_bs')).toBe('BS');
    expect(getMethodCurrency('pago_movil')).toBe('BS');
    expect(getMethodCurrency('punto_de_venta')).toBe('BS');
    expect(getMethodCurrency('ubii')).toBe('BS');
    expect(getMethodCurrency('transferencia')).toBe('BS');
  });

  it('maneja mayúsculas, alias y valores nulos', () => {
    expect(getMethodCurrency('EFECTIVO_USD')).toBe('USD');
    expect(getMethodCurrency('EFECTIVO_BS')).toBe('BS');
    expect(getMethodCurrency(null)).toBe('USD');
    expect(getMethodCurrency(undefined)).toBe('USD');
  });
});
