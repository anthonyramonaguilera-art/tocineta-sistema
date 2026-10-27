import type { FastifyPluginAsync } from 'fastify';
import {
  listPartners,
  getPartnerById,
  createPartner,
  updatePartner,
  registerPartnerTransaction,
  distributeProfitsEquitably
} from './partners-service.js';
import { getDatabaseContext } from '../../db/connection.js';

export const businessPartnersRoutes: FastifyPluginAsync = async (fastify) => {
  const rawDb = (fastify as any).rawDb || getDatabaseContext().rawDb;

  // 1. Listar socios y estado del módulo
  fastify.get('/api/partners', async (_req, reply) => {
    try {
      const data = listPartners(rawDb);
      return reply.send({ success: true, ...data });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  });

  // 2. Detalle de socio con transacciones
  fastify.get('/api/partners/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const partner = getPartnerById(rawDb, id);
      if (!partner) {
        return reply.status(404).send({ success: false, message: 'Socio no encontrado' });
      }
      return reply.send({ success: true, partner });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  });

  // 3. Crear socio
  fastify.post('/api/partners', async (req, reply) => {
    try {
      const body = req.body as any;
      const partner = createPartner(rawDb, body);
      return reply.status(201).send({ success: true, partner });
    } catch (err: any) {
      return reply.status(400).send({ success: false, message: err.message });
    }
  });

  // 4. Actualizar socio
  fastify.put('/api/partners/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const partner = updatePartner(rawDb, id, body);
      return reply.send({ success: true, partner });
    } catch (err: any) {
      return reply.status(400).send({ success: false, message: err.message });
    }
  });

  // 5. Registrar Aporte o Retiro a cuenta de utilidades
  fastify.post('/api/partners/transactions', async (req, reply) => {
    try {
      const body = req.body as any;
      const user = (req as any).user || { id: 'usr_admin' };
      const updatedPartner = registerPartnerTransaction(rawDb, body, user.id);
      return reply.send({ success: true, partner: updatedPartner });
    } catch (err: any) {
      return reply.status(400).send({ success: false, message: err.message });
    }
  });

  // 6. Reparto de dividendos equitativo por porcentaje
  const distributeHandler = async (req: any, reply: any) => {
    try {
      const body = req.body as any;
      const user = (req as any).user || { id: 'usr_admin' };
      const totalAmount = body.totalDividendUsdCents ?? body.totalAmountUsdCents;
      const result = distributeProfitsEquitably(rawDb, totalAmount, body.notes, user.id);
      return reply.send({ ...result, ok: true });
    } catch (err: any) {
      return reply.status(400).send({ success: false, message: err.message });
    }
  };

  fastify.post('/api/partners/distribute', distributeHandler);
  fastify.post('/api/partners/distribute-profits', distributeHandler);

  // 7. Alternar activación del módulo de socios por la dueña
  fastify.post('/api/partners/toggle-module', async (req, reply) => {
    try {
      const body = req.body as { enabled: boolean };
      const val = body.enabled ? 1 : 0;
      rawDb.prepare('UPDATE business_settings SET partners_module_enabled = ?, updated_at_ms = ? WHERE id = ?').run(
        val, Date.now(), 'default'
      );
      return reply.send({ success: true, ok: true, enabled: Boolean(val), partnersModuleEnabled: Boolean(val) });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  });
};
