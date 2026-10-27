import type { FastifyPluginAsync } from 'fastify';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import { getDatabaseContext } from '../../db/connection.js';
import { PayrollService } from './payroll-service.js';

export const staffPayrollRoutes: FastifyPluginAsync = async (fastify) => {
  const requireAdminOrSupervisor = (request: any, reply: any) => {
    const rawToken = extractSessionToken(request.headers.authorization);
    if (!rawToken) {
      reply.status(401).send({ success: false, error: 'Token no proporcionado' });
      return null;
    }

    const tokenHash = hashToken(rawToken);
    const dbCtx = getDatabaseContext();
    const now = Date.now();

    const rawSession = dbCtx.rawDb.prepare(`
      SELECT s.*, u.role as user_role
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL AND s.expires_at_ms > ?
    `).get(tokenHash, now) as any;

    if (!rawSession || (rawSession.user_role !== 'admin' && rawSession.user_role !== 'supervisor')) {
      reply.status(403).send({ success: false, error: 'Acceso restringido a administradores' });
      return null;
    }

    return rawSession;
  };

  // 1. Configuración global de nómina
  fastify.get('/api/staff/payroll/settings', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply);
    if (!session) return;

    const settings = await PayrollService.getPayrollSettings();
    return reply.status(200).send({ success: true, settings });
  });

  fastify.put('/api/staff/payroll/settings', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply);
    if (!session) return;

    const body = request.body as any;
    const settings = await PayrollService.updatePayrollSettings({
      payrollEnabled: body?.payrollEnabled,
      fixedDinnerEnabled: body?.fixedDinnerEnabled,
      fixedDinnerCostUsdCents: body?.fixedDinnerCostUsdCents
    });

    return reply.status(200).send({ success: true, settings });
  });

  // 2. Perfil salarial de empleado
  fastify.post('/api/staff/payroll/profiles', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply);
    if (!session) return;

    const body = request.body as any;
    if (!body?.userId || !body?.salaryScheme || body?.baseSalaryUsdCents === undefined) {
      return reply.status(400).send({ success: false, error: 'Datos incompletos para perfil salarial' });
    }

    const profile = await PayrollService.upsertProfile({
      userId: body.userId,
      salaryScheme: body.salaryScheme,
      baseSalaryUsdCents: body.baseSalaryUsdCents,
      fixedDinnerAllowed: body.fixedDinnerAllowed ?? true
    });

    return reply.status(200).send({ success: true, profile });
  });

  // 3. Ajustes salariales (Bonos y Adelantos)
  fastify.post('/api/staff/payroll/adjustments', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply);
    if (!session) return;

    const body = request.body as any;
    if (!body?.userId || !body?.adjustmentType || body?.amountUsdCents === undefined) {
      return reply.status(400).send({ success: false, error: 'Datos incompletos para ajuste salarial' });
    }

    const adj = await PayrollService.createAdjustment({
      userId: body.userId,
      adjustmentType: body.adjustmentType,
      amountUsdCents: body.amountUsdCents,
      reason: body.reason || '',
      createdByUserId: session.user_id
    });

    return reply.status(201).send({ success: true, adjustment: adj });
  });

  fastify.get('/api/staff/payroll/adjustments/:userId', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply);
    if (!session) return;

    const { userId } = request.params as { userId: string };
    const adjustments = await PayrollService.getPendingAdjustments(userId);
    return reply.status(200).send({ success: true, adjustments });
  });

  // 4. Consumos de empleado y Cena del Personal
  fastify.post('/api/staff/consumptions', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply);
    if (!session) return;

    const body = request.body as any;
    if (!body?.userId || !body?.itemDescription) {
      return reply.status(400).send({ success: false, error: 'Datos incompletos para consumo' });
    }

    const consumption = await PayrollService.recordConsumption({
      userId: body.userId,
      itemDescription: body.itemDescription,
      amountUsdCents: body.amountUsdCents,
      isFixedDinner: body.isFixedDinner,
      orderId: body.orderId,
      recordedByUserId: session.user_id
    });

    return reply.status(201).send({ success: true, consumption });
  });

  fastify.get('/api/staff/consumptions/:userId', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply);
    if (!session) return;

    const { userId } = request.params as { userId: string };
    const consumptions = await PayrollService.getPendingConsumptions(userId);
    return reply.status(200).send({ success: true, consumptions });
  });

  // 5. Cálculo y Liquidación
  fastify.post('/api/staff/settlements/calculate', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply);
    if (!session) return;

    const body = request.body as any;
    if (!body?.userId || !body?.periodStartMs || !body?.periodEndMs) {
      return reply.status(400).send({ success: false, error: 'Faltan parámetros de período o usuario' });
    }

    try {
      const calc = await PayrollService.calculateSettlementPreview({
        userId: body.userId,
        periodStartMs: body.periodStartMs,
        periodEndMs: body.periodEndMs,
        chargedConsumptionIds: body.chargedConsumptionIds || []
      });
      return reply.status(200).send({ success: true, calculation: calc });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  fastify.post('/api/staff/settlements', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply);
    if (!session) return;

    const body = request.body as any;
    if (!body?.userId || !body?.periodStartMs || !body?.periodEndMs) {
      return reply.status(400).send({ success: false, error: 'Faltan parámetros de período o usuario' });
    }

    try {
      const result = await PayrollService.executeSettlement({
        userId: body.userId,
        periodStartMs: body.periodStartMs,
        periodEndMs: body.periodEndMs,
        chargedConsumptionIds: body.chargedConsumptionIds || [],
        notes: body.notes,
        processedByUserId: session.user_id
      });
      return reply.status(201).send({ success: true, ...result });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  fastify.get('/api/staff/settlements', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply);
    if (!session) return;

    const query = request.query as { userId?: string };
    const settlements = await PayrollService.listSettlements(query.userId);
    return reply.status(200).send({ success: true, settlements });
  });

  // 6. Descarga de Recibo en PDF
  fastify.get('/api/staff/settlements/:id/pdf', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const pdfBuffer = await PayrollService.generateSettlementPdf(id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="recibo_liquidacion_${id.slice(-6)}.pdf"`)
        .send(pdfBuffer);
    } catch (err: any) {
      return reply.status(404).send({ success: false, error: err.message });
    }
  });
};
