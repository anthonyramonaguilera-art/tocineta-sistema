import type { FastifyPluginAsync } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';

export const websocketPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyWebsocket);

  fastify.get('/ws', { websocket: true }, (socket, _req) => {
    fastify.log.info('🔌 Cliente WebSocket conectado a la pasarela de eventos del Food Truck');

    // Envío inicial de bienvenida
    socket.send(JSON.stringify({
      event: 'CONNECTED',
      timestampUtcMs: Date.now(),
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
      fastify.log.info('🔌 Cliente WebSocket desconectado');
    });
  });
};
