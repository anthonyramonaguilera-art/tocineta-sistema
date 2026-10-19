import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import {
  getAvailableCoupons,
  validateCoupon,
  applyCouponToOrder,
  removeCouponFromOrder
} from './coupon-service.js';

export const couponRoutes: FastifyPluginAsync = async (fastify) => {
  // Helper de autenticación
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

  // 1. Listar Cupones Disponibles (GET /api/coupons)
  fastify.get('/api/coupons', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const coupons = getAvailableCoupons(dbCtx.rawDb);
    return reply.status(200).send({
      success: true,
      coupons
    });
  });

  // 2. Validar Cupón de forma previa (GET /api/coupons/validate)
  fastify.get('/api/coupons/validate', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const query = request.query as { code?: string; subtotalCents?: string } | undefined;
    if (!query?.code) {
      return reply.status(400).send({
        success: false,
        valid: false,
        error: 'Debe especificar el código de cupón'
      });
    }

    const subtotal = query.subtotalCents ? parseInt(query.subtotalCents, 10) : 0;
    const result = validateCoupon(dbCtx.rawDb, query.code, isNaN(subtotal) ? 0 : subtotal);

    return reply.status(200).send({
      success: true,
      ...result
    });
  });

  // 3. Aplicar Cupón a una Orden (POST /api/orders/:id/apply-coupon)
  fastify.post('/api/orders/:id/apply-coupon', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const { id } = request.params as { id: string };
    const body = request.body as { couponCode?: string } | undefined;

    if (!body?.couponCode) {
      return reply.status(400).send({
        success: false,
        error: 'Debe proporcionar el código del cupón (couponCode)'
      });
    }

    try {
      const result = applyCouponToOrder(
        dbCtx.rawDb,
        id,
        body.couponCode,
        user?.user_id || 'usr_cajera_principal'
      );

      return reply.status(200).send(result);
    } catch (err: any) {
      const errorCode = err.errorCode || err.code || err.message;
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: errorCode,
        message: err.message
      });
    }
  });

  // 4. Quitar Cupón de una Orden (POST /api/orders/:id/remove-coupon)
  fastify.post('/api/orders/:id/remove-coupon', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const { id } = request.params as { id: string };

    try {
      const result = removeCouponFromOrder(
        dbCtx.rawDb,
        id,
        user?.user_id || 'usr_cajera_principal'
      );

      return reply.status(200).send(result);
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: err.message
      });
    }
  });
};
