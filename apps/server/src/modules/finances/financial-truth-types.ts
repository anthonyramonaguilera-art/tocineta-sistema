/**
 * SISTEMA OPERATIVO TOCINETA — TIPOS DE VERDAD FINANCIERA (R2 P2-B)
 */

export interface FinancialTruthParams {
  jornadaId?: string;
  from?: number;
  to?: number;
  locationId?: 'ALL' | string;
}

export interface MethodBreakdown {
  method: string;
  grossUsdCents: number;
  grossBsCents: number;
  changeDeliveredUsdCents: number;
  changeDeliveredBsCents: number;
  netUsdCents: number;
  netBsCents: number;
  count: number;
}

export interface ExpectedCashBreakdown {
  openingCashUsdCents: number;
  openingCashBsCents: number;
  collectedCashUsdCents: number;
  collectedCashBsCents: number;
  changeDeliveredUsdCents: number;
  changeDeliveredBsCents: number;
  expensesPaidInCashUsdCents: number;
  expensesPaidInCashBsCents: number;
  netCashUsdCents: number;
  netCashBsCents: number;
}

export interface SedeFinancialTruth {
  locationId: string;
  locationName: string;
  totalOrders: number;
  collectedOrdersCount: number;
  uncollectedOrdersCount: number;
  grossSalesUsdCents: number;
  discountsUsdCents: number;
  netSalesUsdCents: number;
  deliveryFeesUsdCents: number;
  expectedCashUsdCents: number;
  expectedCashBsCents: number;
  cogsTheoretical: number;
  wasteUsdCents: number;
  operatingExpensesUsdCents: number;
  netProfitUsdCents: number;
}

export interface FinancialTruthResult {
  period: {
    jornadaId?: string;
    from: number;
    to: number;
    locationId: string;
  };
  rateMicroBs: number;
  orders: {
    collectedCount: number;
    uncollectedCount: number;
    totalCount: number;
    grossSalesUsdCents: number;
    discountsUsdCents: number;
    netSalesUsdCents: number;
    deliveryFeesUsdCents: number;
  };
  collectedByMethod: MethodBreakdown[];
  expectedCash: ExpectedCashBreakdown;
  cogsTheoretical: number;
  waste: {
    totalUsdCents: number;
    wasteLogsUsdCents: number;
    workerIncidentsUsdCents: number;
  };
  operatingExpensesUsdCents: number;
  netProfitUsdCents: number;
  receivables: {
    totalUsdCents: number;
    pendingCount: number;
  };
  payables: {
    totalUsdCents: number;
    pendingCount: number;
  };
  bySede: SedeFinancialTruth[];
}
