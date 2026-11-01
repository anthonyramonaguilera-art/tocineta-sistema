import type { FastifyPluginAsync } from 'fastify';
import { extractSessionToken } from '../../routes/auth.js';
import { getSessionUser as getCanonicalSessionUser } from '../auth/session.js';
import { getDatabaseContext } from '../../db/connection.js';
import { TipsService } from './tips-service.js';
import { resolveLocationId } from '../profitability/locations-service.js';

export const staffTipsRoutes: FastifyPluginAsync = async (fastify) => {
  const getSessionUser = (request: any, reply: any) => {
    const rawToken = extractSessionToken(request.headers.authorization);
    if (!rawToken) {
      reply.status(401).send({ success: false, error: 'Token no proporcionado' });
      return null;
    }

    const dbCtx = getDatabaseContext();
    const user = getCanonicalSessionUser(dbCtx.rawDb, request.headers.authorization);
    if (!user) {
      reply.status(401).send({ success: false, error: 'Sesión inválida o expirada' });
      return null;
    }

    return {
      ...user,
      user_id: user.userId,
      user_role: user.role
    };
  };

  function resolveLocationAndJornada(rawLocationId?: string, rawJornadaId?: string): { locationId: string; jornadaId: string } {
    const dbCtx = getDatabaseContext();
    let locationId = rawLocationId || 'loc_alta_vista';
    const locRow = dbCtx.rawDb.prepare('SELECT id FROM locations WHERE id = ?').get(locationId);
    if (!locRow) {
      const firstLoc = dbCtx.rawDb.prepare('SELECT id FROM locations LIMIT 1').get() as any;
      locationId = firstLoc ? firstLoc.id : 'loc_alta_vista';
    }

    let jornadaId = rawJornadaId;
    if (jornadaId) {
      const jRow = dbCtx.rawDb.prepare('SELECT id FROM jornadas WHERE id = ?').get(jornadaId);
      if (!jRow) jornadaId = undefined;
    }

    if (!jornadaId) {
      const activeJornada = dbCtx.rawDb.prepare(`
        SELECT id FROM jornadas 
        WHERE (location_id = ? OR location_id = 'loc_alta_vista') AND status = 'abierta'
        ORDER BY opened_at_ms DESC LIMIT 1
      `).get(locationId) as any;

      if (activeJornada) {
        jornadaId = activeJornada.id;
      } else {
        const anyJornada = dbCtx.rawDb.prepare(`SELECT id FROM jornadas ORDER BY opened_at_ms DESC LIMIT 1`).get() as any;
        if (anyJornada) {
          jornadaId = anyJornada.id;
        } else {
          jornadaId = 'jornada_' + Date.now();
          dbCtx.rawDb.prepare(`
            INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status, location_id)
            VALUES (?, 'usr_admin', ?, 'abierta', ?)
          `).run(jornadaId, Date.now(), locationId);
        }
      }
    }

    return { locationId, jornadaId: jornadaId || 'jornada_default' };
  }

  // 1. Obtener o consultar pool abierto
  fastify.get('/api/staff/tips/pool', async (request, reply) => {
    const session = getSessionUser(request, reply);
    if (!session) return;

    const query = request.query as { locationId?: string; jornadaId?: string };
    const { locationId, jornadaId } = resolveLocationAndJornada(query.locationId, query.jornadaId);

    const pool = await TipsService.getOrCreateOpenPool(locationId, jornadaId);
    return reply.status(200).send({ success: true, pool });
  });

  // 2. Registrar propina en el pool
  fastify.post('/api/staff/tips/pool', async (request, reply) => {
    const session = getSessionUser(request, reply);
    if (!session) return;

    const body = request.body as any;
    const { locationId, jornadaId } = resolveLocationAndJornada(body.locationId, body.jornadaId);
    try {
      const pool = await TipsService.addTip({
        tipPoolId: body.tipPoolId,
        locationId,
        jornadaId,
        amountUsdCents: body.amountUsdCents || 0,
        amountBsCents: body.amountBsCents || 0
      });
      return reply.status(200).send({ success: true, pool });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // 3. Cerrar y distribuir pool
  fastify.post('/api/staff/tips/close', async (request, reply) => {
    const session = getSessionUser(request, reply);
    if (!session) return;

    const body = request.body as any;
    if (!body?.tipPoolId || !body?.participants) {
      return reply.status(400).send({ success: false, error: 'Faltan parámetros de pool o meseros' });
    }

    try {
      const result = await TipsService.closeAndDistributePool({
        tipPoolId: body.tipPoolId,
        closedByUserId: session.user_id,
        splitMode: body.splitMode === 'HOURS' ? 'HOURS' : 'EQUAL',
        participants: body.participants
      });
      return reply.status(200).send({ success: true, ...result });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // 4. Listar pools históricos de la sede
  fastify.get('/api/staff/tips/pools', async (request, reply) => {
    const session = getSessionUser(request, reply);
    if (!session) return;

    const query = request.query as { locationId?: string; limit?: string };
    const dbCtx = getDatabaseContext();
    const locationId = resolveLocationId(dbCtx.rawDb, query.locationId, session.user_id);
    const limit = query.limit ? parseInt(query.limit, 10) : 20;

    const pools = await TipsService.listPools(locationId, limit);
    return reply.status(200).send({ success: true, pools });
  });

  // 5. Ver distribuciones de un pool
  fastify.get('/api/staff/tips/pool/:id/distributions', async (request, reply) => {
    const session = getSessionUser(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };
    const distributions = await TipsService.getDistributionsForPool(id);
    return reply.status(200).send({ success: true, distributions });
  });

  // 6. Marcar distribución como pagada
  fastify.patch('/api/staff/tips/distributions/:id/pay', async (request, reply) => {
    const session = getSessionUser(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };
    await TipsService.markDistributionPaid(id);
    return reply.status(200).send({ success: true, message: 'Distribución marcada como pagada' });
  });
};
