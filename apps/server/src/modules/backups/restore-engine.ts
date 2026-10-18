import * as fs from 'node:fs';
import * as path from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
import { decryptWithAge } from './age-service.js';
import { verifyAuditChain, type AuditChainVerificationResult } from '../audit/audit-service.js';

export interface RestoreOptions {
  backupFilePath: string;
  privateKey?: string;
  targetDbPath?: string;
  dryRun?: boolean;
  backupExisting?: boolean;
}

export interface RestoreResult {
  success: boolean;
  integrityCheck: 'ok';
  auditChain: AuditChainVerificationResult;
  manifest: any | null;
  targetDbPath: string;
  preRestoreBackupPath: string | null;
  stats: {
    ordersCount: number;
    auditEventsCount: number;
    usersCount: number;
    productsCount: number;
  };
  durationMs: number;
}

/**
 * Motor integral de restauración y verificación criptográfica
 * Garantiza:
 * 1. Descifrado exitoso con clave privada age (si el archivo está cifrado).
 * 2. Integridad estructural física mediante 'PRAGMA integrity_check;'.
 * 3. Verificación matemática 100% estricta de la cadena inmutable audit_events (SHA-256).
 * 4. Respaldo preventivo automático de la base de datos anterior antes de sustituir.
 */
export async function restoreAndVerifyDatabase(options: RestoreOptions): Promise<RestoreResult> {
  const startTime = Date.now();
  const backupFilePath = path.resolve(options.backupFilePath);
  const targetDbPath = path.resolve(options.targetDbPath || './data/tocineta.db');
  const dryRun = options.dryRun ?? false;
  const backupExisting = options.backupExisting ?? true;

  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`El archivo de respaldo no existe: '${backupFilePath}'`);
  }

  const isEncrypted = backupFilePath.endsWith('.age');
  let tempVerifiedDbPath = backupFilePath;
  let isTemp = false;

  const tempDir = path.resolve(process.cwd(), './data/temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  if (isEncrypted) {
    if (!options.privateKey) {
      throw new Error("El archivo está cifrado con age (.age). Se requiere una clave privada age para restaurar.");
    }

    const encryptedBytes = fs.readFileSync(backupFilePath);
    const decryptedBytes = await decryptWithAge(encryptedBytes, options.privateKey);

    tempVerifiedDbPath = path.join(tempDir, `restored-verify-${Date.now()}.db`);
    fs.writeFileSync(tempVerifiedDbPath, decryptedBytes);
    isTemp = true;
  }

  try {
    // 1. Abrir base de datos para verificación
    const db = new DatabaseConstructor(tempVerifiedDbPath, { readonly: true });

    // 2. PRAGMA integrity_check;
    const integrityRows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const isIntegrityOk = integrityRows.length === 1 && integrityRows[0].integrity_check === 'ok';

    if (!isIntegrityOk) {
      const issues = integrityRows.map((r) => r.integrity_check).join('; ');
      db.close();
      throw new Error(`Fallo de integridad física en la base de datos (PRAGMA integrity_check): ${issues}`);
    }

    // 3. Verificación de la cadena de auditoría SHA-256
    const auditResult = verifyAuditChain(db);
    if (!auditResult.valid) {
      db.close();
      throw new Error(`Cadena de auditoría SHA-256 corrupta o manipulada: ${auditResult.reason}`);
    }

    // 4. Leer manifiesto si está incrustado
    let manifest: any = null;
    const hasManifestTable = db.prepare(`
      SELECT count(*) as count FROM sqlite_master WHERE type = 'table' AND name = '_backup_manifest'
    `).get() as { count: number };

    if (hasManifestTable && hasManifestTable.count > 0) {
      manifest = db.prepare('SELECT * FROM _backup_manifest ORDER BY created_at_ms DESC LIMIT 1').get() || null;
      if (manifest?.z_report_json) {
        try {
          manifest.z_report = JSON.parse(manifest.z_report_json);
        } catch {
          // Mantener string
        }
      }
    }

    // 5. Estadísticas clave
    const ordersCount = (db.prepare('SELECT count(*) as c FROM orders').get() as any)?.c ?? 0;
    const auditEventsCount = auditResult.count;
    const usersCount = (db.prepare('SELECT count(*) as c FROM users').get() as any)?.c ?? 0;
    const productsCount = (db.prepare('SELECT count(*) as c FROM products').get() as any)?.c ?? 0;

    db.close();

    // 6. Aplicar restauración física si no es dryRun
    let preRestoreBackupPath: string | null = null;

    if (!dryRun) {
      const targetDir = path.dirname(targetDbPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Si ya existe la base de datos actual, generar copia de seguridad preventiva
      if (fs.existsSync(targetDbPath) && backupExisting) {
        preRestoreBackupPath = path.join(
          targetDir,
          `tocineta-backup-pre-restore-${Date.now()}.db`
        );
        fs.copyFileSync(targetDbPath, preRestoreBackupPath);
      }

      // Copiar la base de datos íntegra y verificada a la ubicación operativa
      fs.copyFileSync(tempVerifiedDbPath, targetDbPath);
    }

    const durationMs = Date.now() - startTime;

    return {
      success: true,
      integrityCheck: 'ok',
      auditChain: auditResult,
      manifest,
      targetDbPath,
      preRestoreBackupPath,
      stats: {
        ordersCount,
        auditEventsCount,
        usersCount,
        productsCount
      },
      durationMs
    };
  } finally {
    // Si creamos un archivo temporal durante el descifrado, limpiarlo
    if (isTemp && fs.existsSync(tempVerifiedDbPath)) {
      try {
        fs.unlinkSync(tempVerifiedDbPath);
      } catch {
        // Ignorar
      }
    }
  }
}
