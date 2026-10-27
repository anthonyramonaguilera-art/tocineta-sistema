import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import { getDatabaseContext } from '../db/connection.js';
import { mapUserRow, mapSessionRow, type UserRole } from '../db/schema.js';
import { hashPin, verifyPin, validatePinFormat } from '../modules/auth/pin.js';
import { checkUserLockout, recordFailedAttempt, resetLockout } from '../modules/auth/lockout.js';
import { appendAuditEvent } from '../modules/audit/audit-service.js';
import { publishDomainEvent } from '../modules/events/event-bus.js';
import { generateUuidV7 } from '@tocineta/shared';
import { extractSessionToken, hashToken } from './auth.js';

export const authActionsRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. Auto-registro de nuevos trabajadores (Hito M20 C.2)
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

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = password ? crypto.scryptSync(password, salt, 64).toString('hex') : null;

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

  // 2. Verificación de PIN para acciones sensibles (Autorización de supervisor/admin)
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
    const rawAuthorizer = dbCtx.rawDb.prepare(`SELECT * FROM users WHERE id = ?`).get(body.authorizerUserId);

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

  // 3. Desbloqueo manual de usuarios por Supervisor o Admin
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

  // 4. Cambio de PIN
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
};
