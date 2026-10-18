import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import { getDatabaseContext } from '../db/connection.js';
import {
  type UserRole,
  mapUserRow,
  mapSessionRow
} from '../db/schema.js';
import {
  hashPin,
  verifyPin,
  validatePinFormat
} from '../modules/auth/pin.js';
import {
  checkUserLockout,
  recordFailedAttempt,
  resetLockout
} from '../modules/auth/lockout.js';
import { appendAuditEvent } from '../modules/audit/audit-service.js';

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

  // 2. Inicio de sesión mediante PIN
  fastify.post('/api/auth/login', async (request, reply) => {
    const body = request.body as { userId?: string; pin?: string } | undefined;
    const userId = body?.userId?.trim();
    const pin = body?.pin?.trim();

    if (!userId || !pin) {
      return reply.status(400).send({
        success: false,
        error: 'Debe especificar userId y pin'
      });
    }

    const dbCtx = getDatabaseContext();
    const rawUser = dbCtx.rawDb.prepare(`
      SELECT * FROM users WHERE id = ?
    `).get(userId);

    if (!rawUser) {
      return reply.status(404).send({
        success: false,
        error: 'Usuario no encontrado o inactivo'
      });
    }

    const user = mapUserRow(rawUser);

    if (!user.isActive) {
      return reply.status(404).send({
        success: false,
        error: 'Usuario no encontrado o inactivo'
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

    const isPinValid = verifyPin(pin, user.pinSalt, user.pinHash);

    if (!isPinValid) {
      const failResult = recordFailedAttempt(
        dbCtx.rawDb,
        user.id,
        user.failedAttempts,
        user.lockoutStage,
        now
      );

      appendAuditEvent(dbCtx.rawDb, {
        actorUserId: user.id,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'user',
        entityId: user.id,
        payload: {
          failedAttempts: user.failedAttempts + 1,
          isLockedNow: failResult.isLockedNow,
          lockoutStage: failResult.lockoutStage
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
        error: `PIN incorrecto. Le quedan ${failResult.remainingAttemptsBeforeLock} intento(s) antes del bloqueo.`,
        remainingAttempts: failResult.remainingAttemptsBeforeLock
      });
    }

    // PIN correcto: Resetear intentos fallidos
    resetLockout(dbCtx.rawDb, user.id, now);

    // Crear nueva sesión con token criptográfico
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const sessionId = `ses_${crypto.randomBytes(16).toString('hex')}`;
    const expiresAtMs = now + 24 * 3600 * 1000; // 24 horas

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
      action: 'AUTH_LOGIN_SUCCESS',
      entityType: 'session',
      entityId: sessionId,
      payload: { role: user.role }
    });

    return reply.status(200).send({
      success: true,
      token: rawToken,
      mustChangePin: Boolean(user.mustChangePin),
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
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
      SELECT s.*, u.name, u.must_change_pin, u.is_active
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL AND s.expires_at_ms > ?
    `).get(tokenHash, now) as any;

    if (!rawSession || !rawSession.is_active) {
      return reply.status(401).send({ success: false, error: 'Sesión inválida o expirada' });
    }

    const session = mapSessionRow(rawSession);

    return reply.status(200).send({
      success: true,
      user: {
        id: session.userId,
        name: rawSession.name,
        role: session.role,
        mustChangePin: Boolean(rawSession.must_change_pin)
      },
      session: {
        id: session.id,
        createdAtMs: session.createdAtMs,
        expiresAtMs: session.expiresAtMs
      }
    });
  });

  // 5. Verificación de PIN para acciones sensibles (Autorización de supervisor/admin)
  fastify.post('/api/auth/verify-action-pin', async (request, reply) => {
    const body = request.body as {
      authorizerUserId?: string;
      pin?: string;
      action?: string;
      entityType?: string;
      entityId?: string;
    } | undefined;

    if (!body?.authorizerUserId || !body?.pin || !body?.action) {
      return reply.status(400).send({
        success: false,
        error: 'Debe especificar authorizerUserId, pin y action'
      });
    }

    const dbCtx = getDatabaseContext();
    const rawAuthorizer = dbCtx.rawDb.prepare(`
      SELECT * FROM users WHERE id = ?
    `).get(body.authorizerUserId);

    if (!rawAuthorizer) {
      return reply.status(404).send({ success: false, error: 'Usuario autorizador no encontrado' });
    }

    const authorizer = mapUserRow(rawAuthorizer);

    if (!authorizer.isActive) {
      return reply.status(404).send({ success: false, error: 'Usuario autorizador no encontrado' });
    }

    if (authorizer.role !== 'admin' && authorizer.role !== 'supervisor') {
      return reply.status(403).send({
        success: false,
        error: 'Solo supervisores o administradores pueden autorizar esta acción'
      });
    }

    const now = Date.now();
    const lockCheck = checkUserLockout(authorizer, now);
    if (lockCheck.isLocked) {
      return reply.status(423).send({
        success: false,
        error: 'El usuario autorizador se encuentra bloqueado temporalmente por intentos fallidos'
      });
    }

    const valid = verifyPin(body.pin, authorizer.pinSalt, authorizer.pinHash);
    if (!valid) {
      recordFailedAttempt(dbCtx.rawDb, authorizer.id, authorizer.failedAttempts, authorizer.lockoutStage, now);
      return reply.status(401).send({ success: false, error: 'PIN de autorización inválido' });
    }

    resetLockout(dbCtx.rawDb, authorizer.id, now);

    appendAuditEvent(dbCtx.rawDb, {
      authorizerUserId: authorizer.id,
      action: `AUTHORIZE_ACTION_${body.action.toUpperCase()}`,
      entityType: body.entityType || 'action',
      entityId: body.entityId || 'auth_action',
      payload: { action: body.action }
    });

    return reply.status(200).send({
      success: true,
      authorizedBy: {
        id: authorizer.id,
        name: authorizer.name,
        role: authorizer.role
      }
    });
  });

  // 6. Desbloqueo manual de usuarios por Supervisor o Admin
  fastify.post('/api/auth/unlock-user', async (request, reply) => {
    const body = request.body as {
      authorizerUserId?: string;
      authorizerPin?: string;
      targetUserId?: string;
    } | undefined;

    if (!body?.authorizerUserId || !body?.authorizerPin || !body?.targetUserId) {
      return reply.status(400).send({
        success: false,
        error: 'Debe especificar authorizerUserId, authorizerPin y targetUserId'
      });
    }

    const dbCtx = getDatabaseContext();
    const rawAuthorizer = dbCtx.rawDb.prepare(`SELECT * FROM users WHERE id = ?`).get(body.authorizerUserId);

    if (!rawAuthorizer) {
      return reply.status(403).send({
        success: false,
        error: 'Permiso denegado: solo un supervisor o administrador puede desbloquear usuarios'
      });
    }

    const authorizer = mapUserRow(rawAuthorizer);

    if (authorizer.role !== 'admin' && authorizer.role !== 'supervisor') {
      return reply.status(403).send({
        success: false,
        error: 'Permiso denegado: solo un supervisor o administrador puede desbloquear usuarios'
      });
    }

    if (!verifyPin(body.authorizerPin, authorizer.pinSalt, authorizer.pinHash)) {
      return reply.status(401).send({ success: false, error: 'PIN del autorizador inválido' });
    }

    const rawTargetUser = dbCtx.rawDb.prepare(`SELECT * FROM users WHERE id = ?`).get(body.targetUserId);
    if (!rawTargetUser) {
      return reply.status(404).send({ success: false, error: 'Usuario a desbloquear no encontrado' });
    }

    const targetUser = mapUserRow(rawTargetUser);
    resetLockout(dbCtx.rawDb, targetUser.id);

    appendAuditEvent(dbCtx.rawDb, {
      actorUserId: authorizer.id,
      authorizerUserId: authorizer.id,
      action: 'USER_UNLOCKED_MANUALLY',
      entityType: 'user',
      entityId: targetUser.id,
      payload: { targetUserName: targetUser.name }
    });

    return reply.status(200).send({
      success: true,
      message: `El usuario '${targetUser.name}' ha sido desbloqueado exitosamente.`
    });
  });

  // 7. Cambio de PIN
  fastify.post('/api/auth/change-pin', async (request, reply) => {
    const rawToken = extractSessionToken(request.headers.authorization);
    if (!rawToken) {
      return reply.status(401).send({ success: false, error: 'Token no proporcionado' });
    }

    const body = request.body as { currentPin?: string; newPin?: string } | undefined;
    if (!body?.currentPin || !body?.newPin) {
      return reply.status(400).send({ success: false, error: 'Debe proporcionar currentPin y newPin' });
    }

    const tokenHash = hashToken(rawToken);
    const dbCtx = getDatabaseContext();
    const rawSession = dbCtx.rawDb.prepare(`
      SELECT s.*, u.pin_hash, u.pin_salt, u.role
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL
    `).get(tokenHash) as any;

    if (!rawSession) {
      return reply.status(401).send({ success: false, error: 'Sesión no válida' });
    }

    const session = mapSessionRow(rawSession);
    const pinSalt = rawSession.pin_salt;
    const pinHash = rawSession.pin_hash;
    const userRole = rawSession.role as UserRole;

    if (!verifyPin(body.currentPin, pinSalt, pinHash)) {
      return reply.status(401).send({ success: false, error: 'El PIN actual es incorrecto' });
    }

    const formatCheck = validatePinFormat(body.newPin, userRole);
    if (!formatCheck.valid) {
      return reply.status(400).send({ success: false, error: formatCheck.error });
    }

    const { hash: newHash, salt: newSalt } = hashPin(body.newPin);
    const now = Date.now();

    dbCtx.rawDb.prepare(`
      UPDATE users 
      SET pin_hash = ?, pin_salt = ?, pin_length = ?, must_change_pin = 0, updated_at_ms = ?
      WHERE id = ?
    `).run(newHash, newSalt, body.newPin.length, now, session.userId);

    appendAuditEvent(dbCtx.rawDb, {
      actorUserId: session.userId,
      action: 'USER_PIN_CHANGED',
      entityType: 'user',
      entityId: session.userId,
      payload: {}
    });

    return reply.status(200).send({
      success: true,
      message: 'PIN actualizado exitosamente'
    });
  });

  // 8. Admin: Listado completo de usuarios
  fastify.get('/api/admin/users', async (request, reply) => {
    const rawToken = extractSessionToken(request.headers.authorization);
    if (!rawToken) {
      return reply.status(401).send({ success: false, error: 'Token no proporcionado' });
    }

    const tokenHash = hashToken(rawToken);
    const dbCtx = getDatabaseContext();
    const now = Date.now();

    const rawSession = dbCtx.rawDb.prepare(`
      SELECT s.*, u.role as user_role
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL AND s.expires_at_ms > ?
    `).get(tokenHash, now) as any;

    if (!rawSession || (rawSession.user_role !== 'admin' && rawSession.user_role !== 'supervisor')) {
      return reply.status(403).send({ success: false, error: 'Acceso restringido a administradores y supervisores' });
    }

    const rawUsers = dbCtx.rawDb.prepare(`
      SELECT *
      FROM users
      ORDER BY name ASC
    `).all();

    const users = rawUsers.map(r => {
      const u = mapUserRow(r);
      const { pinHash, pinSalt, ...rest } = u;
      return rest;
    });

    return reply.status(200).send({ success: true, users });
  });

  // 9. Admin: Crear nuevo usuario
  fastify.post('/api/admin/users', async (request, reply) => {
    const rawToken = extractSessionToken(request.headers.authorization);
    if (!rawToken) {
      return reply.status(401).send({ success: false, error: 'Token no proporcionado' });
    }

    const tokenHash = hashToken(rawToken);
    const dbCtx = getDatabaseContext();
    const now = Date.now();

    const rawSession = dbCtx.rawDb.prepare(`
      SELECT s.*, u.role as user_role
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL AND s.expires_at_ms > ?
    `).get(tokenHash, now) as any;

    if (!rawSession || rawSession.user_role !== 'admin') {
      return reply.status(403).send({ success: false, error: 'Acceso restringido a administradores' });
    }

    const body = request.body as { name?: string; role?: UserRole; pin?: string } | undefined;
    if (!body?.name || !body?.role || !body?.pin) {
      return reply.status(400).send({ success: false, error: 'Debe proporcionar name, role y pin' });
    }

    const formatCheck = validatePinFormat(body.pin, body.role);
    if (!formatCheck.valid) {
      return reply.status(400).send({ success: false, error: formatCheck.error });
    }

    const { hash, salt } = hashPin(body.pin);
    const newUserId = `usr_${crypto.randomBytes(8).toString('hex')}`;

    dbCtx.rawDb.prepare(`
      INSERT INTO users (
        id, name, role, pin_hash, pin_salt, pin_length,
        must_change_pin, is_active, failed_attempts, lockout_stage,
        locked_until_ms, created_at_ms, updated_at_ms
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        1, 1, 0, 0,
        NULL, ?, ?
      )
    `).run(newUserId, body.name.trim(), body.role, hash, salt, body.pin.length, now, now);

    appendAuditEvent(dbCtx.rawDb, {
      actorUserId: rawSession.user_id,
      action: 'ADMIN_CREATE_USER',
      entityType: 'user',
      entityId: newUserId,
      payload: { name: body.name.trim(), role: body.role }
    });

    return reply.status(201).send({
      success: true,
      user: {
        id: newUserId,
        name: body.name.trim(),
        role: body.role
      }
    });
  });
};
