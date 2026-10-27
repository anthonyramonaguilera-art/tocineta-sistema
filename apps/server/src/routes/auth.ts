import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import { getDatabaseContext } from '../db/connection.js';
import {
  mapUserRow,
  mapSessionRow
} from '../db/schema.js';
import {
  verifyPin
} from '../modules/auth/pin.js';
import {
  checkUserLockout,
  recordFailedAttempt,
  resetLockout
} from '../modules/auth/lockout.js';
import { appendAuditEvent } from '../modules/audit/audit-service.js';
import { authActionsRoutes } from './auth-actions.js';

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 días persistentes (Hito M20 C.1)

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function extractSessionToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  const parts = authHeader.trim().split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return null;
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Registrar rutas complementarias de registro, desbloqueo y validación de PIN
  await fastify.register(authActionsRoutes);

  // 1. Listado público de usuarios para el teclado PIN del POS
  fastify.get('/api/auth/users-public', async (_req, reply) => {
    const dbCtx = getDatabaseContext();
    const rows = dbCtx.rawDb.prepare(`
      SELECT *
      FROM users
      WHERE is_active = 1
      ORDER BY 
        CASE role
          WHEN 'cajera' THEN 1
          WHEN 'mesonero' THEN 2
          WHEN 'supervisor' THEN 3
          WHEN 'admin' THEN 4
          WHEN 'cocinero' THEN 5
          ELSE 6
        END,
        name ASC
    `).all();

    const now = Date.now();
    const usersList = rows.map(r => {
      const u = mapUserRow(r);
      const lockCheck = checkUserLockout(u, now);
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        pinLength: u.pinLength,
        isLocked: lockCheck.isLocked,
        lockoutRemainingMs: lockCheck.remainingMs || 0
      };
    });

    return reply.status(200).send({ success: true, users: usersList });
  });

  // 2. Inicio de sesión mediante Usuario/Contraseña en texto o PIN
  fastify.post('/api/auth/login', async (request, reply) => {
    const body = request.body as { userId?: string; username?: string; pin?: string; cedula?: string; password?: string } | undefined;
    const userId = body?.userId?.trim();
    const username = body?.username?.trim();
    const pin = body?.pin?.trim();
    const cedula = body?.cedula?.trim();
    const password = body?.password?.trim();

    const identifier = username || userId || cedula;
    const credential = password || pin;

    if (!identifier) {
      return reply.status(400).send({
        success: false,
        error: 'Debe especificar usuario o identificación'
      });
    }

    if (!credential) {
      return reply.status(400).send({
        success: false,
        error: 'Debe ingresar contraseña o PIN'
      });
    }

    const dbCtx = getDatabaseContext();

    // ── GOBERNANZA ACCESO REMOTO (HITO FASE 4) ───────────────────────────────
    const proto = (request.headers['x-forwarded-proto'] as string || '').toLowerCase();
    const forwardedHost = (request.headers['x-forwarded-host'] as string || '').toLowerCase();
    const cfIp = (request.headers['cf-connecting-ip'] as string || '').trim();
    const isRemote = Boolean(
      cfIp ||
      request.headers['x-remote-access'] ||
      (forwardedHost && !forwardedHost.includes('localhost') && !forwardedHost.includes('127.0.0.1'))
    );

    if (isRemote && proto && proto !== 'https') {
      appendAuditEvent(dbCtx.rawDb, {
        actorUserId: null,
        action: 'REMOTE_ACCESS_BLOCKED',
        entityType: 'network',
        entityId: cfIp || request.ip,
        payload: { reason: 'HTTPS_REQUIRED', ip: request.ip, host: forwardedHost }
      });
      return reply.status(403).send({
        success: false,
        error: 'Acceso remoto rechazado: Se requiere conexión cifrada HTTPS exclusivamente'
      });
    }

    // Búsqueda exclusiva por username exacto, id o cédula
    const rawUser: any = dbCtx.rawDb.prepare(`
      SELECT * FROM users 
      WHERE (username IS NOT NULL AND LOWER(username) = LOWER(?))
         OR id = ?
         OR cedula = ?
      ORDER BY is_active DESC
      LIMIT 1
    `).get(identifier, identifier, identifier);

    if (!rawUser) {
      return reply.status(404).send({
        success: false,
        error: 'Usuario no encontrado o inactivo'
      });
    }

    const user = mapUserRow(rawUser);

    if (user.approvalStatus === 'PENDING') {
      return reply.status(403).send({
        error: 'ACCOUNT_PENDING_APPROVAL',
        message: 'Tu cuenta está esperando la aprobación de la administración.'
      });
    }

    if (user.approvalStatus === 'REJECTED') {
      return reply.status(403).send({
        error: 'ACCOUNT_REJECTED',
        message: 'Tu cuenta ha sido rechazada por la administración.'
      });
    }

    if (!user.isActive) {
      return reply.status(403).send({
        success: false,
        error: 'ACCOUNT_INACTIVE',
        message: 'Usuario no encontrado o inactivo'
      });
    }

    const now = Date.now();
    const lockCheck = checkUserLockout(user, now);

    if (lockCheck.isLocked) {
      const mins = Math.ceil((lockCheck.remainingMs || 0) / 60000);
      return reply.status(423).send({
        success: false,
        error: `Usuario bloqueado temporalmente por intentos fallidos. Intente de nuevo en ${mins} minuto(s).`,
        remainingMs: lockCheck.remainingMs
      });
    }

    let isCredentialValid = false;
    if (credential && user.passwordHash && user.passwordSalt) {
      const derived = crypto.scryptSync(credential, user.passwordSalt, 64).toString('hex');
      try {
        isCredentialValid = crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(user.passwordHash, 'hex'));
      } catch {
        isCredentialValid = false;
      }
    }
    if (!isCredentialValid && credential && user.pinSalt && user.pinHash) {
      isCredentialValid = verifyPin(credential, user.pinSalt, user.pinHash);
    }

    if (!isCredentialValid) {
      const failResult = recordFailedAttempt(
        dbCtx.rawDb,
        user.id,
        user.failedAttempts,
        user.lockoutStage,
        now
      );

      appendAuditEvent(dbCtx.rawDb, {
        actorUserId: user.id,
        action: isRemote ? 'REMOTE_LOGIN_FAILED' : 'AUTH_LOGIN_FAILED',
        entityType: 'user',
        entityId: user.id,
        payload: {
          failedAttempts: user.failedAttempts + 1,
          isLockedNow: failResult.isLockedNow,
          lockoutStage: failResult.lockoutStage,
          isRemote,
          remoteIp: cfIp || request.ip,
          userAgent: request.headers['user-agent']
        }
      });

      if (failResult.isLockedNow) {
        return reply.status(423).send({
          success: false,
          error: `Has superado el límite de 5 intentos fallidos. Usuario bloqueado por ${Math.ceil((failResult.lockDurationMs || 0) / 60000)} minuto(s).`,
          lockedUntilMs: failResult.lockedUntilMs
        });
      }

      return reply.status(401).send({
        success: false,
        error: `Credenciales incorrectas. Le quedan ${failResult.remainingAttemptsBeforeLock} intento(s) antes del bloqueo.`,
        remainingAttempts: failResult.remainingAttemptsBeforeLock
      });
    }

    // Resetear bloqueo
    resetLockout(dbCtx.rawDb, user.id, now);

    const REMOTE_SESSION_TTL_MS = 2 * 3600 * 1000;
    const effectiveTtlMs = isRemote ? REMOTE_SESSION_TTL_MS : SESSION_TTL_MS;
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const sessionId = `ses_${crypto.randomBytes(16).toString('hex')}`;
    const expiresAtMs = now + effectiveTtlMs;

    dbCtx.rawDb.prepare(`
      INSERT INTO sessions (
        id, user_id, token_hash, role, created_at_ms,
        expires_at_ms, last_activity_ms, sensitive_unlocked_until_ms, revoked_at_ms
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, NULL, NULL
      )
    `).run(sessionId, user.id, tokenHash, user.role, now, expiresAtMs, now);

    appendAuditEvent(dbCtx.rawDb, {
      actorUserId: user.id,
      action: isRemote ? 'REMOTE_LOGIN_SUCCESS' : 'AUTH_LOGIN_SUCCESS',
      entityType: 'session',
      entityId: sessionId,
      payload: {
        role: user.role,
        isRemote,
        sessionTtlHours: isRemote ? 2 : 720,
        remoteIp: cfIp || request.ip,
        userAgent: request.headers['user-agent']
      }
    });

    let permissions: string[] = [];
    try {
      permissions = JSON.parse(user.permissionsJson || '[]');
    } catch {}

    return reply.status(200).send({
      success: true,
      token: rawToken,
      isRemote: Boolean(isRemote),
      mustChangePin: Boolean(user.mustChangePin),
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        cedula: user.cedula,
        approvalStatus: user.approvalStatus,
        permissions,
        mustChangePin: Boolean(user.mustChangePin)
      }
    });
  });

  // 3. Cierre de sesión (Logout)
  fastify.post('/api/auth/logout', async (request, reply) => {
    const rawToken = extractSessionToken(request.headers.authorization);
    if (!rawToken) {
      return reply.status(200).send({ success: true });
    }

    const tokenHash = hashToken(rawToken);
    const dbCtx = getDatabaseContext();
    const now = Date.now();

    const rawSession = dbCtx.rawDb.prepare(`
      SELECT * FROM sessions WHERE token_hash = ? AND revoked_at_ms IS NULL
    `).get(tokenHash);

    if (rawSession) {
      const session = mapSessionRow(rawSession);
      dbCtx.rawDb.prepare(`
        UPDATE sessions SET revoked_at_ms = ? WHERE id = ?
      `).run(now, session.id);

      appendAuditEvent(dbCtx.rawDb, {
        actorUserId: session.userId,
        action: 'AUTH_LOGOUT',
        entityType: 'session',
        entityId: session.id,
        payload: {}
      });
    }

    return reply.status(200).send({ success: true });
  });

  // 4. Datos del usuario autenticado actual (Me)
  fastify.get('/api/auth/me', async (request, reply) => {
    const rawToken = extractSessionToken(request.headers.authorization);
    if (!rawToken) {
      return reply.status(401).send({ success: false, error: 'Token no proporcionado' });
    }

    const tokenHash = hashToken(rawToken);
    const dbCtx = getDatabaseContext();
    const now = Date.now();

    const rawSession = dbCtx.rawDb.prepare(`
      SELECT s.*, u.name, u.cedula, u.phone, u.must_change_pin, u.is_active, u.approval_status, u.permissions_json
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL AND s.expires_at_ms > ?
    `).get(tokenHash, now) as any;

    if (!rawSession || !rawSession.is_active) {
      return reply.status(401).send({ success: false, error: 'Sesión inválida o expirada' });
    }

    const session = mapSessionRow(rawSession);

    let permissions: string[] = [];
    try {
      permissions = JSON.parse(rawSession.permissions_json || '[]');
    } catch {}

    return reply.status(200).send({
      success: true,
      user: {
        id: session.userId,
        name: rawSession.name,
        role: session.role,
        cedula: rawSession.cedula,
        phone: rawSession.phone,
        approvalStatus: rawSession.approval_status,
        permissions,
        mustChangePin: Boolean(rawSession.must_change_pin)
      },
      session: {
        id: session.id,
        createdAtMs: session.createdAtMs,
        expiresAtMs: session.expiresAtMs
      }
    });
  });
};
