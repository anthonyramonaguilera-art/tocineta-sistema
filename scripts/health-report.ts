/**
 * SISTEMA OPERATIVO LOCAL TOCINETA
 * Diagnóstico de Salud Local en Solo Lectura (V-1)
 *
 * Abre SQLite en modo ESTRICTAMENTE SOLO LECTURA sin alterar WAL ni el estado del servidor.
 * Exporta funciones de formateo y validación de seguridad de destinos Telegram.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import DatabaseConstructor from 'better-sqlite3';
import { getProjectRoot } from '../apps/server/src/config/paths.js';

export interface BackupStatus {
  atMs: number;
  ok: boolean;
  error?: string;
}

export interface HealthReport {
  version: string;
  dbSizeMb: number;
  closedJornadasCount: number;
  openJornada: boolean;
  serverErrors24h: number;
  lastBackup: BackupStatus | null;
  diskFreeGb: number;
  logsRecientes: boolean;
  dailyMessage?: string;
}

export function formatDate(ms: number): string {
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

/**
 * Valida que el chatId configurado no coincida con el botId (evita loop infinito o mensajes a uno mismo)
 * y que no esté vacío.
 */
export function validateChatTarget(
  botId: string | number | null | undefined,
  chatId: string | number | null | undefined
): { ok: boolean; reason?: string } {
  const botIdStr = botId !== null && botId !== undefined ? String(botId).trim() : '';
  const chatIdStr = chatId !== null && chatId !== undefined ? String(chatId).trim() : '';

  if (!chatIdStr || (botIdStr !== '' && botIdStr === chatIdStr)) {
    return {
      ok: false,
      reason: 'El destino de avisos apunta a un bot; use su ID personal'
    };
  }

  return { ok: true };
}

/**
 * Genera el mensaje oficial para el reporte diario de salud
 * Formato: "TOCINETA activo. Versión X. Jornadas cerradas: N. Último respaldo: fecha y estado. Errores 24 h: N. Disco libre: X GB"
 */
export function formatDailyMessage(report: Partial<HealthReport>): string {
  const version = report.version || '0.0.0';
  const closedCount = report.closedJornadasCount ?? 0;

  let backupInfo = 'sin respaldo previo';
  if (report.lastBackup) {
    const at = report.lastBackup.atMs ? formatDate(report.lastBackup.atMs) : 'desconocida';
    const status = report.lastBackup.ok
      ? 'exitoso'
      : `fallido${report.lastBackup.error ? ` (${report.lastBackup.error})` : ''}`;
    backupInfo = `${at} (${status})`;
  }

  const errors = report.serverErrors24h ?? 0;
  const disk = report.diskFreeGb ?? 0;

  return `TOCINETA activo. Versión ${version}. Jornadas cerradas: ${closedCount}. Último respaldo: ${backupInfo}. Errores 24 h: ${errors}. Disco libre: ${disk} GB`;
}

