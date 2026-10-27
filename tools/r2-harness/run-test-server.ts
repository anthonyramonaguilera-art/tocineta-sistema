import * as path from 'node:path';
import { seedR2Scenario } from './seed-r2-scenario.js';
import { buildServer } from '../../apps/server/src/server.js';
import { TEST_SCENARIO_CONFIG } from './test-constants.js';

async function startTestServer() {
  const port = parseInt(process.env.TEST_PORT || '3100', 10);
  const host = process.env.TEST_HOST || '127.0.0.1';
  const dbPath = process.env.TOCINETA_DB_PATH || path.resolve(process.cwd(), TEST_SCENARIO_CONFIG.defaultDbPath);

  process.env.NODE_ENV = 'test';
  process.env.TOCINETA_DB_PATH = dbPath;
  process.env.PORT = String(port);
  process.env.HOST = host;

  console.log(`[R2-HARNESS] Inicializando servidor de pruebas en ${host}:${port} con BD ${dbPath}...`);
  await seedR2Scenario(dbPath);

  const server = await buildServer();
  await server.listen({ port, host });
  console.log(`[R2-HARNESS] Servidor listo y escuchando en http://${host}:${port}`);

  const shutdown = async () => {
    console.log('[R2-HARNESS] Cerrando servidor de pruebas...');
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startTestServer().catch(err => {
  console.error('[R2-HARNESS] Error fatal iniciando servidor de pruebas:', err);
  process.exit(1);
});
