import * as fs from 'node:fs';
import * as path from 'node:path';
import type Database from 'better-sqlite3';
import { DEFAULT_SNAPSHOTS_DIR, SNAPSHOT_RETENTION, DEFAULT_SNAPSHOT_INTERVAL_MS } from './constants.js';

export interface SnapshotMeta {
  filename: string;
  fullPath: string;
  timestampMs: number;
  sizeBytes: number;
}

export interface PruneResult {
  retained: string[];
  deleted: string[];
}

/**
 * Parsea el timestamp numérico a partir del nombre del snapshot.
 * Admite: snapshot-<timestamp>.db o snapshot-<date>-<timestamp>.db
 */
export function parseSnapshotTimestamp(filename: string): number | null {
  const match = filename.match(/snapshot-(?:.*-)?(\d+)\.db$/);
  if (match) {
    const ts = parseInt(match[1], 10);
    if (!isNaN(ts) && ts > 0) return ts;
  }
  return null;
}

/**
 * Obtiene la lista de snapshots ordenados del más reciente al más antiguo.
 */
export function listSnapshots(snapshotsDir = DEFAULT_SNAPSHOTS_DIR): SnapshotMeta[] {
  if (!fs.existsSync(snapshotsDir)) {
    return [];
  }

  const files = fs.readdirSync(snapshotsDir);
  const snapshots: SnapshotMeta[] = [];

  for (const file of files) {
    if (!file.endsWith('.db') || !file.startsWith('snapshot-')) continue;
    const fullPath = path.join(snapshotsDir, file);
    try {
      const stat = fs.statSync(fullPath);
      const parsedTs = parseSnapshotTimestamp(file);
      const timestampMs = parsedTs ?? stat.mtimeMs;
      snapshots.push({
        filename: file,
        fullPath,
        timestampMs,
        sizeBytes: stat.size
      });
    } catch {
      // Archivo inaccesible o eliminado concurrentemente
    }
  }

  // Ordenar de más reciente a más antiguo
  return snapshots.sort((a, b) => b.timestampMs - a.timestampMs);
}

/**
 * Ejecuta la política de retención automática de snapshots:
 * 1. Conserva los últimos 12 snapshots (cubre los 5 min de la última hora).
 * 2. Conserva 1 snapshot por hora durante las últimas 24 horas.
 * 3. Conserva 1 snapshot por día durante los últimos 30 días.
 * 4. Elimina de forma segura cualquier snapshot que no cumpla las condiciones.
 */
export function pruneSnapshots(snapshotsDir = DEFAULT_SNAPSHOTS_DIR, nowMs = Date.now()): PruneResult {
  const snapshots = listSnapshots(snapshotsDir);
  const keepFilenames = new Set<string>();

  const oneHourMs = 60 * 60 * 1000;
  const oneDayMs = 24 * oneHourMs;

  // 1. Conservar los 12 más recientes
  const recent12 = snapshots.slice(0, SNAPSHOT_RETENTION.RECENT_5MIN_COUNT);
  for (const s of recent12) {
    keepFilenames.add(s.filename);
  }

  // 2. Conservar 1 por hora durante las últimas 24 horas
  const last24hCutoff = nowMs - (SNAPSHOT_RETENTION.HOURLY_COUNT * oneHourMs);
  const hourlyBuckets = new Map<string, SnapshotMeta>();

  for (const s of snapshots) {
    if (s.timestampMs >= last24hCutoff && s.timestampMs <= nowMs) {
      const date = new Date(s.timestampMs);
      const hourKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
      if (!hourlyBuckets.has(hourKey)) {
        hourlyBuckets.set(hourKey, s);
      }
    }
  }

  for (const s of hourlyBuckets.values()) {
    keepFilenames.add(s.filename);
  }

  // 3. Conservar 1 por día durante los últimos 30 días
  const last30dCutoff = nowMs - (SNAPSHOT_RETENTION.DAILY_COUNT * oneDayMs);
  const dailyBuckets = new Map<string, SnapshotMeta>();

  for (const s of snapshots) {
    if (s.timestampMs >= last30dCutoff && s.timestampMs <= nowMs) {
      const date = new Date(s.timestampMs);
      const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      if (!dailyBuckets.has(dayKey)) {
        dailyBuckets.set(dayKey, s);
      }
    }
  }

  for (const s of dailyBuckets.values()) {
    keepFilenames.add(s.filename);
  }

  // 4. Identificar retenidos y eliminados
  const retained: string[] = [];
  const deleted: string[] = [];

  for (const s of snapshots) {
    if (keepFilenames.has(s.filename)) {
      retained.push(s.filename);
    } else {
      try {
        fs.unlinkSync(s.fullPath);
        deleted.push(s.filename);
      } catch (err) {
        console.warn(`[Snapshots] Error al podar snapshot '${s.filename}':`, err);
      }
    }
  }

  return { retained, deleted };
}

/**
 * Crea un snapshot físico en caliente no bloqueante utilizando rawDb.backup()
 * y ejecuta la política de retención automática.
 */
export async function createHotSnapshot(
  rawDb: Database.Database,
  snapshotsDir = DEFAULT_SNAPSHOTS_DIR
): Promise<{ snapshotPath: string; filename: string; fileSizeBytes: number; createdAtMs: number; pruneResult: PruneResult }> {
  if (!fs.existsSync(snapshotsDir)) {
    fs.mkdirSync(snapshotsDir, { recursive: true });
  }

  const now = Date.now();
  const filename = `snapshot-${now}.db`;
  const snapshotPath = path.join(snapshotsDir, filename);

  // Backup físico en caliente nativo de better-sqlite3
  await rawDb.backup(snapshotPath);

  const stat = fs.statSync(snapshotPath);
  const pruneResult = pruneSnapshots(snapshotsDir, now);

  return {
    snapshotPath,
    filename,
    fileSizeBytes: stat.size,
    createdAtMs: now,
    pruneResult
  };
}

/**
 * Inicia el cron / worker en segundo plano que toma snapshots cada 5 minutos
 */
export function startSnapshotWorker(
  rawDb: Database.Database,
  options: { intervalMs?: number; snapshotsDir?: string; logger?: any } = {}
): { stop: () => void } {
  const intervalMs = options.intervalMs ?? DEFAULT_SNAPSHOT_INTERVAL_MS;
  const snapshotsDir = options.snapshotsDir ?? DEFAULT_SNAPSHOTS_DIR;
  const logger = options.logger ?? console;

  const timer = setInterval(async () => {
    try {
      const result = await createHotSnapshot(rawDb, snapshotsDir);
      logger.info?.({
        msg: '[Snapshots] Snapshot en caliente tomado exitosamente',
        filename: result.filename,
        sizeBytes: result.fileSizeBytes,
        deletedCount: result.pruneResult.deleted.length
      });
    } catch (err) {
      logger.error?.('[Snapshots] Error en snapshot worker:', err);
    }
  }, intervalMs);

  // No bloquear el shutdown del proceso
  if (timer.unref) {
    timer.unref();
  }

  return {
    stop: () => clearInterval(timer)
  };
}
