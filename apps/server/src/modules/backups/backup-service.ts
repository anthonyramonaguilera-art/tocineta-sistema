import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import DatabaseConstructor from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { DEFAULT_AGE_RECIPIENTS, DEFAULT_USB_BACKUP_DIR } from './constants.js';
import { encryptWithAge } from './age-service.js';
import { appendAuditEvent } from '../audit/audit-service.js';

export interface EncryptedBackupOptions {
  destinationDir?: string;
  jornadaId?: string;
  actorUserId?: string;
  backupType?: 'ENCRYPTED_USB_DAILY' | 'MANUAL_EXPORT';
  recipients?: string[];
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
}

/**
 * Genera un paquete de respaldo cifrado con age dirigido exclusivamente a las claves públicas
 * de la Sra. Olinelcys y Varons Media.
 * 
 * Invariante de seguridad:
 * La laptop jamás posee las claves privadas. El archivo generado (.db.age) NO puede
 * ser descifrado por ningún archivo dentro del sistema del Food Truck.
 */
export async function createEncryptedBackup(
  rawDb: Database.Database,
  options: EncryptedBackupOptions = {}
): Promise<EncryptedBackupResult> {
  const destinationDir = options.destinationDir || DEFAULT_USB_BACKUP_DIR;
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

  const auditHeadHash = lastAudit?.entry_hash || 'GENESIS_HASH_TOCINETA_SONRIE_V1_2026';

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
      companionJsonPath
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
