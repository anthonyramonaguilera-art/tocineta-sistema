import type { FastifyPluginAsync } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { getDatabaseContext } from '../db/connection.js';
import {
  registerWebSocket,
  unregisterWebSocket,
  getLatestEventSeq
} from '../modules/events/event-bus.js';

export const websocketPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyWebsocket);

  fastify.get('/ws', { websocket: true }, (socket, _req) => {
    fastify.log.info('🔌 Cliente WebSocket conectado a la pasarela de eventos del Food Truck');
    registerWebSocket(socket);

    let latestSeq = 0;
    try {
      const dbCtx = getDatabaseContext();
      latestSeq = getLatestEventSeq(dbCtx.rawDb);
    } catch {}

    // Envío inicial de bienvenida con último seq registrado
    socket.send(JSON.stringify({
      event: 'CONNECTED',
      timestampUtcMs: Date.now(),
      latestSeq,
      message: 'Conectado al Sistema Operativo Local Tocineta Sonrie'
    }));

    socket.on('message', (message: Buffer | string | unknown) => {
      try {
        const raw = String(message);
        const data = JSON.parse(raw);
        if (data.type === 'PING') {
          socket.send(JSON.stringify({ type: 'PONG', timestampUtcMs: Date.now() }));
        }
      } catch {
        // Ignora payloads no JSON
      }
    });

    socket.on('close', () => {
      unregisterWebSocket(socket);
      fastify.log.info('🔌 Cliente WebSocket desconectado');
    });

    socket.on('error', () => {
      unregisterWebSocket(socket);
    });
  });
};
