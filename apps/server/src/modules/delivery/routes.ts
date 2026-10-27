import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import {
  getDeliveryDrivers,
  createDeliveryDriver,
  updateDeliveryDriver,
  getDriverSettlementPreview,
  settleDriver,
  syncOrderDelivery,
  type OrderDeliveryInput
} from './delivery-service.js';

export const deliveryRoutes: FastifyPluginAsync = async (fastify) => {
  // Helper de autenticación y extracción de usuario
  const getUserFromRequest = (req: any) => {
    const dbCtx = getDatabaseContext();
    const rawToken = extractSessionToken(req.headers.authorization);
    if (!rawToken) return null;
    const tokenHash = hashToken(rawToken);
    const session = dbCtx.rawDb.prepare(`
      SELECT s.user_id, u.name, u.role
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL
    `).get(tokenHash) as { user_id: string; name: string; role: string } | undefined;

    return session || null;
  };

  // 1. Listar Repartidores (GET /api/delivery/drivers)
  fastify.get('/api/delivery/drivers', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const query = request.query as { all?: string; locationId?: string } | undefined;
    const includeInactive = query?.all === 'true' || query?.all === '1';

    const drivers = getDeliveryDrivers(dbCtx.rawDb, includeInactive, query?.locationId);
    return reply.status(200).send({
      success: true,
      drivers
    });
  });

  // 2. Registrar Nuevo Repartidor (POST /api/delivery/drivers)
  fastify.post('/api/delivery/drivers', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as { name?: string; phone?: string; locationId?: string } | undefined;

    if (!body?.name || !body?.phone) {
      return reply.status(400).send({
        success: false,
        error: 'Debe especificar nombre y teléfono del motorizado'
      });
    }

    try {
      const driver = createDeliveryDriver(dbCtx.rawDb, {
        name: body.name,
        phone: body.phone,
        locationId: body.locationId,
        actorUserId: user?.user_id
      });

      return reply.status(201).send({
        success: true,
        driver
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: err.message
      });
    }
  });

  // 3. Actualizar Repartidor (PATCH /api/delivery/drivers/:id)
  fastify.patch('/api/delivery/drivers/:id', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; phone?: string; locationId?: string; isActive?: boolean } | undefined;

    try {
      const updated = updateDeliveryDriver(dbCtx.rawDb, id, {
        name: body?.name,
        phone: body?.phone,
        locationId: body?.locationId,
        isActive: body?.isActive,
        actorUserId: user?.user_id
      });

      return reply.status(200).send({
        success: true,
        driver: updated
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: err.message
      });
    }
  });

  // 4. Vista Previa de Liquidación Nocturna (GET /api/delivery/settlement-preview)
  fastify.get('/api/delivery/settlement-preview', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const query = request.query as { jornadaId?: string; locationId?: string } | undefined;

    let targetJornadaId = query?.jornadaId;
    if (!targetJornadaId) {
      const current = dbCtx.rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
      targetJornadaId = current?.id;
    }

    if (!targetJornadaId) {
      return reply.status(200).send({
        success: true,
        preview: [],
        message: 'No hay jornada activa en este momento'
      });
    }

    const preview = getDriverSettlementPreview(dbCtx.rawDb, targetJornadaId, query?.locationId);
    return reply.status(200).send({
      success: true,
      jornadaId: targetJornadaId,
      preview
    });
  });

  // 5. Ejecutar Liquidación de Motorizado (POST /api/delivery/settle-driver)
  fastify.post('/api/delivery/settle-driver', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as {
      jornadaId?: string;
      driverId?: string;
      locationId?: string;
      notes?: string;
      modeOverride?: 'THIRD_PARTY_PASS_THROUGH' | 'HOUSE_REVENUE';
    } | undefined;

    if (!body?.driverId) {
      return reply.status(400).send({
        success: false,
        error: 'Debe especificar el driverId a liquidar'
      });
    }

    let targetJornadaId = body.jornadaId;
    if (!targetJornadaId) {
      const current = dbCtx.rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
      targetJornadaId = current?.id;
    }

    if (!targetJornadaId) {
      return reply.status(400).send({
        success: false,
        error: 'No se encontró una jornada abierta para procesar la liquidación'
      });
    }

    try {
      const result = settleDriver(dbCtx.rawDb, {
        jornadaId: targetJornadaId,
        driverId: body.driverId,
        locationId: body.locationId,
        settledByUserId: user?.user_id || 'usr_cajera',
        notes: body.notes,
        modeOverride: body.modeOverride
      });

      return reply.status(200).send({
        success: true,
        settlement: result,
        ...result
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: err.message
      });
    }
  });

  // 6. Asignar o Sincronizar Delivery en una Orden (PATCH /api/orders/:id/delivery)
  fastify.patch('/api/orders/:id/delivery', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as OrderDeliveryInput;

    try {
      const updatedOrder = syncOrderDelivery(dbCtx.rawDb, id, body, user?.user_id);
      return reply.status(200).send({
        success: true,
        order: updatedOrder
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: err.message
      });
    }
  });
};
