import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as schema from './schema.js';

export interface SqlitePragmas {
  journalMode: string;
  synchronous: number;
  foreignKeys: number;
  busyTimeoutMs: number;
}

export interface DatabaseContext {
  db: BetterSQLite3Database<typeof schema>;
  rawDb: Database.Database;
  dbPath: string;
  getPragmas: () => SqlitePragmas;
}

let activeContext: DatabaseContext | null = null;

export function getDefaultDbPath(): string {
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return './data/tocineta.test.db';
  }
  return './data/tocineta.db';
}

export function initSqlite(dbFilePath?: string): DatabaseContext {
  const effectivePath = dbFilePath || getDefaultDbPath();
  const isMemory = effectivePath === ':memory:';
  const resolvedPath = isMemory ? ':memory:' : path.resolve(process.cwd(), effectivePath);

  if (!isMemory) {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const rawDb = new Database(resolvedPath);

  // Ejecución obligatoria de PRAGMAs de integridad y concurrencia Single-Writer
  rawDb.pragma('journal_mode = WAL');
  rawDb.pragma('synchronous = FULL');
  rawDb.pragma('foreign_keys = ON');
  rawDb.pragma('busy_timeout = 5000');

  const getPragmas = (): SqlitePragmas => {
    const journalMode = rawDb.pragma('journal_mode', { simple: true }) as string;
    const synchronous = rawDb.pragma('synchronous', { simple: true }) as number;
    const foreignKeys = rawDb.pragma('foreign_keys', { simple: true }) as number;
    const busyTimeoutMs = rawDb.pragma('busy_timeout', { simple: true }) as number;

    return {
      journalMode,
      synchronous,
      foreignKeys,
      busyTimeoutMs
    };
  };

  const pragmas = getPragmas();

  // Validación de seguridad para asegurar que no se abra en modo inseguro
  if (resolvedPath !== ':memory:') {
    if (pragmas.journalMode.toLowerCase() !== 'wal') {
      console.warn(`[SQLite] Advertencia: journal_mode reportó '${pragmas.journalMode}', esperado 'wal'.`);
    }
    if (pragmas.synchronous !== 2) {
      console.warn(`[SQLite] Advertencia: synchronous reportó ${pragmas.synchronous}, esperado 2 (FULL).`);
    }
    if (pragmas.foreignKeys !== 1) {
      console.warn(`[SQLite] Advertencia: foreign_keys reportó ${pragmas.foreignKeys}, esperado 1 (ON).`);
    }
  }

  const db = drizzle(rawDb, { schema });

  activeContext = {
    db,
    rawDb,
    dbPath: resolvedPath,
    getPragmas
  };

  return activeContext;
}

export function getDatabaseContext(): DatabaseContext {
  if (!activeContext) {
    return initSqlite();
  }
  return activeContext;
}
