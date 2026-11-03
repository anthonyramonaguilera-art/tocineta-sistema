import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import path from 'node:path';
import { getDatabaseContext } from '../db/connection.js';
import { mapUserRow, mapSessionRow, type UserRole } from '../db/schema.js';
import { hashPin, verifyPin, validatePinFormat, isTrivialPin } from '../modules/auth/pin.js';
import { deleteAdminInitialFileIfExists, hashPassword } from '../modules/auth/seed-users.js';
import { resetLockout } from '../modules/auth/lockout.js';
import { assertAuthorizerAttemptAllowed, findAuthorizerByPin } from '../modules/auth/authorizer-guard.js';
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
    const pin = typeof body?.pin === 'string' ? body.pin.trim() : (typeof body?.pin === 'number' ? String(body.pin).trim() : '');

    if (!name) {
      return reply.status(400).send({
        success: false,
        error: 'Debe especificar su nombre completo'
      });
    }

    if (!pin) {
      return reply.status(400).send({
        success: false,
        error: 'Debe especificar un PIN de 4 dígitos'
      });
    }

    const pinFormat = validatePinFormat(pin, 'mesonero');
    if (!pinFormat.valid) {
      return reply.status(400).send({
        success: false,
        error: pinFormat.error || 'El PIN debe ser un valor numérico de 4 dígitos'
      });
    }

    if (isTrivialPin(pin)) {
      return reply.status(400).send({
        success: false,
        error: 'El PIN no puede ser trivial ni predecible (evite números consecutivos o repetidos)'
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

    const { hash: pinHash, salt: pinSalt } = hashPin(pin);

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

    const key = (request as any).user?.id ?? request.ip;
    try {
      assertAuthorizerAttemptAllowed(key);
    } catch (err: any) {
      return reply.status(err.statusCode || 423).send({
        success: false,
        code: err.code || 'AUTHORIZER_LOCKED',
        error: err.message,
        remainingMs: err.remainingMs
      });
    }

    const dbCtx = getDatabaseContext();
    const authorizer = findAuthorizerByPin(dbCtx.rawDb, body.pin, key, Date.now(), body.authorizerUserId);
    if (!authorizer) {
      const rawAuthorizer = dbCtx.rawDb.prepare(`SELECT * FROM users WHERE id = ?`).get(body.authorizerUserId);
      if (!rawAuthorizer || !(rawAuthorizer as any).is_active) {
        return reply.status(404).send({ success: false, error: 'Usuario autorizador no encontrado' });
      }
      if ((rawAuthorizer as any).role !== 'admin' && (rawAuthorizer as any).role !== 'supervisor') {
        return reply.status(403).send({
          success: false,
          error: 'Solo supervisores o administradores pueden autorizar esta acción'
        });
      }
      return reply.status(401).send({ success: false, error: 'PIN de autorización inválido' });
    }

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

    const key = request.ip;
    try {
      assertAuthorizerAttemptAllowed(key);
    } catch (err: any) {
      return reply.status(err.statusCode || 423).send({
        success: false,
        code: err.code || 'AUTHORIZER_LOCKED',
        error: err.message,
        remainingMs: err.remainingMs
      });
    }

    const dbCtx = getDatabaseContext();
    const authorizer = findAuthorizerByPin(dbCtx.rawDb, body.authorizerPin, key, Date.now(), body.authorizerUserId);
    if (!authorizer) {
      const rawAuthorizer = dbCtx.rawDb.prepare(`SELECT * FROM users WHERE id = ?`).get(body.authorizerUserId);
      if (!rawAuthorizer || !(rawAuthorizer as any).is_active || ((rawAuthorizer as any).role !== 'admin' && (rawAuthorizer as any).role !== 'supervisor')) {
        return reply.status(403).send({
          success: false,
          error: 'Permiso denegado: solo un supervisor o administrador puede desbloquear usuarios'
        });
      }
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

    const body = request.body as { currentPin?: string; newPin?: string; newPassword?: string; password?: string } | undefined;
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

    if (userRole === 'admin' && isTrivialPin(body.newPin)) {
      return reply.status(400).send({
        success: false,
        error: 'El PIN de administrador no puede ser una secuencia numérica ni dígitos repetidos'
      });
    }

    const newPin = body.newPin;
    const { hash: newHash, salt: newSalt } = hashPin(newPin);
    const now = Date.now();

    const candidatePassword = body.newPassword?.trim() || body.password?.trim();
    let pwHash: string | null = null;
    let pwSalt: string | null = null;
    if (candidatePassword) {
      const hashedPw = hashPassword(candidatePassword);
      pwHash = hashedPw.hash;
      pwSalt = hashedPw.salt;
    }

    const updateTx = dbCtx.rawDb.transaction(() => {
      if (pwHash && pwSalt) {
        dbCtx.rawDb.prepare(`
          UPDATE users 
          SET pin_hash = ?, pin_salt = ?, pin_length = ?, password_hash = ?, password_salt = ?, must_change_pin = 0, updated_at_ms = ?
          WHERE id = ?
        `).run(newHash, newSalt, newPin.length, pwHash, pwSalt, now, session.userId);
      } else {
        dbCtx.rawDb.prepare(`
          UPDATE users 
          SET pin_hash = ?, pin_salt = ?, pin_length = ?, must_change_pin = 0, updated_at_ms = ?
          WHERE id = ?
        `).run(newHash, newSalt, newPin.length, now, session.userId);
      }

      appendAuditEvent(dbCtx.rawDb, {
        actorUserId: session.userId,
        action: 'USER_PIN_CHANGED',
        entityType: 'user',
        entityId: session.userId,
        payload: { changedPassword: Boolean(pwHash) }
      });
    });

    updateTx();

    const dbDir = (dbCtx.rawDb.name && dbCtx.rawDb.name !== '' && dbCtx.rawDb.name !== ':memory:')
      ? path.dirname(path.resolve(dbCtx.rawDb.name))
      : undefined;
    deleteAdminInitialFileIfExists(dbDir);

    return reply.status(200).send({
      success: true,
      message: 'PIN actualizado exitosamente'
    });
  });
};
