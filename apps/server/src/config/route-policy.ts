/**
 * ROUTE_POLICY — Clasificación de acceso de TODOS los endpoints del servidor.
 *
 * Roles REALES (apps/server/src/db/schema.ts -> UserRoleValues):
 *   admin | supervisor | cajera | mesonero | cocinero | despachador
 * (No existen CAJERA/MESERO/PLANCHA/DESPACHO en la base de datos: son solo nombres visibles.)
 *
 * Reglas:
 *  - La primera regla que coincide gana: las específicas van ANTES que los comodines.
 *  - Rutas fuera de /api, /ws y /qr (archivos estáticos de la SPA) son PUBLIC.
 *  - Una ruta /api sin regla cae en ANY_SESSION (exige sesión) y se marca matched=false;
 *    el test r2-route-policy.test.ts garantiza que no quede ninguna ruta real sin regla.
 *  - Las marcas DECISION_NEGOCIO son reglas que el dueño debe confirmar tras la
 *    fase de observación (log "auth-would-block").
 */

export type AccessLevel = 'PUBLIC' | 'ANY_SESSION' | 'CASHIER_PLUS' | 'ADMIN_SUPERVISOR' | 'ADMIN';
export type PolicyMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | '*';

export const ROLES_BY_LEVEL: Record<AccessLevel, readonly string[] | null> = {
  PUBLIC: null,
  ANY_SESSION: null,
  CASHIER_PLUS: ['cajera', 'supervisor', 'admin'],
  ADMIN_SUPERVISOR: ['supervisor', 'admin'],
  ADMIN: ['admin']
};

export type RouteRule = readonly [PolicyMethod, string, AccessLevel];

