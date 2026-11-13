import type { FastifyPluginAsync } from 'fastify';
import { formatCaracasDateTime, type HealthResponse } from '@tocineta/shared';
import { getDatabaseContext } from '../db/connection.js';
import { getServerId } from '../lib/server-id.js';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/health', async (_req, reply) => {
    const dbCtx = getDatabaseContext();
    const pragmas = dbCtx.getPragmas();

    const response: HealthResponse = {
      status: 'ok',
      version: '0.1.0',
      db: 'wal_full',
      journalMode: pragmas.journalMode,
      synchronous: pragmas.synchronous,
      foreignKeys: pragmas.foreignKeys,
      timestampUtcMs: Date.now(),
      localTimeCaracas: formatCaracasDateTime(),
      serverId: getServerId()
    };

    return reply.status(200).send(response);
  });
};
