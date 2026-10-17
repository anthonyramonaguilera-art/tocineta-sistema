/**
 * SISTEMA OPERATIVO LOCAL TOCINETA SONRÍE (Varons Media)
 * Rutas de Impresión Asíncrona, Vista Previa HTML y Reimpresión (Fastify)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { renderTicketToHtml, type TicketIR } from '@tocineta/shared';
import {
  reprintPrintJob,
  resolveAttentionJob,
  createRefirePrintJob,
  type PrinterRow
} from './worker.js';

import { getDatabaseContext } from '../../db/connection.js';

export const printingRoutes: FastifyPluginAsync = async (fastify) => {
  const dbCtx = getDatabaseContext();
  const rawDb = dbCtx.rawDb;

  // 1. Listar impresoras configuradas
  fastify.get('/api/printers', async (_request, reply) => {
    const list = rawDb.prepare(`
      SELECT id, name, connection_type, address, columns, codepage, is_active
      FROM printers
      ORDER BY id ASC
    `).all() as PrinterRow[];

    return reply.send({ data: list });
  });

  // 2. Listar trabajos de impresión
  fastify.get('/api/print-jobs', async (request, reply) => {
    const querySchema = z.object({
      status: z.string().optional(),
      orderId: z.string().optional(),
      printerId: z.string().optional(),
      limit: z.coerce.number().min(1).max(100).default(30)
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'Parámetros de consulta inválidos',
        issues: parsed.error.issues
      });
    }

    const { status, orderId, printerId, limit } = parsed.data;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      conditions.push('pj.status = ?');
      params.push(status);
    }
    if (orderId) {
      conditions.push('pj.order_id = ?');
      params.push(orderId);
    }
    if (printerId) {
      conditions.push('pj.printer_id = ?');
      params.push(printerId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    const jobs = rawDb.prepare(`
      SELECT 
        pj.id, pj.printer_id, pj.order_id, pj.job_type,
        pj.ticket_ir_json, pj.station, pj.status, pj.error_message,
        pj.attempts, pj.max_attempts, pj.reprint_count,
        pj.reprint_reason, pj.reprinted_by_user_id,
        pj.created_at_ms, pj.completed_at_ms,
        p.name as printer_name, p.connection_type,
        o.order_number
      FROM print_jobs pj
      JOIN printers p ON pj.printer_id = p.id
      LEFT JOIN orders o ON pj.order_id = o.id
      ${whereClause}
      ORDER BY pj.created_at_ms DESC
      LIMIT ?
    `).all(...params);

    return reply.send({ data: jobs });
  });

  // 3. Vista previa idéntica en HTML
  fastify.get('/api/print-jobs/:id/preview', async (request, reply) => {
    const { id } = request.params as { id: string };

    const job = rawDb.prepare(`
      SELECT id, ticket_ir_json, job_type, order_id, status
      FROM print_jobs
      WHERE id = ?
    `).get(id) as { id: string; ticket_ir_json: string | null; job_type: string; order_id: string | null; status: string } | undefined;

    if (!job) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: `Trabajo de impresión ${id} no encontrado`
      });
    }

    if (!job.ticket_ir_json) {
      return reply.status(400).send({
        error: 'NO_IR_DATA',
        message: 'El trabajo no cuenta con representación intermedia Ticket IR'
      });
    }

    const ir = JSON.parse(job.ticket_ir_json) as TicketIR;
    const html = renderTicketToHtml(ir);

    return reply.send({
      id: job.id,
      jobType: job.job_type,
      orderId: job.order_id,
      status: job.status,
      ir,
      html
    });
  });

  // 4. Reimpresión manual con PIN y motivo
  fastify.post('/api/print-jobs/:id/reprint', async (request, reply) => {
    const { id } = request.params as { id: string };
    const bodySchema = z.object({
      pin: z.string().min(4).max(6),
      reason: z.string().min(3).max(255)
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'PIN (4-6 dígitos) y motivo requeridos para reimpresión',
        issues: parsed.error.issues
      });
    }

    try {
      const result = reprintPrintJob(rawDb, {
        jobId: id,
        pin: parsed.data.pin,
        reason: parsed.data.reason
      });

      // Disparar procesamiento del worker
      if (fastify.printingWorker) {
        fastify.printingWorker.trigger();
      }

      return reply.status(201).send(result);
    } catch (err: any) {
      const isForbidden = err.message.includes('Rol no autorizado') || err.message.includes('cocinero');
      const statusCode = isForbidden ? 403 : 400;
      return reply.status(statusCode).send({
        error: isForbidden ? 'FORBIDDEN' : 'BAD_REQUEST',
        message: err.message
      });
    }
  });

  // 5. Resolver trabajo con estado 'requiere_atencion'
  fastify.post('/api/print-jobs/:id/resolve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const bodySchema = z.object({
      action: z.enum(['mark_printed', 'retry_now'])
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: "Acción requerida: 'mark_printed' o 'retry_now'",
        issues: parsed.error.issues
      });
    }

    try {
      const result = resolveAttentionJob(rawDb, id, parsed.data.action);
      if (parsed.data.action === 'retry_now' && fastify.printingWorker) {
        fastify.printingWorker.trigger();
      }
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: err.message
      });
    }
  });

  // 6. Reposición urgente sin cobro (Re-fire de cocina)
  fastify.post('/api/print-jobs/refire', async (request, reply) => {
    const bodySchema = z.object({
      orderId: z.string(),
      reason: z.string().min(3),
      pin: z.string().min(4).max(6)
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'orderId, reason y pin requeridos',
        issues: parsed.error.issues
      });
    }

    try {
      const result = createRefirePrintJob(
        rawDb,
        parsed.data.orderId,
        parsed.data.reason,
        parsed.data.pin
      );

      if (fastify.printingWorker) {
        fastify.printingWorker.trigger();
      }

      return reply.status(201).send(result);
    } catch (err: any) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: err.message
      });
    }
  });
};
