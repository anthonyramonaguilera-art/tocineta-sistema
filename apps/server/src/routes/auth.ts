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
import { publishDomainEvent } from '../modules/events/event-bus.js';
import { generateUuidV7 } from '@tocineta/shared';

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

  // 1.1 Auto-registro de nuevos trabajadores (Hito M20 C.2)
  fastify.post('/api/auth/register', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = request.body as {
      name?: string;
      cedula?: string;
      phone?: string;
      password?: string;
      pin?: string;
    } | undefined;

    const name = body?.name?.trim();
    const cedula = body?.cedula?.trim() || null;
    const phone = body?.phone?.trim() || null;
    const password = body?.password?.trim() || '';
    const pin = body?.pin?.trim() || '';

    if (!name || (!password && !pin)) {
      return reply.status(400).send({
        success: false,
        error: 'Debe especificar su nombre completo y una contraseña o PIN'
      });
    }

    if (cedula) {
      const existing = dbCtx.rawDb.prepare('SELECT id FROM users WHERE cedula = ?').get(cedula) as any;
      if (existing) {
        return reply.status(409).send({
          success: false,
          error: `Ya existe un registro con la cédula ${cedula}`
        });
      }
    }

    const now = Date.now();
    const newUserId = `usr_${generateUuidV7()}`;

    // Hashear contraseña con scrypt
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = password ? crypto.scryptSync(password, salt, 64).toString('hex') : null;

    // PIN: si se proporcionó un PIN de 4 dígitos usarlo, sino derivar de password o cédula
    let effectivePin = '0000';
    if (pin && /^\d{4}$/.test(pin)) {
      effectivePin = pin;
    } else if (password && /^\d{4}$/.test(password)) {
      effectivePin = password;
    } else if (cedula && /\d{4}$/.test(cedula)) {
      effectivePin = cedula.slice(-4);
    }
    const { hash: pinHash, salt: pinSalt } = hashPin(effectivePin);

    dbCtx.rawDb.prepare(`
      INSERT INTO users (
        id, name, cedula, phone, role, password_hash, password_salt,
        pin_hash, pin_salt, pin_length, approval_status, is_active,
        must_change_pin, failed_attempts, lockout_stage, permissions_json,
        created_at_ms, updated_at_ms
      ) VALUES (
        ?, ?, ?, ?, 'mesonero', ?, ?,
        ?, ?, 4, 'PENDING', 0,
        0, 0, 0, '[]',
        ?, ?
      )
    `).run(
      newUserId,
      name,
      cedula,
      phone,
      passwordHash,
      salt,
      pinHash,
      pinSalt,
      now,
      now
    );

    appendAuditEvent(dbCtx.rawDb, {
      actorUserId: null,
      action: 'STAFF_REGISTERED',
      entityType: 'user',
      entityId: newUserId,
      payload: { name, cedula, phone, approvalStatus: 'PENDING' }
    });

    publishDomainEvent(dbCtx.rawDb, {
      eventType: 'NEW_STAFF_REQUEST',
      entityId: newUserId,
      payload: { userId: newUserId, name, cedula, phone }
    });

    return reply.status(201).send({
      success: true,
      message: 'Solicitud de registro enviada. Esperando aprobación de la administración.',
      userId: newUserId
    });
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

    // 1. En acceso remoto: exclusivamente HTTPS
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

    // Búsqueda exclusiva por username exacto (insensible a mayúsculas), id o cédula (nunca por nombre ni rol)
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

    // Verificación de estado de aprobación
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
    // 1. Probar contra password_hash si existe
    if (credential && user.passwordHash && user.passwordSalt) {
      const derived = crypto.scryptSync(credential, user.passwordSalt, 64).toString('hex');
      try {
        isCredentialValid = crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(user.passwordHash, 'hex'));
      } catch {
        isCredentialValid = false;
      }
    }
    // 2. Si no es válido o no tiene passwordHash, probar contra pinHash con verifyPin
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

    // Credenciales correctas: Resetear intentos fallidos
    resetLockout(dbCtx.rawDb, user.id, now);

    // En acceso remoto: sesión corta de 2 horas (vs 30 días persistentes para dispositivos locales del Food Truck)
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

    const users = (rawUsers as any[]).map((r: any) => {
      const u = mapUserRow(r);
      const { pinHash, pinSalt, ...rest } = u;
      return {
        ...rest,
        permissions: JSON.parse(r.permissions_json || '[]')
      };
    });

    return reply.status(200).send({ success: true, users, staff: users });
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

  // 10. Aprobar trabajador (PATCH /api/admin/users/:id/approve) - Hito M20 C.3
  fastify.patch('/api/admin/users/:id/approve', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { role?: string; permissions?: string[] };

    const rawToken = extractSessionToken(request.headers.authorization);
    let actingUserId: string | null = null;
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      const session = dbCtx.rawDb.prepare(`
        SELECT s.user_id, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL
      `).get(tokenHash) as { user_id: string; role: string } | undefined;
      if (session) {
        actingUserId = session.user_id;
        if (session.role !== 'admin' && session.role !== 'supervisor') {
          return reply.status(403).send({ error: 'FORBIDDEN', message: 'Solo la administración puede aprobar trabajadores.' });
        }
      }
    }

    const targetUser = dbCtx.rawDb.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!targetUser) {
      return reply.status(404).send({ error: 'Usuario no encontrado' });
    }

    const newRole = body.role || targetUser.role || 'mesonero';
    const permissions = Array.isArray(body.permissions) ? body.permissions : [];
    const permissionsJson = JSON.stringify(permissions);
    const now = Date.now();

    dbCtx.rawDb.prepare(`
      UPDATE users
      SET approval_status = 'APPROVED',
          is_active = 1,
          role = ?,
          permissions_json = ?,
          updated_at_ms = ?
      WHERE id = ?
    `).run(newRole, permissionsJson, now, id);

    appendAuditEvent(dbCtx.rawDb, {
      actorUserId: actingUserId,
      action: 'USER_APPROVED',
      entityType: 'user',
      entityId: id,
      payload: { role: newRole, permissions, approvedBy: actingUserId }
    });

    publishDomainEvent(dbCtx.rawDb, {
      eventType: 'STAFF_PERMISSIONS_UPDATED',
      entityId: id,
      payload: { userId: id, approvalStatus: 'APPROVED', role: newRole, permissions }
    });

    const updated = dbCtx.rawDb.prepare('SELECT id, name, role, cedula, phone, approval_status, is_active, permissions_json FROM users WHERE id = ?').get(id) as any;

    return reply.status(200).send({
      success: true,
      user: {
        ...updated,
        permissions: JSON.parse(updated.permissions_json || '[]')
      }
    });
  });

  // 11. Modificar permisos de trabajador (PATCH /api/admin/users/:id/permissions) - Hito M20 C.3
  fastify.patch('/api/admin/users/:id/permissions', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { permissions: string[]; role?: string };

    const rawToken = extractSessionToken(request.headers.authorization);
    let actingUserId: string | null = null;
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      const session = dbCtx.rawDb.prepare(`
        SELECT s.user_id, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL
      `).get(tokenHash) as { user_id: string; role: string } | undefined;
      if (session) {
        actingUserId = session.user_id;
        if (session.role !== 'admin' && session.role !== 'supervisor') {
          return reply.status(403).send({ error: 'FORBIDDEN', message: 'Solo la administración puede modificar permisos.' });
        }
      }
    }

    const targetUser = dbCtx.rawDb.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!targetUser) {
      return reply.status(404).send({ error: 'Usuario no encontrado' });
    }

    const permissions = Array.isArray(body.permissions) ? body.permissions : [];
    const permissionsJson = JSON.stringify(permissions);
    const newRole = body.role || targetUser.role;
    const now = Date.now();

    dbCtx.rawDb.prepare(`
      UPDATE users
      SET permissions_json = ?,
          role = ?,
          updated_at_ms = ?
      WHERE id = ?
    `).run(permissionsJson, newRole, now, id);

    appendAuditEvent(dbCtx.rawDb, {
      actorUserId: actingUserId,
      action: 'USER_PERMISSIONS_UPDATED',
      entityType: 'user',
      entityId: id,
      payload: { role: newRole, permissions, updatedBy: actingUserId }
    });

    publishDomainEvent(dbCtx.rawDb, {
      eventType: 'STAFF_PERMISSIONS_UPDATED',
      entityId: id,
      payload: { userId: id, role: newRole, permissions }
    });

    const updated = dbCtx.rawDb.prepare('SELECT id, name, role, cedula, phone, approval_status, is_active, permissions_json FROM users WHERE id = ?').get(id) as any;

    return reply.status(200).send({
      success: true,
      user: {
        ...updated,
        permissions: JSON.parse(updated.permissions_json || '[]')
      }
    });
  });

  // 12. Modificar rol de trabajador (PATCH /api/admin/users/:id/role)
  fastify.patch('/api/admin/users/:id/role', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { role: string };

    const rawToken = extractSessionToken(request.headers.authorization);
    let actingUserId: string | null = null;
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      const session = dbCtx.rawDb.prepare(`
        SELECT s.user_id, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL
      `).get(tokenHash) as { user_id: string; role: string } | undefined;
      if (session) {
        actingUserId = session.user_id;
        if (session.role !== 'admin' && session.role !== 'supervisor') {
          return reply.status(403).send({ error: 'FORBIDDEN', message: 'Solo la administración puede cambiar roles.' });
        }
      }
    }

    const targetUser = dbCtx.rawDb.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!targetUser) {
      return reply.status(404).send({ error: 'Usuario no encontrado' });
    }

    if ((targetUser.id === 'usr_admin' || targetUser.role === 'admin') && body.role !== 'admin') {
      return reply.status(400).send({ error: 'No se puede cambiar el rol del Administrador principal' });
    }

    const validRoles = ['admin', 'supervisor', 'cajera', 'mesonero', 'cocinero', 'despachador'];
    if (!validRoles.includes(body.role)) {
      return reply.status(400).send({ error: 'Rol no válido' });
    }

    dbCtx.rawDb.prepare('UPDATE users SET role = ?, updated_at_ms = ? WHERE id = ?').run(body.role, Date.now(), id);

    appendAuditEvent(dbCtx.rawDb, {
      actorUserId: actingUserId,
      action: 'USER_ROLE_UPDATED',
      entityType: 'user',
      entityId: id,
      payload: { previousRole: targetUser.role, newRole: body.role }
    });

    return reply.status(200).send({ success: true, role: body.role });
  });

  // 13. Eliminar / Dar de baja trabajador (DELETE /api/admin/users/:id)
  fastify.delete('/api/admin/users/:id', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };

    const rawToken = extractSessionToken(request.headers.authorization);
    let actingUserId: string | null = null;
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      const session = dbCtx.rawDb.prepare(`
        SELECT s.user_id, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL
      `).get(tokenHash) as { user_id: string; role: string } | undefined;
      if (session) {
        actingUserId = session.user_id;
        if (session.role !== 'admin' && session.role !== 'supervisor') {
          return reply.status(403).send({ error: 'FORBIDDEN', message: 'Solo la administración puede eliminar personal.' });
        }
      }
    }

    const targetUser = dbCtx.rawDb.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!targetUser) {
      return reply.status(404).send({ error: 'Usuario no encontrado' });
    }

    // Impedir borrar al administrador principal
    if (targetUser.id === 'usr_admin' || targetUser.role === 'admin') {
      return reply.status(400).send({
        success: false,
        error: 'No se puede eliminar al Administrador principal'
      });
    }

    const now = Date.now();
    // Revocar sesiones activas
    dbCtx.rawDb.prepare('UPDATE sessions SET revoked_at_ms = ? WHERE user_id = ?').run(now, id);

    try {
      dbCtx.rawDb.prepare('DELETE FROM users WHERE id = ?').run(id);
    } catch {
      // Si falla por constraints (audit_events, orders, etc.), desactivar de forma segura
      dbCtx.rawDb.prepare('UPDATE users SET is_active = 0, approval_status = \'REJECTED\', updated_at_ms = ? WHERE id = ?').run(now, id);
    }

    appendAuditEvent(dbCtx.rawDb, {
      actorUserId: actingUserId,
      action: 'USER_DELETED',
      entityType: 'user',
      entityId: id,
      payload: { deletedUserId: id, name: targetUser.name, role: targetUser.role }
    });

    return reply.status(200).send({
      success: true,
      message: `Usuario ${targetUser.name} dado de baja exitosamente`
    });
  });
};
