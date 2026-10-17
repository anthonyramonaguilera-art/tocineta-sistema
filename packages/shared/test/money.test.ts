import { describe, it, expect } from 'vitest';
import {
  parseRateToMicroBs,
  formatMicroBsToRate,
  usdToBsCents,
  calculateSettlement,
  calculateMixedChange,
  prorateComboLargestRemainder,
  calculateOrderFinancials,
  checkClockIntegrity,
  generateUuidV7,
  isValidUuidV7,
  createIdempotencyKey,
  parseIdempotencyKey
} from '../src/index.js';

describe('Hito M1 - Motor Financiero Exacto y Seguridad (@tocineta/shared)', () => {
  const BCV_RATE = 36587200; // 36,5872 Bs/USD

  // --------------------------------------------------------------------------
  // PRUEBA OBLIGATORIA 1
  // --------------------------------------------------------------------------
  it('1. usdToBsCents(1390, 36587200) === 50856 (Bs 508,56 con half-up)', () => {
    const result = usdToBsCents(1390, BCV_RATE);
    expect(result).toBe(50856);
  });

  // --------------------------------------------------------------------------
  // PRUEBA OBLIGATORIA 2
  // --------------------------------------------------------------------------
  it('2. Cuenta de $13.90 con abono de $10.00 USD exige 14269 céntimos de Bs (Bs 142,69)', () => {
    const settlement = calculateSettlement({
      totalUsdCents: 1390,
      paidUsdCents: 1000,
      paidBsCents: 14269,
      rateMicroBs: BCV_RATE
    });

    expect(settlement.remUsdBeforeBs).toBe(390);
    expect(settlement.expectedBsCents).toBe(14269);
    expect(settlement.status).toBe('PAID');
    expect(settlement.isFullySettled).toBe(true);
    expect(settlement.roundingAdjustmentBsCents).toBe(0);
  });

  it('2b. Tolerancia de 1 centavo USD en liquidación mixta', () => {
    const maxTol = usdToBsCents(1, BCV_RATE); // 37 céntimos de Bs

    // Si paga con 20 céntimos de Bs menos (dentro de tolerancia de 37)
    const withinTol = calculateSettlement({
      totalUsdCents: 1390,
      paidUsdCents: 1000,
      paidBsCents: 14269 - 20,
      rateMicroBs: BCV_RATE
    });
    expect(withinTol.status).toBe('PAID');
    expect(withinTol.isFullySettled).toBe(true);
    expect(withinTol.roundingAdjustmentBsCents).toBe(20);

    // Si le faltan 50 céntimos de Bs (más de 1 centavo USD de tolerancia)
    const underpaid = calculateSettlement({
      totalUsdCents: 1390,
      paidUsdCents: 1000,
      paidBsCents: 14269 - 50,
      rateMicroBs: BCV_RATE
    });
    expect(underpaid.status).toBe('UNDERPAID');
    expect(underpaid.isFullySettled).toBe(false);
  });

  // --------------------------------------------------------------------------
  // PRUEBA OBLIGATORIA 3
  // --------------------------------------------------------------------------
  it('3. Vuelto de $20 sobre $13.90 ($6.10): $6.00 USD efectivo + remanente en Bs da 366 céntimos de Bs', () => {
    const mixedChange = calculateMixedChange({
      changeTotalUsdCents: 610, // $6.10
      changeGivenUsdCents: 600, // $6.00 USD
      rateMicroBs: BCV_RATE
    });

    expect(mixedChange.remChangeUsdCents).toBe(10); // $0.10
    expect(mixedChange.changeGivenBsCents).toBe(366); // Bs 3,66
  });

  // --------------------------------------------------------------------------
  // PRUEBA OBLIGATORIA 4
  // --------------------------------------------------------------------------
  it('4. Prorrateo Combo Street (550 sobre [250, 250, 150]) da [212, 211, 127]', () => {
    const items = [
      { id: 'burger', normalPriceUsdCents: 250, order: 0 },
      { id: 'papas', normalPriceUsdCents: 250, order: 1 },
      { id: 'soda', normalPriceUsdCents: 150, order: 2 }
    ];

    const result = prorateComboLargestRemainder(550, items);
    const prorated = result.items.map(it => it.proratedUsdCents);

    expect(prorated).toEqual([212, 211, 127]);
    expect(prorated.reduce((a, b) => a + b, 0)).toBe(550);
  });

  // --------------------------------------------------------------------------
  // PRUEBA OBLIGATORIA 5
  // --------------------------------------------------------------------------
  it('5. Prorrateo Combo Clásico (790 sobre [350, 350, 150]) da [325, 325, 140]', () => {
    const items = [
      { id: 'burger_clasica', normalPriceUsdCents: 350, order: 0 },
      { id: 'papas_grandes', normalPriceUsdCents: 350, order: 1 },
      { id: 'refresco', normalPriceUsdCents: 150, order: 2 }
    ];

    const result = prorateComboLargestRemainder(790, items);
    const prorated = result.items.map(it => it.proratedUsdCents);

    expect(prorated).toEqual([325, 325, 140]);
    expect(prorated.reduce((a, b) => a + b, 0)).toBe(790);
  });

  // --------------------------------------------------------------------------
  // PRUEBA OBLIGATORIA 6
  // --------------------------------------------------------------------------
  it('6. Prorrateo Combo Para Ti (1390 sobre [690, 690, 180]) da [615, 615, 160]', () => {
    const items = [
      { id: 'burger_doble_1', normalPriceUsdCents: 690, order: 0 },
      { id: 'burger_doble_2', normalPriceUsdCents: 690, order: 1 },
      { id: 'bebida_grande', normalPriceUsdCents: 180, order: 2 }
    ];

    const result = prorateComboLargestRemainder(1390, items);
    const prorated = result.items.map(it => it.proratedUsdCents);

    expect(prorated).toEqual([615, 615, 160]);
    expect(prorated.reduce((a, b) => a + b, 0)).toBe(1390);
  });

  // --------------------------------------------------------------------------
  // PRUEBA OBLIGATORIA 7
  // --------------------------------------------------------------------------
  it('7. Cálculo financiero de orden con Delivery ($3.00) en THIRD_PARTY_PASS_THROUGH y cupón COURTESY_ITEM (Café $0.00 / costo $0.35)', () => {
    const financials = calculateOrderFinancials({
      items: [
        { priceUsdCents: 1200 }, // Comida regular $12.00
        { priceUsdCents: 0, internalCostUsdCents: 35, isCourtesy: true } // Café de cortesía $0.00
      ],
      coupon: {
        code: 'CAFE_GRATIS',
        type: 'COURTESY_ITEM',
        courtesyItem: {
          id: 'item_cafe',
          name: 'Café Espresso',
          internalCostUsdCents: 35 // $0.35
        }
      },
      deliveryFeeUsdCents: 300, // $3.00
      deliveryAccountingMode: 'THIRD_PARTY_PASS_THROUGH'
    });

    expect(financials.grossFoodSubtotalUsdCents).toBe(1200);
    expect(financials.discountUsdCents).toBe(0);
    expect(financials.netFoodSalesUsdCents).toBe(1200);
    expect(financials.deliveryFeeUsdCents).toBe(300);
    expect(financials.totalToCollectUsdCents).toBe(1500); // $12.00 + $3.00
    expect(financials.motorizadoLiabilityUsdCents).toBe(300); // Separado para liquidar al motorizado
    expect(financials.marketingCourtesyCostUsdCents).toBe(70); // 35 (ítem) + 35 (cupón)
  });

  it('7b. Cálculo financiero de cupón DISCOUNT en porcentaje (10% sobre $15.00)', () => {
    const financials = calculateOrderFinancials({
      items: [{ priceUsdCents: 1500 }],
      coupon: {
        code: 'DESC10',
        type: 'DISCOUNT',
        percentageBps: 1000 // 10%
      },
      deliveryFeeUsdCents: 200,
      deliveryAccountingMode: 'THIRD_PARTY_PASS_THROUGH'
    });

    expect(financials.grossFoodSubtotalUsdCents).toBe(1500);
    expect(financials.discountUsdCents).toBe(150);
    expect(financials.netFoodSalesUsdCents).toBe(1350);
    expect(financials.totalToCollectUsdCents).toBe(1550);
    expect(financials.motorizadoLiabilityUsdCents).toBe(200);
  });

  // --------------------------------------------------------------------------
  // PARSING Y FORMATEO DE TASAS
  // --------------------------------------------------------------------------
  it('Parsea tasa BCV con punto o coma correctamente', () => {
    expect(parseRateToMicroBs('36.5872')).toBe(36587200);
    expect(parseRateToMicroBs('36,5872')).toBe(36587200);
    expect(parseRateToMicroBs('37')).toBe(37000000);
    expect(formatMicroBsToRate(36587200)).toBe('36,5872');
  });

  // --------------------------------------------------------------------------
  // GUARDIA DE RELOJ Y UUIDv7
  // --------------------------------------------------------------------------
  it('8a. Guardia de reloj detecta retroceso > 1 min o salto > 36h', () => {
    const now = 1729140000000;

    // Normal (avance de 5 segundos)
    expect(checkClockIntegrity(now, now - 5000)).toEqual({ status: 'OK' });

    // Primera vez (null)
    expect(checkClockIntegrity(now, null)).toEqual({ status: 'OK' });

    // Retroceso de 3 minutos
    const backwards = checkClockIntegrity(now - 180000, now);
    expect(backwards.status).toBe('CLOCK_WENT_BACKWARDS');
    expect(backwards.deltaMs).toBe(-180000);

    // Salto hacia adelante de 40 horas (40 * 3600 * 1000 = 144.000.000 ms)
    const jump = checkClockIntegrity(now + 144000000, now);
    expect(jump.status).toBe('CLOCK_JUMP_CONFIRM_REQUIRED');
  });

  it('8b. UUIDv7 canónico y claves de idempotencia', () => {
    const uuid = generateUuidV7();
    expect(isValidUuidV7(uuid)).toBe(true);

    const key = createIdempotencyKey('order', uuid);
    expect(key).toBe(`order:${uuid}`);

    const parsed = parseIdempotencyKey(key);
    expect(parsed.entity).toBe('order');
    expect(parsed.uuidV7).toBe(uuid);

    expect(() => createIdempotencyKey('invalid name!', uuid)).toThrow();
  });
});
