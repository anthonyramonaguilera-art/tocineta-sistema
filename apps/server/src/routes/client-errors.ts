import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../db/connection.js';
import { generateUuidV7 } from '@tocineta/shared';
import { ensureBusinessSettingsDefensive } from '../db/business-settings.js';

export const clientErrorsRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. Reportar error de cliente (ErrorBoundary)
  fastify.post('/api/client-errors', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = (request.body || {}) as {
      viewName?: string;
      errorMessage?: string;
      errorStack?: string;
      userId?: string;
      userRole?: string;
    };

    const id = `err_${generateUuidV7()}`;
    const viewName = String(body.viewName || 'unknown').slice(0, 100);
    const errorMessage = String(body.errorMessage || 'Error no especificado').slice(0, 1000);
    const errorStack = body.errorStack ? String(body.errorStack).slice(0, 5000) : null;
    const userId = body.userId ? String(body.userId).slice(0, 100) : null;
    const userRole = body.userRole ? String(body.userRole).slice(0, 50) : null;
    const now = Date.now();

    try {
      dbCtx.rawDb.prepare(`
        INSERT INTO client_errors (
          id, view_name, error_message, error_stack, user_id, user_role, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, viewName, errorMessage, errorStack, userId, userRole, now);

      return reply.status(201).send({ success: true, id });
    } catch (err: any) {
      fastify.log.error(err, 'Fallo al registrar client_error en SQLite');
      return reply.status(200).send({ success: false, error: err.message });
    }
  });

  // 2. Listar errores de cliente para Administrador
  fastify.get('/api/client-errors', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    try {
      const errors = dbCtx.rawDb.prepare(`
        SELECT id, view_name, error_message, error_stack, user_id, user_role, created_at_ms
        FROM client_errors
        ORDER BY created_at_ms DESC
        LIMIT 100
      `).all();

      return reply.status(200).send({ success: true, errors });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // 3. Obtener Business Settings (incluyendo blind_closure_enabled)
  fastify.get('/api/business-settings', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    try {
      const settings = ensureBusinessSettingsDefensive(dbCtx.rawDb);
      return reply.status(200).send({
        success: true,
        settings: {
          businessName: settings.business_name,
          rif: settings.rif,
          phone: settings.phone,
          address: settings.address,
          blindClosureEnabled: Boolean(settings.blind_closure_enabled),
          posFeeBps: settings.pos_fee_bps,
          deliveryAccountingMode: settings.delivery_accounting_mode,
          tableServiceMode: settings.table_service_mode
        }
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // 4. Modificar Business Settings (incluyendo blind_closure_enabled)
  fastify.patch('/api/business-settings', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = (request.body || {}) as {
      blindClosureEnabled?: boolean;
      businessName?: string;
      phone?: string;
      address?: string;
    };

    try {
      const existing = ensureBusinessSettingsDefensive(dbCtx.rawDb);
      const newBlind = body.blindClosureEnabled !== undefined
        ? (body.blindClosureEnabled ? 1 : 0)
        : existing.blind_closure_enabled;
      const newName = body.businessName || existing.business_name;
      const newPhone = body.phone || existing.phone;
      const newAddress = body.address || existing.address;

      dbCtx.rawDb.prepare(`
        UPDATE business_settings
        SET blind_closure_enabled = ?,
            business_name = ?,
            phone = ?,
            address = ?,
            updated_at_ms = ?
        WHERE id = 'default'
      `).run(newBlind, newName, newPhone, newAddress, Date.now());

      return reply.status(200).send({
        success: true,
        settings: {
          businessName: newName,
          phone: newPhone,
          address: newAddress,
          blindClosureEnabled: Boolean(newBlind)
        }
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
};
