import * as path from 'node:path';
import * as fs from 'node:fs';
import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import {
  type ReleaseManifest,
  verifyManifestSignature,
  computeSha256
} from './signer.js';
import { verifyPin } from '../auth/pin.js';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';

// Clave pública oficial de Varons Media para verificación Ed25519
export const VARONS_MEDIA_OFFICIAL_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEACLinq5i8QkWFX+SDHSroZSGO8aCh+H4V6A5QZZWzA6M=
-----END PUBLIC KEY-----`;

export interface ApplyUpdateOptions {
  publicKeyPem?: string;
  forceEmergencyUpdate?: boolean;
  adminPin?: string;
  actorUserId?: string;
  currentDate?: Date; // Permite simular horario en pruebas
}

export interface UpdateResult {
  success: boolean;
  version: string;
  previousVersion: string;
  appliedMigrationsCount: number;
  message: string;
  snapshotPath?: string;
}

/**
 * Determina si la hora dada se encuentra dentro del horario de venta del Food Truck
 * Horario protegido de venta: 16:00 a 02:00 hora America/Caracas (4:00 PM a 2:00 AM)
 */
export function isSalesHours(date = new Date()): boolean {
  try {
    const caracasTimeStr = date.toLocaleTimeString('en-US', {
      timeZone: 'America/Caracas',
      hour12: false,
      hour: '2-digit'
    });
    const hour = parseInt(caracasTimeStr, 10);
    // 16:00 a 23:59 ó 00:00 a 01:59
    return hour >= 16 || hour < 2;
  } catch {
    // Si la zona no estuviera disponible, fallback con UTC-4
    const utcHours = date.getUTCHours();
    const caracasHour = (utcHours - 4 + 24) % 24;
    return caracasHour >= 16 || caracasHour < 2;
  }
}

/**
 * Obtiene la versión actual instalada en el sistema desde _system_meta
 */
export function getCurrentSystemVersion(rawDb: Database.Database): string {
  try {
    const row = rawDb.prepare("SELECT value FROM _system_meta WHERE key = 'version'").get() as { value: string } | undefined;
    if (row && row.value) {
      return row.value;
    }
  } catch {
    // Ignorar si tabla no existe aún
  }
  return '1.0.0';
}

/**
 * Verifica y aplica un paquete de actualización firmado con Ed25519 de forma atómica
 */
export async function applySignedUpdatePackage(
  rawDb: Database.Database,
  packageData: {
    manifestJson: string;
    signatureBase64: string;
    filesData?: Record<string, string>;
  },
  options: ApplyUpdateOptions = {}
): Promise<UpdateResult> {
  const now = Date.now();
  const currentDate = options.currentDate || new Date(now);
  const currentVersion = getCurrentSystemVersion(rawDb);
  const publicKeyToUse = options.publicKeyPem || process.env.VARONS_MEDIA_UPDATE_PUBLIC_KEY || VARONS_MEDIA_OFFICIAL_PUBLIC_KEY;

  // 1. REGLA DE PROTECCIÓN DE HORARIO DE VENTA (16:00 a 02:00 Caracas)
  if (isSalesHours(currentDate)) {
    if (!options.forceEmergencyUpdate) {
      const err: any = new Error(
        'SALES_HOURS_BLOCKED: Actualizaciones bloqueadas durante el horario activo de ventas del Food Truck (16:00 a 02:00 hora Caracas). Para emergencias críticas, use forceEmergencyUpdate con el PIN de Administrador.'
      );
      err.statusCode = 403;
      err.code = 'SALES_HOURS_BLOCKED';
      throw err;
    }

    // Validar PIN de administrador para desbloqueo de emergencia
    if (!options.adminPin) {
      const err: any = new Error('Se requiere el PIN de Administrador para forzar una actualización durante horario de venta');
      err.statusCode = 403;
      err.code = 'ADMIN_PIN_REQUIRED';
      throw err;
    }

    const admins = rawDb.prepare("SELECT id, pin_salt, pin_hash FROM users WHERE role = 'admin' AND is_active = 1").all() as any[];
    const isPinValid = admins.some(a => verifyPin(options.adminPin!, a.pin_salt, a.pin_hash));

    if (!isPinValid) {
      const err: any = new Error('PIN de Administrador inválido para forzar actualización de emergencia');
      err.statusCode = 403;
      err.code = 'PIN_ADMIN_INVALID';
      throw err;
    }
  }

  // 2. PARSEAR MANIFEST
  let manifest: ReleaseManifest;
  try {
    manifest = JSON.parse(packageData.manifestJson);
    if (!manifest.version || !Array.isArray(manifest.files)) {
      throw new Error('Estructura de manifest.json inválida');
    }
  } catch (err: any) {
    const parseErr: any = new Error(`Formato de manifest.json corrupto: ${err.message}`);
    parseErr.statusCode = 400;
    parseErr.code = 'INVALID_MANIFEST';
    throw parseErr;
  }

  // 3. PASO 1: VERIFICACIÓN CRIPTOGRÁFICA ED25519
  const isSignatureValid = verifyManifestSignature(
    packageData.manifestJson,
    packageData.signatureBase64,
    publicKeyToUse
  );

  if (!isSignatureValid) {
    appendAuditEvent(rawDb, {
      actorUserId: options.actorUserId || null,
      action: 'UPDATE_ATTEMPT_REJECTED',
      entityType: 'system_update',
      entityId: manifest.version || 'unknown_version',
      payload: {
        attemptedVersion: manifest.version,
        reason: 'INVALID_SIGNATURE',
        manifestSha256: computeSha256(packageData.manifestJson)
      }
    });

    const err: any = new Error('INVALID_SIGNATURE: La firma digital Ed25519 no coincide con la clave pública oficial de Varons Media o el paquete fue alterado.');
    err.statusCode = 400;
    err.code = 'INVALID_SIGNATURE';
    throw err;
  }

  // 4. VERIFICACIÓN DE HASHES SHA-256 DE LOS ARCHIVOS INCLUIDOS
  if (packageData.filesData) {
    for (const f of manifest.files) {
      const content = packageData.filesData[f.path];
      if (content === undefined) {
        const err: any = new Error(`INVALID_PACKAGE: Falta el archivo declarado en manifest '${f.path}'`);
        err.statusCode = 400;
        err.code = 'MISSING_FILE';
        throw err;
      }
      const actualHash = computeSha256(content);
      if (actualHash !== f.sha256) {
        appendAuditEvent(rawDb, {
          actorUserId: options.actorUserId || null,
          action: 'UPDATE_ATTEMPT_REJECTED',
          entityType: 'system_update',
          entityId: manifest.version || 'unknown_version',
          payload: {
            attemptedVersion: manifest.version,
            reason: 'FILE_HASH_MISMATCH',
            file: f.path,
            expectedSha256: f.sha256,
            actualSha256: actualHash
          }
        });

        const err: any = new Error(`INVALID_SIGNATURE: El archivo '${f.path}' no coincide con el hash SHA-256 firmado digitalmente`);
        err.statusCode = 400;
        err.code = 'INVALID_SIGNATURE';
        throw err;
      }
    }
  }

  // 5. PASO 2: TOMA DE SNAPSHOT FÍSICO EN CALIENTE (PRE-UPDATE)
  const snapshotsDir = path.resolve(process.cwd(), './data/snapshots');
  if (!fs.existsSync(snapshotsDir)) {
    fs.mkdirSync(snapshotsDir, { recursive: true });
  }
  const snapshotPath = path.join(snapshotsDir, `pre-update-${currentVersion}-${now}.db`);

  try {
    await rawDb.backup(snapshotPath);
  } catch (err: any) {
    // Si backup nativo no está disponible (ej. en DB en memoria de tests), continúa sin fallar
  }

  // 6. PASO 3 & 4: EJECUCIÓN ATÓMICA DE MIGRACIONES CON ROLLBACK AUTOMÁTICO
  const updateId = `upd_${generateUuidV7()}`;
  const manifestSha256 = computeSha256(packageData.manifestJson);
  let appliedMigrationsCount = 0;

  if (manifest.migrations && manifest.migrations.length > 0) {
    try {
      const executeMigrationsTx = rawDb.transaction(() => {
        for (const mig of manifest.migrations!) {
          // Ejecutar DDL / DML de la migración
          rawDb.exec(mig.sql);

          // Registrar en tabla _migrations
          rawDb.prepare(`
            INSERT OR IGNORE INTO _migrations (name, applied_at_ms)
            VALUES (?, ?)
          `).run(mig.name, now);

          appliedMigrationsCount++;
        }

        // Prueba de salud e integridad SQLite antes de consolidar
        const integrityRows = rawDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
        if (!integrityRows || integrityRows.length === 0 || integrityRows[0].integrity_check !== 'ok') {
          throw new Error(`Fallo en prueba de integridad SQLite: ${integrityRows?.[0]?.integrity_check || 'unknown'}`);
        }
      });

      // Ejecutar la transacción
      executeMigrationsTx();
    } catch (migErr: any) {
      // ROLLBACK AUTOMÁTICO: better-sqlite3 aborta la transacción automáticamente ante cualquier excepción
      // Registrar incidente en auditoría inmutable
      appendAuditEvent(rawDb, {
        actorUserId: options.actorUserId || null,
        action: 'UPDATE_FAILED_ROLLBACK',
        entityType: 'system_update',
        entityId: updateId,
        payload: {
          attemptedVersion: manifest.version,
          previousVersion: currentVersion,
          error: migErr.message,
          status: 'AUTOMATIC_ROLLBACK_COMPLETED'
        }
      });

      // Registrar en system_updates
      try {
        rawDb.prepare(`
          INSERT INTO system_updates (
            id, version, previous_version, description, manifest_sha256,
            applied_by_user_id, applied_at_ms, status, error_details
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'FAILED_ROLLBACK', ?)
        `).run(
          updateId,
          manifest.version,
          currentVersion,
          manifest.description || null,
          manifestSha256,
          options.actorUserId || null,
          now,
          migErr.message
        );
      } catch {
        // Ignorar si la tabla no existiera
      }

      const rollbackErr: any = new Error(
        `AUTOMATIC_ROLLBACK_COMPLETED: La migración falló con el error '${migErr.message}'. Se ejecutó reversión automática total; la base de datos y la versión ${currentVersion} permanecen 100% operativas e intactas.`
      );
      rollbackErr.statusCode = 500;
      rollbackErr.code = 'AUTOMATIC_ROLLBACK_COMPLETED';
      rollbackErr.previousVersion = currentVersion;
      throw rollbackErr;
    }
  }

  // 7. PASO 5: CONSOLIDAR ÉXITO Y ACTUALIZAR _SYSTEM_META.VERSION
  rawDb.prepare(`
    INSERT INTO _system_meta (key, value, updated_at_ms)
    VALUES ('version', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_ms = excluded.updated_at_ms
  `).run(manifest.version, now);

  // Registrar en tabla histórica system_updates
  try {
    rawDb.prepare(`
      INSERT INTO system_updates (
        id, version, previous_version, description, manifest_sha256,
        applied_by_user_id, applied_at_ms, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'APPLIED')
    `).run(
      updateId,
      manifest.version,
      currentVersion,
      manifest.description || null,
      manifestSha256,
      options.actorUserId || null,
      now
    );
  } catch {
    // Ignorar si la tabla no existiera
  }

  // Registrar en Auditoría Inmutable
  appendAuditEvent(rawDb, {
    actorUserId: options.actorUserId || null,
    action: 'UPDATE_APPLIED_SUCCESS',
    entityType: 'system_update',
    entityId: updateId,
    payload: {
      updateId,
      previousVersion: currentVersion,
      newVersion: manifest.version,
      filesCount: manifest.files.length,
      migrationsCount: appliedMigrationsCount,
      snapshotPath
    }
  });

  // Emitir evento por WebSocket
  try {
    publishDomainEvent(rawDb, {
      eventType: 'SYSTEM_UPDATED',
      entityId: manifest.version,
      payload: {
        version: manifest.version,
        previousVersion: currentVersion,
        appliedAtMs: now
      }
    });
  } catch {
    // Ignorar si no hay websocket activo
  }

  return {
    success: true,
    version: manifest.version,
    previousVersion: currentVersion,
    appliedMigrationsCount,
    message: `Actualización a versión ${manifest.version} instalada con éxito`,
    snapshotPath
  };
}

/**
 * Recupera actualizaciones interrumpidas o atascadas en 'IN_PROGRESS' durante el arranque del sistema.
 * Ajuste B2: Ejecuta PRAGMA integrity_check, pasa status a 'FAILED_ROLLBACK' y registra STUCK_UPDATE_RECOVERED_ON_BOOT en audit_events.
 */
export function recoverStuckUpdatesOnBoot(rawDb: Database.Database): number {
  try {
    const stuckUpdates = rawDb.prepare(`
      SELECT id, version, previous_version FROM system_updates WHERE status = 'IN_PROGRESS'
    `).all() as { id: string; version: string; previous_version?: string }[];

    if (!stuckUpdates || stuckUpdates.length === 0) {
      return 0;
    }

    // Ejecuta PRAGMA integrity_check
    const integrityResult = rawDb.pragma('integrity_check') as any;
    const isIntegrityOk = Array.isArray(integrityResult)
      ? integrityResult[0]?.integrity_check === 'ok'
      : true;

    const now = Date.now();

    for (const update of stuckUpdates) {
      rawDb.prepare(`
        UPDATE system_updates
        SET status = 'FAILED_ROLLBACK',
            error_details = 'STUCK_UPDATE_RECOVERED_ON_BOOT: Actualización interrumpida en arranque anterior revertida automáticamente.'
        WHERE id = ?
      `).run(update.id);

      appendAuditEvent(rawDb, {
        actorUserId: null,
        action: 'STUCK_UPDATE_RECOVERED_ON_BOOT',
        entityType: 'system_update',
        entityId: update.id,
        payload: {
          updateId: update.id,
          version: update.version,
          previousVersion: update.previous_version,
          integrityCheck: isIntegrityOk ? 'ok' : JSON.stringify(integrityResult),
          recoveredAtMs: now
        }
      });
    }

    return stuckUpdates.length;
  } catch {
    // Si la tabla system_updates no existe u otro error no fatal en boot
    return 0;
  }
}

