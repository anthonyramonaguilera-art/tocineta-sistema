import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import {
  createOrder,
  getOrderById,
  hydrateOrderLines,
  updateOrder,
  authorizeWithoutPayment,
  type CreateOrderInput,
  type UpdateOrderInput
} from './order-service.js';
import { getKitchenBuildableLines } from './kitchen-queries.js';

export const orderRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. Crear nuevo pedido (POST /api/orders)
  fastify.post('/api/orders', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const rawToken = extractSessionToken(request.headers.authorization);

    let createdByUserId = 'usr_cajera_principal';
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      const session = dbCtx.rawDb.prepare(`
        SELECT user_id FROM sessions WHERE token_hash = ? AND revoked_at_ms IS NULL
      `).get(tokenHash) as { user_id: string } | undefined;
      if (session) {
        createdByUserId = session.user_id;
      }
    }

    const body = request.body as CreateOrderInput | undefined;
    if (!body || !Array.isArray(body.lines) || body.lines.length === 0) {
      return reply.status(400).send({
        success: false,
        error: 'Debe incluir al menos una línea de producto en el pedido'
      });
    }

    try {
      const order = createOrder(dbCtx.rawDb, {
        ...body,
        createdByUserId
      });

      return reply.status(201).send({
        success: true,
        order
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: err.message
      });
    }
  });

  // 2. Listado de pedidos (GET /api/orders)
  fastify.get('/api/orders', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const query = request.query as {
      tableNumber?: string;
      status?: string;
      paymentStatus?: string;
    };

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.tableNumber) {
      conditions.push('table_number = ?');
      params.push(query.tableNumber);
    }
    if (query.status) {
      if (query.status === 'pagado') {
        conditions.push("payment_status = 'pagado'");
      } else {
        conditions.push('fulfillment_status = ?');
        params.push(query.status);
      }
    }
    if (query.paymentStatus) {
      conditions.push('payment_status = ?');
      params.push(query.paymentStatus);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rawOrders = dbCtx.rawDb.prepare(`
      SELECT o.*, u.name as created_by_name
      FROM orders o
      JOIN users u ON o.created_by_user_id = u.id
      ${whereClause}
      ORDER BY o.order_number DESC
      LIMIT 100
    `).all(...params) as any[];

    const orders = rawOrders.map(o => {
      const { lines, itemsCount } = hydrateOrderLines(dbCtx.rawDb, o.id, { forCashier: true });
      return {
        ...o,
        lines,
        itemsCount
      };
    });

    return reply.status(200).send({ success: true, orders });
  });

  // 3. Detalle de pedido con comanda de cocina (GET /api/orders/:id)
  fastify.get('/api/orders/:id', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };

    const rawToken = extractSessionToken(request.headers.authorization);
    let userRole: string | undefined = undefined;
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      const session = dbCtx.rawDb.prepare(`
        SELECT u.role FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL
      `).get(tokenHash) as { role: string } | undefined;
      if (session) userRole = session.role;
    }

    const order = getOrderById(dbCtx.rawDb, id, userRole);
    if (!order) {
      return reply.status(404).send({ success: false, error: `Orden '${id}' no encontrada` });
    }

    const kitchenLines = getKitchenBuildableLines(dbCtx.rawDb, id);

    return reply.status(200).send({
      success: true,
      order,
      kitchenLines
    });
  });

  // 4. Edición de pedido con concurrencia optimista (PATCH /api/orders/:id)
  fastify.patch('/api/orders/:id', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const rawToken = extractSessionToken(request.headers.authorization);

    let actorUserId = 'usr_cajera_principal';
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      const session = dbCtx.rawDb.prepare(`
        SELECT user_id FROM sessions WHERE token_hash = ? AND revoked_at_ms IS NULL
      `).get(tokenHash) as { user_id: string } | undefined;
      if (session) actorUserId = session.user_id;
    }

    const { id } = request.params as { id: string };
    const body = request.body as UpdateOrderInput | undefined;

    if (!body || body.version === undefined) {
      return reply.status(400).send({
        success: false,
        error: 'Debe incluir el número de versión (version) para control de concurrencia optimista'
      });
    }

    try {
      const updatedOrder = updateOrder(dbCtx.rawDb, id, body, actorUserId);
      return reply.status(200).send({
        success: true,
        order: updatedOrder
      });
    } catch (err: any) {
      const status = err.statusCode || 400;
      return reply.status(status).send({
        success: false,
        error: err.message,
        serverVersion: err.serverVersion
      });
    }
  });

  // 5. Autorizar pedido sin pago previo (POST /api/orders/:id/authorize-without-payment)
  fastify.post('/api/orders/:id/authorize-without-payment', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };
    const body = request.body as { authorizerUserId?: string; pin?: string } | undefined;

    if (!body?.authorizerUserId || !body?.pin) {
      return reply.status(400).send({
        success: false,
        error: 'Debe proporcionar authorizerUserId y pin del supervisor o administrador'
      });
    }

    try {
      const authorizedOrder = authorizeWithoutPayment(dbCtx.rawDb, id, body.authorizerUserId, body.pin);
      return reply.status(200).send({
        success: true,
        order: authorizedOrder
      });
    } catch (err: any) {
      const status = err.statusCode || 400;
      return reply.status(status).send({
        success: false,
        error: err.message
      });
    }
  });

  // 6. Cancelar pedido no cobrado (POST /api/orders/:id/cancel)
  fastify.post('/api/orders/:id/cancel', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string } | undefined;
    const reason = body?.reason || 'Cliente se arrepintió';
    const now = Date.now();

    const order = dbCtx.rawDb.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
    if (!order) {
      return reply.status(404).send({ success: false, error: 'Orden no encontrada' });
    }
    if (order.payment_status === 'pagado') {
      return reply.status(400).send({
        success: false,
        error: 'No se puede cancelar directamente una orden ya pagada. Debe procesar un Reembolso / Anulación con PIN.'
      });
    }

    dbCtx.rawDb.prepare(`
      UPDATE orders
      SET payment_status = 'anulado',
          fulfillment_status = 'anulado',
          notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || ' [CANCELADO: ' || ? || ']' END,
          updated_at_ms = ?
      WHERE id = ?
    `).run(`[CANCELADO: ${reason}]`, reason, now, id);

    dbCtx.rawDb.prepare(`
      UPDATE order_lines
      SET status = 'entregado'
      WHERE order_id = ?
    `).run(id);

    return reply.status(200).send({
      success: true,
      message: 'Orden cancelada con éxito'
    });
  });
};
