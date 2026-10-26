import type { FastifyPluginAsync } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  formatCaracasDateTime,
  CARACAS_TIMEZONE,
  type SystemHealthResponse,
  type SnapshotInfo
} from '@tocineta/shared';
import { getDatabaseContext } from '../db/connection.js';
import { verifyAuditChain } from '../modules/audit/audit-service.js';
import { getLastDryRun, detectUsbVault } from '../modules/backups/backup-service.js';
import { DEFAULT_AGE_RECIPIENTS } from '../modules/backups/constants.js';

function formatGigabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getDiskStats(dirPath: string): {
  freeBytes: number;
  totalBytes: number;
  freeFormatted: string;
  totalFormatted: string;
  percentFree: number;
} {
  try {
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync(dirPath);
      const freeBytes = stats.bfree * stats.bsize;
      const totalBytes = stats.blocks * stats.bsize;
      const percentFree = totalBytes > 0 ? Math.round((freeBytes / totalBytes) * 100) : 0;
      return {
        freeBytes,
        totalBytes,
        freeFormatted: formatGigabytes(freeBytes),
        totalFormatted: formatGigabytes(totalBytes),
        percentFree
      };
    }
  } catch {
    // Fallback seguro si statfsSync no está disponible en el entorno
  }

  return {
    freeBytes: 0,
    totalBytes: 0,
    freeFormatted: 'N/A',
    totalFormatted: 'N/A',
    percentFree: 0
  };
}

function getLatestSnapshot(snapshotsDir: string): SnapshotInfo | null {
  if (!fs.existsSync(snapshotsDir)) {
    return null;
  }

  try {
    const files = fs.readdirSync(snapshotsDir)
      .filter(f => f.startsWith('pre-migrate-') && f.endsWith('.db'));

    if (files.length === 0) return null;

    let latestFile = '';
    let latestMtime = 0;
    let latestSize = 0;

    for (const file of files) {
      const fullPath = path.join(snapshotsDir, file);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latestFile = file;
        latestSize = stat.size;
      }
    }

    if (!latestFile) return null;

    return {
      filename: latestFile,
      createdAtIso: new Date(latestMtime).toISOString(),
      sizeBytes: latestSize
    };
  } catch {
    return null;
  }
}

export const systemHealthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/system-health', async (_req, reply) => {
    const dbCtx = getDatabaseContext();
    const pragmas = dbCtx.getPragmas();

    // Estado del archivo DB y WAL
    let dbSizeBytes = 0;
    let walSizeBytes = 0;
    if (dbCtx.dbPath !== ':memory:' && fs.existsSync(dbCtx.dbPath)) {
      try {
        dbSizeBytes = fs.statSync(dbCtx.dbPath).size;
      } catch {}
      const walPath = `${dbCtx.dbPath}-wal`;
      if (fs.existsSync(walPath)) {
        try {
          walSizeBytes = fs.statSync(walPath).size;
        } catch {}
      }
    }

    const snapshotsDir = path.resolve(process.cwd(), './data/snapshots');
    const lastSnapshot = getLatestSnapshot(snapshotsDir);
    const diskStats = getDiskStats(path.dirname(dbCtx.dbPath));

    const mem = process.memoryUsage();

    let auditChain: { valid: boolean; count: number; headHash: string | null } | undefined;
    try {
      const chainResult = verifyAuditChain(dbCtx.rawDb);
      auditChain = {
        valid: chainResult.valid,
        count: chainResult.count,
        headHash: chainResult.headHash
      };
    } catch {
      // Si la tabla audit_events aún no existe (ej. tests tempranos)
    }

    // SUG-03: Estado del último Dry-Run
    const lastDryRun = getLastDryRun();
    const dryRunData = lastDryRun ? {
      status: lastDryRun.status,
      snapshotVerified: lastDryRun.snapshotVerified,
      auditChainValid: lastDryRun.auditChainValid,
      checkedAtMs: lastDryRun.checkedAtMs,
      message: lastDryRun.message,
      error: lastDryRun.error
    } : {
      status: 'NEVER_RUN',
      snapshotVerified: null,
      auditChainValid: null,
      checkedAtMs: null,
      message: 'Simulacro aún no ejecutado'
    };

    // SUG-02: Detección y espacio de la bóveda USB (.tocineta-usb-vault)
    const usbVaultDetection = detectUsbVault();
    const usbVaultData = {
      connected: usbVaultDetection.detected,
      vaultPath: usbVaultDetection.detected ? usbVaultDetection.vaultPath : null,
      percentUsed: usbVaultDetection.detected ? usbVaultDetection.percentUsed : null,
      percentFree: usbVaultDetection.detected ? usbVaultDetection.percentFree : null,
      warning: usbVaultDetection.warning || null
    };

    // SUG-05: Estado de custodia de claves age
    const isAgeProvisioned = process.env.AGE_KEYS_PROVISIONED === 'true' ||
      ((process.env.AGE_RECIPIENT_ADMIN || process.env.AGE_RECIPIENT_OLINELCYS) && (process.env.AGE_RECIPIENT_ADMIN || process.env.AGE_RECIPIENT_OLINELCYS) !== 'age1q5q9c7am7xx9e4flj0j8ugyfqejpyp5dc8qsvqpnv7uamg4wkcuqye3f0r');

    const ageKeysData = {
      mode: isAgeProvisioned ? ('PRODUCTION' as const) : ('DEVELOPMENT' as const),
      recipientsCount: DEFAULT_AGE_RECIPIENTS.length,
      isProduction: Boolean(isAgeProvisioned)
    };

    const response: SystemHealthResponse = {
      status: 'ok',
      version: '0.1.0',
      architecture: 'single_process',
      systemTime: {
        utcMs: Date.now(),
        localTimeCaracas: formatCaracasDateTime(),
        timezone: CARACAS_TIMEZONE
      },
      database: {
        status: 'connected',
        driver: 'better-sqlite3',
        path: dbCtx.dbPath,
        sizeBytes: dbSizeBytes,
        walSizeBytes: walSizeBytes,
        pragmas: {
          journalMode: pragmas.journalMode,
          synchronous: pragmas.synchronous,
          foreignKeys: pragmas.foreignKeys,
          busyTimeoutMs: pragmas.busyTimeoutMs
        },
        lastSnapshot,
        auditChain
      },
      system: {
        platform: process.platform,
        nodeVersion: process.version,
        uptimeSec: Math.floor(process.uptime()),
        memory: {
          rssMb: Math.round(mem.rss / (1024 * 1024)),
          heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
          heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024))
        },
        disk: diskStats
      },
      dryRun: dryRunData,
      usbVault: usbVaultData,
      ageKeys: ageKeysData
    };

    return reply.status(200).send(response);
  });
};
