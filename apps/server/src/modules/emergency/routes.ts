import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { generateEmergencySlipsPdf, buildEmergencySlipTicketIR } from './slips-generator.js';
import { createDeferredPaperOrder, getDeferredOrders, type DeferredPaperOrderInput } from './emergency-service.js';
import { renderTicketToEscPos, generateUuidV7 } from '@tocineta/shared';
import { getPrinterConfig } from '../printing/worker.js';
import { getSessionUser } from '../auth/session.js';

interface EmergencyRoutesOptions {
  rawDb: Database.Database;
}

export const emergencyRoutes: FastifyPluginAsync<EmergencyRoutesOptions> = async (fastify, options) => {
  const { rawDb } = options;

  // Helper para autenticar sesión
  const getUserFromRequest = (req: any) => {
    const user = getSessionUser(rawDb, req.headers.authorization);
    if (!user) return null;
    return {
      id: user.userId,
      name: user.name,
      role: user.role
    };
  };

  /**
   * Descarga el PDF con las 200 comandas numeradas de emergencia para imprimir en lote
   */
  fastify.get('/api/emergency/slips-pdf', async (request, reply) => {
    try {
      const query = (request.query as any) || {};
      const count = parseInt(query.count, 10) || 200;

      const pdfBuffer = await generateEmergencySlipsPdf(count);

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="comandas-emergencia-${count}.pdf"`);
      return reply.send(pdfBuffer);
    } catch (err: any) {
      fastify.log.error(err, 'Error al generar PDF de comandas de emergencia');
      return reply.status(500).send({ error: 'Error al generar talonario PDF', details: err.message });
    }
  });

  /**
   * Encola la impresión térmica de comandas de emergencia en la impresora de caja
   */
  fastify.post('/api/emergency/print-slips', async (request, reply) => {
    const user = getUserFromRequest(request);
    if (!user || (user.role !== 'admin' && user.role !== 'supervisor')) {
      return reply.status(403).send({ error: 'Solo Admin o Supervisor pueden encolar impresión masiva de talonarios' });
    }

    const body = (request.body as any) || {};
    const startNum = parseInt(body.startNum, 10) || 1;
    const endNum = parseInt(body.endNum, 10) || Math.min(startNum + 9, 200);

    try {
      const now = Date.now();
      const queuedJobs: string[] = [];

      const cajaConfig = getPrinterConfig(rawDb, 'print_caja_usb');
      for (let i = startNum; i <= endNum; i++) {
        const ticketIR = buildEmergencySlipTicketIR(i);
        const escposBytes = Buffer.from(renderTicketToEscPos(ticketIR, cajaConfig));
        const printJobId = `pjob_${generateUuidV7()}`;

        rawDb.prepare(`
          INSERT INTO print_jobs (
            id, printer_id, order_id, job_type, payload_bytes,
            ticket_ir_json, station, status, attempts, created_at_ms
          ) VALUES (?, 'print_caja_usb', NULL, 'TEST', ?, ?, 'caja', 'en_cola', 0, ?)
        `).run(printJobId, escposBytes, JSON.stringify(ticketIR), now);

        queuedJobs.push(printJobId);
      }

      return reply.status(201).send({
        success: true,
        message: `Se encolaron ${queuedJobs.length} comandas de emergencia (#EMG-${startNum} a #EMG-${endNum})`,
        jobIds: queuedJobs
      });
    } catch (err: any) {
      fastify.log.error(err, 'Error al encolar impresión de comandas');
      return reply.status(500).send({ error: 'Error al encolar impresión', details: err.message });
    }
  });

  /**
   * Carga diferida de comanda de papel (Pantalla de transcripción de contingencia)
   */
  fastify.post('/api/emergency/deferred-orders', async (request, reply) => {
    const user = getUserFromRequest(request);
    if (!user || (user.role !== 'admin' && user.role !== 'supervisor' && user.role !== 'cajera')) {
      return reply.status(403).send({ error: 'Solo Cajera, Supervisor o Admin pueden transcribir comandas de papel' });
    }

    const body = request.body as DeferredPaperOrderInput;

    try {
      const result = await createDeferredPaperOrder(rawDb, body, user);
      return reply.status(201).send({
        success: true,
        message: `Comanda de papel ${result.slipNumber} cargada y auditada exitosamente`,
        data: result
      });
    } catch (err: any) {
      fastify.log.error(err, 'Error en transcripción de comanda de papel');
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        error: err.message || 'Error al transcribir comanda de papel',
        code: err.code
      });
    }
  });

  /**
   * Historial de comandas diferidas cargadas
   */
  fastify.get('/api/emergency/deferred-orders', async (_request, reply) => {
    try {
      const orders = getDeferredOrders(rawDb);
      return reply.send({ success: true, orders });
    } catch (err: any) {
      return reply.status(500).send({ error: 'Error al consultar comandas diferidas', details: err.message });
    }
  });
};
