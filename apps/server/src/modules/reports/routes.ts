import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import {
  getWorkerPerformance,
  getAdminStaffPerformance,
  generateJornadaExcelReport,
  generateJornadaPdfReport,
  getJornadaReportData
} from './reports-service.js';
import { getCurrentJornada } from '../cashier/cashier-service.js';
import {
  redactSummaryForBlindCashier,
  isBlindActive,
  canCashierDownload
} from './blind-redaction.js';
import { appendAuditEvent } from '../audit/audit-service.js';

export const reportsRoutes: FastifyPluginAsync = async (fastify) => {
  const getUserIdFromRequest = (req: any): string => {
    const user = req.user;
    if (!user) {
      const err: any = new Error('No autenticado');
      err.statusCode = 401;
      throw err;
    }

    if ((user.role === 'admin' || user.role === 'supervisor') && (req.query as any)?.userId) {
      return (req.query as any).userId;
    }

    return user.id;
  };

  // 1. Vista "Mi Rendimiento" (GET /api/reports/my-performance)
  fastify.get('/api/reports/my-performance', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    try {
      const userId = getUserIdFromRequest(request);
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
    const user = request.user as any;

    if (user?.role === 'cajera' && !canCashierDownload(dbCtx.rawDb, user, id)) {
      return reply.status(403).send({
        success: false,
        code: 'REPORT_FORBIDDEN_FOR_ROLE',
        error: 'Solo puedes descargar el reporte de tu turno despues de cerrarlo'
      });
    }

    try {
      const buffer = await generateJornadaExcelReport(dbCtx.rawDb, id);

      appendAuditEvent(dbCtx.rawDb, {
        actorUserId: user?.id || null,
        action: 'REPORT_DOWNLOADED',
        entityType: 'jornada',
        entityId: id,
        payload: { format: 'excel', endpoint: '/api/reports/jornada/:id/excel' }
      });

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
    const user = request.user as any;

    if (user?.role === 'cajera' && !canCashierDownload(dbCtx.rawDb, user, id)) {
      return reply.status(403).send({
        success: false,
        code: 'REPORT_FORBIDDEN_FOR_ROLE',
        error: 'Solo puedes descargar el reporte de tu turno despues de cerrarlo'
      });
    }

    try {
      const buffer = await generateJornadaPdfReport(dbCtx.rawDb, id);

      appendAuditEvent(dbCtx.rawDb, {
        actorUserId: user?.id || null,
        action: 'REPORT_DOWNLOADED',
        entityType: 'jornada',
        entityId: id,
        payload: { format: 'pdf', endpoint: '/api/reports/jornada/:id/pdf' }
      });

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

  // 5. Resumen en vivo de Cierre Z (GET /api/reports/z-report/summary)
  fastify.get('/api/reports/z-report/summary', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const query = request.query as { jornadaId?: string } | undefined;
    const currentJornada = getCurrentJornada(dbCtx.rawDb);
    const jornadaId = query?.jornadaId || currentJornada?.id;
    if (!jornadaId) {
      return reply.status(200).send({ success: true, summary: null, jornada: null });
    }
    try {
      const summary = getJornadaReportData(dbCtx.rawDb, jornadaId);
      const targetJornadaId = summary.jornada?.id || jornadaId;
      const finalSummary = isBlindActive(dbCtx.rawDb, request.user, targetJornadaId)
        ? redactSummaryForBlindCashier(summary)
        : summary;

      return reply.status(200).send({
        success: true,
        summary: finalSummary
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({ success: false, error: err.message });
    }
  });

  // 6. Descargar Reporte PDF del Día / Cierre Z (GET /api/reports/z-report/pdf)
  fastify.get('/api/reports/z-report/pdf', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const query = request.query as { jornadaId?: string } | undefined;
    const currentJornada = getCurrentJornada(dbCtx.rawDb);
    const jornadaId = query?.jornadaId || currentJornada?.id;
    if (!jornadaId) {
      return reply.status(404).send({ success: false, error: 'No hay jornada abierta' });
    }

    const user = request.user as any;
    if (user?.role === 'cajera' && !canCashierDownload(dbCtx.rawDb, user, jornadaId)) {
      return reply.status(403).send({
        success: false,
        code: 'REPORT_FORBIDDEN_FOR_ROLE',
        error: 'Solo puedes descargar el reporte de tu turno despues de cerrarlo'
      });
    }

    try {
      const buffer = await generateJornadaPdfReport(dbCtx.rawDb, jornadaId);

      appendAuditEvent(dbCtx.rawDb, {
        actorUserId: user?.id || null,
        action: 'REPORT_DOWNLOADED',
        entityType: 'jornada',
        entityId: jornadaId,
        payload: { format: 'pdf', endpoint: '/api/reports/z-report/pdf' }
      });

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="cierre_z_${jornadaId}.pdf"`)
        .status(200)
        .send(buffer);
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({ success: false, error: err.message });
    }
  });

  // 7. Descargar Reporte Excel del Día / Cierre Z (GET /api/reports/z-report/excel)
  fastify.get('/api/reports/z-report/excel', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const query = request.query as { jornadaId?: string } | undefined;
    const currentJornada = getCurrentJornada(dbCtx.rawDb);
    const jornadaId = query?.jornadaId || currentJornada?.id;
    if (!jornadaId) {
      return reply.status(404).send({ success: false, error: 'No hay jornada abierta' });
    }

    const user = request.user as any;
    if (user?.role === 'cajera' && !canCashierDownload(dbCtx.rawDb, user, jornadaId)) {
      return reply.status(403).send({
        success: false,
        code: 'REPORT_FORBIDDEN_FOR_ROLE',
        error: 'Solo puedes descargar el reporte de tu turno despues de cerrarlo'
      });
    }

    try {
      const buffer = await generateJornadaExcelReport(dbCtx.rawDb, jornadaId);

      appendAuditEvent(dbCtx.rawDb, {
        actorUserId: user?.id || null,
        action: 'REPORT_DOWNLOADED',
        entityType: 'jornada',
        entityId: jornadaId,
        payload: { format: 'excel', endpoint: '/api/reports/z-report/excel' }
      });

      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="cierre_z_${jornadaId}.xlsx"`)
        .status(200)
        .send(buffer);
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({ success: false, error: err.message });
    }
  });
};
