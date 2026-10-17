import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { getKdsOrders, updateKdsLineStatus, deliverKdsOrder } from './kds-service.js';
import { type Station } from '../../db/schema.js';

export const kdsRoutes: FastifyPluginAsync = async (server) => {
  /**
   * GET /api/kds/orders
   * Devuelve las órdenes de cocina activas (en_preparacion, listo)
   * Opcionalmente filtradas por estación (?station=hot_dogs | ?station=hamburguesas)
   */
  server.get<{
    Querystring: {
      station?: Station;
    };
  }>('/api/kds/orders', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const station = request.query.station;

    const orders = getKdsOrders(dbCtx.rawDb, { station });
    return reply.status(200).send({ orders });
  });

  /**
   * POST /api/kds/lines/:lineId/status
   * Cambia el estado de una línea de comanda (pendiente ➔ preparando ➔ listo)
   * Dispara ensamble automático si todas las líneas alcanzan 'listo'
   */
  server.post<{
    Params: { lineId: string };
    Body: {
      status: 'pendiente' | 'preparando' | 'listo';
      userId?: string;
    };
  }>('/api/kds/lines/:lineId/status', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { lineId } = request.params;
    const { status, userId } = request.body || {};

    if (!status || !['pendiente', 'preparando', 'listo'].includes(status)) {
      return reply.status(400).send({
        error: "El campo 'status' es obligatorio y debe ser 'pendiente', 'preparando' o 'listo'"
      });
    }

    try {
      const result = updateKdsLineStatus(dbCtx.rawDb, lineId, status, userId);
      return reply.status(200).send(result);
    } catch (err: any) {
      const code = err.statusCode || 500;
      return reply.status(code).send({ error: err.message || 'Error al actualizar estado de la línea' });
    }
  });

  /**
   * POST /api/kds/orders/:orderId/deliver
   * Marca la orden como 'entregado'. Si está 'pagado', permite archivarla en 'cerrado'.
   */
  server.post<{
    Params: { orderId: string };
    Body: {
      archive?: boolean;
      userId?: string;
    };
  }>('/api/kds/orders/:orderId/deliver', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { orderId } = request.params;
    const { archive, userId } = request.body || {};

    try {
      const result = deliverKdsOrder(dbCtx.rawDb, orderId, { archive, actorUserId: userId });
      return reply.status(200).send(result);
    } catch (err: any) {
      const code = err.statusCode || 500;
      return reply.status(code).send({ error: err.message || 'Error al entregar comanda' });
    }
  });
};
