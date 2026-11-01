import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { getKdsOrders, updateKdsLineStatus, deliverKdsOrder, forceCompleteKdsOrder } from './kds-service.js';
import { type Station } from '../../db/schema.js';
import { getSessionUser } from '../auth/session.js';
import { ensureBusinessSettingsDefensive } from '../../db/business-settings.js';

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
    try {
      const dbCtx = getDatabaseContext();
      ensureBusinessSettingsDefensive(dbCtx.rawDb);
      const station = request.query.station;

      const orders = getKdsOrders(dbCtx.rawDb, { station });
      return reply.status(200).send({ orders });
    } catch (err: any) {
      server.log.error(err, 'Error defensivo en GET /api/kds/orders');
      return reply.status(200).send({ orders: [] });
    }
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
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        error: err.code || err.message || 'Error al actualizar estado de la línea',
        code: err.code,
        message: err.message
      });
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
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        error: err.code || err.message || 'Error al entregar comanda',
        code: err.code,
        message: err.message
      });
    }
  });

  /**
   * POST /api/kds/orders/:orderId/force-complete
   * Despacho Forzado en 1 toque en cocina (Supervisión Dueña / Admin / Supervisor)
   * Valida rol 'admin' o 'supervisor' o permiso 'KDS_FORCE_COMPLETE'
   */
  server.post<{
    Params: { orderId: string };
    Body: {
      userId?: string;
    };
  }>('/api/kds/orders/:orderId/force-complete', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { orderId } = request.params;
    const body = (request.body || {}) as { userId?: string };

    let userRole = '';
    let userId = body.userId;
    let permissions: string[] = [];

    const session = getSessionUser(dbCtx.rawDb, request.headers.authorization);
    if (session) {
      userId = session.userId;
      userRole = session.role;
      permissions = session.permissions;
    } else if (userId) {
      const u = dbCtx.rawDb.prepare('SELECT role, permissions_json FROM users WHERE id = ?').get(userId) as any;
      if (u) {
        userRole = u.role;
        try {
          permissions = JSON.parse(u.permissions_json || '[]');
        } catch {}
      }
    }

    const hasPermission = userRole === 'admin' || userRole === 'supervisor' || permissions.includes('KDS_FORCE_COMPLETE');
    if (!hasPermission) {
      return reply.status(403).send({
        error: 'FORBIDDEN_KDS_FORCE_COMPLETE',
        message: 'No tienes permisos para forzar el despacho completo de cocina.'
      });
    }

    try {
      const result = forceCompleteKdsOrder(dbCtx.rawDb, orderId, { actorUserId: userId });
      return reply.status(200).send(result);
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        error: err.code || err.message || 'Error al forzar despacho de comanda',
        code: err.code,
        message: err.message
      });
    }
  });
};
