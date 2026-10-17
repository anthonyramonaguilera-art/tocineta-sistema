import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { healthRoutes } from './routes/health.js';
import { systemHealthRoutes } from './routes/system-health.js';
import { authRoutes } from './routes/auth.js';
import { menuRoutes } from './modules/menu/routes.js';
import { orderRoutes } from './modules/orders/routes.js';
import { cashierRoutes } from './modules/cashier/routes.js';
import { printingRoutes } from './modules/printing/routes.js';
import { kdsRoutes } from './modules/kds/routes.js';
import { PrintingWorker } from './modules/printing/worker.js';
import { getDatabaseContext } from './db/connection.js';
import { websocketPlugin } from './plugins/websocket.js';
import { staticPlugin } from './plugins/static.js';
import { idempotencyPlugin } from './modules/idempotency/idempotency-plugin.js';

declare module 'fastify' {
  interface FastifyInstance {
    printingWorker?: PrintingWorker;
  }
}

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

  // Inicializar PrintingWorker interno
  const dbCtx = getDatabaseContext();
  const worker = new PrintingWorker(dbCtx.rawDb, {
    mockTransports: process.env.NODE_ENV === 'test'
  });
  server.decorate('printingWorker', worker);

  if (process.env.NODE_ENV !== 'test') {
    worker.start(1500);
  }

  server.addHook('onClose', async () => {
    worker.stop();
  });

  // Registro de Plugins
  await server.register(idempotencyPlugin);
  await server.register(websocketPlugin);

  // Registro de Rutas
  await server.register(healthRoutes);
  await server.register(systemHealthRoutes);
  await server.register(authRoutes);
  await server.register(menuRoutes);
  await server.register(orderRoutes);
  await server.register(cashierRoutes);
  await server.register(printingRoutes);
  await server.register(kdsRoutes);

  if (!options.disableStatic) {
    await server.register(staticPlugin);
  }

  return server;
}