export function generateHealthReport(customDbPath?: string): HealthReport {
  const root = getProjectRoot();
  const rawDbPath = customDbPath || process.env.DB_PATH || './data/tocineta.db';
  const dbPath = path.isAbsolute(rawDbPath) ? rawDbPath : path.resolve(root, rawDbPath);

  let db: DatabaseConstructor.Database;
  try {
    db = new DatabaseConstructor(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 5000');
  } catch (err: any) {
    console.log(JSON.stringify({ error: err.message || String(err) }));
    process.exit(2);
  }

  try {
    // 1. Version de package.json raiz
    let version = '1.0.0';
    try {
      const pkgPath = path.resolve(root, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.version) version = pkg.version;
      }
    } catch {
      // Ignorar fallback
    }

    // 2. Tamano de la BD en MB
    let dbSizeMb = 0;
    try {
      const stat = fs.statSync(dbPath);
      dbSizeMb = Math.round((stat.size / (1024 * 1024)) * 100) / 100;
    } catch {
      dbSizeMb = 0;
    }

    // 3. Jornadas cerradas
    let closedJornadasCount = 0;
    try {
      const row = db.prepare(`
        SELECT COUNT(*) as cnt FROM jornadas WHERE status = 'cerrada' OR closed_at_ms IS NOT NULL
      `).get() as { cnt: number } | undefined;
      closedJornadasCount = row?.cnt ?? 0;
    } catch {
      closedJornadasCount = 0;
    }

    // 4. Jornada abierta
    let openJornada = false;
    try {
      const row = db.prepare(`
        SELECT id FROM jornadas WHERE (status = 'abierta' OR status = 'OPEN') AND closed_at_ms IS NULL LIMIT 1
      `).get() as { id: string } | undefined;
      openJornada = Boolean(row);
    } catch {
      openJornada = false;
    }

    // 5. Errores de servidor en ultimas 24h
    let serverErrors24h = 0;
    try {
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
      const row = db.prepare(`
        SELECT COUNT(*) as cnt FROM server_errors WHERE created_at_ms >= ?
      `).get(twentyFourHoursAgo) as { cnt: number } | undefined;
      serverErrors24h = row?.cnt ?? 0;
    } catch {
      serverErrors24h = 0;
    }

    // 6. Ultimo respaldo (data/backup-status.json)
    let lastBackup: BackupStatus | null = null;
    try {
      const backupStatusPath = path.resolve(root, 'data', 'backup-status.json');
      if (fs.existsSync(backupStatusPath)) {
        const parsed = JSON.parse(fs.readFileSync(backupStatusPath, 'utf-8'));
        if (parsed && typeof parsed.atMs === 'number' && typeof parsed.ok === 'boolean') {
          lastBackup = parsed;
        }
      }
    } catch {
      lastBackup = null;
    }

    // 7. Espacio libre en disco (GB)
    let diskFreeGb = 0;
    try {
      if (typeof (fs as any).statfsSync === 'function') {
        const s = (fs as any).statfsSync(root);
        diskFreeGb = Math.round(((s.bavail * s.bsize) / (1024 * 1024 * 1024)) * 100) / 100;
      }
    } catch {
      diskFreeGb = 0;
    }

    // 8. Logs recientes (logs/server-out.log modificado en ultimas 24h)
    let logsRecientes = false;
    try {
      const candidates = [
        path.resolve(root, 'logs', 'server-out.log'),
        path.resolve(root, 'apps', 'server', 'logs', 'server-out.log')
      ];
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          const s = fs.statSync(cand);
          if (s.mtimeMs >= twentyFourHoursAgo) {
            logsRecientes = true;
            break;
          }
        }
      }
    } catch {
      logsRecientes = false;
    }

    const report: HealthReport = {
      version,
      dbSizeMb,
      closedJornadasCount,
      openJornada,
      serverErrors24h,
      lastBackup,
      diskFreeGb,
      logsRecientes
    };

    return report;
  } finally {
    try {
      db.close();
    } catch {
      // Ignorar error al cerrar
    }
  }
}

// Ejecucion directa como CLI
function isDirectRun(): boolean {
  if (!process.argv[1]) return false;
  const currentPath = path.resolve(process.argv[1]);
  return (
    currentPath.endsWith('health-report.ts') ||
    currentPath.endsWith('health-report.js') ||
    (typeof import.meta.url === 'string' && currentPath === fileURLToPath(import.meta.url))
  );
}

if (isDirectRun()) {
  const args = process.argv.slice(2);
  let customDb: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
      customDb = args[++i];
    }
  }

  const report = generateHealthReport(customDb);
  const dailyMessage = formatDailyMessage(report);

  if (args.includes('--daily') || args.includes('--message-only')) {
    console.log(dailyMessage);
  } else {
    console.log(JSON.stringify({ ...report, dailyMessage }, null, 2));
  }
}
