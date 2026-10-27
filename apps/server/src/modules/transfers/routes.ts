/**
 * SISTEMA OPERATIVO TOCINETA — RUTAS DE FASE 4 (ENVÍOS, PRODUCCIÓN, DUEÑA)
 */

import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import {
  calculateDishEquivalents,
  createTransfer,
  confirmTransferReception,
  getTransfers,
  getTransferBatches,
  createTransferBatch,
  updateTransferBatch,
  deleteTransferBatch
} from './transfers-service.js';
import { registerProduction, getProductionLogs } from './production-service.js';
import {
  generateDispatchNotePdf,
  buildDispatchNoteTicketIR,
  buildWhatsAppTransferText,
  type DispatchNoteData
} from './pdf-service.js';
import { getOwnerDashboardData } from './owner-dashboard-service.js';

export const fase4Routes: FastifyPluginAsync = async (fastify) => {
  const getUserFromRequest = (req: any) => {
    const dbCtx = getDatabaseContext();
    const rawToken = extractSessionToken(req.headers.authorization);
    if (!rawToken) return null;
    const tokenHash = hashToken(rawToken);
    const session = dbCtx.rawDb.prepare(`
      SELECT s.user_id, u.name, u.role
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL
    `).get(tokenHash) as { user_id: string; name: string; role: string } | undefined;

    return session || null;
  };

  // Helper para armar datos de la nota de despacho para PDF / Ticket IR
  const buildNoteData = (rawDb: any, transfer: any): DispatchNoteData => {
    const fromLoc = rawDb.prepare('SELECT name FROM locations WHERE id = ?').get(transfer.from_location_id) as any;
    const toLoc = rawDb.prepare('SELECT name FROM locations WHERE id = ?').get(transfer.to_location_id) as any;
    const creator = rawDb.prepare('SELECT name FROM users WHERE id = ?').get(transfer.created_by_user_id) as any;
    const receiver = transfer.received_by_user_id ? rawDb.prepare('SELECT name FROM users WHERE id = ?').get(transfer.received_by_user_id) as any : null;

    let dishEq = null;
    if (transfer.dish_equivalents_json) {
      try {
        const rawEq = JSON.parse(transfer.dish_equivalents_json);
        dishEq = rawEq.map((d: any) => {
          const p = rawDb.prepare('SELECT name FROM products WHERE id = ?').get(d.productId) as any;
          return { productId: d.productId, productName: p?.name || d.productId, quantity: d.quantity };
        });
      } catch {}
    }

    return {
      dispatchNoteCode: transfer.dispatch_note_code,
      fromLocationName: fromLoc?.name || transfer.from_location_id,
      toLocationName: toLoc?.name || transfer.to_location_id,
      status: transfer.status,
      mode: transfer.mode,
      createdAtMs: transfer.created_at_ms,
      createdByName: creator?.name || 'Administración',
      receivedByName: receiver?.name || null,
      receivedAtMs: transfer.received_at_ms,
      items: JSON.parse(transfer.items_json),
      dishEquivalents: dishEq,
      forcedWithPin: Boolean(transfer.forced_with_pin),
      forceReason: transfer.force_reason,
      notes: transfer.notes
    };
  };

  // 1. Calcular equivalente de platos (POST /api/fase4/transfers/calculate-dish-equivalents)
  fastify.post('/api/fase4/transfers/calculate-dish-equivalents', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = request.body as { fromLocationId?: string; dishes?: Array<{ productId: string; quantity: number }> };
    const fromLoc = body?.fromLocationId || 'loc_los_olivos';
    const dishes = body?.dishes || [];

    const result = calculateDishEquivalents(dbCtx.rawDb, fromLoc, dishes);
    return reply.status(200).send({ success: true, ...result });
  });

  // 2. Crear transferencia (POST /api/fase4/transfers)
  fastify.post('/api/fase4/transfers', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as any;

    try {
      const transfer = createTransfer(dbCtx.rawDb, {
        fromLocationId: body.fromLocationId,
        toLocationId: body.toLocationId,
        mode: body.mode || 'LOOSE_SUPPLIES',
        items: body.items,
        dishEquivalents: body.dishEquivalents,
        batchId: body.batchId,
        notes: body.notes,
        forceWithPin: body.forceWithPin,
        forceReason: body.forceReason,
        supervisorPin: body.supervisorPin,
        requireTransit: body.requireTransit,
        createdByUserId: user?.user_id || 'usr_admin'
      });

      return reply.status(201).send({ success: true, transfer });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        error: err.message,
        insufficientItems: err.insufficientItems
      });
    }
  });

  // 3. Confirmar recepción en destino (POST /api/fase4/transfers/:id/receive)
  fastify.post('/api/fase4/transfers/:id/receive', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const { id } = request.params as { id: string };

    try {
      const transfer = confirmTransferReception(dbCtx.rawDb, id, user?.user_id || 'usr_admin');
      return reply.status(200).send({ success: true, transfer });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({ success: false, error: err.message });
    }
  });

  // 4. Listar transferencias (GET /api/fase4/transfers)
  fastify.get('/api/fase4/transfers', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const query = request.query as any;
    const list = getTransfers(dbCtx.rawDb, {
      status: query?.status,
      locationId: query?.locationId,
      limit: query?.limit ? parseInt(query.limit, 10) : 50
    });
    return reply.status(200).send({ success: true, transfers: list });
  });

  // 5. Descargar Nota de Despacho en PDF (GET /api/fase4/transfers/:id/pdf)
  fastify.get('/api/fase4/transfers/:id/pdf', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };

    const transfer = dbCtx.rawDb.prepare('SELECT * FROM inter_location_transfers WHERE id = ?').get(id) as any;
    if (!transfer) {
      return reply.status(404).send({ success: false, error: 'Nota de despacho no encontrada' });
    }

    const noteData = buildNoteData(dbCtx.rawDb, transfer);
    const pdfBuffer = await generateDispatchNotePdf(noteData);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="nota-despacho-${transfer.dispatch_note_code}.pdf"`);
    return reply.send(pdfBuffer);
  });

  // 6. Obtener Ticket IR 58mm (GET /api/fase4/transfers/:id/ticket-ir)
  fastify.get('/api/fase4/transfers/:id/ticket-ir', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };

    const transfer = dbCtx.rawDb.prepare('SELECT * FROM inter_location_transfers WHERE id = ?').get(id) as any;
    if (!transfer) {
      return reply.status(404).send({ success: false, error: 'Nota de despacho no encontrada' });
    }

    const noteData = buildNoteData(dbCtx.rawDb, transfer);
    const ticketIr = buildDispatchNoteTicketIR(noteData);
    return reply.status(200).send({ success: true, ticketIr });
  });

  // 7. Texto formateado para WhatsApp (GET /api/fase4/transfers/:id/whatsapp-text)
  fastify.get('/api/fase4/transfers/:id/whatsapp-text', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };

    const transfer = dbCtx.rawDb.prepare('SELECT * FROM inter_location_transfers WHERE id = ?').get(id) as any;
    if (!transfer) {
      return reply.status(404).send({ success: false, error: 'Nota de despacho no encontrada' });
    }

    const noteData = buildNoteData(dbCtx.rawDb, transfer);
    const text = buildWhatsAppTransferText(noteData);
    return reply.status(200).send({ success: true, text, dispatchNoteCode: transfer.dispatch_note_code });
  });

  // 8. Lotes Preconfigurados (Batches CRUD)
  fastify.get('/api/fase4/transfer-batches', async (_req, reply) => {
    const dbCtx = getDatabaseContext();
    const batches = getTransferBatches(dbCtx.rawDb);
    return reply.status(200).send({ success: true, batches });
  });

  fastify.post('/api/fase4/transfer-batches', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = request.body as any;
    if (!body?.name?.trim() || !body?.items?.length) {
      return reply.status(400).send({ success: false, error: 'Nombre e insumos requeridos para crear el lote' });
    }
    const created = createTransferBatch(dbCtx.rawDb, body);
    return reply.status(201).send({ success: true, batch: created });
  });

  fastify.patch('/api/fase4/transfer-batches/:id', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };
    const body = request.body as any;
    try {
      const updated = updateTransferBatch(dbCtx.rawDb, id, body);
      return reply.status(200).send({ success: true, batch: updated });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({ success: false, error: err.message });
    }
  });

  fastify.delete('/api/fase4/transfer-batches/:id', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };
    deleteTransferBatch(dbCtx.rawDb, id);
    return reply.status(200).send({ success: true, message: 'Lote eliminado' });
  });

  // 9. Registrar Producción en Sede A (POST /api/fase4/production)
  fastify.post('/api/fase4/production', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as any;

    try {
      const log = registerProduction(dbCtx.rawDb, {
        locationId: body.locationId || 'loc_los_olivos',
        targetType: body.targetType,
        targetId: body.targetId,
        quantityProduced: parseFloat(body.quantityProduced),
        producedByUserId: user?.user_id || 'usr_admin',
        notes: body.notes
      });
      return reply.status(201).send({ success: true, productionLog: log });
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({ success: false, error: err.message });
    }
  });

  fastify.get('/api/fase4/production', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const query = request.query as any;
    const logs = getProductionLogs(dbCtx.rawDb, query?.locationId, query?.limit ? parseInt(query.limit, 10) : 20);
    return reply.status(200).send({ success: true, productionLogs: logs });
  });

  // 10. Panel de la Dueña (GET /api/fase4/owner-dashboard)
  fastify.get('/api/fase4/owner-dashboard', async (_req, reply) => {
    const dbCtx = getDatabaseContext();
    const data = getOwnerDashboardData(dbCtx.rawDb);
    return reply.status(200).send({ success: true, dashboard: data });
  });

  // 11. Configuración de Fase 4 (GET & PATCH /api/fase4/settings)
  fastify.get('/api/fase4/settings', async (_req, reply) => {
    const dbCtx = getDatabaseContext();
    const row = dbCtx.rawDb.prepare('SELECT production_module_enabled, transfers_require_transit FROM business_settings LIMIT 1').get() as any;
    return reply.status(200).send({
      success: true,
      settings: {
        productionModuleEnabled: Boolean(row?.production_module_enabled ?? 1),
        transfersRequireTransit: Boolean(row?.transfers_require_transit ?? 0)
      }
    });
  });

  fastify.patch('/api/fase4/settings', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = request.body as any;

    if (body.productionModuleEnabled !== undefined) {
      dbCtx.rawDb.prepare('UPDATE business_settings SET production_module_enabled = ?').run(body.productionModuleEnabled ? 1 : 0);
    }
    if (body.transfersRequireTransit !== undefined) {
      dbCtx.rawDb.prepare('UPDATE business_settings SET transfers_require_transit = ?').run(body.transfersRequireTransit ? 1 : 0);
    }

    const updated = dbCtx.rawDb.prepare('SELECT production_module_enabled, transfers_require_transit FROM business_settings LIMIT 1').get() as any;
    return reply.status(200).send({
      success: true,
      settings: {
        productionModuleEnabled: Boolean(updated?.production_module_enabled ?? 1),
        transfersRequireTransit: Boolean(updated?.transfers_require_transit ?? 0)
      }
    });
  });
};
