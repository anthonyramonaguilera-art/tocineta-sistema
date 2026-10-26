import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import DatabaseConstructor from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { DEFAULT_AGE_RECIPIENTS, DEFAULT_USB_BACKUP_DIR } from './constants.js';
import { encryptWithAge } from './age-service.js';
import { appendAuditEvent, verifyAuditChain, GENESIS_HASH } from '../audit/audit-service.js';

export interface UsbVaultDetection {
  detected: boolean;
  driveLetter?: string;
  vaultPath: string;
  isContingency: boolean;
  freeBytes: number;
  totalBytes: number;
  percentUsed: number;
  percentFree: number;
  warning?: string;
}

export interface DryRunResult {
  status: 'OK' | 'NO_SNAPSHOT' | 'ERROR';
  snapshotVerified: string | null;
  auditChainValid: boolean | null;
  auditCount?: number;
  headHash?: string | null;
  checkedAtMs: number;
  message?: string;
  error?: string;
}

let cachedLastDryRun: DryRunResult | null = null;

export function getLastDryRun(): DryRunResult | null {
  return cachedLastDryRun;
}

export function setLastDryRun(result: DryRunResult): void {
  cachedLastDryRun = result;
}

/**
 * SUG-02: Escanea unidades disponibles buscando el marcador .tocineta-usb-vault.
 * Si encuentra más de una unidad, selecciona la que tenga el respaldo más reciente.
 * Si el uso supera el 85%, emite advertencia de capacidad.
 * Si no hay pendrive, recurre a contingencia local ./data/backups/usb/.
 */
export function detectUsbVault(
  scanRootsOverride?: string[],
  statfsFn: (p: string) => any = (p: string) => (typeof fs.statfsSync === 'function' ? fs.statfsSync(p) : null)
): UsbVaultDetection {
  const fallbackDir = DEFAULT_USB_BACKUP_DIR;

  let candidateRoots: string[] = [];

  if (scanRootsOverride && scanRootsOverride.length > 0) {
    candidateRoots = scanRootsOverride;
  } else if (process.env.TOCINETA_USB_SCAN_PATHS) {
    candidateRoots = process.env.TOCINETA_USB_SCAN_PATHS.split(',').map(s => s.trim()).filter(Boolean);
  } else if (process.platform === 'win32') {
    const letters = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
    candidateRoots = letters.map(l => `${l}:\\`);
  }

  interface CandidateVault {
    root: string;
    latestBackupMtime: number;
  }

  const matchingVaults: CandidateVault[] = [];

  for (const root of candidateRoots) {
    try {
      const markerPath = path.join(root, '.tocineta-usb-vault');
      if (fs.existsSync(markerPath)) {
        let latestMtime = 0;
        try {
          const checkDirs = [root, path.join(root, 'backups')];
          for (const d of checkDirs) {
            if (fs.existsSync(d)) {
              const files = fs.readdirSync(d);
              for (const f of files) {
                if (f.endsWith('.age') || f.endsWith('.db') || f.endsWith('.json')) {
                  const s = fs.statSync(path.join(d, f));
                  if (s.mtimeMs > latestMtime) {
                    latestMtime = s.mtimeMs;
                  }
                }
              }
            }
          }
        } catch {
          // Ignorar errores de acceso
        }
        matchingVaults.push({ root, latestBackupMtime: latestMtime });
      }
    } catch {
      // Unidad no lista o sin permisos
    }
  }

  if (matchingVaults.length === 0) {
    return {
      detected: false,
      vaultPath: fallbackDir,
      isContingency: true,
      freeBytes: 0,
      totalBytes: 0,
      percentUsed: 0,
      percentFree: 0
    };
  }

  // Si encuentra más de una unidad con el marcador, selecciona la que tenga el respaldo más reciente
  matchingVaults.sort((a, b) => b.latestBackupMtime - a.latestBackupMtime);
  const selectedRoot = matchingVaults[0].root;

  let freeBytes = 0;
  let totalBytes = 0;
  let percentUsed = 0;
  let percentFree = 0;
  let warning: string | undefined;

  try {
    const stats = statfsFn(selectedRoot);
    if (stats && typeof stats.blocks === 'number' && typeof stats.bsize === 'number' && typeof stats.bfree === 'number') {
      freeBytes = stats.bfree * stats.bsize;
      totalBytes = stats.blocks * stats.bsize;
      const usedBytes = totalBytes - freeBytes;
      percentUsed = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
      percentFree = totalBytes > 0 ? Math.round((freeBytes / totalBytes) * 100) : 0;

      if (percentUsed > 85) {
        warning = 'Memoria USB al >85% de capacidad';
      }
    }
  } catch {
    // statfs fallback
  }

  const driveMatch = selectedRoot.match(/^([a-zA-Z]):/);

  return {
    detected: true,
    driveLetter: driveMatch ? driveMatch[1].toUpperCase() : undefined,
    vaultPath: selectedRoot,
    isContingency: false,
    freeBytes,
    totalBytes,
    percentUsed,
    percentFree,
    warning
  };
}

