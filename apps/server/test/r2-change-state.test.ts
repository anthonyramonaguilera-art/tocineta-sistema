import { describe, it, expect } from 'vitest';
import { resolveChangeState } from '../../web/src/features/cashier/change-state.js';

describe('R2 T-07 W1: resolveChangeState (Vuelto derivado sin desincronización)', () => {
  const rateMicroBs = 40_000_000; // 40 Bs/USD

  it('Caso A (Bug de "Atrás"): al retroceder (override = null) y agregar más pago, el vuelto se recalcula completamente sin residuos', () => {
    // 1. Total $50 (5000 cents), tender inicial [USD 6000] -> change = 1000
    const step1 = resolveChangeState({
      totalUsdCents: 5000,
      tenders: [{ amountCents: 6000, currency: 'USD' }],
      rateMicroBs,
      override: null
    });

    expect(step1.changeUsdCents).toBe(1000);
    expect(step1.change).toBe(1000);
    expect(step1.givenUsdCents).toBe(1000);
    expect(step1.givenBsCents).toBe(0);
    expect(step1.unreturnedSurplusUsdCents).toBe(0);

    // 2. El usuario retrocede (override = null) y agrega [USD 500] -> total paid 6500, change = 1500
    const step2 = resolveChangeState({
      totalUsdCents: 5000,
      tenders: [
        { amountCents: 6000, currency: 'USD' },
        { amountCents: 500, currency: 'USD' }
      ],
      rateMicroBs,
      override: null
    });

    expect(step2.changeUsdCents).toBe(1500);
    expect(step2.change).toBe(1500);
    expect(step2.givenUsdCents).toBe(1500);
    expect(step2.givenBsCents).toBe(0);
    expect(step2.unreturnedSurplusUsdCents).toBe(0);
  });

  it('Caso B (Override acotado): si el override supera el vuelto, se recorta automáticamente y unreturnedSurplusUsdCents === 0', () => {
    // Total $50 (5000 cents), pago $60 (6000 cents) -> vuelto $10 (1000 cents)
    // El usuario o estado intenta dar $20 en USD y 5000 Bs
    const result = resolveChangeState({
      totalUsdCents: 5000,
      tenders: [{ amountCents: 6000, currency: 'USD' }],
      rateMicroBs,
      override: {
        usdCents: 2000,
        bsCents: 5000
      }
    });

    expect(result.changeUsdCents).toBe(1000);
    expect(result.givenUsdCents).toBe(1000); // Acotado al máximo disponible (1000)
    expect(result.givenBsCents).toBe(0); // Como se dio todo en USD, el remanente es 0, no hay maxBs
    expect(result.unreturnedSurplusUsdCents).toBe(0);

    // Sub-caso B2: Override en Bs que supera el remanente en Bs
    const resultBsExceeded = resolveChangeState({
      totalUsdCents: 5000,
      tenders: [{ amountCents: 6000, currency: 'USD' }],
      rateMicroBs,
      override: {
        usdCents: 400, // $4 en USD, remanente $6 (600 cents) -> maxBs = 600 * 40 = 24000
        bsCents: 999_999 // Intento de dar más Bs de lo que corresponde
      }
    });

    expect(resultBsExceeded.changeUsdCents).toBe(1000);
    expect(resultBsExceeded.givenUsdCents).toBe(400);
    expect(resultBsExceeded.givenBsCents).toBe(24000); // 24000 céntimos de Bs (240 Bs = $6)
    expect(resultBsExceeded.unreturnedSurplusUsdCents).toBe(0);
  });

  it('Caso C (Vuelto mixto USD + Bs): cuadra exacto sin excedente fantasma', () => {
    // Total $50 (5000 cents), pago $70 (7000 cents) -> vuelto $20 (2000 cents)
    // Se desea dar $10 en USD y el resto en Bolívares
    // Remanente en USD: 1000 cents ($10) -> a tasa 40 micro-Bs = 40_000 cents Bs (Bs 400,00)
    const result = resolveChangeState({
      totalUsdCents: 5000,
      tenders: [{ amountCents: 7000, currency: 'USD' }],
      rateMicroBs,
      override: {
        usdCents: 1000,
        bsCents: 40000
      }
    });

    expect(result.changeUsdCents).toBe(2000);
    expect(result.givenUsdCents).toBe(1000);
    expect(result.givenBsCents).toBe(40000);
    expect(result.unreturnedSurplusUsdCents).toBe(0); // Cuadre exacto sin excedente fantasma

    // Sub-caso C2: Vuelto con tasa real no redonda (ej. 36.5872 Bs/$)
    const bcvRate = 36_587_200;
    // Vuelto $1.00 (100 cents), override todo en Bs
    // maxBs = usdCentsToBsCents(100, 36587200) = 3659 cents de Bs
    const resultBcv = resolveChangeState({
      totalUsdCents: 1000,
      tenders: [{ amountCents: 1100, currency: 'USD' }],
      rateMicroBs: bcvRate,
      override: {
        usdCents: 0,
        bsCents: 3659
      }
    });

    expect(resultBcv.changeUsdCents).toBe(100);
    expect(resultBcv.givenUsdCents).toBe(0);
    expect(resultBcv.givenBsCents).toBe(3659);
    expect(resultBcv.unreturnedSurplusUsdCents).toBe(0); // Sin residuo ni excedente fantasma de 1 centavo
  });
});
