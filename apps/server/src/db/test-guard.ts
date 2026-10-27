import * as path from 'node:path';

/**
 * Determina si una ruta de archivo apunta a la base de datos de producción real.
 */
export function isProductionDatabasePath(targetPath: string): boolean {
  if (!targetPath || targetPath === ':memory:') {
    return false;
  }

  const normalized = path.resolve(process.cwd(), targetPath).replace(/\\/g, '/').toLowerCase();

  // Se permiten respaldos, instantáneas y bases de datos expresamente temporales / de prueba
  if (
    normalized.includes('/backups/') ||
    normalized.includes('/backups-r2/') ||
    normalized.includes('/snapshots/') ||
    normalized.includes('.test.') ||
    normalized.includes('/temp/') ||
    normalized.includes('/tmp/')
  ) {
    return false;
  }

  // Si apunta a data/tocineta.db o termina en /tocineta.db sin ser respaldo
  if (normalized.endsWith('/data/tocineta.db') || normalized.endsWith('/tocineta.db')) {
    return true;
  }

  return false;
}

/**
 * Guarda obligatoria de seguridad: aborta inmediatamente si en entorno de pruebas
 * se intenta abrir o inicializar la base de datos de producción real.
 */
export function assertIsolatedTestDatabase(dbPath?: string): void {
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  if (!isTest) {
    return;
  }

  const target = dbPath || process.env.TOCINETA_DB_PATH || process.env.DB_PATH || './data/tocineta.db';
  if (isProductionDatabasePath(target)) {
    throw new Error(
      `[TOCINETA GUARD] ERROR CRÍTICO: Se intentó ejecutar pruebas sobre la base de datos de producción (${target}). Abortando inmediatamente para proteger datos reales.`
    );
  }
}
