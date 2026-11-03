import { usdCentsToBsCents, bsCentsToUsdCents } from '@tocineta/shared';

/**
 * Formatea un entero en centavos USD a cadena con 2 decimales usando aritmética entera.
 * Cero toFixed sobre floats.
 * Ejemplos: 5000 -> "50.00", -200 -> "-2.00", 0 -> "0.00"
 */
export function fmtUsd(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  const intPart = Math.trunc(abs / 100);
  const decPart = String(abs % 100).padStart(2, '0');
  return `${sign}${intPart}.${decPart}`;
}

/**
 * Formatea un entero en centavos de Bolívares a cadena con 2 decimales usando aritmética entera.
 * Cero toFixed sobre floats.
 * Ejemplos: 200000 -> "2000.00", -500 -> "-5.00", 0 -> "0.00"
 */
export function fmtBs(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  const intPart = Math.trunc(abs / 100);
  const decPart = String(abs % 100).padStart(2, '0');
  return `${sign}${intPart}.${decPart}`;
}

/**
 * Convierte centavos USD a Bolívares según la tasa micro-Bs y formatea el resultado con 2 decimales.
 */
export function fmtBsFromUsd(usdCents: number, rateMicroBs: number): string {
  const safeUsd = Number.isFinite(usdCents) ? Math.round(usdCents) : 0;
  const bsCents = usdCentsToBsCents(Math.abs(safeUsd), rateMicroBs);
  const sign = safeUsd < 0 ? '-' : '';
  const abs = Math.abs(bsCents);
  const intPart = Math.trunc(abs / 100);
  const decPart = String(abs % 100).padStart(2, '0');
  return `${sign}${intPart}.${decPart}`;
}

/**
 * Convierte centavos de Bolívares a USD según la tasa micro-Bs y formatea el resultado con 2 decimales.
 */
export function fmtUsdFromBs(bsCents: number, rateMicroBs: number): string {
  const safeBs = Number.isFinite(bsCents) ? Math.round(bsCents) : 0;
  const usdCents = bsCentsToUsdCents(Math.abs(safeBs), rateMicroBs);
  const sign = safeBs < 0 ? '-' : '';
  const abs = Math.abs(usdCents);
  const intPart = Math.trunc(abs / 100);
  const decPart = String(abs % 100).padStart(2, '0');
  return `${sign}${intPart}.${decPart}`;
}