export const ROUTE_POLICY: readonly RouteRule[] = [
  // ───────────── PUBLIC ─────────────
  ['GET', '/api/health', 'PUBLIC'],
  ['GET', '/api/system-health', 'PUBLIC'],
  ['POST', '/api/auth/login', 'PUBLIC'],
  ['GET', '/api/auth/users-public', 'PUBLIC'],
  ['POST', '/api/auth/register', 'PUBLIC'],
  ['POST', '/api/auth/logout', 'PUBLIC'],
  ['GET', '/api/auth/me', 'PUBLIC'],
  // Desbloqueo desde la pantalla de login: se autentica con el PIN del autorizador (ver M12: lockout).
  ['POST', '/api/auth/unlock-user', 'PUBLIC'],
  ['GET', '/api/menu/pos', 'PUBLIC'],
  ['GET', '/api/qr-menu/data', 'PUBLIC'],
  ['GET', '/api/qr-menu/menu', 'PUBLIC'],
  ['GET', '/qr', 'PUBLIC'],
  ['GET', '/qr/*', 'PUBLIC'],
  ['POST', '/api/client-errors', 'PUBLIC'],

  // ───────────── ANY_SESSION (operación ágil de piso) ─────────────
  ['GET', '/ws', 'ANY_SESSION'],
  ['GET', '/api/events', 'ANY_SESSION'],
  ['GET', '/api/system/access-info', 'ANY_SESSION'],
  ['POST', '/api/auth/verify-action-pin', 'ANY_SESSION'],
  ['POST', '/api/auth/change-pin', 'ANY_SESSION'],
  ['GET', '/api/business-settings', 'ANY_SESSION'],
  ['PATCH', '/api/menu/products/:id/availability', 'ANY_SESSION'],
  ['PATCH', '/api/menu/flavors/:id/availability', 'ANY_SESSION'],
  ['POST', '/api/orders/:id/pay', 'CASHIER_PLUS'],
  ['POST', '/api/orders/:id/void', 'CASHIER_PLUS'], // el PIN de supervisor se valida dentro del servicio
  ['POST', '/api/orders/:id/incident', 'CASHIER_PLUS'], // el PIN de supervisor se valida dentro del servicio
  ['POST', '/api/orders', 'ANY_SESSION'],
  ['GET', '/api/orders/unpaid', 'ANY_SESSION'],
  ['GET', '/api/orders', 'ANY_SESSION'],
  ['GET', '/api/orders/:id', 'ANY_SESSION'],
  ['PATCH', '/api/orders/:id', 'ANY_SESSION'],
  ['PATCH', '/api/orders/:id/delivery', 'ANY_SESSION'],
  ['POST', '/api/orders/:id/cancel', 'ANY_SESSION'],
  ['POST', '/api/orders/:id/authorize-without-payment', 'ANY_SESSION'],
  ['POST', '/api/orders/:id/apply-coupon', 'ANY_SESSION'],
  ['POST', '/api/orders/:id/remove-coupon', 'ANY_SESSION'],
  ['GET', '/api/coupons', 'ANY_SESSION'],
  ['GET', '/api/coupons/validate', 'ANY_SESSION'],
  ['GET', '/api/kds/orders', 'ANY_SESSION'],
  ['POST', '/api/kds/lines/:lineId/status', 'ANY_SESSION'],
  ['POST', '/api/kds/orders/:orderId/deliver', 'ANY_SESSION'],
  ['POST', '/api/kds/orders/:orderId/force-complete', 'ANY_SESSION'], // DECISION_NEGOCIO: ¿solo CASHIER_PLUS?
  ['GET', '/api/printers', 'ANY_SESSION'],
  ['GET', '/api/print-jobs', 'ANY_SESSION'],
  ['GET', '/api/print-jobs/:id/preview', 'ANY_SESSION'],
  ['POST', '/api/print-jobs/:id/reprint', 'ANY_SESSION'],
  ['GET', '/api/locations', 'ANY_SESSION'],
  ['GET', '/api/user-locations', 'ANY_SESSION'],
  ['GET', '/api/reports/my-performance', 'ANY_SESSION'],
  ['GET', '/api/jornadas/current', 'ANY_SESSION'],
  ['GET', '/api/delivery/drivers', 'ANY_SESSION'],
  ['GET', '/api/support/status', 'ANY_SESSION'],
  ['GET', '/api/updater/version', 'ANY_SESSION'],

  // ───────────── CASHIER_PLUS (cajera, supervisor, admin) ─────────────
  ['POST', '/api/jornadas/open', 'CASHIER_PLUS'],
  ['POST', '/api/jornadas/:id/close', 'CASHIER_PLUS'],
  ['GET', '/api/jornadas/*', 'CASHIER_PLUS'],
  ['POST', '/api/cash-sessions/open', 'CASHIER_PLUS'],
  ['GET', '/api/cash-sessions/current', 'CASHIER_PLUS'],
  ['GET', '/api/cash-sessions/current/sales', 'CASHIER_PLUS'],
  ['POST', '/api/cash-sessions/:id/blind-count', 'CASHIER_PLUS'],
  ['GET', '/api/delivery/settlement-preview', 'CASHIER_PLUS'],
  ['POST', '/api/delivery/settle-driver', 'CASHIER_PLUS'],
  ['POST', '/api/print-jobs/:id/release', 'CASHIER_PLUS'],
  ['POST', '/api/print-jobs/:id/resolve', 'CASHIER_PLUS'],
  ['POST', '/api/print-jobs/:id/refire', 'CASHIER_PLUS'],
  ['POST', '/api/print-jobs/refire', 'CASHIER_PLUS'],
  ['POST', '/api/printers/:id/test', 'CASHIER_PLUS'],
  ['GET', '/api/reports/z-report/*', 'CASHIER_PLUS'],
  ['POST', '/api/menu/exchange-rate', 'CASHIER_PLUS'],
  ['POST', '/api/menu/exchange-rate/sync-now', 'CASHIER_PLUS'],
  ['*', '/api/emergency/*', 'CASHIER_PLUS'],

  // ───────────── ADMIN_SUPERVISOR ─────────────
  ['GET', '/api/printers/windows', 'ADMIN_SUPERVISOR'],
  ['POST', '/api/delivery/drivers', 'ADMIN_SUPERVISOR'],
  ['PATCH', '/api/delivery/drivers/:id', 'ADMIN_SUPERVISOR'],
  ['GET', '/api/qr-menu/cloud-summary', 'ADMIN_SUPERVISOR'],
  ['POST', '/api/qr-menu/export-static', 'ADMIN_SUPERVISOR'],
  ['*', '/api/menu/*', 'ADMIN_SUPERVISOR'],
  ['*', '/api/reports/*', 'ADMIN_SUPERVISOR'],
  ['*', '/api/finances/*', 'ADMIN_SUPERVISOR'],
  ['*', '/api/profitability/*', 'ADMIN_SUPERVISOR'],
  ['*', '/api/quotes/*', 'ADMIN_SUPERVISOR'],
  ['*', '/api/backups/*', 'ADMIN_SUPERVISOR'],
  ['*', '/api/fase4/*', 'ADMIN_SUPERVISOR'],

  // ───────────── ADMIN (solo admin) — específicas ANTES de /api/fase3/* ─────────────
  ['POST', '/api/fase3/setup-wizard/init-prod', 'ADMIN'],
  ['POST', '/api/fase3/setup-wizard/seed-demo', 'ADMIN'],
  ['*', '/api/fase3/*', 'ADMIN_SUPERVISOR'],
  ['PUT', '/api/business-settings', 'ADMIN'],
  ['PATCH', '/api/business-settings', 'ADMIN'],
  ['POST', '/api/business-settings/onboarding', 'ADMIN'],
  ['PATCH', '/api/printers/:id', 'ADMIN'],
  ['POST', '/api/locations', 'ADMIN'],
  ['PATCH', '/api/locations/:id', 'ADMIN'],
  ['PATCH', '/api/user-locations', 'ADMIN'],
  ['GET', '/api/client-errors', 'ADMIN'],
  ['*', '/api/partners/*', 'ADMIN'],
  ['*', '/api/staff/*', 'ADMIN'],
  ['*', '/api/admin/*', 'ADMIN'],
  ['*', '/api/updater/*', 'ADMIN'],
  ['*', '/api/support/*', 'ADMIN']
] as const;

