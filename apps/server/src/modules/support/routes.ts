import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import {
  startSupportMode,
  stopSupportMode,
  getSupportStatus
} from './support-service.js';

export const supportRoutes: FastifyPluginAsync = async (fastify) => {
  const getUserFromRequest = (req: any) => {
    const dbCtx = getDatabaseContext();
    const rawToken = extractSessionToken(req.headers.authorization);
    if (!rawToken) return null;
    const tokenHash = hashToken(rawToken);
    return dbCtx.rawDb.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at_ms > ?').get(tokenHash, Date.now()) as { user_id: string } | undefined;
  };

  // 1. Iniciar Modo Soporte (Exclusivo con PIN Admin)
  fastify.post('/api/support/start', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as { adminPin?: string; notes?: string } | undefined;

    if (!body?.adminPin) {
      return reply.status(400).send({
        success: false,
        error: 'Debe ingresar el PIN de Administrador (6 dígitos)'
      });
    }

    try {
      const status = startSupportMode(dbCtx.rawDb, {
        adminPin: body.adminPin,
        notes: body.notes,
        actorUserId: user?.user_id
      });

      return reply.status(200).send({
        success: true,
        support: status,
        message: 'Modo Soporte Técnico activado exitosamente por 2 horas'
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 403).send({
        success: false,
        error: err.message || 'Error al iniciar Modo Soporte'
      });
    }
  });

  // 2. Detener Modo Soporte
  fastify.post('/api/support/stop', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);

    const status = stopSupportMode(dbCtx.rawDb, {
      actorUserId: user?.user_id
    });

    return reply.status(200).send({
      success: true,
      support: status,
      message: 'Modo Soporte finalizado exitosamente'
    });
  });

  // 3. Consultar Estado Actual de Modo Soporte
  fastify.get('/api/support/status', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const status = getSupportStatus(dbCtx.rawDb);

    return reply.status(200).send({
      success: true,
      support: status
    });
  });

  // 4. Registrar selección de opción fallback (Ajuste B1)
  fastify.post('/api/support/fallback-selection', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as { selectedOption?: string; sessionId?: string } | undefined;

    if (!body?.selectedOption) {
      return reply.status(400).send({
        success: false,
        error: 'Debe especificar la opción seleccionada (selectedOption)'
      });
    }

    const { recordSupportFallbackSelection } = await import('./support-service.js');
    const result = recordSupportFallbackSelection(dbCtx.rawDb, {
      selectedOption: body.selectedOption,
      actorUserId: user?.user_id,
      sessionId: body.sessionId
    });

    return reply.status(200).send(result);
  });

  // 5. Lanzar Quick Assist en Cascada (POST /api/support/launch-quick-assist)
  fastify.post('/api/support/launch-quick-assist', async (_request, reply) => {
    const { launchQuickAssistCascade } = await import('./support-service.js');
    const result = launchQuickAssistCascade();
    return reply.status(200).send(result);
  });

  // 6. Consultar Registro de Errores del Servidor (GET /api/support/server-errors?limit=50) - Exclusivo Admin
  fastify.get('/api/support/server-errors', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const session = getUserFromRequest(request);
    if (!session?.user_id) {
      return reply.status(401).send({
        success: false,
        error: 'No autorizado',
        code: 'UNAUTHORIZED'
      });
    }

    const user = dbCtx.rawDb.prepare('SELECT role FROM users WHERE id = ?').get(session.user_id) as { role: string } | undefined;
    if (user?.role !== 'admin') {
      return reply.status(403).send({
        success: false,
        error: 'Acceso restringido a administradores',
        code: 'FORBIDDEN'
      });
    }

    const query = request.query as { limit?: string } | undefined;
    const limit = Math.min(Math.max(parseInt(query?.limit || '50', 10) || 50, 1), 500);

    const errors = dbCtx.rawDb.prepare(`
      SELECT id, request_id, method, url, status, code, message, stack, body_json, user_id, created_at_ms
      FROM server_errors
      ORDER BY created_at_ms DESC
      LIMIT ?
    `).all(limit);

    return reply.status(200).send({
      success: true,
      errors
    });
  });
};


