/**
 * SISTEMA OPERATIVO LOCAL TOCINETA
 * Rutas de Impresión Asíncrona, Vista Previa HTML, Reimpresión y Diagnóstico (Fastify)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { renderTicketToHtml, renderTicketToEscPos, type TicketIR, type EscPosConfig } from '@tocineta/shared';
import type { UserRole } from '../../db/schema.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import {
  reprintPrintJob,
  resolveAttentionJob,
  createRefirePrintJob,
  sendWindowsRawEscPos,
  sendTcpEscPos,
  type PrinterRow
} from './worker.js';

import { getDatabaseContext } from '../../db/connection.js';

function getSessionUser(
  rawDb: any,
  authHeader?: string
): { userId: string; role: UserRole } | null {
  const token = extractSessionToken(authHeader);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const now = Date.now();
  const row = rawDb.prepare(`
    SELECT s.user_id, s.role, u.is_active
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL AND s.expires_at_ms > ?
  `).get(tokenHash, now) as { user_id: string; role: UserRole; is_active: number } | undefined;

  if (!row || !row.is_active) return null;
  return { userId: row.user_id, role: row.role };
}

export const printingRoutes: FastifyPluginAsync = async (fastify) => {
  const dbCtx = getDatabaseContext();
  const rawDb = dbCtx.rawDb;

  // 1. Listar impresoras configuradas
  fastify.get('/api/printers', async (_request, reply) => {
    const list = rawDb.prepare(`
      SELECT id, name, connection_type, address, columns, codepage, has_cutter, has_buzzer, is_active
      FROM printers
      ORDER BY id ASC
    `).all() as PrinterRow[];

    return reply.send({ data: list });
  });

  // 1.1 Listar impresoras detectadas en Windows (GET /api/printers/windows)
  fastify.get('/api/printers/windows', async (_request, reply) => {
    if (process.platform !== 'win32' || process.env.PRINTER_DEV_SIMULATION === 'true') {
      return reply.send([]);
    }
    try {
      const result = await new Promise<string>((resolve, reject) => {
        execFile(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            'Get-Printer | Select-Object Name, PortName, DriverName, PrinterStatus | ConvertTo-Json -Compress'
          ],
          { timeout: 5000 },
          (err, stdout, stderr) => {
            if (err) {
              return reject(new Error(stderr.trim() || err.message));
            }
            resolve(stdout.trim());
          }
        );
      });

      if (!result) {
        return reply.send([]);
      }
      const parsed = JSON.parse(result);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return reply.send(list);
    } catch {
      return reply.send([]);
    }
  });

  // 1.2 Actualizar configuración o conmutar USB / Red LAN (PATCH /api/printers/:id) - Solo ADMIN
  fastify.patch('/api/printers/:id', async (request, reply) => {
    const user = getSessionUser(rawDb, request.headers.authorization);
    if (!user || user.role !== 'admin') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Solo el rol ADMIN puede modificar la configuración de impresoras' });
    }

    const { id } = request.params as { id: string };
    const patchSchema = z.object({
      address: z.string().optional(),
      codepage: z.union([z.literal(16), z.literal(2)]).optional(),
      has_cutter: z.union([z.boolean(), z.number()]).optional(),
      has_buzzer: z.union([z.boolean(), z.number()]).optional(),
      name: z.string().optional(),
      connection_type: z.string().optional(),
      is_active: z.union([z.boolean(), z.number()]).optional()
    });

    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'Parámetros de actualización de impresora inválidos',
        issues: parsed.error.issues
      });
    }

    const existing = rawDb.prepare('SELECT * FROM printers WHERE id = ?').get(id) as PrinterRow | undefined;
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Impresora no encontrada' });
    }

    const body = parsed.data;
    const newAddress = body.address !== undefined ? body.address : existing.address;
    const newCodepage = body.codepage !== undefined ? body.codepage : existing.codepage;
    const newHasCutter = body.has_cutter !== undefined ? (typeof body.has_cutter === 'boolean' ? (body.has_cutter ? 1 : 0) : body.has_cutter) : existing.has_cutter;
    const newHasBuzzer = body.has_buzzer !== undefined ? (typeof body.has_buzzer === 'boolean' ? (body.has_buzzer ? 1 : 0) : body.has_buzzer) : existing.has_buzzer;
    const newName = body.name !== undefined ? body.name : existing.name;
    const newConnType = body.connection_type !== undefined ? body.connection_type : existing.connection_type;
    const newActive = body.is_active !== undefined ? (typeof body.is_active === 'boolean' ? (body.is_active ? 1 : 0) : body.is_active) : existing.is_active;

    rawDb.prepare(`
      UPDATE printers
      SET connection_type = ?, address = ?, name = ?, codepage = ?, has_cutter = ?, has_buzzer = ?, is_active = ?
      WHERE id = ?
    `).run(newConnType, newAddress, newName, newCodepage, newHasCutter, newHasBuzzer, newActive, id);

    return reply.send({
      success: true,
      printer: {
        id,
        name: newName,
        connection_type: newConnType,
        address: newAddress,
        codepage: newCodepage,
        has_cutter: newHasCutter,
        has_buzzer: newHasBuzzer,
        is_active: newActive
      }
    });
  });

  // 1.3 Enviar ticket de prueba directo (POST /api/printers/:id/test) - Solo ADMIN
  fastify.post('/api/printers/:id/test', async (request, reply) => {
    const user = getSessionUser(rawDb, request.headers.authorization);
    if (!user || user.role !== 'admin') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Solo el rol ADMIN puede realizar pruebas de impresión' });
    }

    const { id } = request.params as { id: string };
    const printer = rawDb.prepare('SELECT * FROM printers WHERE id = ?').get(id) as PrinterRow | undefined;
    if (!printer) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        diagnostic: 'no encontrada',
        message: 'Impresora no encontrada'
      });
    }

    // Arma un Ticket IR de prueba (á é í ó ú ñ ¿ ¡ $ Bs, 32 columns, negrita e invertido)
    const testIr: TicketIR = {
      widthColumns: 32,
      blocks: [
        { type: 'banner_inverted', text: 'TOCINETA PRUEBA' },
        { type: 'title_double', text: 'TEST IMPRESORA', align: 'center' },
        { type: 'separator', style: 'single' },
        { type: 'text', text: 'Caracteres: á é í ó ú ñ ¿ ¡ $ Bs', align: 'left' },
        { type: 'text', text: 'Texto en Negrita', bold: true },
        { type: 'separator', style: 'dashed' },
        { type: 'cut', feedLines: 2 }
      ]
    };

    const pConfig: EscPosConfig = {
      columns: printer.columns || 32,
      codepage: printer.codepage || 16,
      hasCutter: Boolean(printer.has_cutter),
      hasBuzzer: Boolean(printer.has_buzzer)
    };

    let payload: Buffer;
    try {
      payload = Buffer.from(renderTicketToEscPos(testIr, pConfig));
    } catch (renderErr: any) {
      return reply.status(400).send({
        error: 'RENDER_ERROR',
        diagnostic: 'error de renderizado',
        message: renderErr.message
      });
    }

    if (process.env.PRINTER_DEV_SIMULATION === 'true' || process.platform !== 'win32') {
      return reply.send({
        success: true,
        simulated: true,
        diagnostic: 'simulated',
        bytesSent: payload.length
      });
    }

    try {
      const connType = (printer.connection_type || '').toLowerCase();
      if (connType.includes('tcp') || connType.includes('9100')) {
        let host = printer.address;
        let port = 9100;
        if (host.includes(':')) {
          const parts = host.split(':');
          host = parts[0];
          port = parseInt(parts[1], 10) || 9100;
        }
        await sendTcpEscPos(host, port, payload, 4000);
      } else {
        await sendWindowsRawEscPos(printer.address, payload, 'Tocineta_Test', 4000);
      }

      return reply.send({
        success: true,
        simulated: false,
        diagnostic: 'impreso',
        bytesSent: payload.length
      });
    } catch (err: any) {
      const msg = (err.message || '').toLowerCase();
      let diagnostic = 'error de spooler';
      if (msg.includes('timeout') || msg.includes('etimedout')) {
        diagnostic = 'timeout';
      } else if (msg.includes('connect') || msg.includes('econnrefused') || msg.includes('offline')) {
        diagnostic = 'offline';
      } else if (msg.includes('not found') || msg.includes('no encontrada')) {
        diagnostic = 'no encontrada';
      }

      return reply.status(400).send({
        error: 'PRINT_TEST_FAILED',
        diagnostic,
        message: err.message
      });
    }
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

  // 4. Reimpresión manual con PIN y motivo (o rápida por omisión)
  fastify.post('/api/print-jobs/:id/reprint', async (request, reply) => {
    const { id } = request.params as { id: string };
    const bodySchema = z.object({
      pin: z.string().min(4).max(6).optional().default('1111'),
      reason: z.string().min(3).max(255).optional().default('Reimpresión rápida')
    });

    const parsed = bodySchema.safeParse(request.body || {});
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

  // 4.1 Liberar trabajo pendiente (POST /api/print-jobs/:id/release)
  fastify.post('/api/print-jobs/:id/release', async (request, reply) => {
    const user = getSessionUser(rawDb, request.headers.authorization);
    if (!user || user.role === 'cocinero') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Rol no autorizado para liberar trabajos de impresión' });
    }

    const { id } = request.params as { id: string };
    const job = rawDb.prepare('SELECT id, status FROM print_jobs WHERE id = ?').get(id) as { id: string; status: string } | undefined;
    if (!job) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: `Trabajo de impresión ${id} no encontrado` });
    }

    if (job.status !== 'pending') {
      return reply.status(409).send({ error: 'CONFLICT', status: job.status, message: `El trabajo no se encuentra en estado pending (estado actual: ${job.status})` });
    }

    const result = rawDb.prepare("UPDATE print_jobs SET status = 'en_cola' WHERE id = ? AND status = 'pending'").run(id);
    if (result.changes === 0) {
      const current = rawDb.prepare('SELECT status FROM print_jobs WHERE id = ?').get(id) as { status: string } | undefined;
      return reply.status(409).send({ error: 'CONFLICT', status: current?.status || 'unknown', message: 'No se pudo liberar el trabajo de impresión' });
    }

    if (fastify.printingWorker) {
      fastify.printingWorker.trigger();
    }

    return reply.send({ success: true, status: 'en_cola' });
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
