import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import {
  getWorkerPerformance,
  getAdminStaffPerformance,
  generateJornadaExcelReport,
  generateJornadaPdfReport
} from './reports-service.js';

export const reportsRoutes: FastifyPluginAsync = async (fastify) => {
  const getUserIdFromRequest = (req: any): string => {
    const dbCtx = getDatabaseContext();
    const rawToken = extractSessionToken(req.headers.authorization);
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      const session = dbCtx.rawDb.prepare(`
        SELECT user_id FROM sessions WHERE token_hash = ? AND revoked_at_ms IS NULL
      `).get(tokenHash) as { user_id: string } | undefined;

      if (session?.user_id) return session.user_id;
    }

    const headerUserId = req.headers['x-user-id'];
    if (headerUserId) return headerUserId as string;

    const queryUserId = (req.query as any)?.userId;
    if (queryUserId) return queryUserId;

    return 'usr_mesonero_carlos';
  };

  // 1. Vista "Mi Rendimiento" (GET /api/reports/my-performance)
  fastify.get('/api/reports/my-performance', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const userId = getUserIdFromRequest(request);

    try {
      const metrics = getWorkerPerformance(dbCtx.rawDb, userId);
      return reply.status(200).send({
        success: true,
        metrics
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: err.message
      });
    }
  });

  // 2. Vista Admin: Métricas de todo el personal y alertas (GET /api/reports/staff-performance)
  fastify.get('/api/reports/staff-performance', async (_request, reply) => {
    const dbCtx = getDatabaseContext();

    try {
      const report = getAdminStaffPerformance(dbCtx.rawDb);
      return reply.status(200).send({
        success: true,
        report
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: err.message
      });
    }
  });

  // 3. Exportación 100% Local a Excel (GET /api/reports/jornada/:id/excel)
  fastify.get('/api/reports/jornada/:id/excel', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };

    try {
      const buffer = await generateJornadaExcelReport(dbCtx.rawDb, id);

      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="reporte_jornada_${id}.xlsx"`)
        .status(200)
        .send(buffer);
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: err.message
      });
    }
  });

  // 4. Exportación 100% Local a PDF (GET /api/reports/jornada/:id/pdf)
  fastify.get('/api/reports/jornada/:id/pdf', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };

    try {
      const buffer = await generateJornadaPdfReport(dbCtx.rawDb, id);

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="reporte_jornada_${id}.pdf"`)
        .status(200)
        .send(buffer);
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: err.message
      });
    }
  });
};
