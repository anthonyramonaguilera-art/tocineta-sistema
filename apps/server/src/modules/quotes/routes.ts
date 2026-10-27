import type { FastifyPluginAsync } from 'fastify';
import {
  listEventQuotations,
  getEventQuotationById,
  createEventQuotation,
  convertQuotationToReservation,
  deleteEventQuotation,
  generateQuotationWhatsAppText
} from './quotes-service.js';
import { generateQuotationPdf } from './quotes-pdf.js';
import { getDatabaseContext } from '../../db/connection.js';

export const eventQuotesRoutes: FastifyPluginAsync = async (fastify) => {
  const rawDb = (fastify as any).rawDb || getDatabaseContext().rawDb;

  // 1. Listar cotizaciones
  fastify.get('/api/quotes', async (_req, reply) => {
    try {
      const quotes = listEventQuotations(rawDb);
      return reply.send({ success: true, quotes });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  });

  // 2. Obtener cotización por ID con simulador y lista de compras
  fastify.get('/api/quotes/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const quote = getEventQuotationById(rawDb, id);
      if (!quote) {
        return reply.status(404).send({ success: false, message: 'Cotización no encontrada' });
      }
      return reply.send({ success: true, quotation: quote });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  });

  // 3. Crear nueva cotización
  fastify.post('/api/quotes', async (req, reply) => {
    try {
      const body = req.body as any;
      const user = (req as any).user || { id: 'usr_admin' };
      const created = createEventQuotation(rawDb, body, user.id);
      return reply.status(201).send({ success: true, ok: true, quote: created, quotation: created });
    } catch (err: any) {
      return reply.status(400).send({ success: false, message: err.message });
    }
  });

  // 4. Convertir cotización en reserva confirmada
  fastify.post('/api/quotes/:id/reserve', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const result = convertQuotationToReservation(rawDb, id);
      return reply.send({ success: true, ok: true, quote: result, quotation: result, shoppingList: result.shoppingList });
    } catch (err: any) {
      return reply.status(400).send({ success: false, message: err.message });
    }
  });

  // 5. Enlace y texto estructurado para WhatsApp
  fastify.get('/api/quotes/:id/whatsapp', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const result = generateQuotationWhatsAppText(rawDb, id);
      return reply.send({ success: true, ok: true, ...result, whatsappText: result.text, whatsappUrl: result.url });
    } catch (err: any) {
      return reply.status(400).send({ success: false, message: err.message });
    }
  });

  // 6. Descargar PDF formal para el cliente
  fastify.get('/api/quotes/:id/pdf', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const buffer = await generateQuotationPdf(rawDb, id);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="cotizacion_${id}.pdf"`);
      return reply.send(buffer);
    } catch (err: any) {
      return reply.status(400).send({ success: false, message: err.message });
    }
  });

  // 7. Eliminar cotización
  fastify.delete('/api/quotes/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const result = deleteEventQuotation(rawDb, id);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ success: false, message: err.message });
    }
  });
};
