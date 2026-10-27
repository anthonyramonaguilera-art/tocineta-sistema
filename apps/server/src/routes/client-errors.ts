import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../db/connection.js';
import { generateUuidV7 } from '@tocineta/shared';

export const clientErrorsRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. Reportar error de cliente (ErrorBoundary)
  fastify.post('/api/client-errors', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = (request.body || {}) as {
      viewName?: string;
      errorMessage?: string;
      errorStack?: string;
      userId?: string;
      userRole?: string;
    };

    const id = `err_${generateUuidV7()}`;
    const viewName = String(body.viewName || 'unknown').slice(0, 100);
    const errorMessage = String(body.errorMessage || 'Error no especificado').slice(0, 1000);
    const errorStack = body.errorStack ? String(body.errorStack).slice(0, 5000) : null;
    const userId = body.userId ? String(body.userId).slice(0, 100) : null;
    const userRole = body.userRole ? String(body.userRole).slice(0, 50) : null;
    const now = Date.now();

    try {
      dbCtx.rawDb.prepare(`
        INSERT INTO client_errors (
          id, view_name, error_message, error_stack, user_id, user_role, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, viewName, errorMessage, errorStack, userId, userRole, now);

      return reply.status(201).send({ success: true, id });
    } catch (err: any) {
      fastify.log.error(err, 'Fallo al registrar client_error en SQLite');
      return reply.status(200).send({ success: false, error: err.message });
    }
  });

  // 2. Listar errores de cliente para Administrador
  fastify.get('/api/client-errors', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    try {
      const errors = dbCtx.rawDb.prepare(`
        SELECT id, view_name, error_message, error_stack, user_id, user_role, created_at_ms
        FROM client_errors
        ORDER BY created_at_ms DESC
        LIMIT 100
      `).all();

      return reply.status(200).send({ success: true, errors });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
};
