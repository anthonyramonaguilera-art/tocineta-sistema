/**
 * SISTEMA OPERATIVO TOCINETA — RESOLUCIÓN DE ESTADO DE VUELTO (R2 T-07 W1)
 *
 * Lógica pura sin dependencias de DOM ni React.
 * Dinero manejado estrictamente en enteros (centavos USD y micro-Bs).
 */

import { usdCentsToBsCents, bsCentsToUsdCents } from '@tocineta/shared';

export interface ChangeTenderInput {
  amountCents: number;
  currency: 'USD' | 'BS';
}

export interface ChangeOverrideInput {
  usdCents: number;
  bsCents: number;
}

export interface ResolveChangeStateInput {
  totalUsdCents: number;
  tenders: ChangeTenderInput[];
  rateMicroBs: number;
  override: ChangeOverrideInput | null;
}

export interface ResolvedChangeState {
  totalPaidUsdEquivalentCents: number;
  changeUsdCents: number;
  change: number;
  givenUsdCents: number;
  givenBsCents: number;
  unreturnedSurplusUsdCents: number;
}

export function resolveChangeState(input: ResolveChangeStateInput): ResolvedChangeState {
  const totalUsdCents = Math.max(0, input.totalUsdCents || 0);
  const rateMicroBs = input.rateMicroBs || 0;
  const tenders = Array.isArray(input.tenders) ? input.tenders : [];

  let paidUsdCents = 0;
  let paidBsCents = 0;
  for (const t of tenders) {
    if (t.currency === 'USD') {
      paidUsdCents += t.amountCents;
    } else {
      paidBsCents += t.amountCents;
    }
  }

  const bsEquivUsdCents = paidBsCents > 0 ? bsCentsToUsdCents(paidBsCents, rateMicroBs) : 0;
  const totalPaidUsdEquivalentCents = paidUsdCents + bsEquivUsdCents;
  const changeUsdCents = Math.max(0, totalPaidUsdEquivalentCents - totalUsdCents);

  if (!input.override) {
    return {
      totalPaidUsdEquivalentCents,
      changeUsdCents,
      change: changeUsdCents,
      givenUsdCents: changeUsdCents,
      givenBsCents: 0,
      unreturnedSurplusUsdCents: 0
    };
  }

  // Con override, se acota siempre al vuelto real
  const safeOverrideUsd = Math.max(0, input.override.usdCents || 0);
  const givenUsdCents = Math.min(safeOverrideUsd, changeUsdCents);
  const remUsd = changeUsdCents - givenUsdCents;
  const maxBs = usdCentsToBsCents(remUsd, rateMicroBs);
  const safeOverrideBs = Math.max(0, input.override.bsCents || 0);
  const givenBsCents = Math.min(safeOverrideBs, maxBs);

  // unreturnedSurplusUsdCents nunca es negativo y given nunca supera el vuelto total
  let unreturnedSurplusUsdCents = 0;
  if (remUsd > 0) {
    if (givenBsCents >= maxBs) {
      unreturnedSurplusUsdCents = 0;
    } else {
      const deliveredBsEquivalentUsd = bsCentsToUsdCents(givenBsCents, rateMicroBs);
      unreturnedSurplusUsdCents = Math.max(0, remUsd - deliveredBsEquivalentUsd);
    }
  }

  return {
    totalPaidUsdEquivalentCents,
    changeUsdCents,
    change: changeUsdCents,
    givenUsdCents,
    givenBsCents,
    unreturnedSurplusUsdCents
  };
}
