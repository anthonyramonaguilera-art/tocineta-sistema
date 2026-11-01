import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getDatabaseContext } from '../db/connection.js';
import { isRoleAllowed, resolveRoutePolicy, stripQuery, type AccessLevel } from '../config/route-policy.js';
import { extractSessionToken } from '../routes/auth.js';
import { getSessionUserByToken, type SessionUser } from '../modules/auth/session.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Usuario resuelto desde la sesión. null si no hay sesión válida. */
    user: SessionUser | null;
  }
}

/** Quita la query string (tokens de /ws) para que NUNCA llegue a logs ni a la base de datos. */
export function sanitizeUrl(rawUrl: string | undefined): string {
  return stripQuery(rawUrl || '');
}

/**
 * Opciones de logger seguras. Fastify NO loguea req.query, así que redactar
 * 'req.query.token' no sirve: la fuga real es req.url (con ?token=...).
 * Se combina con el logger existente en server.ts (dev con pino-pretty y prod).
 */
export const SAFE_LOGGER_REDACT = ['req.headers.authorization', 'req.headers.cookie'];

export function safeReqSerializer(req: any): Record<string, unknown> {
  return {
    method: req?.method,
    url: sanitizeUrl(req?.url),
    host: req?.headers?.host ?? req?.host,
    remoteAddress: req?.ip ?? req?.socket?.remoteAddress,
    remotePort: req?.socket?.remotePort
  };
}

/** Rutas permitidas aunque el usuario tenga must_change_pin = 1. */
const PIN_CHANGE_ALLOWLIST = new Set(['/api/auth/change-pin', '/api/auth/logout', '/api/auth/me']);

function resolveToken(request: FastifyRequest, path: string): string | null {
  const fromHeader = extractSessionToken(request.headers.authorization);
  if (fromHeader) return fromHeader;
  // Los navegadores no pueden enviar cabeceras en WebSocket: solo /ws acepta ?token=
  if (path === '/ws') {
    try {
      return new URL(request.url, 'http://localhost').searchParams.get('token');
    } catch {
      return null;
    }
  }
  return null;
}

type BlockReason = 'no-session' | 'role-denied' | 'must-change-pin';

export interface AuthGuardOptions {
  /** Fuerza el modo; por defecto lee process.env.ENFORCE_AUTH en cada petición. */
  enforce?: boolean;
}

/**
 * Registra el guard global. Llamar en buildServer ANTES de registrar las rutas.
 *  - ENFORCE_AUTH !== 'true' (modo auditoría): no bloquea; registra "auth-would-block".
 *  - ENFORCE_AUTH === 'true': responde 401 (sin sesión) o 403 (rol denegado / cambio de PIN pendiente).
 */
export function registerAuthGuard(server: FastifyInstance, options: AuthGuardOptions = {}): void {
  server.decorateRequest('user', null);

  server.addHook('onRequest', async (request, reply) => {
    const path = sanitizeUrl(request.url);
    const policy = resolveRoutePolicy(request.method, request.url);
    const token = resolveToken(request, path);

    if (token) {
      try {
        request.user = getSessionUserByToken(getDatabaseContext().rawDb, token);
      } catch {
        request.user = null;
      }
    }

    if (policy.level === 'PUBLIC') return;

    const required: AccessLevel = policy.level;
    let reason: BlockReason | null = null;
    if (!request.user) {
      reason = 'no-session';
    } else if (!isRoleAllowed(required, request.user.role)) {
      reason = 'role-denied';
    } else if (request.user.mustChangePin && !PIN_CHANGE_ALLOWLIST.has(path)) {
      reason = 'must-change-pin';
    }

    if (!reason) return;

    const enforce = options.enforce ?? process.env.ENFORCE_AUTH === 'true';
    if (!enforce) {
      request.log.warn(
        {
          evt: 'auth-would-block',
          method: request.method,
          route: request.routeOptions?.url ?? path,
          role: request.user?.role ?? 'anon',
          reason,
          required,
          unclassified: policy.matched ? undefined : true
        },
        'auth-would-block'
      );
      return;
    }

    if (reason === 'no-session') {
      return reply.status(401).send({ success: false, code: 'UNAUTHENTICATED', error: 'Sesión requerida o expirada' });
    }
    if (reason === 'must-change-pin') {
      return reply.status(403).send({ success: false, code: 'PIN_CHANGE_REQUIRED', error: 'Debe cambiar su PIN antes de continuar' });
    }
    return reply.status(403).send({ success: false, code: 'FORBIDDEN', error: 'Su rol no tiene permiso para esta acción' });
  });
}
