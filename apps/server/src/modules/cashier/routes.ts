import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
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
  // Helper para resolver el usuario actuante exclusivamente desde req.user (sesión validada por guard)
  // Se extirpó la suplantación por cabecera, payload, cookie y fallback de caja activa (P1-B).
  const resolveActingUser = (req: any, _body?: any): { id: string; role: string; name: string; permissions: string[] } => {
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
  fastify.get('/api/cash-sessions/current/sales', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const currentJornada = getCurrentJornada(dbCtx.rawDb);
    if (!currentJornada) {
      return reply.status(200).send({
        success: true,
        sales: [],
        nextCursor: null
      });
    }

    const query = (request.query || {}) as { limit?: string; cursor?: string };
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '50', 10) || 50));
    const cursor = query.cursor ? parseInt(query.cursor, 10) : null;

    const conditions = ["payment_status = 'pagado'", "jornada_id = ?"];
    const params: any[] = [currentJornada.id];
    if (cursor) {
      conditions.push('updated_at_ms < ?');
      params.push(cursor);
    }
    params.push(limit + 1);

    const rows = dbCtx.rawDb.prepare(`
      SELECT o.*, 
        (SELECT p.method FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at_ms DESC LIMIT 1) as primary_method
      FROM orders o
      WHERE ${conditions.join(' AND ')}
      ORDER BY o.updated_at_ms DESC
      LIMIT ?
    `).all(...params) as any[];

    const hasMore = rows.length > limit;
    const pagedRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && pagedRows.length > 0 ? String(pagedRows[pagedRows.length - 1].updated_at_ms) : null;
    const rateMicroBs = currentJornada.rate_micro_bs || 40_000_000;

    const sales = pagedRows.map((o) => {
      const totalUsdCents = o.net_food_sales_usd_cents || o.total_to_collect_usd_cents || 0;
      const rate = (o.rate_micro_bs || rateMicroBs) / 1_000_000;
      const totalBsCents = Math.round((totalUsdCents / 100) * rate * 100);
      const rawMethod = o.primary_method || 'EFECTIVO_USD';

      return {
        orderId: o.id,
        orderNumber: String(o.order_number),
        customerName: o.customer_name || 'Cliente Mostrador',
        tableLabel: o.table_number ? `Mesa ${o.table_number}` : (o.fulfillment_type === 'delivery' ? 'Delivery' : 'Para Llevar'),
        totalUsdCents,
        totalBsCents,
        primaryMethod: rawMethod,
        paidAtMs: o.updated_at_ms || o.created_at_ms,
        locationId: o.location_id || 'loc_alta_vista',
        status: o.fulfillment_status,
        id: o.id,
        totalCents: totalUsdCents,
        paymentMethod: rawMethod
      };
    });

    return reply.status(200).send({
      success: true,
      sales,
      nextCursor
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
        confirmWarning: body.confirmWarning,
        actingKey: (request as any).user?.id ?? request.ip
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
        netOverpaymentUsdCents: err.netOverpaymentUsdCents,
        remainingMs: err.remainingMs
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
        actorUserId: user.id,
        actingKey: (request as any).user?.id ?? request.ip
      });

      return reply.status(200).send({
        success: true,
        message: result.message
      });
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
