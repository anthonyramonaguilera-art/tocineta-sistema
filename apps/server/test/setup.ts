import { assertIsolatedTestDatabase } from '../src/db/test-guard.js';
import { getDefaultDbPath, getDatabaseContext } from '../src/db/connection.js';

// Guarda de arranque para pruebas en Vitest
const currentDbTarget = process.env.TOCINETA_DB_PATH || process.env.DB_PATH || getDefaultDbPath();
assertIsolatedTestDatabase(currentDbTarget);

// Regla D1: Al iniciar cada archivo de pruebas, cerrar cualquier jornada abierta
// remanente de archivos anteriores para respetar el índice único global
try {
  const ctx = getDatabaseContext();
  ctx.rawDb.prepare("UPDATE jornadas SET status = 'cerrada' WHERE status = 'abierta'").run();
} catch {}

