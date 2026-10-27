import { assertIsolatedTestDatabase } from '../src/db/test-guard.js';
import { getDefaultDbPath } from '../src/db/connection.js';

// Guarda de arranque para pruebas en Vitest
const currentDbTarget = process.env.TOCINETA_DB_PATH || process.env.DB_PATH || getDefaultDbPath();
assertIsolatedTestDatabase(currentDbTarget);
