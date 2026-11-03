import type Database from 'better-sqlite3';

/**
 * Conserva SOLO { jornada, ordersCount, totalOrders, receivablesUsdCents } y
 * elimina esperados (expectedCash*), byMethod, ledgerEntries, bySede e incidentes.
 */
export function redactSummaryForBlindCashier(summary: any): any {
  if (!summary) return summary;

  return {
    jornada: summary.jornada,
    ordersCount: summary.ordersCount,
    totalOrders: summary.totalOrders,
    receivablesUsdCents: summary.receivablesUsdCents
  };
}

/**
 * Devuelve true SI Y SOLO SI user?.role === 'cajera' y existe en cash_sessions una
 * sesión con user_id = user.id, jornada_id = jornadaId y status = 'abierta'.
 * (Para admin y supervisor devuelve SIEMPRE false: ellos ven todo guiado).
 */
export function isBlindActive(
  rawDb: Database.Database,
  user: any,
  jornadaId: string
): boolean {
  if (!user || user.role !== 'cajera' || !user.id || !jornadaId) {
    return false;
  }

  const altJornadaId = jornadaId.startsWith('jor_')
    ? jornadaId.replace(/^jor_/, 'jornada_')
    : jornadaId.replace(/^jornada_/, 'jor_');

  const session = rawDb.prepare(`
    SELECT id FROM cash_sessions
    WHERE user_id = ?
      AND (jornada_id = ? OR jornada_id = ?)
      AND status = 'abierta'
    LIMIT 1
  `).get(user.id, jornadaId, altJornadaId);

  return Boolean(session);
}

/**
 * Devuelve true si existe una sesión con status = 'cerrada' de esa cajera en esa jornada.
 */
export function canCashierDownload(
  rawDb: Database.Database,
  user: any,
  jornadaId: string
): boolean {
  if (!user || !user.id || !jornadaId) {
    return false;
  }

  const altJornadaId = jornadaId.startsWith('jor_')
    ? jornadaId.replace(/^jor_/, 'jornada_')
    : jornadaId.replace(/^jornada_/, 'jor_');

  const session = rawDb.prepare(`
    SELECT id FROM cash_sessions
    WHERE user_id = ?
      AND (jornada_id = ? OR jornada_id = ?)
      AND status = 'cerrada'
    LIMIT 1
  `).get(user.id, jornadaId, altJornadaId);

  return Boolean(session);
}
