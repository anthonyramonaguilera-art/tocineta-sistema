import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { getProjectRoot } from './config/paths.js';
import { env } from './config/env.js';
import { initSqlite } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { buildServer } from './server.js';
import { seedInitialUsers, ensureCorporateUsersNonDestructive } from './modules/auth/seed-users.js';
import { seedCatalog } from './db/seed-catalog.js';
import { seedProductPhotos } from './modules/menu/photo-seed.js';
import { ensureOfficialLocations } from './modules/profitability/locations-service.js';

export function describeAuthMode(env: { ENFORCE_AUTH?: string } = process.env): string {
  return env.ENFORCE_AUTH === 'true'
    ? 'Autenticación: ESTRICTA (ENFORCE_AUTH=true)'
    : 'Autenticación: MODO AUDITORÍA (no bloquea)';
}

export function shouldWarnProductionAudit(env: { ENFORCE_AUTH?: string; NODE_ENV?: string } = process.env): boolean {
  return env.NODE_ENV === 'production' && env.ENFORCE_AUTH !== 'true';
}

export function assertSafeStartup(env: { ENFORCE_AUTH?: string; NODE_ENV?: string } = process.env): void {
  if (shouldWarnProductionAudit(env)) {
    throw new Error('Servidor en producción con autenticación en MODO AUDITORÍA (ENFORCE_AUTH !== "true"). El arranque ha sido abortado por seguridad. Configure ENFORCE_AUTH=true en el archivo .env.');
  }
}

export function warnIfSiblingDatabaseHasUsers(currentDbPath: string): boolean {
  try {
    const resolvedCurrent = path.resolve(currentDbPath);
    const projectRoot = getProjectRoot();
    const candidatePaths = [
      path.resolve(projectRoot, 'data/tocineta.db'),
      path.resolve(process.cwd(), 'data/tocineta.db'),
      path.resolve(process.cwd(), '../data/tocineta.db'),
      path.resolve(process.cwd(), '../../data/tocineta.db'),
      path.resolve(process.cwd(), 'apps/server/data/tocineta.db'),
      path.resolve(path.dirname(resolvedCurrent), '../data/tocineta.db'),
      path.resolve(path.dirname(resolvedCurrent), '../../data/tocineta.db'),
      path.resolve(path.dirname(resolvedCurrent), '../tocineta.db')
    ];

    const visited = new Set<string>();
    for (const candidate of candidatePaths) {
      const resolvedCandidate = path.resolve(candidate);
      if (resolvedCandidate === resolvedCurrent || visited.has(resolvedCandidate)) {
        continue;
      }
      visited.add(resolvedCandidate);

      if (!fs.existsSync(resolvedCandidate)) {
        continue;
      }

      try {
        const checkDb = new Database(resolvedCandidate, { readonly: true, fileMustExist: true });
        try {
          const row = checkDb.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number } | undefined;
          if (row && row.cnt > 0) {
            console.warn(
              `\n⚠️ [ADVERTENCIA CRÍTICA DE PRODUCCIÓN]: La base de datos resuelta en "${resolvedCurrent}" está VACÍA (0 usuarios), ` +
              `pero se detectó otra base de datos con ${row.cnt} usuarios en una carpeta hermana/relacionada: "${resolvedCandidate}".`
            );
            console.warn(
              '⚠️ Verifique que el servicio esté apuntando a la ruta correcta o revise TOCINETA_HOME / DB_PATH.\n'
            );
            return true;
          }
        } finally {
          checkDb.close();
        }
      } catch {
        // Ignorar bases ilegibles
      }
    }
  } catch {
    // Proteger contra errores inesperados
  }
  return false;
}

async function bootstrap() {
  console.log(`\n=============================================================`);
  console.log(`🍔 SISTEMA OPERATIVO GASTRONÓMICO "TOCINETA" (PRD v2.0)`);
  console.log(`=============================================================`);
  console.log(`⚙️ Entorno: ${env.NODE_ENV} | Host: ${env.HOST} | Port: ${env.PORT}`);
  console.log(`📁 Base de Datos SQLite (Configurada): ${env.DB_PATH}`);
  console.log(`📂 Directorio de Trabajo (cwd): ${process.cwd()}`);
  console.log(describeAuthMode(process.env));
  try {
    assertSafeStartup(process.env);
  } catch (err: any) {
    console.error(`ERROR CRÍTICO: ${err.message}`);
    process.exit(1);
  }

  // 1. Inicialización de SQLite con PRAGMAs obligatorios (WAL, FULL sync, FKs, BusyTimeout)
  const dbContext = initSqlite(env.DB_PATH);
  console.log(`📁 Base de Datos SQLite (Ruta Absoluta): ${dbContext.dbPath}`);
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
  const userCountRow = dbContext.rawDb.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  console.log(`👥 Número de usuarios en base de datos: ${userCountRow.cnt}`);
  if (process.env.NODE_ENV === 'production' && userCountRow.cnt === 0) {
    warnIfSiblingDatabaseHasUsers(dbContext.dbPath);
  }
  if (userCountRow.cnt === 0) {
    const seededCount = seedInitialUsers(dbContext.rawDb);
    console.log(`BOOTSTRAP: ${seededCount} usuarios iniciales creados`);
  } else {
    ensureCorporateUsersNonDestructive(dbContext.rawDb);
    console.log(`👥 Perfiles corporativos sincronizados (ADMIN, CAJERA, MESERO, PLANCHA, DESPACHO)`);
  }

  // 4. Semilla de catálogo oficial (27 productos, combos, barra libre, sabores Pepsi, cupones)
  if (process.env.SKIP_SEED_CATALOG !== 'true') {
    seedCatalog(dbContext.rawDb);
    seedProductPhotos(dbContext.rawDb);
    console.log(`🍔 Catálogo oficial y fotografías sembrados con éxito.`);
  } else {
    console.log(`ℹ️ SKIP_SEED_CATALOG=true: Omitiendo siembra automática del catálogo oficial.`);
  }

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

if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
  bootstrap().catch(err => {
    console.error('Error fatal durante el bootstrap:', err);
    process.exit(1);
  });
}
