import type Database from 'better-sqlite3';

export interface MethodCountHistoryItem {
  method: string;
  currency: string;
  expectedCents: number;
  countedCents: number;
  diffCents: number;
}

export interface SessionHistoryItem {
  sessionId: string;
  userName: string;
  hasDiff: boolean;
  methods: MethodCountHistoryItem[];
}

export interface JornadaHistoryItem {
  jornadaId: string;
  openedAtMs: number;
  closedAtMs: number;
  closedByName: string | null;
  ordersCount: number;
  netSalesUsdCents: number;
  sessions: SessionHistoryItem[];
}

export interface ClosureHistoryResult {
  items: JornadaHistoryItem[];
  nextBefore: number | null;
}

export interface ClosureHistoryOptions {
  user: {
    id: string;
    role: string;
    [key: string]: any;
  };
  limit?: number;
  before?: number | null;
}

/**
 * Consulta el historial paginado de jornadas cerradas sin N+1.
 * Acotado a 1..50 (default 20), paginación por cursor `before = closed_at_ms`.
 * Restricción de rol cajera: solo jornadas con sesiones suyas y solo sus sesiones cerradas.
 */
export function getClosureHistory(
  rawDb: Database.Database,
  options: ClosureHistoryOptions
): ClosureHistoryResult {
  const { user, limit, before } = options;

  let safeLimit = typeof limit === 'number' && !isNaN(limit) ? Math.floor(limit) : 20;
  if (safeLimit < 1) safeLimit = 1;
  if (safeLimit > 50) safeLimit = 50;

  const conditions: string[] = ["j.status = 'cerrada'", 'j.closed_at_ms IS NOT NULL'];
  const params: any[] = [];

  if (before !== undefined && before !== null) {
    conditions.push('j.closed_at_ms < ?');
    params.push(before);
  }

  if (user.role === 'cajera') {
    conditions.push('EXISTS (SELECT 1 FROM cash_sessions cs WHERE cs.jornada_id = j.id AND cs.user_id = ?)');
    params.push(user.id);
  }

  const whereClause = conditions.join(' AND ');
  const jornadasQuery = `
    SELECT 
      j.id AS jornada_id,
      j.opened_at_ms,
      j.closed_at_ms,
      u.name AS closed_by_name
    FROM jornadas j
    LEFT JOIN users u ON u.id = j.closed_by_user_id
    WHERE ${whereClause}
    ORDER BY j.closed_at_ms DESC
    LIMIT ?
  `;
  params.push(safeLimit + 1);

  const rows = rawDb.prepare(jornadasQuery).all(...params) as Array<{
    jornada_id: string;
    opened_at_ms: number;
    closed_at_ms: number;
    closed_by_name: string | null;
  }>;

  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;

  if (pageRows.length === 0) {
    return {
      items: [],
      nextBefore: null
    };
  }

  const nextBefore = hasMore ? pageRows[pageRows.length - 1].closed_at_ms : null;
  const jornadaIds = pageRows.map(r => r.jornada_id);
  const placeholders = jornadaIds.map(() => '?').join(',');

  // Totales de órdenes por jornada (pagadas y no anuladas)
  const ordersQuery = `
    SELECT 
      jornada_id,
      COUNT(id) AS orders_count,
      COALESCE(SUM(net_food_sales_usd_cents), 0) AS net_sales_usd_cents
    FROM orders
    WHERE jornada_id IN (${placeholders})
      AND payment_status = 'pagado'
      AND (fulfillment_status IS NULL OR fulfillment_status NOT IN ('anulado', 'cancelado'))
    GROUP BY jornada_id
  `;
  const orderRows = rawDb.prepare(ordersQuery).all(...jornadaIds) as Array<{
    jornada_id: string;
    orders_count: number;
    net_sales_usd_cents: number;
  }>;

  const ordersMap = new Map<string, { ordersCount: number; netSalesUsdCents: number }>();
  for (const row of orderRows) {
    ordersMap.set(row.jornada_id, {
      ordersCount: Number(row.orders_count || 0),
      netSalesUsdCents: Number(row.net_sales_usd_cents || 0)
    });
  }

  // Sesiones de caja asociadas a las jornadas
  const sessionConditions: string[] = [
    `cs.jornada_id IN (${placeholders})`,
    "cs.status = 'cerrada'"
  ];
  const sessionParams: any[] = [...jornadaIds];

  if (user.role === 'cajera') {
    sessionConditions.push('cs.user_id = ?');
    sessionParams.push(user.id);
  }

  const sessionsQuery = `
    SELECT 
      cs.id AS session_id,
      cs.jornada_id,
      cs.user_id,
      u.name AS user_name,
      cs.diff_usd_cents,
      cs.diff_bs_cents,
      cs.diff_ubii_bs_cents
    FROM cash_sessions cs
    LEFT JOIN users u ON u.id = cs.user_id
    WHERE ${sessionConditions.join(' AND ')}
    ORDER BY cs.opened_at_ms ASC
  `;

  const sessionRows = rawDb.prepare(sessionsQuery).all(...sessionParams) as Array<{
    session_id: string;
    jornada_id: string;
    user_id: string;
    user_name: string | null;
    diff_usd_cents: number | null;
    diff_bs_cents: number | null;
    diff_ubii_bs_cents: number | null;
  }>;

  // Conteos por método de pago (último attempt por sesión)
  const sessionIds = sessionRows.map(s => s.session_id);
  const sessionMethodsMap = new Map<string, MethodCountHistoryItem[]>();

  if (sessionIds.length > 0) {
    const sessionPlaceholders = sessionIds.map(() => '?').join(',');
    const countsQuery = `
      SELECT 
        csmc.cash_session_id,
        csmc.method,
        csmc.currency,
        csmc.expected_cents,
        csmc.counted_cents,
        csmc.diff_cents,
        csmc.attempt
      FROM cash_session_method_counts csmc
      INNER JOIN (
        SELECT cash_session_id, MAX(attempt) AS max_attempt
        FROM cash_session_method_counts
        WHERE cash_session_id IN (${sessionPlaceholders})
        GROUP BY cash_session_id
      ) latest ON csmc.cash_session_id = latest.cash_session_id AND csmc.attempt = latest.max_attempt
      ORDER BY csmc.cash_session_id, csmc.created_at_ms ASC, csmc.id ASC
    `;

    const countRows = rawDb.prepare(countsQuery).all(...sessionIds) as Array<{
      cash_session_id: string;
      method: string;
      currency: string;
      expected_cents: number;
      counted_cents: number;
      diff_cents: number;
      attempt: number;
    }>;

    for (const count of countRows) {
      let list = sessionMethodsMap.get(count.cash_session_id);
      if (!list) {
        list = [];
        sessionMethodsMap.set(count.cash_session_id, list);
      }
      list.push({
        method: count.method,
        currency: count.currency,
        expectedCents: count.expected_cents,
        countedCents: count.counted_cents,
        diffCents: count.diff_cents
      });
    }
  }

  // Agrupar sesiones por jornada con evaluación de hasDiff en último intento
  const sessionsByJornada = new Map<string, SessionHistoryItem[]>();
  for (const session of sessionRows) {
    let list = sessionsByJornada.get(session.jornada_id);
    if (!list) {
      list = [];
      sessionsByJornada.set(session.jornada_id, list);
    }
    const methods = sessionMethodsMap.get(session.session_id) || [];
    const hasDiff = methods.length > 0
      ? methods.some(m => m.diffCents !== 0)
      : Boolean(
          (session.diff_usd_cents && session.diff_usd_cents !== 0) ||
          (session.diff_bs_cents && session.diff_bs_cents !== 0) ||
          (session.diff_ubii_bs_cents && session.diff_ubii_bs_cents !== 0)
        );

    list.push({
      sessionId: session.session_id,
      userName: session.user_name || 'Desconocido',
      hasDiff,
      methods
    });
  }

  const items: JornadaHistoryItem[] = pageRows.map(j => {
    const orderTotals = ordersMap.get(j.jornada_id) || { ordersCount: 0, netSalesUsdCents: 0 };
    const sessions = sessionsByJornada.get(j.jornada_id) || [];
    return {
      jornadaId: j.jornada_id,
      openedAtMs: j.opened_at_ms,
      closedAtMs: j.closed_at_ms,
      closedByName: j.closed_by_name,
      ordersCount: orderTotals.ordersCount,
      netSalesUsdCents: orderTotals.netSalesUsdCents,
      sessions
    };
  });

  return {
    items,
    nextBefore
  };
}
