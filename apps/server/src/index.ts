import { env } from './config/env.js';
import { initSqlite } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { buildServer } from './server.js';
import { seedInitialUsers, syncAndSanitizeCorporateUsers } from './modules/auth/seed-users.js';
import { seedCatalog } from './db/seed-catalog.js';
import { ensureOfficialLocations } from './modules/profitability/locations-service.js';

async function bootstrap() {
  console.log(`\n=============================================================`);
  console.log(`🍔 SISTEMA OPERATIVO GASTRONÓMICO "TOCINETA" (PRD v2.0)`);
  console.log(`=============================================================`);
  console.log(`⚙️ Entorno: ${env.NODE_ENV} | Host: ${env.HOST} | Port: ${env.PORT}`);
  console.log(`📁 Base de Datos SQLite: ${env.DB_PATH}`);

  // 1. Inicialización de SQLite con PRAGMAs obligatorios (WAL, FULL sync, FKs, BusyTimeout)
  const dbContext = initSqlite(env.DB_PATH);
  const pragmas = dbContext.getPragmas();
  console.log(`🔒 SQLite configurado con éxito:`);
  console.log(`   - journal_mode: ${pragmas.journalMode}`);
  console.log(`   - synchronous: ${pragmas.synchronous} (FULL)`);
  console.log(`   - foreign_keys: ${pragmas.foreignKeys} (ON)`);
  console.log(`   - busy_timeout: ${pragmas.busyTimeoutMs} ms`);

  // 2. Ejecución automática de migraciones forward-only
  console.log(`🚀 Comprobando migraciones pendientes...`);
  const migResult = await runMigrations(dbContext.rawDb, { dbPath: env.DB_PATH });
  if (migResult.snapshotPath) {
    console.log(`📸 Snapshot físico en caliente generado: ${migResult.snapshotPath}`);
  }
  if (migResult.appliedCount > 0) {
    console.log(`✅ ${migResult.appliedCount} migración(es) aplicada(s) exitosamente.`);
  } else {
    console.log(`✨ Base de datos al día. Cero migraciones pendientes.`);
  }

  // 2.1 Asegurar sedes oficiales (Sede A: Los Olivos, Sede B: Alta Vista)
  ensureOfficialLocations(dbContext.rawDb);

  // 3. Saneamiento y sincronización de perfiles corporativos limpios (PRD v2.0)
  syncAndSanitizeCorporateUsers(dbContext.rawDb);
  const userCountRow = dbContext.rawDb.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (userCountRow.cnt === 0) {
    const seededCount = seedInitialUsers(dbContext.rawDb);
    console.log(`BOOTSTRAP: ${seededCount} usuarios iniciales creados`);
  } else {
    console.log(`👥 Perfiles corporativos sincronizados (ADMIN, CAJERA, MESERO, PLANCHA, DESPACHO)`);
  }

  // 4. Semilla de catálogo oficial (27 productos, combos, barra libre, sabores Pepsi, cupones)
  seedCatalog(dbContext.rawDb);
  console.log(`🍔 Catálogo oficial sembrado con éxito.`);

  // 3. Inicialización del servidor Fastify (Proceso Único)
  const server = await buildServer();

  try {
    await server.listen({
      port: env.PORT,
      host: env.HOST
    });
    console.log(`\n🌐 Servidor Fastify escuchando en http://${env.HOST}:${env.PORT}`);
    console.log(`   - Health check: http://localhost:${env.PORT}/api/health`);
    console.log(`   - System Health: http://localhost:${env.PORT}/api/system-health`);
    console.log(`   - WebSocket: ws://localhost:${env.PORT}/ws`);
    console.log(`=============================================================\n`);
  } catch (err: any) {
    server.log.error(err, 'Fallo al iniciar el servidor Fastify');
    process.exit(1);
  }

  // Cierre ordenado (Graceful Shutdown)
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Recibida señal ${signal}. Cerrando servidor y base de datos...`);
    try {
      await server.close();
      dbContext.rawDb.close();
      console.log('✅ Servidor y base de datos cerrados limpiamente.');
      process.exit(0);
    } catch (err) {
      console.error('Error durante el cierre:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch(err => {
  console.error('Error fatal durante el bootstrap:', err);
  process.exit(1);
});
