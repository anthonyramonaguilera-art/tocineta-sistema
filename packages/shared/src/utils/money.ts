import {
  type SettlementResult,
  type MixedChangeResult,
  type ComboItemInput,
  type ComboProrateResult,
  type Coupon,
  type DeliveryAccountingMode,
  type OrderFinancialsResult
} from '../schemas/money.js';

/**
 * Parsea una tasa BCV en formato texto ("36.5872" o "36,5872") a un entero en micro-Bolívares (36587200)
 */
export function parseRateToMicroBs(rateStr: string): number {
  if (typeof rateStr !== 'string') {
    throw new Error('La tasa debe ser una cadena de texto');
  }

  const normalized = rateStr.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Formato de tasa BCV inválido: "${rateStr}"`);
  }

  const [intPart, decPart = ''] = normalized.split('.');
  const intBig = BigInt(intPart);
  // Normalizar a exactamente 6 posiciones decimales (micro-unidades)
  const paddedDec = decPart.padEnd(6, '0').slice(0, 6);
  const decBig = BigInt(paddedDec);

  const microBs = intBig * 1_000_000n + decBig;
  if (microBs <= 0n) {
    throw new Error('La tasa debe ser un número positivo');
  }

  return Number(microBs);
}

/**
 * Formatea un entero en micro-Bolívares a cadena con coma decimal ("36587200" => "36,5872")
 */
export function formatMicroBsToRate(rateMicroBs: number): string {
  if (!Number.isSafeInteger(rateMicroBs) || rateMicroBs <= 0) {
    throw new Error('Monto en micro-Bolívares inválido');
  }

  const intPart = Math.floor(rateMicroBs / 1_000_000);
  const decPart = (rateMicroBs % 1_000_000).toString().padStart(6, '0');
  const trimmedDec = decPart.replace(/0+$/, '') || '0';

  return `${intPart},${trimmedDec}`;
}

/**
 * Conversión canónica USD cents ➔ Bs cents usando BigInt y redondeo half-up.
 * Prohibido el redondeo bancario.
 */
export function usdToBsCents(usdCents: number, rateMicroBs: number): number {
  if (!Number.isSafeInteger(usdCents) || !Number.isSafeInteger(rateMicroBs) || rateMicroBs <= 0) {
    throw new Error('Parámetros monetarios inválidos');
  }

  const sign = usdCents < 0 ? -1n : 1n;
  const absUsd = BigInt(Math.abs(usdCents));
  const rate = BigInt(rateMicroBs);
  const bsCents = (absUsd * rate + 500_000n) / 1_000_000n;
  return Number(sign * bsCents);
}

export interface SettlementParams {
  totalUsdCents: number;
  paidUsdCents: number;
  paidBsCents: number;
  rateMicroBs: number;
}

/**
 * Regla de liquidación de saldos en pagos mixtos.
 * NUNCA convierte Bs a USD para decidir si una orden está pagada.
 */
export function calculateSettlement(params: SettlementParams): SettlementResult {
  const { totalUsdCents, paidUsdCents, paidBsCents, rateMicroBs } = params;

  if (
    !Number.isSafeInteger(totalUsdCents) ||
    !Number.isSafeInteger(paidUsdCents) ||
    !Number.isSafeInteger(paidBsCents) ||
    !Number.isSafeInteger(rateMicroBs) ||
    rateMicroBs <= 0
  ) {
    throw new Error('Parámetros de liquidación inválidos');
  }

  const remUsdBeforeBs = totalUsdCents - paidUsdCents;
  const maxToleranceBsCents = usdToBsCents(1, rateMicroBs); // Tolerancia máx: 1 centavo USD en Bs

  if (remUsdBeforeBs <= 0) {
    // Orden completamente cubierta con USD
    const surplusUsd = Math.abs(remUsdBeforeBs);
    const hasExcess = surplusUsd > 0 || paidBsCents > 0;
    return {
      status: hasExcess ? 'OVERPAID' : 'PAID',
      totalUsdCents,
      paidUsdCents,
      paidBsCents,
      rateMicroBs,
      remUsdBeforeBs,
      expectedBsCents: 0,
      differenceBsCents: paidBsCents,
      maxToleranceBsCents,
      roundingAdjustmentBsCents: 0,
      roundingAdjustmentUsdCents: 0,
      isFullySettled: true
    };
  }

  const expectedBsCents = usdToBsCents(remUsdBeforeBs, rateMicroBs);
  const diffBs = expectedBsCents - paidBsCents;

  if (diffBs <= 0) {
    // Pagó exacto o excedente en Bs
    const surplusBs = Math.abs(diffBs);
    return {
      status: surplusBs > maxToleranceBsCents ? 'OVERPAID' : 'PAID',
      totalUsdCents,
      paidUsdCents,
      paidBsCents,
      rateMicroBs,
      remUsdBeforeBs,
      expectedBsCents,
      differenceBsCents: diffBs,
      maxToleranceBsCents,
      roundingAdjustmentBsCents: 0,
      roundingAdjustmentUsdCents: 0,
      isFullySettled: true
    };
  }

  // Falta dinero en Bs (diffBs > 0)
  if (diffBs <= maxToleranceBsCents) {
    // Dentro de tolerancia por redondeo de 1 centavo USD
    return {
      status: 'PAID',
      totalUsdCents,
      paidUsdCents,
      paidBsCents,
      rateMicroBs,
      remUsdBeforeBs,
      expectedBsCents,
      differenceBsCents: diffBs,
      maxToleranceBsCents,
      roundingAdjustmentBsCents: diffBs,
      roundingAdjustmentUsdCents: 1,
      isFullySettled: true
    };
  }

  // Falta más de 1 centavo USD
  return {
    status: 'UNDERPAID',
    totalUsdCents,
    paidUsdCents,
    paidBsCents,
    rateMicroBs,
    remUsdBeforeBs,
    expectedBsCents,
    differenceBsCents: diffBs,
    maxToleranceBsCents,
    roundingAdjustmentBsCents: 0,
    roundingAdjustmentUsdCents: 0,
    isFullySettled: false
  };
}

export interface MixedChangeParams {
  changeTotalUsdCents: number;
  changeGivenUsdCents: number;
  rateMicroBs: number;
}

/**
 * Cálculo del vuelto mixto (efectivo USD + remanente en Bolívares)
 */
export function calculateMixedChange(params: MixedChangeParams): MixedChangeResult {
  const { changeTotalUsdCents, changeGivenUsdCents, rateMicroBs } = params;

  if (
    !Number.isSafeInteger(changeTotalUsdCents) ||
    !Number.isSafeInteger(changeGivenUsdCents) ||
    !Number.isSafeInteger(rateMicroBs) ||
    rateMicroBs <= 0
  ) {
    throw new Error('Parámetros de vuelto mixto inválidos');
  }

  const remChangeUsdCents = Math.max(0, changeTotalUsdCents - changeGivenUsdCents);
  const changeGivenBsCents = remChangeUsdCents > 0 ? usdToBsCents(remChangeUsdCents, rateMicroBs) : 0;

  return {
    changeTotalUsdCents,
    changeGivenUsdCents,
    remChangeUsdCents,
    changeGivenBsCents,
    rateMicroBs
  };
}

/**
 * Prorrateo de combos por el Método del Mayor Resto (Hamilton)
 * Regla de desempate completa:
 * 1. Mayor resto.
 * 2. Mayor precio normal (normalPriceUsdCents).
 * 3. Menor índice de orden de aparición (order).
 */
export function prorateComboLargestRemainder(
  comboPriceUsdCents: number,
  items: ComboItemInput[]
): ComboProrateResult {
  if (!Number.isSafeInteger(comboPriceUsdCents) || comboPriceUsdCents <= 0) {
    throw new Error('Precio de combo inválido');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('La lista de ítems del combo no puede estar vacía');
  }

  const sumNormalPrices = items.reduce((acc, it) => acc + it.normalPriceUsdCents, 0);
  if (sumNormalPrices <= 0) {
    throw new Error('La suma de precios normales del combo debe ser mayor a cero');
  }

  const comboBig = BigInt(comboPriceUsdCents);
  const sumNormalBig = BigInt(sumNormalPrices);

  interface CalculationItem {
    id: string;
    normalPriceUsdCents: number;
    order: number;
    floorCents: number;
    remainder: bigint;
    index: number;
    allocatedCents: number;
  }

  let sumFloors = 0;
  const calcItems: CalculationItem[] = items.map((item, index) => {
    const num = comboBig * BigInt(item.normalPriceUsdCents);
    const floorCents = Number(num / sumNormalBig);
    const remainder = num % sumNormalBig;
    sumFloors += floorCents;

    return {
      id: item.id,
      normalPriceUsdCents: item.normalPriceUsdCents,
      order: item.order,
      floorCents,
      remainder,
      index,
      allocatedCents: floorCents
    };
  });

  const leftoverCents = comboPriceUsdCents - sumFloors;

  // Ordenar según reglas de prioridad:
  // 1. Mayor resto (descendente)
  // 2. Mayor precio normal (descendente)
  // 3. Menor índice/order (ascendente)
  const sorted = [...calcItems].sort((a, b) => {
    if (b.remainder !== a.remainder) {
      return b.remainder > a.remainder ? 1 : -1;
    }
    if (b.normalPriceUsdCents !== a.normalPriceUsdCents) {
      return b.normalPriceUsdCents - a.normalPriceUsdCents;
    }
    return a.order - b.order;
  });

  // Repartir los centavos sobrantes de 1 en 1
  for (let i = 0; i < leftoverCents; i++) {
    sorted[i % sorted.length].allocatedCents += 1;
  }

  // Devolver en el orden original de entrada
  const resultItems = calcItems.map(item => ({
    id: item.id,
    normalPriceUsdCents: item.normalPriceUsdCents,
    proratedUsdCents: item.allocatedCents,
    order: item.order
  }));

  return {
    comboPriceUsdCents,
    sumNormalPricesUsdCents: sumNormalPrices,
    items: resultItems
  };
}

export interface OrderFinancialsItemInput {
  priceUsdCents: number;
  internalCostUsdCents?: number;
  isCourtesy?: boolean;
}

export interface OrderFinancialsInput {
  items: OrderFinancialsItemInput[];
  coupon?: Coupon;
  deliveryFeeUsdCents?: number;
  deliveryAccountingMode?: DeliveryAccountingMode;
}

/**
 * Cálculo financiero integral de la orden (cupones, cortesías y separación contable de delivery)
 */
export function calculateOrderFinancials(input: OrderFinancialsInput): OrderFinancialsResult {
  const {
    items,
    coupon,
    deliveryFeeUsdCents = 0,
    deliveryAccountingMode = 'THIRD_PARTY_PASS_THROUGH'
  } = input;

  if (!Number.isSafeInteger(deliveryFeeUsdCents) || deliveryFeeUsdCents < 0) {
    throw new Error('Tarifa de delivery inválida');
  }

  let grossFoodSubtotalUsdCents = 0;
  let marketingCourtesyCostUsdCents = 0;

  for (const item of items) {
    if (!Number.isSafeInteger(item.priceUsdCents) || item.priceUsdCents < 0) {
      throw new Error('Precio de ítem inválido');
    }

    grossFoodSubtotalUsdCents += item.priceUsdCents;

    if (item.isCourtesy || item.priceUsdCents === 0) {
      if (item.internalCostUsdCents && item.internalCostUsdCents > 0) {
        marketingCourtesyCostUsdCents += item.internalCostUsdCents;
      }
    }
  }

  let discountUsdCents = 0;

  if (coupon) {
    if (coupon.type === 'DISCOUNT') {
      if (coupon.fixedUsdCents && coupon.fixedUsdCents > 0) {
        discountUsdCents = coupon.fixedUsdCents;
      } else if (coupon.percentageBps && coupon.percentageBps > 0) {
        const grossBig = BigInt(grossFoodSubtotalUsdCents);
        const bpsBig = BigInt(coupon.percentageBps);
        // Redondeo half-up: + 5000 / 10000
        discountUsdCents = Number((grossBig * bpsBig + 5000n) / 10000n);
      }
      // El descuento jamás supera el subtotal de comida
      discountUsdCents = Math.min(discountUsdCents, grossFoodSubtotalUsdCents);
    } else if (coupon.type === 'COURTESY_ITEM' && coupon.courtesyItem) {
      // Ítem de cortesía a $0.00: suma al costo interno de marketing pero no al ingreso
      marketingCourtesyCostUsdCents += coupon.courtesyItem.internalCostUsdCents;
    }
  }

  const netFoodSalesUsdCents = grossFoodSubtotalUsdCents - discountUsdCents;
  const totalToCollectUsdCents = netFoodSalesUsdCents + deliveryFeeUsdCents;

  const motorizadoLiabilityUsdCents = deliveryAccountingMode === 'THIRD_PARTY_PASS_THROUGH'
    ? deliveryFeeUsdCents
    : 0;

  return {
    grossFoodSubtotalUsdCents,
    discountUsdCents,
    netFoodSalesUsdCents,
    deliveryFeeUsdCents,
    totalToCollectUsdCents,
    deliveryAccountingMode,
    motorizadoLiabilityUsdCents,
    marketingCourtesyCostUsdCents
  };
}
