/**
 * SISTEMA OPERATIVO LOCAL TOCINETA
 * Motor de Respaldo Cifrado con Age hacia Almacenamiento Local (USB) y Telegram
 *
 * TAREA 1 (Ajuste R4):
 * - Genera snapshot en caliente de la base de datos SQLite sin interrumpir operaciones (WAL-safe).
 * - Incrusta manifiesto de auditoría y versión en el snapshot.
 * - Cifra el archivo usando Age con las claves públicas de la Administración y Custodio Seguro.
 * - Copia el archivo (.db.age) a USB_BACKUP_PATH si existe la ruta (opcional, si no existe solo avisa).
 * - Envía el archivo cifrado .db.age directamente al chat de Telegram del administrador usando la API de Telegram (sendDocument).
 * - Si ocurre cualquier fallo, registra un registro de error en la tabla server_errors.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import DatabaseConstructor from 'better-sqlite3';
import { generateUuidV7 } from '../packages/shared/src/utils/id.js';
import { encryptWithAge } from '../apps/server/src/modules/backups/age-service.js';
import { DEFAULT_AGE_RECIPIENTS } from '../apps/server/src/modules/backups/constants.js';
import { appendAuditEvent, GENESIS_HASH } from '../apps/server/src/modules/audit/audit-service.js';

interface CliOptions {
  dbPath?: string;
  usbBackupPath?: string;
  envFilePath?: string;
  botToken?: string;
  chatId?: string;
}

function parseCliArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--db' && args[i + 1]) {
      opts.dbPath = args[++i];
    } else if (arg === '--usb' && args[i + 1]) {
      opts.usbBackupPath = args[++i];
    } else if (arg === '--env' && args[i + 1]) {
      opts.envFilePath = args[++i];
    } else if (arg === '--bot-token' && args[i + 1]) {
      opts.botToken = args[++i];
    } else if (arg === '--chat-id' && args[i + 1]) {
      opts.chatId = args[++i];
    }
  }
  return opts;
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

function logServerErrorToDatabase(dbPath: string, error: Error, contextDetails: Record<string, any>) {
  try {
    if (!fs.existsSync(dbPath)) {
      console.error(`[ALERTA] No se pudo registrar en server_errors porque la base de datos no existe en: ${dbPath}`);
      return;
    }

    const db = new DatabaseConstructor(dbPath);
    db.pragma('busy_timeout = 5000');

    // Asegurar existencia de tabla server_errors
    db.exec(`
      CREATE TABLE IF NOT EXISTS server_errors (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        status INTEGER NOT NULL,
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        stack TEXT,
        body_json TEXT,
        user_id TEXT,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_server_errors_created ON server_errors(created_at_ms DESC);
    `);

    const now = Date.now();
    const errId = `serr_${now}_${Math.random().toString(36).slice(2, 9)}`;
    const requestId = `job_backup_${now}`;

    db.prepare(`
      INSERT INTO server_errors (
        id, request_id, method, url, status, code, message, stack, body_json, user_id, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      errId,
      requestId,
      'JOB',
      'scripts/respaldo-drive.ps1',
      500,
      'BACKUP_FAILED',
      error.message || 'Error en respaldo a Telegram',
      error.stack || null,
      JSON.stringify(contextDetails),
      'SYSTEM',
      now
    );

    // Conservar maximo ultimos 500 registros
    db.prepare(`
      DELETE FROM server_errors
      WHERE id NOT IN (
        SELECT id FROM server_errors
        ORDER BY created_at_ms DESC, rowid DESC
        LIMIT 500
      )
    `).run();

    db.close();
    console.log(`[INFO] Registro de fallo guardado exitosamente en tabla server_errors (ID: ${errId})`);
  } catch (logErr: any) {
    console.error(`[ERROR CRITICO] Fallo al registrar en server_errors: ${logErr.message}`);
  }
}

async function runBackup() {
  const cliOpts = parseCliArgs();
  const repoRoot = path.resolve(process.cwd());

  const envFilePath = cliOpts.envFilePath
    ? path.resolve(cliOpts.envFilePath)
    : path.resolve(repoRoot, '.env');

  const fileEnv = loadEnvFile(envFilePath);

  // Mezclar variables de entorno con prioridad a CLI > process.env > .env
  const dbPath = path.resolve(
    cliOpts.dbPath || process.env.DB_PATH || fileEnv.DB_PATH || './data/tocineta.db'
  );

  const rawUsbBackupPath = (cliOpts.usbBackupPath || process.env.USB_BACKUP_PATH || fileEnv.USB_BACKUP_PATH || '').trim();
  let usbBackupDir: string | null = null;
  if (rawUsbBackupPath) {
    const resolvedUsb = path.resolve(rawUsbBackupPath);
    if (fs.existsSync(resolvedUsb)) {
      usbBackupDir = resolvedUsb;
    } else {
      console.log(`[AVISO] La ruta USB_BACKUP_PATH no existe o no esta conectada: ${resolvedUsb}. Se omitira la copia local y se continuara con el envio por Telegram.`);
    }
  } else {
    console.log(`[AVISO] USB_BACKUP_PATH no esta configurado. El respaldo continuara exclusivamente por Telegram.`);
  }

  const telegramBotToken = (cliOpts.botToken || process.env.TELEGRAM_BOT_TOKEN || fileEnv.TELEGRAM_BOT_TOKEN || '').trim();
  const telegramChatId = (cliOpts.chatId || process.env.TELEGRAM_CHAT_ID || fileEnv.TELEGRAM_CHAT_ID || '').trim();

  if (!telegramBotToken || !telegramChatId) {
    throw new Error('TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID deben estar configurados en .env o pasarse como parametros para enviar el respaldo por Telegram.');
  }

  const adminKey = (process.env.AGE_RECIPIENT_ADMIN || fileEnv.AGE_RECIPIENT_ADMIN || '').trim();
  const secureKey = (process.env.AGE_RECIPIENT_SECURE || fileEnv.AGE_RECIPIENT_SECURE || '').trim();

  // Construir destinatarios Age autorizados
  const recipients: string[] = [];
  if (adminKey.startsWith('age1')) recipients.push(adminKey);
  if (secureKey.startsWith('age1')) recipients.push(secureKey);

  if (recipients.length === 0) {
    // Si no se pasaron claves en .env, usar los destinatarios predeterminados del sistema
    recipients.push(...DEFAULT_AGE_RECIPIENTS);
  }

  console.log('\n=============================================================');
  console.log('   TOCINETA - RESPALDO CIFRADO CON AGE HACIA TELEGRAM        ');
  console.log('=============================================================');
  console.log(`- Base de Datos origen:   ${dbPath}`);
  console.log(`- Directorio USB / Local: ${usbBackupDir ? usbBackupDir : '(Omitido / No disponible)'}`);
  console.log(`- Canal de Respaldo:      Telegram (Chat ID: ${telegramChatId})`);
  console.log(`- Destinatarios Age:      ${recipients.length} claves publicas activas`);

  // Validar existencia de base de datos origen
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Base de datos principal no encontrada en: ${dbPath}`);
  }

  const now = Date.now();
  const backupId = `bck_${generateUuidV7()}`;
  const tempDir = path.resolve(repoRoot, './data/temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempSnapshotFile = path.join(tempDir, `temp-backup-${backupId}.db`);

  // 1. Abrir conexion de base de datos activa
  const rawDb = new DatabaseConstructor(dbPath);
  rawDb.pragma('busy_timeout = 10000');

  let companionJsonContent: string | null = null;
  let companionFilename: string | null = null;

  try {
    // 2. Obtener ultima jornada y hash de auditoria
    const lastJornada = rawDb.prepare(`
      SELECT id, z_report_json 
      FROM jornadas 
      ORDER BY opened_at_ms DESC 
      LIMIT 1
    `).get() as { id: string; z_report_json?: string } | undefined;

    const jornadaId = lastJornada?.id || null;
    const zReportJson = lastJornada?.z_report_json || null;

    const lastAudit = rawDb.prepare(`
      SELECT entry_hash 
      FROM audit_events 
      ORDER BY seq DESC 
      LIMIT 1
    `).get() as { entry_hash: string } | undefined;

    const auditHeadHash = lastAudit?.entry_hash || GENESIS_HASH;

    // 3. Crear snapshot fisico en caliente usando la API oficial SQLite Online Backup
    console.log(`- Creando snapshot fisico en caliente con SQLite Online Backup API...`);
    await rawDb.backup(tempSnapshotFile);

    // 4. Incrustar manifiesto oficial dentro del snapshot temporal antes de cifrar
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
    `).run(backupId, 'ENCRYPTED_USB_DAILY', jornadaId, zReportJson, auditHeadHash, now, '1.0.0-M9');

    tempDb.pragma('wal_checkpoint(TRUNCATE)');
    tempDb.close();

    // 5. Leer buffer del snapshot
    const dbBuffer = fs.readFileSync(tempSnapshotFile);

    // 6. Cifrar con Age
    console.log(`- Cifrando base de datos con Age (${recipients.length} destinatarios)...`);
    const { encryptedBuffer, recipientsCount } = await encryptWithAge(dbBuffer, recipients);

    // 7. Calcular checksum SHA-256
    const sha256Hash = crypto.createHash('sha256').update(encryptedBuffer).digest('hex');
    const filename = `tocineta-backup-${now}.db.age`;

    // 8. Escribir archivo .db.age en USB_BACKUP_PATH solo si existe la ruta
    let localEncryptedPath: string | null = null;
    if (usbBackupDir) {
      localEncryptedPath = path.join(usbBackupDir, filename);
      fs.writeFileSync(localEncryptedPath, encryptedBuffer);
      console.log(`- Guardado en directorio USB/Local: ${localEncryptedPath} (${encryptedBuffer.length} bytes)`);

      // 9. Si existe Cierre Z, escribir manifiesto companero JSON en USB
      if (zReportJson) {
        companionFilename = `cierre-z-${now}.json`;
        const manifestObject = {
          backupId,
          backupType: 'ENCRYPTED_USB_DAILY',
          jornadaId,
          auditHeadHash,
          sha256BackupDbAge: sha256Hash,
          createdAtMs: now,
          cierreZ: JSON.parse(zReportJson)
        };
        companionJsonContent = JSON.stringify(manifestObject, null, 2);
        fs.writeFileSync(path.join(usbBackupDir, companionFilename), companionJsonContent, 'utf-8');
      }
    }

    // 10. Enviar archivo cifrado (.db.age) a Telegram vía sendDocument
    console.log(`- Enviando archivo cifrado a Telegram (Chat ID: ${telegramChatId})...`);
    const telegramUrl = `https://api.telegram.org/bot${telegramBotToken}/sendDocument`;

    const formData = new FormData();
    formData.append('chat_id', telegramChatId);

    const fileBlob = new Blob([encryptedBuffer], { type: 'application/octet-stream' });
    formData.append('document', fileBlob, filename);

    const captionLines = [
      'TOCINETA — Respaldo Cifrado (.db.age)',
      `ID: ${backupId}`,
      `Fecha: ${new Date(now).toISOString()}`,
      `SHA-256: ${sha256Hash}`,
      `Tamano: ${(encryptedBuffer.length / 1024).toFixed(2)} KB`
    ];
    if (jornadaId) {
      captionLines.push(`Jornada: ${jornadaId}`);
    }
    formData.append('caption', captionLines.join('\n'));

    const tgResponse = await fetch(telegramUrl, {
      method: 'POST',
      body: formData
    });

    if (!tgResponse.ok) {
      const errorText = await tgResponse.text();
      throw new Error(`Error HTTP ${tgResponse.status} al enviar respaldo a Telegram: ${errorText}`);
    }

    const tgResult = (await tgResponse.json()) as { ok: boolean; description?: string };
    if (!tgResult.ok) {
      throw new Error(`Telegram rechazo el envio del respaldo: ${tgResult.description || 'Error desconocido'}`);
    }
    console.log(`- Entregado exitosamente al chat de Telegram.`);

    // 11. Registrar en tabla backups_log de la base de datos activa
    const loggedDestination = localEncryptedPath || `TELEGRAM:${telegramChatId}`;
    rawDb.prepare(`
      INSERT INTO backups_log (
        id, backup_type, destination_path, file_size_bytes, sha256_hash,
        jornada_id, audit_head_hash, recipients_count, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      backupId,
      'ENCRYPTED_USB_DAILY',
      loggedDestination,
      encryptedBuffer.length,
      sha256Hash,
      jornadaId,
      auditHeadHash,
      recipientsCount,
      now
    );

    // 12. Registrar en la cadena inmutable de auditoria
    appendAuditEvent(rawDb, {
      actorUserId: null,
      action: 'BACKUP_ENCRYPTED_EXPORTED',
      entityType: 'backup',
      entityId: backupId,
      payload: {
        backupType: 'ENCRYPTED_USB_DAILY',
        filename,
        destinationUsb: localEncryptedPath,
        destinationTelegram: `chat_id:${telegramChatId}`,
        fileSizeBytes: encryptedBuffer.length,
        sha256Hash,
        recipientsCount
      }
    });

    console.log('\n=============================================================');
    console.log('   RESPALDO COMPLETADO Y ENVIADO A TELEGRAM CON EXITO       ');
    console.log('=============================================================');
    console.log(`- ID de Respaldo:  ${backupId}`);
    console.log(`- Archivo Cifrado: ${filename}`);
    console.log(`- SHA-256 Hash:    ${sha256Hash}`);
    console.log(`- Tamano Cifrado:  ${(encryptedBuffer.length / 1024).toFixed(2)} KB`);
    console.log('=============================================================\n');
  } finally {
    rawDb.close();
    // Limpiar archivo temporal
    if (fs.existsSync(tempSnapshotFile)) {
      try {
        fs.unlinkSync(tempSnapshotFile);
      } catch {}
    }
  }
}

async function main() {
  const cliOpts = parseCliArgs();
  const repoRoot = path.resolve(process.cwd());
  const envFilePath = cliOpts.envFilePath
    ? path.resolve(cliOpts.envFilePath)
    : path.resolve(repoRoot, '.env');
  const fileEnv = loadEnvFile(envFilePath);
  const dbPath = path.resolve(
    cliOpts.dbPath || process.env.DB_PATH || fileEnv.DB_PATH || './data/tocineta.db'
  );

  try {
    await runBackup();
    process.exit(0);
  } catch (err: any) {
    console.error('\n[FALLO CRITICO EN EL RESPALDO]', err.message);
    logServerErrorToDatabase(dbPath, err, {
      cliOpts,
      time: new Date().toISOString()
    });
    process.exit(1);
  }
}

main();
