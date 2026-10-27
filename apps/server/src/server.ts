import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';
import { systemHealthRoutes } from './routes/system-health.js';
import { authRoutes } from './routes/auth.js';
import { menuRoutes } from './modules/menu/routes.js';
import { orderRoutes } from './modules/orders/routes.js';
import { cashierRoutes } from './modules/cashier/routes.js';
import { printingRoutes } from './modules/printing/routes.js';
import { kdsRoutes } from './modules/kds/routes.js';
import { closuresRoutes } from './modules/closures/routes.js';
import { incidentsRoutes } from './modules/incidents/routes.js';
import { reportsRoutes } from './modules/reports/routes.js';
import { backupsRoutes } from './modules/backups/routes.js';
import { emergencyRoutes } from './modules/emergency/routes.js';
import { deliveryRoutes } from './modules/delivery/routes.js';
import { couponRoutes } from './modules/coupons/routes.js';
import { supportRoutes } from './modules/support/routes.js';
import { updaterRoutes } from './modules/updater/routes.js';
import { qrMenuRoutes } from './modules/qr-menu/routes.js';
import { profitabilityRoutes } from './modules/profitability/routes.js';
import { fase3Routes } from './modules/profitability/fase3-routes.js';
import { fase4Routes } from './modules/transfers/routes.js';
import { financesRoutes } from './modules/finances/routes.js';
import { staffRoutes } from './modules/staff/routes.js';
import { eventQuotesRoutes } from './modules/quotes/routes.js';
import { businessPartnersRoutes } from './modules/partners/routes.js';
import { businessSettingsRoutes } from './modules/business-settings/settings-routes.js';
import { clientErrorsRoutes } from './routes/client-errors.js';
import { startSnapshotWorker } from './modules/backups/snapshot-service.js';
import { PrintingWorker } from './modules/printing/worker.js';
import { getDatabaseContext } from './db/connection.js';
import { websocketPlugin } from './plugins/websocket.js';
import { staticPlugin } from './plugins/static.js';
import { idempotencyPlugin } from './modules/idempotency/idempotency-plugin.js';
import { seedInitialUsers } from './modules/auth/seed-users.js';
import { recoverStuckUpdatesOnBoot } from './modules/updater/updater-service.js';
import { syncBcvRateFromInternet } from './modules/menu/bcv-auto-sync.js';

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

  // Parser tolerante a cuerpos vacíos (Evita 400 Bad Request FST_ERR_CTP_EMPTY_JSON_BODY)
  server.addContentTypeParser('application/json', { parseAs: 'string' }, function (_req, body, done) {
    if (!body || body === '') {
      return done(null, {});
    }
    try {
      const json = JSON.parse(body as string);
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err as Error, undefined);
    }
  });

  // Inicializar PrintingWorker interno
  const dbCtx = getDatabaseContext();

  // Bootstrap automático de usuarios si la tabla users está vacía tras migraciones (B.5 / F5)
  try {
    const userCount = dbCtx.rawDb.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number } | undefined;
    if (userCount && userCount.cnt === 0) {
      const count = seedInitialUsers(dbCtx.rawDb);
      server.log.info(`BOOTSTRAP: ${count} usuarios iniciales creados`);
      console.log(`BOOTSTRAP: ${count} usuarios iniciales creados`);
    }
  } catch {}

  // Recuperar actualizaciones atascadas en 'IN_PROGRESS' durante el arranque anterior (Ajuste B2)
  try {
    const recovered = recoverStuckUpdatesOnBoot(dbCtx.rawDb);
    if (recovered > 0) {
      server.log.warn(`BOOTSTRAP: ${recovered} actualizaciones atascadas recuperadas a FAILED_ROLLBACK`);
    }
  } catch {}

  const worker = new PrintingWorker(dbCtx.rawDb, {
    mockTransports: process.env.NODE_ENV === 'test'
  });
  server.decorate('printingWorker', worker);
  server.decorate('rawDb', dbCtx.rawDb);

  let snapshotWorker: { stop: () => void } | null = null;
  let bcvInterval: NodeJS.Timeout | null = null;
  if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
    worker.start(1500);
    snapshotWorker = startSnapshotWorker(dbCtx.rawDb);
    void syncBcvRateFromInternet(dbCtx.rawDb).catch(() => {});
    bcvInterval = setInterval(() => {
      void syncBcvRateFromInternet(dbCtx.rawDb).catch(() => {});
    }, 30 * 60 * 1000);
  }

  server.addHook('onClose', async () => {
    worker.stop();
    if (snapshotWorker) {
      snapshotWorker.stop();
    }
    if (bcvInterval) {
      clearInterval(bcvInterval);
    }
  });

  // Registro de Plugins
  await server.register(cors, { origin: '*', methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] });
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
  await server.register(closuresRoutes);
  await server.register(incidentsRoutes);
  await server.register(reportsRoutes);
  await server.register(backupsRoutes, { rawDb: dbCtx.rawDb });
  await server.register(emergencyRoutes, { rawDb: dbCtx.rawDb });
  await server.register(deliveryRoutes);
  await server.register(couponRoutes);
  await server.register(supportRoutes);
  await server.register(updaterRoutes);
  await server.register(qrMenuRoutes);
  await server.register(profitabilityRoutes);
  await server.register(fase3Routes);
  await server.register(fase4Routes);
  await server.register(financesRoutes);
  await server.register(staffRoutes);
  await server.register(eventQuotesRoutes);
  await server.register(businessPartnersRoutes);
  await server.register(businessSettingsRoutes);
  await server.register(clientErrorsRoutes);

  if (!options.disableStatic) {
    await server.register(staticPlugin);
  }

  return server;
}