/**
 * SUG-03: Simulacro de Restauración (Dry-Run).
 * Toma el último snapshot físico en ./data/snapshots/, lo abre en conexión de solo lectura,
 * ejecuta PRAGMA integrity_check y verifyAuditChain() sin tocar la DB de producción.
 */
export async function executeDryRunVerification(snapshotsDir?: string): Promise<DryRunResult> {
  const dir = snapshotsDir || path.resolve(process.cwd(), './data/snapshots');
  const now = Date.now();

  if (!fs.existsSync(dir)) {
    const res: DryRunResult = {
      status: 'NO_SNAPSHOT',
      snapshotVerified: null,
      auditChainValid: null,
      checkedAtMs: now,
      message: 'Directorio de snapshots no existe'
    };
    setLastDryRun(res);
    return res;
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.db'));
  if (files.length === 0) {
    const res: DryRunResult = {
      status: 'NO_SNAPSHOT',
      snapshotVerified: null,
      auditChainValid: null,
      checkedAtMs: now,
      message: 'No se encontraron snapshots físicos en ./data/snapshots/'
    };
    setLastDryRun(res);
    return res;
  }

  // Seleccionar el snapshot más reciente por mtime
  let latestFile = files[0];
  let latestMtime = 0;
  for (const f of files) {
    try {
      const s = fs.statSync(path.join(dir, f));
      if (s.mtimeMs > latestMtime) {
        latestMtime = s.mtimeMs;
        latestFile = f;
      }
    } catch {}
  }

  const snapshotPath = path.join(dir, latestFile);
  let tempDb: Database.Database | null = null;

  try {
    tempDb = new DatabaseConstructor(snapshotPath, { readonly: true, fileMustExist: true });

    const integrityRows = tempDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const isIntegrityOk = integrityRows.length > 0 && integrityRows[0].integrity_check === 'ok';

    const auditRes = verifyAuditChain(tempDb);

    tempDb.close();
    tempDb = null;

    const isOk = isIntegrityOk && auditRes.valid;
    const res: DryRunResult = {
      status: isOk ? 'OK' : 'ERROR',
      snapshotVerified: latestFile,
      auditChainValid: auditRes.valid,
      auditCount: auditRes.count,
      headHash: auditRes.headHash,
      checkedAtMs: now,
      message: isOk
        ? 'Simulacro de restauración completado exitosamente sin tocar producción'
        : (auditRes.reason || 'Fallo en comprobación de integridad')
    };
    setLastDryRun(res);
    return res;
  } catch (err: any) {
    if (tempDb) {
      try { tempDb.close(); } catch {}
    }
    const res: DryRunResult = {
      status: 'ERROR',
      snapshotVerified: latestFile,
      auditChainValid: false,
      checkedAtMs: now,
      error: err.message,
      message: `Error al verificar snapshot: ${err.message}`
    };
    setLastDryRun(res);
    return res;
  }
}

export interface EncryptedBackupOptions {
  destinationDir?: string;
  jornadaId?: string;
  actorUserId?: string;
  backupType?: 'ENCRYPTED_USB_DAILY' | 'MANUAL_EXPORT';
  recipients?: string[];
  scanRoots?: string[];
}

export interface EncryptedBackupResult {
  backupId: string;
  backupType: 'ENCRYPTED_USB_DAILY' | 'MANUAL_EXPORT';
  encryptedFilePath: string;
  filename: string;
  fileSizeBytes: number;
  sha256Hash: string;
  jornadaId: string | null;
  auditHeadHash: string;
  recipientsCount: number;
  createdAtMs: number;
  companionJsonPath?: string;
  usbConnected?: boolean;
  usbStorageWarning?: string;
}

/**
 * Genera un paquete de respaldo cifrado con age dirigido exclusivamente a las claves públicas
 * de la Administración y Custodio Seguro.
 * 
 * Invariante de seguridad:
 * La laptop jamás posee las claves privadas. El archivo generado (.db.age) NO puede
 * ser descifrado por ningún archivo dentro del sistema del Food Truck.
 */
export async function createEncryptedBackup(
  rawDb: Database.Database,
  options: EncryptedBackupOptions = {}
): Promise<EncryptedBackupResult> {
  const usbVault = detectUsbVault(options.scanRoots);
  const destinationDir = options.destinationDir || usbVault.vaultPath;
  const backupType = options.backupType || 'ENCRYPTED_USB_DAILY';
  const recipients = options.recipients || DEFAULT_AGE_RECIPIENTS;
  const now = Date.now();
  const backupId = `bck_${generateUuidV7()}`;

  if (!fs.existsSync(destinationDir)) {
    fs.mkdirSync(destinationDir, { recursive: true });
  }

  // 1. Obtener jornada relevante y hash de cabeza de audit_events
  let jornadaId = options.jornadaId || null;
  let zReportJson: string | null = null;

  if (jornadaId) {
    const row = rawDb.prepare('SELECT z_report_json FROM jornadas WHERE id = ?').get(jornadaId) as any;
    if (row?.z_report_json) {
      zReportJson = row.z_report_json;
    }
  } else {
    // Buscar la última jornada cerrada o abierta
    const lastJornada = rawDb.prepare(`
      SELECT id, z_report_json 
      FROM jornadas 
      ORDER BY opened_at_ms DESC 
      LIMIT 1
    `).get() as any;
    if (lastJornada) {
      jornadaId = lastJornada.id;
      zReportJson = lastJornada.z_report_json || null;
    }
  }

  const lastAudit = rawDb.prepare(`
    SELECT entry_hash 
    FROM audit_events 
    ORDER BY seq DESC 
    LIMIT 1
  `).get() as { entry_hash: string } | undefined;

  const auditHeadHash = lastAudit?.entry_hash || GENESIS_HASH;

  // 2. Crear un snapshot físico temporal en caliente de la base de datos
  const tempDir = path.resolve(process.cwd(), './data/temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempSnapshotFile = path.join(tempDir, `temp-backup-${backupId}.db`);
  await rawDb.backup(tempSnapshotFile);

  try {
    // 3. Incrustar manifiesto oficial dentro del snapshot temporal antes de cifrar
    const tempDb = new DatabaseConstructor(tempSnapshotFile);
    tempDb.exec(`
      CREATE TABLE IF NOT EXISTS _backup_manifest (
        id TEXT PRIMARY KEY,
        backup_type TEXT NOT NULL,
        jornada_id TEXT,
        z_report_json TEXT,
        audit_head_hash TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        system_version TEXT NOT NULL
      );
    `);

    tempDb.prepare(`
      INSERT OR REPLACE INTO _backup_manifest (
        id, backup_type, jornada_id, z_report_json, audit_head_hash, created_at_ms, system_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(backupId, backupType, jornadaId, zReportJson, auditHeadHash, now, '1.0.0-M9');

    // Forzar checkpoint para consolidar cambios
    tempDb.pragma('wal_checkpoint(TRUNCATE)');
    tempDb.close();

    // 4. Leer el archivo binario completo del snapshot
    const dbBuffer = fs.readFileSync(tempSnapshotFile);

    // 5. Cifrar con age dirigido a las claves públicas destinatarias
    const { encryptedBuffer, recipientsCount } = await encryptWithAge(dbBuffer, recipients);

    // 6. Calcular SHA-256 del archivo cifrado resultante
    const sha256Hash = crypto.createHash('sha256').update(encryptedBuffer).digest('hex');

    // 7. Escribir archivo cifrado a la ruta destino (.db.age)
    const filename = `tocineta-backup-${now}.db.age`;
    const encryptedFilePath = path.join(destinationDir, filename);
    fs.writeFileSync(encryptedFilePath, encryptedBuffer);

    // 8. Opcionalmente guardar el JSON del Cierre Z complementario si existe
    let companionJsonPath: string | undefined;
    if (zReportJson) {
      const jsonFilename = `cierre-z-${now}.json`;
      companionJsonPath = path.join(destinationDir, jsonFilename);
      const manifestObject = {
        backupId,
        backupType,
        jornadaId,
        auditHeadHash,
        sha256BackupDbAge: sha256Hash,
        createdAtMs: now,
        cierreZ: JSON.parse(zReportJson)
      };
      fs.writeFileSync(companionJsonPath, JSON.stringify(manifestObject, null, 2), 'utf-8');
    }

    // 9. Registrar en la bitácora backups_log de la base de datos activa
    rawDb.prepare(`
      INSERT INTO backups_log (
        id, backup_type, destination_path, file_size_bytes, sha256_hash,
        jornada_id, audit_head_hash, recipients_count, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      backupId,
      backupType,
      encryptedFilePath,
      encryptedBuffer.length,
      sha256Hash,
      jornadaId,
      auditHeadHash,
      recipientsCount,
      now
    );

    // 10. Registrar en la cadena inmutable de auditoría
    appendAuditEvent(rawDb, {
      actorUserId: options.actorUserId || null,
      action: 'BACKUP_ENCRYPTED_EXPORTED',
      entityType: 'backup',
      entityId: backupId,
      payload: {
        backupType,
        encryptedFilePath,
        fileSizeBytes: encryptedBuffer.length,
        sha256Hash,
        auditHeadHash,
        recipientsCount,
        jornadaId
      }
    });

    return {
      backupId,
      backupType,
      encryptedFilePath,
      filename,
      fileSizeBytes: encryptedBuffer.length,
      sha256Hash,
      jornadaId,
      auditHeadHash,
      recipientsCount,
      createdAtMs: now,
      companionJsonPath,
      usbConnected: usbVault.detected,
      usbStorageWarning: usbVault.warning
    };
  } finally {
    // Limpiar snapshot temporal no cifrado
    try {
      if (fs.existsSync(tempSnapshotFile)) {
        fs.unlinkSync(tempSnapshotFile);
      }
    } catch {
      // Ignorar error de limpieza
    }
  }
}

/**
 * Consulta el historial de respaldos registrados en la base de datos
 */
export function getBackupsHistory(rawDb: Database.Database, limit = 20): any[] {
  return rawDb.prepare(`
    SELECT * 
    FROM backups_log 
    ORDER BY created_at_ms DESC 
    LIMIT ?
  `).all(limit);
}
