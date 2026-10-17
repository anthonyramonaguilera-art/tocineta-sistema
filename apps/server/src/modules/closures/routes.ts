import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import { verifyPin } from '../auth/pin.js';
import { performBlindCount, closeJornadaZ, type BlindCountInput, type UserContext } from './closures-service.js';

export const closuresRoutes: FastifyPluginAsync = async (fastify) => {
  const getUserFromRequest = (req: any, supervisorPin?: string): UserContext => {
    const dbCtx = getDatabaseContext();

    // Si viene un PIN supervisor/admin, validar si pertenece a un usuario autorizado
    if (supervisorPin) {
      const authorizers = dbCtx.rawDb.prepare(`
        SELECT id, name, role, pin_salt, pin_hash
        FROM users
        WHERE role IN ('admin', 'supervisor') AND is_active = 1
      `).all() as any[];

      for (const a of authorizers) {
        if (verifyPin(supervisorPin, a.pin_salt, a.pin_hash)) {
          return { id: a.id, name: a.name, role: a.role };
        }
      }
    }

    // Verificar token Bearer si existe
    const rawToken = extractSessionToken(req.headers.authorization);
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      const session = dbCtx.rawDb.prepare(`
        SELECT s.user_id, u.name, u.role
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL
      `).get(tokenHash) as { user_id: string; name: string; role: any } | undefined;

      if (session) {
        return { id: session.user_id, name: session.name, role: session.role };
      }
    }

    // Header opcional x-user-id
    const customUserId = req.headers['x-user-id'];
    if (customUserId) {
      const u = dbCtx.rawDb.prepare('SELECT id, name, role FROM users WHERE id = ?').get(customUserId) as any;
      if (u) return { id: u.id, name: u.name, role: u.role };
    }

    return { id: 'usr_cajera_principal', name: 'Cajera Principal', role: 'cajera' };
  };

  // 1. Arqueo Ciego de Sesión de Caja (POST /api/cash-sessions/:id/blind-count)
  fastify.post('/api/cash-sessions/:id/blind-count', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as any;

    const user = getUserFromRequest(request, body.supervisorPin || body.adminPin);

    const input: BlindCountInput = {
      cashUsdCents: body.cash_usd_cents ?? body.cashUsdCents ?? 0,
      cashBsCents: body.cash_bs_cents ?? body.cashBsCents ?? 0,
      ubiiVoucherBsCents: body.ubii_voucher_bs_cents ?? body.ubiiVoucherBsCents ?? 0,
      notes: body.notes
    };

    try {
      const result = performBlindCount(dbCtx.rawDb, id, input, user);
      return reply.status(200).send(result);
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: err.message
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
        error: err.message
      });
    }
  });
};
