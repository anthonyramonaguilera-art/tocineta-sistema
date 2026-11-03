import type Database from 'better-sqlite3';

export type CanonicalPaymentMethod =
  | 'EFECTIVO_USD'
  | 'EFECTIVO_BS'
  | 'PAGO_MOVIL'
  | 'PUNTO_DE_VENTA'
  | 'UBII'
  | 'TRANSFERENCIA'
  | 'ZELLE'
  | 'BINANCE'
  | 'OTROS';

export interface MethodExpectedResult {
  method: CanonicalPaymentMethod;
  currency: 'USD' | 'BS';
  expectedCents: number;
}

export const CANONICAL_METHODS: ReadonlyArray<{ method: CanonicalPaymentMethod; currency: 'USD' | 'BS' }> = [
  { method: 'EFECTIVO_USD', currency: 'USD' },
  { method: 'EFECTIVO_BS', currency: 'BS' },
  { method: 'PAGO_MOVIL', currency: 'BS' },
  { method: 'PUNTO_DE_VENTA', currency: 'BS' },
  { method: 'UBII', currency: 'BS' },
  { method: 'TRANSFERENCIA', currency: 'BS' },
  { method: 'ZELLE', currency: 'USD' },
  { method: 'BINANCE', currency: 'USD' },
  { method: 'OTROS', currency: 'USD' }
];

export const METHOD_CURRENCIES: Record<CanonicalPaymentMethod, 'USD' | 'BS'> = {
  EFECTIVO_USD: 'USD',
  EFECTIVO_BS: 'BS',
  PAGO_MOVIL: 'BS',
  PUNTO_DE_VENTA: 'BS',
  UBII: 'BS',
  TRANSFERENCIA: 'BS',
  ZELLE: 'USD',
  BINANCE: 'USD',
  OTROS: 'USD'
};

export function normalizeCanonicalMethod(rawMethod: string): CanonicalPaymentMethod {
  const m = (rawMethod || '').toUpperCase().trim();
  switch (m) {
    case 'EFECTIVO_USD':
    case 'CASH_USD':
    case 'USD':
      return 'EFECTIVO_USD';
    case 'EFECTIVO_BS':
    case 'CASH_BS':
    case 'BS':
      return 'EFECTIVO_BS';
    case 'PAGO_MOVIL':
    case 'PAGOMOVIL':
      return 'PAGO_MOVIL';
    case 'PUNTO_DE_VENTA':
    case 'PUNTO':
      return 'PUNTO_DE_VENTA';
    case 'UBII':
      return 'UBII';
    case 'TRANSFERENCIA':
      return 'TRANSFERENCIA';
    case 'BINANCE':
    case 'USDT':
      return 'BINANCE';
    case 'ZELLE':
      return 'ZELLE';
    case 'OTROS':
    case 'OTRO':
      return 'OTROS';
    default:
      return 'OTROS';
  }
}

/**
 * Calcula los montos esperados para los 9 métodos canónicos en su moneda nativa.
 * Regla T-02: Excluye órdenes con payment_status IN ('reembolsado', 'anulado').
 * EFECTIVO_USD y EFECTIVO_BS incluyen saldo de apertura, cobros, menos vueltos entregados,
 * menos gastos operativos en efectivo de la sesión.
 * Los demás métodos corresponden a la recaudación bruta exacta de la sesión.
 */
export function computeExpectedByMethod(
  rawDb: Database.Database,
  sessionId: string
): MethodExpectedResult[] {
  const session = rawDb.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(sessionId) as any;
  if (!session) {
    const err: any = new Error(`Sesión de caja '${sessionId}' no encontrada`);
    err.statusCode = 404;
    throw err;
  }

  // 1. Cobros en órdenes válidas de la sesión (excluyendo reembolsado y anulado)
  const payments = rawDb.prepare(`
    SELECT p.method, p.amount_cents, p.currency
    FROM payments p
    JOIN orders o ON p.order_id = o.id
    WHERE o.cash_session_id = ? AND o.payment_status NOT IN ('reembolsado', 'anulado')
  `).all(sessionId) as Array<{
    method: string;
    amount_cents: number;
    currency: string;
  }>;

  const inflows: Record<CanonicalPaymentMethod, number> = {
    EFECTIVO_USD: 0,
    EFECTIVO_BS: 0,
    PAGO_MOVIL: 0,
    PUNTO_DE_VENTA: 0,
    UBII: 0,
    TRANSFERENCIA: 0,
    ZELLE: 0,
    BINANCE: 0,
    OTROS: 0
  };

  for (const p of payments) {
    const norm = normalizeCanonicalMethod(p.method);
    inflows[norm] = (inflows[norm] || 0) + (p.amount_cents || 0);
  }

  // 2. Vueltos entregados en órdenes válidas de la sesión
  const changes = rawDb.prepare(`
    SELECT cd.change_usd_cents, cd.change_bs_cents
    FROM change_deliveries cd
    JOIN orders o ON cd.order_id = o.id
    WHERE o.cash_session_id = ? AND o.payment_status NOT IN ('reembolsado', 'anulado')
  `).all(sessionId) as Array<{
    change_usd_cents: number;
    change_bs_cents: number;
  }>;

  let cashUsdOutflow = 0;
  let cashBsOutflow = 0;
  for (const c of changes) {
    cashUsdOutflow += c.change_usd_cents || 0;
    cashBsOutflow += c.change_bs_cents || 0;
  }

  // 3. Gastos operativos en efectivo de la sesión
  const cashExpensesRow = rawDb.prepare(`
    SELECT 
      COALESCE(SUM(CASE WHEN payment_method IN ('EFECTIVO_USD', 'USD', 'cash_usd') THEN amount_usd_cents ELSE 0 END), 0) as exp_usd,
      COALESCE(SUM(CASE WHEN payment_method IN ('EFECTIVO_BS', 'BS', 'cash_bs') THEN amount_bs_cents ELSE 0 END), 0) as exp_bs
    FROM operating_expenses
    WHERE jornada_id = ? AND category != 'MERMAS_DESPERDICIOS'
      AND (authorized_by_user_id = ? OR location_id = ?)
      AND created_at_ms >= ? AND created_at_ms <= ?
  `).get(
    session.jornada_id,
    session.user_id,
    session.location_id || 'loc_alta_vista',
    session.opened_at_ms,
    session.closed_at_ms || Date.now()
  ) as any;

  const cashExpUsd = cashExpensesRow?.exp_usd || 0;
  const cashExpBs = cashExpensesRow?.exp_bs || 0;

  const expectedMap: Record<CanonicalPaymentMethod, number> = {
    EFECTIVO_USD: (session.opening_cash_usd_cents || 0) + inflows.EFECTIVO_USD - cashUsdOutflow - cashExpUsd,
    EFECTIVO_BS: (session.opening_cash_bs_cents || 0) + inflows.EFECTIVO_BS - cashBsOutflow - cashExpBs,
    PAGO_MOVIL: inflows.PAGO_MOVIL,
    PUNTO_DE_VENTA: inflows.PUNTO_DE_VENTA,
    UBII: inflows.UBII,
    TRANSFERENCIA: inflows.TRANSFERENCIA,
    ZELLE: inflows.ZELLE,
    BINANCE: inflows.BINANCE,
    OTROS: inflows.OTROS
  };

  return CANONICAL_METHODS.map(m => ({
    method: m.method,
    currency: m.currency,
    expectedCents: expectedMap[m.method] || 0
  }));
}
