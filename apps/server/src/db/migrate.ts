import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { initSqlite, getDatabaseContext } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MigrationResult {
  appliedCount: number;
  appliedMigrations: string[];
  snapshotPath: string | null;
}

export interface RunMigrationsOptions {
  migrationsDir?: string;
  snapshotsDir?: string;
  dbPath?: string;
}

/**
 * Ejecuta sentencias SQL de forma idempotente, verificando con PRAGMA table_info
 * antes de hacer ALTER TABLE ADD COLUMN para evitar fallos si la columna ya existe.
 */
export function executeSqlIdempotently(rawDb: Database.Database, sqlContent: string): void {
  const lines = sqlContent.split('\n');
  const processedLines = lines.map(line => {
    const trimmed = line.trim();
    const alterMatch = trimmed.match(/^ALTER\s+TABLE\s+([^\s]+)\s+ADD(?:\s+COLUMN)?\s+([^\s(;,]+)/i);
    if (alterMatch) {
      const tableName = alterMatch[1].replace(/[`"']/g, '');
      const columnName = alterMatch[2].replace(/[`"']/g, '');
      try {
        const columns = rawDb.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
        if (columns && columns.some(c => c.name.toLowerCase() === columnName.toLowerCase())) {
          return `-- [IDEMPOTENT_SKIPPED] ${line}`;
        }
      } catch {
        // Si falla el pragma o la tabla no existe aún, continuar normalmente
      }
    }
    return line;
  });

  const finalSql = processedLines.join('\n');
  try {
    rawDb.exec(finalSql);
  } catch (err: any) {
    const msg = err?.message?.toLowerCase() || '';
    if (msg.includes('duplicate column name')) {
      return;
    }
    throw err;
  }
}

/**
 * Runner de migraciones solo hacia adelante (forward-only) con Hot Snapshot físico automático
 */
export async function runMigrations(
  customRawDb?: Database.Database,
  options: RunMigrationsOptions = {}
): Promise<MigrationResult> {
  const dbContext = customRawDb ? null : getDatabaseContext();
  const rawDb = customRawDb || dbContext!.rawDb;
  const dbFilePath = options.dbPath || (dbContext ? dbContext.dbPath : ':memory:');

  let migrationsFolder = options.migrationsDir
    ? path.resolve(options.migrationsDir)
    : path.resolve(__dirname, 'migrations');

  // Si la carpeta de migraciones no existe o no tiene archivos .sql (ej. dist/ sin compilar assets), buscar en src/db/migrations
  if (!fs.existsSync(migrationsFolder) || fs.readdirSync(migrationsFolder).filter(f => f.endsWith('.sql')).length === 0) {
    const candidateSrc = path.resolve(__dirname, '../../src/db/migrations');
    const cwdSrc = path.resolve(process.cwd(), 'src/db/migrations');
    if (fs.existsSync(candidateSrc) && fs.readdirSync(candidateSrc).filter(f => f.endsWith('.sql')).length > 0) {
      migrationsFolder = candidateSrc;
    } else if (fs.existsSync(cwdSrc) && fs.readdirSync(cwdSrc).filter(f => f.endsWith('.sql')).length > 0) {
      migrationsFolder = cwdSrc;
    }
  }

  const snapshotsFolder = options.snapshotsDir
    ? path.resolve(options.snapshotsDir)
    : path.resolve(process.cwd(), './data/snapshots');

  // 1. Asegurar tabla de historial de migraciones
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at_ms INTEGER NOT NULL
    );
  `);

  // 2. Obtener lista de migraciones ya aplicadas
  const appliedRows = rawDb.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>;
  const appliedSet = new Set(appliedRows.map(r => r.name));

  // 3. Leer archivos .sql disponibles ordenados alfabéticamente
  if (!fs.existsSync(migrationsFolder)) {
    fs.mkdirSync(migrationsFolder, { recursive: true });
  }

  const allFiles = fs.readdirSync(migrationsFolder)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const pending = allFiles.filter(f => !appliedSet.has(f));

  if (pending.length === 0) {
    return {
      appliedCount: 0,
      appliedMigrations: [],
      snapshotPath: null
    };
  }

  // 4. Si hay migraciones pendientes Y la base de datos ya contiene tablas de usuario,
  // tomar un snapshot físico en caliente antes de aplicar cambios.
  let snapshotPath: string | null = null;
  const tableCheck = rawDb.prepare(`
    SELECT count(*) as count 
    FROM sqlite_master 
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_migrations'
  `).get() as { count: number };

  const hasExistingData = tableCheck && tableCheck.count > 0;

  if (hasExistingData && dbFilePath !== ':memory:') {
    if (!fs.existsSync(snapshotsFolder)) {
      fs.mkdirSync(snapshotsFolder, { recursive: true });
    }

    const timestamp = Date.now();
    snapshotPath = path.resolve(snapshotsFolder, `pre-migrate-${timestamp}.db`);

    // Hot physical backup usando la API nativa de better-sqlite3
    await rawDb.backup(snapshotPath);
  }

  // 5. Aplicar migraciones pendientes dentro de transacciones individuales
  const appliedNow: string[] = [];
  for (const migrationFile of pending) {
    const fullPath = path.join(migrationsFolder, migrationFile);
    const sqlContent = fs.readFileSync(fullPath, 'utf-8');

    // Verificación especial R2 para jornadas abiertas en conflicto con actividad previa
    if (migrationFile.includes('jornada') || sqlContent.includes('ux_jornada_abierta')) {
      try {
        const openJornadas = rawDb.prepare(
          "SELECT id, opened_at_ms FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC"
        ).all() as Array<{ id: string; opened_at_ms: number }>;
        if (openJornadas.length > 1) {
          const older = openJornadas.slice(1);
          for (const j of older) {
            const ordersCount = (rawDb.prepare('SELECT COUNT(*) as cnt FROM orders WHERE jornada_id = ?').get(j.id) as any).cnt;
            const paymentsCount = (rawDb.prepare('SELECT COUNT(*) as cnt FROM payments p JOIN orders o ON p.order_id = o.id WHERE o.jornada_id = ?').get(j.id) as any).cnt;
            if (ordersCount > 0 || paymentsCount > 0) {
              throw new Error(
                `MIGRACION_R2_ABORT: La jornada '${j.id}' está abierta y tiene actividad previa (${ordersCount} órdenes, ${paymentsCount} pagos). No se cerrará automáticamente.`
              );
            }
          }
        }
      } catch (err: any) {
        if (err.message.startsWith('MIGRACION_R2_ABORT')) {
          throw err;
        }
        // Si la tabla jornadas no existe aún, ignorar
      }
    }

    const executeMigration = rawDb.transaction(() => {
      executeSqlIdempotently(rawDb, sqlContent);
      rawDb.prepare('INSERT INTO _migrations (name, applied_at_ms) VALUES (?, ?)').run(
        migrationFile,
        Date.now()
      );
    });

    executeMigration();
    appliedNow.push(migrationFile);
  }

  return {
    appliedCount: appliedNow.length,
    appliedMigrations: appliedNow,
    snapshotPath
  };
}

// Ejecución directa por CLI (pnpm db:migrate)
async function cli() {
  const dbPath = process.env.DB_PATH || './data/tocineta.db';
  console.log(`\n📦 [DB] Iniciando migrador forward-only en '${dbPath}'...`);

  const ctx = initSqlite(dbPath);
  try {
    const res = await runMigrations(ctx.rawDb, { dbPath });

    if (res.snapshotPath) {
      console.log(`📸 [Snapshot] Hot backup previo generado en: ${res.snapshotPath}`);
    }

    if (res.appliedCount === 0) {
      console.log(`✨ [DB] La base de datos ya se encuentra al día. Cero migraciones pendientes.`);
    } else {
      console.log(`✅ [DB] Se aplicaron exitosamente ${res.appliedCount} migración(es):`);
      for (const m of res.appliedMigrations) {
        console.log(`   - ${m}`);
      }
    }

    const pragmas = ctx.getPragmas();
    console.log(`⚙️ [PRAGMAs verificados]: journal_mode=${pragmas.journalMode}, synchronous=${pragmas.synchronous}, foreign_keys=${pragmas.foreignKeys}, busy_timeout=${pragmas.busyTimeoutMs}ms\n`);
  } catch (err: any) {
    console.error(`❌ [DB Error] Error fatal durante migración:`, err.message);
    process.exit(1);
  } finally {
    ctx.rawDb.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  cli().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