interface CompiledRule {
  method: PolicyMethod;
  regex: RegExp;
  level: AccessLevel;
  pattern: string;
}

function compilePattern(pattern: string): RegExp {
  const trailingWildcard = pattern.endsWith('/*');
  const base = trailingWildcard ? pattern.slice(0, -2) : pattern;
  const source = base
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  // "/x/*" cubre "/x" y todo lo que cuelgue de "/x/"
  return new RegExp(trailingWildcard ? `^${source}(?:/.*)?$` : `^${source}/?$`);
}

const COMPILED: readonly CompiledRule[] = ROUTE_POLICY.map(([method, pattern, level]) => ({
  method,
  regex: compilePattern(pattern),
  level,
  pattern
}));

export interface ResolvedPolicy {
  level: AccessLevel;
  /** true si existe una regla explícita; false si cayó en el valor por defecto. */
  matched: boolean;
  pattern?: string;
}

export function stripQuery(rawUrl: string): string {
  const i = rawUrl.indexOf('?');
  return i === -1 ? rawUrl : rawUrl.slice(0, i);
}

export function resolveRoutePolicy(method: string, rawUrl: string): ResolvedPolicy {
  const path = stripQuery(rawUrl);
  const m = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();

  if (m === 'OPTIONS') return { level: 'PUBLIC', matched: true, pattern: 'OPTIONS' };

  const isGuarded =
    path === '/ws' || path === '/api' || path.startsWith('/api/') || path === '/qr' || path.startsWith('/qr/');
  if (!isGuarded) return { level: 'PUBLIC', matched: true, pattern: 'static' };

  for (const rule of COMPILED) {
    if ((rule.method === '*' || rule.method === m) && rule.regex.test(path)) {
      return { level: rule.level, matched: true, pattern: rule.pattern };
    }
  }
  return { level: 'ANY_SESSION', matched: false };
}

export function isRoleAllowed(level: AccessLevel, role: string): boolean {
  const allowed = ROLES_BY_LEVEL[level];
  return allowed === null ? true : allowed.includes(role);
}
