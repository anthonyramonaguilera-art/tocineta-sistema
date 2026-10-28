import { describe, it, expect } from 'vitest';
import {
  usdCentsToBsCents,
  bsCentsToUsdCents,
  splitChangeByUsd,
  splitChangeByBs,
  validateChangeSplit
} from '../src/utils/change-split.js';

describe('Lógica de Reparto de Vuelto Mixto (change-split)', () => {
  const rateMicroBs500 = 500_000_000; // 500.00 Bs/USD

  it('convierte correctamente entre centavos USD y centavos Bs', () => {
    // $1.00 = 500.00 Bs = 50,000 bsCents
    expect(usdCentsToBsCents(100, rateMicroBs500)).toBe(50000);
    expect(bsCentsToUsdCents(50000, rateMicroBs500)).toBe(100);

    // $0.50 = 250.00 Bs = 25,000 bsCents
    expect(usdCentsToBsCents(50, rateMicroBs500)).toBe(25000);
    expect(bsCentsToUsdCents(25000, rateMicroBs500)).toBe(50);
  });

  it('calcula vuelto mixto según escenario oficial: $8.10 de vuelto, $0.50 en USD y resto en Bs a tasa 500', () => {
    const totalChangeUsdCents = 810; // $8.10
    const usdGivenCents = 50; // $0.50

    const split = splitChangeByUsd(totalChangeUsdCents, usdGivenCents, rateMicroBs500);

    expect(split.usdGivenCents).toBe(50);
    // Resto en USD = $7.60 (760 cents) -> 760 * 500 = 380,000 bs cents = 3,800.00 Bs
    expect(split.bsGivenCents).toBe(380000);
    expect(split.equivalentGivenUsdCents).toBe(810);
    expect(split.differenceUsdCents).toBe(0);
    expect(split.isValid).toBe(true);
  });

  it('permite entregar todo el vuelto en USD (100% USD)', () => {
    const totalChangeUsdCents = 500;
    const split = splitChangeByUsd(totalChangeUsdCents, 500, rateMicroBs500);

    expect(split.usdGivenCents).toBe(500);
    expect(split.bsGivenCents).toBe(0);
    expect(split.isValid).toBe(true);
  });

  it('permite entregar todo el vuelto en Bs (100% Bs)', () => {
    const totalChangeUsdCents = 500;
    const split = splitChangeByUsd(totalChangeUsdCents, 0, rateMicroBs500);

    expect(split.usdGivenCents).toBe(0);
    expect(split.bsGivenCents).toBe(250000); // 2,500.00 Bs
    expect(split.isValid).toBe(true);
  });

  it('calcula split cuando se especifica monto en Bs y recalcula USD', () => {
    const totalChangeUsdCents = 1000; // $10.00
    // Entregar 2,500.00 Bs (equivale a $5.00)
    const bsGivenCents = 250000;
    const split = splitChangeByBs(totalChangeUsdCents, bsGivenCents, rateMicroBs500);

    expect(split.bsGivenCents).toBe(250000);
    expect(split.usdGivenCents).toBe(500); // $5.00 en USD
    expect(split.isValid).toBe(true);
  });

  it('invalida repartos incompletos o con diferencias superiores a $0.01', () => {
    const totalChangeUsdCents = 1000; // $10.00
    // Solo se entrega $5.00 USD y 0 Bs
    const invalidUnder = validateChangeSplit(totalChangeUsdCents, 500, 0, rateMicroBs500);
    expect(invalidUnder.isValid).toBe(false);
    expect(invalidUnder.differenceUsdCents).toBe(-500);

    // Se entregan $15.00 USD
    const invalidOver = validateChangeSplit(totalChangeUsdCents, 1500, 0, rateMicroBs500);
    expect(invalidOver.isValid).toBe(false);
    expect(invalidOver.differenceUsdCents).toBe(500);
  });

  it('tolera diferencias mínimas de redondeo cambiario hasta $0.01', () => {
    const totalChangeUsdCents = 1000;
    // 999 cents entregados (diferencia de 1 centavo)
    const validWith1Cent = validateChangeSplit(totalChangeUsdCents, 999, 0, rateMicroBs500, 1);
    expect(validWith1Cent.isValid).toBe(true);

    // 998 cents entregados (diferencia de 2 centavos)
    const invalidWith2Cents = validateChangeSplit(totalChangeUsdCents, 998, 0, rateMicroBs500, 1);
    expect(invalidWith2Cents.isValid).toBe(false);
  });
});
