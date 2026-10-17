import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import {
  openJornada,
  getCurrentJornada,
  openCashSession,
  getCurrentCashSession,
  processOrderPayment,
  type OpenJornadaInput,
  type OpenCashSessionInput,
  type ProcessOrderPaymentInput
} from './cashier-service.js';

export const cashierRoutes: FastifyPluginAsync = async (fastify) => {
  // Helper para extraer usuario de la sesión actual
  const getUserIdFromRequest = (req: any): string => {
    const dbCtx = getDatabaseContext();
    const rawToken = extractSessionToken(req.headers.authorization);
    if (!rawToken) return 'usr_cajera_principal';

    const tokenHash = hashToken(rawToken);
    const session = dbCtx.rawDb.prepare(`
      SELECT user_id FROM sessions WHERE token_hash = ? AND revoked_at_ms IS NULL
    `).get(tokenHash) as { user_id: string } | undefined;

    return session?.user_id || 'usr_cajera_principal';
  };

  // 1. Abrir o confirmar Jornada Diaria (POST /api/jornadas/open)
  fastify.post('/api/jornadas/open', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const userId = getUserIdFromRequest(request);
    const body = (request.body || {}) as Partial<OpenJornadaInput>;

    try {
      const jornada = openJornada(dbCtx.rawDb, {
        openedByUserId: userId,
        rateMicroBs: body.rateMicroBs,
        rateStr: body.rateStr,
        initialCashUsdCents: body.initialCashUsdCents || 0,
        initialCashBsCents: body.initialCashBsCents || 0,
        notes: body.notes
      });

      return reply.status(200).send({
        success: true,
        jornada
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: err.message
      });
    }
  });

  // 2. Consultar Jornada Actual (GET /api/jornadas/current)
  fastify.get('/api/jornadas/current', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const current = getCurrentJornada(dbCtx.rawDb);
    return reply.status(200).send({
      success: true,
      jornada: current
    });
  });

  // 3. Abrir o confirmar Sesión de Caja (POST /api/cash-sessions/open)
  fastify.post('/api/cash-sessions/open', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const userId = getUserIdFromRequest(request);
    const body = (request.body || {}) as Partial<OpenCashSessionInput>;

    try {
      const session = openCashSession(dbCtx.rawDb, {
        userId,
        openingCashUsdCents: body.openingCashUsdCents || 0,
        openingCashBsCents: body.openingCashBsCents || 0
      });

      return reply.status(200).send({
        success: true,
        cashSession: session
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: err.message
      });
    }
  });

  // 4. Consultar Sesión de Caja Actual (GET /api/cash-sessions/current)
  fastify.get('/api/cash-sessions/current', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const userId = getUserIdFromRequest(request);
    const current = getCurrentCashSession(dbCtx.rawDb, userId);
    return reply.status(200).send({
      success: true,
      cashSession: current
    });
  });

  // 5. Procesar Pago de Orden (POST /api/orders/:id/pay)
  fastify.post('/api/orders/:id/pay', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const userId = getUserIdFromRequest(request);
    const { id } = request.params as { id: string };
    const body = request.body as Partial<ProcessOrderPaymentInput> | undefined;

    if (!body || !Array.isArray(body.tenders) || body.tenders.length === 0) {
      return reply.status(400).send({
        success: false,
        error: 'Debe incluir al menos un método de pago en tenders'
      });
    }

    try {
      const result = processOrderPayment(dbCtx.rawDb, id, {
        orderId: id,
        cashierUserId: userId,
        tenders: body.tenders,
        changeOutputs: body.changeOutputs,
        overpaymentDisposition: body.overpaymentDisposition,
        overpaymentReason: body.overpaymentReason,
        supervisorPin: body.supervisorPin,
        confirmWarning: body.confirmWarning
      });

      return reply.status(200).send({
        success: true,
        ...result
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        code: err.code || 'PAYMENT_FAILED',
        error: err.message,
        requiresSupervisorPin: err.requiresSupervisorPin || false,
        requiresConfirmation: err.requiresConfirmation || false,
        settlement: err.settlement,
        netOverpaymentUsdCents: err.netOverpaymentUsdCents
      });
    }
  });
};
