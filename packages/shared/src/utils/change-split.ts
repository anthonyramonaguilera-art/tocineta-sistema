/**
 * SISTEMA OPERATIVO TOCINETA — LÓGICA DE REPARTO DE VUELTO MIXTO (R2 P2-C)
 *
 * Manejo estricto de dinero en enteros (centavos USD y centavos de Bs a partir de rateMicroBs).
 * Tolerancia máxima permitida para redondeo cambiario: $0.01 (1 centavo USD).
 */

export interface ChangeSplitResult {
  totalChangeUsdCents: number;
  usdGivenCents: number;
  bsGivenCents: number;
  rateMicroBs: number;
  equivalentGivenUsdCents: number;
  differenceUsdCents: number;
  isValid: boolean;
}

/**
 * Convierte centavos USD a centavos de Bolívares usando la tasa micro-Bs.
 */
export function usdCentsToBsCents(usdCents: number, rateMicroBs: number): number {
  if (usdCents <= 0 || rateMicroBs <= 0) return 0;
  // micro-Bs = Bs * 1,000,000.
  // 1 USD = rateMicroBs / 1,000,000 Bs.
  // 1 usdCent = rateMicroBs / 100,000,000 Bs = rateMicroBs / 1,000,000 bsCents.
  // bsCents = (usdCents * rateMicroBs) / 1,000,000
  return Math.round((usdCents * rateMicroBs) / 1_000_000);
}

/**
 * Convierte centavos de Bolívares a centavos USD usando la tasa micro-Bs.
 */
export function bsCentsToUsdCents(bsCents: number, rateMicroBs: number): number {
  if (bsCents <= 0 || rateMicroBs <= 0) return 0;
  // usdCents = (bsCents * 1,000,000) / rateMicroBs
  return Math.round((bsCents * 1_000_000) / rateMicroBs);
}

/**
 * Calcula el reparto de vuelto cuando el usuario ajusta el monto a entregar en USD.
 * El remanente se asigna automáticamente a Bolívares.
 */
export function splitChangeByUsd(
  totalChangeUsdCents: number,
  usdGivenCents: number,
  rateMicroBs: number
): ChangeSplitResult {
  const safeUsd = Math.max(0, Math.min(usdGivenCents, totalChangeUsdCents));
  const remainingUsdCents = Math.max(0, totalChangeUsdCents - safeUsd);
  const bsGivenCents = usdCentsToBsCents(remainingUsdCents, rateMicroBs);
  
  return validateChangeSplit(totalChangeUsdCents, safeUsd, bsGivenCents, rateMicroBs);
}

/**
 * Calcula el reparto de vuelto cuando el usuario ajusta el monto a entregar en Bolívares.
 * El remanente se asigna automáticamente a USD.
 */
export function splitChangeByBs(
  totalChangeUsdCents: number,
  bsGivenCents: number,
  rateMicroBs: number
): ChangeSplitResult {
  const safeBs = Math.max(0, bsGivenCents);
  const bsEquivalentUsdCents = bsCentsToUsdCents(safeBs, rateMicroBs);
  const remainingUsdCents = Math.max(0, totalChangeUsdCents - bsEquivalentUsdCents);

  return validateChangeSplit(totalChangeUsdCents, remainingUsdCents, safeBs, rateMicroBs);
}

/**
 * Valida si un reparto de vuelto satisface el monto adeudado dentro de una tolerancia de $0.01.
 */
export function validateChangeSplit(
  totalChangeUsdCents: number,
  usdGivenCents: number,
  bsGivenCents: number,
  rateMicroBs: number,
  toleranceCents: number = 1
): ChangeSplitResult {
  const bsEquivalentUsd = bsCentsToUsdCents(bsGivenCents, rateMicroBs);
  const equivalentGivenUsdCents = usdGivenCents + bsEquivalentUsd;
  const differenceUsdCents = equivalentGivenUsdCents - totalChangeUsdCents;
  const isValid = Math.abs(differenceUsdCents) <= toleranceCents;

  return {
    totalChangeUsdCents,
    usdGivenCents,
    bsGivenCents,
    rateMicroBs,
    equivalentGivenUsdCents,
    differenceUsdCents,
    isValid
  };
}
