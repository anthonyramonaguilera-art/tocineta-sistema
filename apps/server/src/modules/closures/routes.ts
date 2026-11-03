import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { findAuthorizerByPin } from '../auth/authorizer-guard.js';
import { appendAuditEvent } from '../audit/audit-service.js';
import { canUserProcessPayments } from '@tocineta/shared';
import { performBlindCount, closeJornadaZ, type BlindCountInput, type UserContext } from './closures-service.js';

export const closuresRoutes: FastifyPluginAsync = async (fastify) => {
  const getUserFromRequest = (req: any, supervisorPin?: string, _body?: any): UserContext => {
    const dbCtx = getDatabaseContext();

    // Si viene un PIN supervisor/admin, validar si pertenece a un usuario autorizado (limitado por authorizer-guard)
    if (supervisorPin) {
      const key = req.user?.id ?? req.ip;
      const authorizer = findAuthorizerByPin(dbCtx.rawDb, supervisorPin, key);
      if (authorizer) {
        return { id: authorizer.id, name: authorizer.name, role: authorizer.role };
      }
    }

    const user = req.user;
    if (!user) {
      const err: any = new Error('No autenticado');
      err.statusCode = 401;
      throw err;
    }

    return {
      id: user.id,
      name: user.name,
      role: user.role,
      permissions: user.permissions || []
    };
  };

  // 1. Arqueo Ciego de Sesión de Caja (POST /api/cash-sessions/:id/blind-count)
  fastify.post('/api/cash-sessions/:id/blind-count', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as any;

    const user = getUserFromRequest(request, body.supervisorPin || body.adminPin, body);

    if (!canUserProcessPayments(user)) {
      appendAuditEvent(dbCtx.rawDb, {
        actorUserId: user.id,
        action: 'UNAUTHORIZED_PAYMENT_ATTEMPT',
        entityType: 'cash_session',
        entityId: id,
        payload: {
          role: user.role,
          url: request.url,
          method: request.method
        }
      });

      return reply.status(403).send({
        error: 'FORBIDDEN_ROLE_FOR_PAYMENT',
        message: 'Tu rol no tiene permisos para procesar cobros en caja.'
      });
    }

    let counts: Array<{ method: string; countedCents: number }> | undefined = undefined;
    if (Array.isArray(body.counts)) {
      counts = body.counts.map((c: any) => ({
        method: String(c.method || ''),
        countedCents: Math.round(Number(c.countedCents ?? c.counted_cents ?? 0))
      }));
    }

    const input: BlindCountInput = {
      cashUsdCents: body.cash_usd_cents ?? body.cashUsdCents,
      cashBsCents: body.cash_bs_cents ?? body.cashBsCents,
      ubiiVoucherBsCents: body.ubii_voucher_bs_cents ?? body.ubiiVoucherBsCents,
      notes: body.notes,
      counts,
      confirmEmpty: Boolean(body.confirmEmpty ?? body.confirm_empty ?? false)
    };

    try {
      const result = performBlindCount(dbCtx.rawDb, id, input, user);
      return reply.status(200).send(result);
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        code: err.code,
        error: err.message,
        remainingMs: err.remainingMs
      });
    }
  });

  // 2. Cierre Z de Jornada (POST /api/jornadas/:id/close)
  fastify.post('/api/jornadas/:id/close', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as any;

    const user = getUserFromRequest(request, body.adminPin || body.supervisorPin || body.pin);

    try {
      const result = closeJornadaZ(dbCtx.rawDb, id, user);
      return reply.status(200).send(result);
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        code: err.code,
        error: err.message,
        remainingMs: err.remainingMs
      });
    }
  });
};
