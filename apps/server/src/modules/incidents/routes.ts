import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { reportOrderIncident, type ReportIncidentInput } from './incidents-service.js';

export const incidentsRoutes: FastifyPluginAsync = async (fastify) => {
  // Reportar incidente en una orden (POST /api/orders/:id/incident)
  fastify.post('/api/orders/:id/incident', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as any;

    if (!body.reason_code && !body.reasonCode) {
      return reply.status(400).send({
        success: false,
        error: 'El campo reason_code es obligatorio'
      });
    }

    if (!body.responsible_area && !body.responsibleArea) {
      return reply.status(400).send({
        success: false,
        error: 'El campo responsible_area es obligatorio (mesonero, cocina, cliente, sistema, impresora)'
      });
    }

    if (!body.resolution) {
      return reply.status(400).send({
        success: false,
        error: 'El campo resolution es obligatorio (refire, refund, void_paid)'
      });
    }

    if (!body.authorizer_pin && !body.authorizerPin && !body.pin) {
      return reply.status(400).send({
        success: false,
        error: 'Se requiere el PIN de un Supervisor o Administrador para autorizar el incidente'
      });
    }

    const input: ReportIncidentInput = {
      reasonCode: body.reason_code || body.reasonCode,
      responsibleArea: body.responsible_area || body.responsibleArea,
      resolution: body.resolution,
      authorizerPin: body.authorizer_pin || body.authorizerPin || body.pin,
      workerId: body.worker_id || body.workerId,
      description: body.description,
      estimatedLossUsdCents: body.estimated_loss_usd_cents ?? body.estimatedLossUsdCents
    };

    try {
      const result = reportOrderIncident(dbCtx.rawDb, id, input);
      return reply.status(200).send(result);
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: err.message
      });
    }
  });
};
