import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { healthRoutes } from './routes/health.js';
import { systemHealthRoutes } from './routes/system-health.js';
import { websocketPlugin } from './plugins/websocket.js';
import { staticPlugin } from './plugins/static.js';

export interface BuildServerOptions {
  logger?: FastifyServerOptions['logger'];
  disableStatic?: boolean;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

  const defaultLogger: FastifyServerOptions['logger'] = isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname'
          }
        }
      }
    : true;

  const server = Fastify({
    logger: options.logger !== undefined ? options.logger : defaultLogger
  });

  // Registro de Plugins
  await server.register(websocketPlugin);

  // Registro de Rutas
  await server.register(healthRoutes);
  await server.register(systemHealthRoutes);

  if (!options.disableStatic) {
    await server.register(staticPlugin);
  }

  return server;
}
