import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { getDatabaseContext } from '../../db/connection.js';
import {
  checkIdempotency,
  saveIdempotentResponse
} from './idempotency-service.js';

export const idempotencyPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.addHook('preHandler', async (request, reply) => {
    const rawKey = request.headers['idempotency-key'];
    if (!rawKey || typeof rawKey !== 'string') {
      return;
    }

    const idempotencyKey = rawKey.trim();
    const dbCtx = getDatabaseContext();

    try {
      const check = checkIdempotency(
        dbCtx.rawDb,
        idempotencyKey,
        request.method,
        request.url,
        request.body
      );

      if (check.isConflict) {
        return reply.status(409).send({
          success: false,
          error: 'Conflicto de idempotencia: el cuerpo de la petición difiere del registrado previamente con esta clave.'
        });
      }

      if (check.isCached && check.cachedResponse) {
        reply.header('X-Cache', 'IDEMPOTENT');
        return reply.status(check.cachedResponse.statusCode).send(check.cachedResponse.body);
      }

      // Guardar el hash en el contexto del request para el hook onSend
      (request as any).__idempotency = {
        key: idempotencyKey,
        requestHash: check.requestHash
      };
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: err.message || 'Error validando clave de idempotencia'
      });
    }
  });

  fastify.addHook('onSend', async (request, reply, payload) => {
    const idempMeta = (request as any).__idempotency;
    const isCached = reply.getHeader('X-Cache') === 'IDEMPOTENT';

    if (idempMeta && !isCached && reply.statusCode < 500) {
      try {
        const dbCtx = getDatabaseContext();
        let bodyToSave: unknown = payload;
        try {
          bodyToSave = typeof payload === 'string' ? JSON.parse(payload) : payload;
        } catch {}

        saveIdempotentResponse(
          dbCtx.rawDb,
          idempMeta.key,
          request.method,
          request.url,
          idempMeta.requestHash,
          reply.statusCode,
          bodyToSave
        );
      } catch (err) {
        fastify.log.warn({ err }, 'Error al guardar respuesta idempotente');
      }
    }
    return payload;
  });
});
