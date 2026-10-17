import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import {
  createOrder,
  getOrderById,
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
      conditions.push('fulfillment_status = ?');
      params.push(query.status);
    }
    if (query.paymentStatus) {
      conditions.push('payment_status = ?');
      params.push(query.paymentStatus);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orders = dbCtx.rawDb.prepare(`
      SELECT o.*, u.name as created_by_name
      FROM orders o
      JOIN users u ON o.created_by_user_id = u.id
      ${whereClause}
      ORDER BY o.order_number DESC
      LIMIT 100
    `).all(...params);

    return reply.status(200).send({ success: true, orders });
  });

  // 3. Detalle de pedido con comanda de cocina (GET /api/orders/:id)
  fastify.get('/api/orders/:id', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };

    const order = getOrderById(dbCtx.rawDb, id);
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
};
