import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getDatabaseContext } from '../../db/connection.js';
import {
  getExpenseCategories,
  createExpenseCategory,
  createExpense,
  listExpenses,
  deleteExpense
} from './expenses-service.js';
import {
  createReceivableAccount,
  listReceivables,
  getReceivableDetail,
  addReceivablePayment,
  generateWhatsAppReminder,
  getCustomerStatement
} from './receivables-service.js';
import {
  listPayables,
  getPayableDetail,
  addPayablePayment
} from './payables-service.js';
import { calculateProfitAndLoss } from './profit-service.js';
import { calculateCashFlow } from './cashflow-service.js';
import {
  getOwnerDashboardNumbers,
  updateOwnerNumbersConfig
} from './owner-dashboard-service.js';
import {
  generateFinancesExcelReport,
  generateFinancesPdfReport,
  createMonthlyClosure,
  listMonthlyClosures
} from './export-service.js';

export const financesRoutes: FastifyPluginAsync = async (fastify) => {
  const { rawDb } = getDatabaseContext();

  // 1. Panel de Inicio de la Dueña: 5 Números
  fastify.get('/api/finances/owner-numbers', async (request, reply) => {
    const query = request.query as { locationId?: string };
    const data = getOwnerDashboardNumbers(rawDb, query.locationId);
    return reply.send({ success: true, data });
  });

  fastify.post('/api/finances/owner-numbers/config', async (request, reply) => {
    const schema = z.object({ keys: z.array(z.string()).length(5) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Debe especificar exactamente 5 claves válidas' });
    }
    const updated = updateOwnerNumbersConfig(rawDb, parsed.data.keys);
    return reply.send({ success: true, data: updated });
  });

  // 2. Gastos Operativos y Categorías
  fastify.get('/api/finances/categories', async (_request, reply) => {
    const data = getExpenseCategories(rawDb);
    return reply.send({ success: true, data });
  });

  fastify.post('/api/finances/categories', async (request, reply) => {
    const schema = z.object({ name: z.string().min(2) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Nombre de categoría inválido' });
    }
    const data = createExpenseCategory(rawDb, parsed.data.name);
    return reply.send({ success: true, data });
  });

  fastify.get('/api/finances/expenses', async (request, reply) => {
    const q = request.query as any;
    const filters = {
      locationId: q.locationId,
      startDateMs: q.startDateMs ? Number(q.startDateMs) : undefined,
      endDateMs: q.endDateMs ? Number(q.endDateMs) : undefined,
      category: q.category,
      paymentMethod: q.paymentMethod
    };
    const data = listExpenses(rawDb, filters);
    return reply.send({ success: true, data });
  });

  fastify.post('/api/finances/expenses', async (request, reply) => {
    const schema = z.object({
      locationId: z.string(),
      jornadaId: z.string().optional(),
      category: z.string().min(2),
      amountUsdCents: z.number().int().positive(),
      amountBsCents: z.number().int().optional(),
      paymentMethod: z.string().optional(),
      description: z.string().min(2),
      receiptPhotoPath: z.string().optional(),
      isRecurring: z.boolean().optional(),
      recurringInterval: z.string().optional(),
      notes: z.string().optional(),
      authorizedByUserId: z.string()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.issues[0].message });
    }
    const data = createExpense(rawDb, parsed.data);
    return reply.status(201).send({ success: true, data });
  });

  fastify.delete('/api/finances/expenses/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = deleteExpense(rawDb, id);
    return reply.send({ success: ok });
  });

  // 3. Cuentas por Cobrar (Clientes, Fiado, Socios, Eventos)
  fastify.get('/api/finances/receivables', async (request, reply) => {
    const q = request.query as any;
    const data = listReceivables(rawDb, {
      locationId: q.locationId,
      customerId: q.customerId,
      status: q.status,
      search: q.search
    });
    return reply.send({ success: true, data });
  });

  fastify.post('/api/finances/receivables', async (request, reply) => {
    const schema = z.object({
      customerId: z.string(),
      locationId: z.string(),
      orderId: z.string().optional(),
      concept: z.string().min(2),
      totalUsdCents: z.number().int().positive(),
      dueDateMs: z.number().int().positive(),
      notes: z.string().optional(),
      createdBy: z.string()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.issues[0].message });
    }
    const data = createReceivableAccount(rawDb, parsed.data);
    return reply.status(201).send({ success: true, data });
  });

  fastify.get('/api/finances/receivables/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = getReceivableDetail(rawDb, id);
    return reply.send({ success: true, data });
  });

  fastify.post('/api/finances/receivables/payment', async (request, reply) => {
    const schema = z.object({
      receivableId: z.string(),
      amountUsdCents: z.number().int().positive(),
      amountBsCents: z.number().int().optional(),
      paymentMethod: z.string().min(2),
      referenceCode: z.string().optional(),
      receiptPhotoPath: z.string().optional(),
      notes: z.string().optional(),
      receivedBy: z.string()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.issues[0].message });
    }
    const result = addReceivablePayment(rawDb, parsed.data);
    return reply.status(201).send({ success: true, data: result });
  });

  fastify.get('/api/finances/receivables/:id/whatsapp', async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = generateWhatsAppReminder(rawDb, id);
    return reply.send({ success: true, data });
  });

  fastify.get('/api/finances/customers/:id/statement', async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = getCustomerStatement(rawDb, id);
    return reply.send({ success: true, data });
  });

  // 4. Cuentas por Pagar (Facturas de Compra a Proveedores a Crédito)
  fastify.get('/api/finances/payables', async (request, reply) => {
    const q = request.query as any;
    const data = listPayables(rawDb, {
      locationId: q.locationId,
      supplierId: q.supplierId,
      status: q.status,
      search: q.search
    });
    return reply.send({ success: true, data });
  });

  fastify.get('/api/finances/payables/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = getPayableDetail(rawDb, id);
    return reply.send({ success: true, data });
  });

  fastify.post('/api/finances/payables/payment', async (request, reply) => {
    const schema = z.object({
      purchaseId: z.string(),
      amountUsdCents: z.number().int().positive(),
      amountBsCents: z.number().int().optional(),
      paymentMethod: z.string().min(2),
      referenceCode: z.string().optional(),
      receiptPhotoPath: z.string().optional(),
      notes: z.string().optional(),
      paidBy: z.string()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.issues[0].message });
    }
    const result = addPayablePayment(rawDb, parsed.data);
    return reply.status(201).send({ success: true, data: result });
  });

  // 5. Utilidad (P&L) y Flujo de Caja
  fastify.get('/api/finances/profit-loss', async (request, reply) => {
    const q = request.query as any;
    const data = calculateProfitAndLoss(rawDb, {
      startDateMs: q.startDateMs ? Number(q.startDateMs) : undefined,
      endDateMs: q.endDateMs ? Number(q.endDateMs) : undefined,
      locationId: q.locationId
    });
    return reply.send({ success: true, data });
  });

  fastify.get('/api/finances/cash-flow', async (request, reply) => {
    const q = request.query as any;
    const data = calculateCashFlow(rawDb, {
      startDateMs: q.startDateMs ? Number(q.startDateMs) : undefined,
      endDateMs: q.endDateMs ? Number(q.endDateMs) : undefined,
      locationId: q.locationId
    });
    return reply.send({ success: true, data });
  });

  // 6. Exportar Excel y PDF
  fastify.get('/api/finances/export/excel', async (request, reply) => {
    const q = request.query as any;
    const buffer = await generateFinancesExcelReport(rawDb, {
      startDateMs: q.startDateMs ? Number(q.startDateMs) : undefined,
      endDateMs: q.endDateMs ? Number(q.endDateMs) : undefined,
      locationId: q.locationId
    });
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', 'attachment; filename="tocineta-finanzas.xlsx"');
    return reply.send(buffer);
  });

  fastify.get('/api/finances/export/pdf', async (request, reply) => {
    const q = request.query as any;
    const buffer = await generateFinancesPdfReport(rawDb, {
      startDateMs: q.startDateMs ? Number(q.startDateMs) : undefined,
      endDateMs: q.endDateMs ? Number(q.endDateMs) : undefined,
      locationId: q.locationId
    });
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'inline; filename="tocineta-finanzas.pdf"');
    return reply.send(buffer);
  });

  // 7. Cierres Mensuales
  fastify.post('/api/finances/closures', async (request, reply) => {
    const schema = z.object({
      year: z.number().int().min(2020),
      month: z.number().int().min(1).max(12),
      locationId: z.string(),
      userId: z.string(),
      notes: z.string().optional()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.issues[0].message });
    }
    const data = createMonthlyClosure(rawDb, parsed.data);
    return reply.status(201).send({ success: true, data });
  });

  fastify.get('/api/finances/closures', async (request, reply) => {
    const q = request.query as any;
    const data = listMonthlyClosures(rawDb, q.locationId);
    return reply.send({ success: true, data });
  });
};
