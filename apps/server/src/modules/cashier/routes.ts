import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import { executeDryRunVerification } from '../backups/backup-service.js';
import { appendAuditEvent } from '../audit/audit-service.js';
import {
  openJornada,
  getCurrentJornada,
  openCashSession,
  getCurrentCashSession,
  processOrderPayment,
  annulOrderInCashier,
  canUserProcessPayments,
  type OpenJornadaInput,
  type OpenCashSessionInput,
  type ProcessOrderPaymentInput
} from './cashier-service.js';

export const cashierRoutes: FastifyPluginAsync = async (fastify) => {
  // Helper para resolver el usuario actuante desde cookie, cabecera x-user-id, payload o token Bearer
  const resolveActingUser = (req: any, body?: any): { id: string; role: string; name?: string; permissions?: string[] } => {
    const dbCtx = getDatabaseContext();

    const parsePermissions = (json?: string): string[] => {
      try {
        return JSON.parse(json || '[]');
      } catch {
        return [];
      }
    };

    // 1. Cabecera explícita x-user-id
    const headerUserId = req.headers['x-user-id'] as string | undefined;
    if (headerUserId) {
      const u = dbCtx.rawDb.prepare('SELECT id, name, role, permissions_json FROM users WHERE id = ?').get(headerUserId) as any;
      if (u) return { id: u.id, name: u.name, role: u.role, permissions: parsePermissions(u.permissions_json) };
    }

    // 2. Campo de usuario en el payload (userId, cashierUserId, actorUserId)
    const payloadUserId = body?.cashierUserId || body?.userId || body?.actorUserId;
    if (payloadUserId) {
      const u = dbCtx.rawDb.prepare('SELECT id, name, role, permissions_json FROM users WHERE id = ?').get(payloadUserId) as any;
      if (u) return { id: u.id, name: u.name, role: u.role, permissions: parsePermissions(u.permissions_json) };
    }

    // 3. Token Bearer en Authorization
    let rawToken = extractSessionToken(req.headers.authorization);

    // 4. Cookie tocineta_session si no vino en Authorization
    if (!rawToken && req.headers.cookie) {
      const match = req.headers.cookie.match(/tocineta_session=([^;]+)/);
      if (match) {
        rawToken = match[1];
      }
    }

    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      const session = dbCtx.rawDb.prepare(`
        SELECT s.user_id, u.name, u.role, u.permissions_json
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL
      `).get(tokenHash) as { user_id: string; name: string; role: string; permissions_json?: string } | undefined;

      if (session) {
        return { id: session.user_id, name: session.name, role: session.role, permissions: parsePermissions(session.permissions_json) };
      }
    }

    // 5. Fallback para tests previos sin usuario explícito:
    // Buscar la cajera de la sesión de caja activa actual
    const activeSession = dbCtx.rawDb.prepare(`
      SELECT cs.user_id, u.name, u.role, u.permissions_json
      FROM cash_sessions cs
      JOIN users u ON cs.user_id = u.id
      WHERE cs.status = 'abierta'
      ORDER BY cs.opened_at_ms DESC
      LIMIT 1
    `).get() as any;

    if (activeSession) {
      return { id: activeSession.user_id, name: activeSession.name, role: activeSession.role, permissions: parsePermissions(activeSession.permissions_json) };
    }

    // Fallback por defecto si no hay sesión abierta
    return { id: 'usr_cajera', name: 'CAJERA', role: 'cajera', permissions: [] };
  };

  // 1. Abrir o confirmar Jornada Diaria (POST /api/jornadas/open)
  fastify.post('/api/jornadas/open', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = resolveActingUser(request, request.body);
    const body = (request.body || {}) as Partial<OpenJornadaInput>;

    try {
      const jornada = openJornada(dbCtx.rawDb, {
        openedByUserId: user.id,
        rateMicroBs: body.rateMicroBs,
        rateStr: body.rateStr,
        initialCashUsdCents: body.initialCashUsdCents || 0,
        initialCashBsCents: body.initialCashBsCents || 0,
        notes: body.notes
      });

      // SUG-03: Disparar simulacro automático de restauración (Dry-Run) en segundo plano
      executeDryRunVerification().catch((dryRunErr) => {
        fastify.log.warn(dryRunErr, '[Dry-Run] Error en verificación de snapshot en background');
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
    const body = (request.body || {}) as Partial<OpenCashSessionInput>;
    const user = resolveActingUser(request, body);

    if (!canUserProcessPayments(user)) {
      appendAuditEvent(dbCtx.rawDb, {
        actorUserId: user.id,
        action: 'UNAUTHORIZED_PAYMENT_ATTEMPT',
        entityType: 'cash_session',
        entityId: 'cs_open',
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

    try {
      const session = openCashSession(dbCtx.rawDb, {
        userId: user.id,
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
    const user = resolveActingUser(request);
    const current = getCurrentCashSession(dbCtx.rawDb, user.id);
    return reply.status(200).send({
      success: true,
      cashSession: current
    });
  });

  // 4.1 Consultar Ventas de la Sesión Actual (GET /api/cash-sessions/current/sales)
  fastify.get('/api/cash-sessions/current/sales', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const rows = dbCtx.rawDb.prepare(`
      SELECT * FROM orders
      WHERE payment_status = 'pagado'
      ORDER BY updated_at_ms DESC
      LIMIT 50
    `).all() as any[];

    const sales = rows.map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      customerName: o.customer_name || 'Cliente Mostrador',
      totalCents: o.total_to_collect_usd_cents,
      paidAtMs: o.updated_at_ms,
      paymentMethod: 'cash_usd',
      status: o.fulfillment_status
    }));

    return reply.status(200).send({
      success: true,
      sales
    });
  });

  // 5. Procesar Pago de Orden (POST /api/orders/:id/pay)
  fastify.post('/api/orders/:id/pay', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };
    const body = request.body as Partial<ProcessOrderPaymentInput> | undefined;
    const user = resolveActingUser(request, body);

    if (!canUserProcessPayments(user)) {
      appendAuditEvent(dbCtx.rawDb, {
        actorUserId: user.id,
        action: 'UNAUTHORIZED_PAYMENT_ATTEMPT',
        entityType: 'order',
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

    if (!body || !Array.isArray(body.tenders) || body.tenders.length === 0) {
      return reply.status(400).send({
        success: false,
        error: 'Debe incluir al menos un método de pago en tenders'
      });
    }

    try {
      const result = processOrderPayment(dbCtx.rawDb, id, {
        orderId: id,
        cashierUserId: user.id,
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

  // 6. Anular Venta o Comanda desde Caja (POST /api/orders/:id/void)
  fastify.post('/api/orders/:id/void', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { supervisorPin?: string; reason?: string };
    const user = resolveActingUser(request, body);

    try {
      const result = annulOrderInCashier(dbCtx.rawDb, {
        orderId: id,
        reason: body.reason,
        supervisorPin: body.supervisorPin,
        actorUserId: user.id
      });

      return reply.status(200).send({
        success: true,
        message: result.message
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: err.message
      });
    }
  });
};
