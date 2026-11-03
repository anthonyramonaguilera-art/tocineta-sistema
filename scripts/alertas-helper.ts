/**
 * SISTEMA OPERATIVO LOCAL TOCINETA
 * Helper para Alertas de Telegram (Consulta de Salud de Base de Datos y Respaldos)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
export { validateChatTarget, formatDailyMessage } from './health-report.js';

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function parseCliArgs(): { dbPath?: string; envPath?: string } {
  const args = process.argv.slice(2);
  const res: { dbPath?: string; envPath?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
      res.dbPath = args[++i];
    } else if (args[i] === '--env' && args[i + 1]) {
      res.envPath = args[++i];
    }
  }
  return res;
}

function loadEnvFile(envPath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return result;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq !== -1) {
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  }
  return result;
}

function getDatabaseMetrics() {
  const { dbPath: argDb, envPath: argEnv } = parseCliArgs();
  const repoRoot = path.resolve(process.cwd());
  const envFile = argEnv || path.resolve(repoRoot, '.env');
  const fileEnv = loadEnvFile(envFile);

  const resolvedDbPath = path.resolve(argDb || process.env.DB_PATH || fileEnv.DB_PATH || './data/tocineta.db');

  if (!fs.existsSync(resolvedDbPath)) {
    return {
      dbExists: false,
      dbPath: resolvedDbPath,
      latestBackupDate: 'Sin base de datos',
      latestBackupMs: null,
      errorsLast24h: 0,
      criticalErrorsCount: 1,
      criticalErrors: [
        {
          code: 'DATABASE_NOT_FOUND',
          message: `El archivo de base de datos no existe en: ${resolvedDbPath}`,
          createdAt: formatDate(Date.now())
        }
      ]
    };
  }

  let db: any = null;
  try {
    db = new DatabaseConstructor(resolvedDbPath, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 3000');

    // 1. Ultimo respaldo
    let latestBackupMs: number | null = null;
    let latestBackupDate = 'Ninguno registrado';

    try {
      const backupRow = db.prepare(`
        SELECT created_at_ms, destination_path 
        FROM backups_log 
        ORDER BY created_at_ms DESC 
        LIMIT 1
      `).get() as { created_at_ms: number; destination_path: string } | undefined;

      if (backupRow?.created_at_ms) {
        latestBackupMs = backupRow.created_at_ms;
        latestBackupDate = formatDate(backupRow.created_at_ms);
      }
    } catch {
      // Si la tabla no existe todavia
    }

    // Si backups_log estaba vacia, verificar archivos en ./data/backups/usb o ./data/snapshots
    if (!latestBackupMs) {
      const usbDir = path.resolve(repoRoot, './data/backups/usb');
      if (fs.existsSync(usbDir)) {
        const files = fs.readdirSync(usbDir).filter(f => f.endsWith('.age') || f.endsWith('.db'));
        let maxMtime = 0;
        for (const f of files) {
          try {
            const s = fs.statSync(path.join(usbDir, f));
            if (s.mtimeMs > maxMtime) maxMtime = s.mtimeMs;
          } catch {}
        }
        if (maxMtime > 0) {
          latestBackupMs = Math.round(maxMtime);
          latestBackupDate = formatDate(latestBackupMs);
        }
      }
    }

    // 2. Errores en ultimas 24 horas
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    let errorsLast24h = 0;
    let criticalErrorsCount = 0;
    const criticalErrors: Array<{ id: string; code: string; message: string; createdAt: string }> = [];

    try {
      const countRow = db.prepare(`
        SELECT COUNT(*) as cnt 
        FROM server_errors 
        WHERE created_at_ms >= ?
      `).get(twentyFourHoursAgo) as { cnt: number } | undefined;

      errorsLast24h = countRow?.cnt || 0;

      // Errores graves (status >= 500, o fallos de respaldo, o excepciones no controladas)
      const criticalRows = db.prepare(`
        SELECT id, code, message, created_at_ms 
        FROM server_errors 
        WHERE created_at_ms >= ? 
          AND (status >= 500 OR code LIKE '%FAIL%' OR code LIKE '%CRIT%' OR code = 'INTERNAL_ERROR')
        ORDER BY created_at_ms DESC 
        LIMIT 5
      `).all(twentyFourHoursAgo) as Array<{ id: string; code: string; message: string; created_at_ms: number }>;

      criticalErrorsCount = criticalRows.length;
      for (const row of criticalRows) {
        criticalErrors.push({
          id: row.id,
          code: row.code,
          message: row.message,
          createdAt: formatDate(row.created_at_ms)
        });
      }
    } catch {
      // Si server_errors no existe
    }

    return {
      dbExists: true,
      dbPath: resolvedDbPath,
      latestBackupDate,
      latestBackupMs,
      errorsLast24h,
      criticalErrorsCount,
      criticalErrors
    };
  } catch (err: any) {
    return {
      dbExists: true,
      dbPath: resolvedDbPath,
      latestBackupDate: 'Error al consultar',
      latestBackupMs: null,
      errorsLast24h: 0,
      criticalErrorsCount: 1,
      criticalErrors: [
        {
          code: 'DB_QUERY_ERROR',
          message: err.message,
          createdAt: formatDate(Date.now())
        }
      ]
    };
  } finally {
    if (db) {
      try { db.close(); } catch {}
    }
  }
}

const metrics = getDatabaseMetrics();
console.log(JSON.stringify(metrics, null, 2));
