/**
 * SISTEMA OPERATIVO LOCAL TOCINETA
 * Receptor Desatendido de Actualizaciones y Diagnóstico por Telegram (V-3)
 *
 * - Verificación criptográfica obligatoria Ed25519 y SHA-256 antes de tocar disco.
 * - Filtro estricto por TELEGRAM_ADMIN_IDS (descarta en silencio no autorizados).
 * - Ejecución exclusiva de comandos /estado y /diag (cero texto libre en consola).
 * - Respeto de jornada abierta consultando /api/jornadas/current.
 * - Disparo de scripts/actualizar.ps1 -LocalZip <zip> -Source Telegram.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import DatabaseConstructor from 'better-sqlite3';
import { verifyManifestSignature, computeSha256 } from '../apps/server/src/modules/updater/signer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..');

export type ProcessResultStatus =
  | 'IGNORED_UNAUTHORIZED'
  | 'REJECTED_INVALID_SIGNATURE'
  | 'REJECTED_INVALID_HASH'
  | 'REJECTED_DOWNGRADE'
  | 'REJECTED_NOT_NEWER'
  | 'REJECTED_INVALID_FILENAME'
  | 'DEFERRED_OPEN_JORNADA'
  | 'APPLIED_UPDATE'
  | 'COMMAND_EXECUTED'
  | 'NOOP'
  | 'PENDING_PAIR';

export interface ProcessResult {
  status: ProcessResultStatus;
  message?: string;
  version?: string;
  chatId?: number | string;
  updateId?: number;
  details?: any;
}

export function logActualizacion(message: string, level = 'INFO', rootDir = PROJECT_ROOT): void {
  try {
    const logsDir = path.join(rootDir, 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, 'actualizaciones.log');
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    fs.appendFileSync(logPath, `[${ts}] [${level}] [UPDATE-RECEIVER] ${message}\n`, 'utf-8');
  } catch {}
}

export function parseSemver(v: string): [number, number, number] {
  const [maj, min, pat] = v.trim().replace(/^v/i, '').split('.').map(n => parseInt(n, 10));
  return [isNaN(maj) ? 0 : maj, isNaN(min) ? 0 : min, isNaN(pat) ? 0 : pat];
}

export function isStrictlyGreaterSemver(candidate: string, current: string): boolean {
  const [cMaj, cMin, cPat] = parseSemver(candidate);
  const [curMaj, curMin, curPat] = parseSemver(current);
  if (cMaj !== curMaj) return cMaj > curMaj;
  if (cMin !== curMin) return cMin > curMin;
  return cPat > curPat;
}


export function assertSafeZipName(name: string): string {
  if (
    typeof name !== 'string' ||
    name.includes('..') ||
    path.basename(name) !== name ||
    !/^[A-Za-z0-9._-]{1,100}\.zip$/.test(name)
  ) {
    throw new Error('REJECTED_INVALID_FILENAME');
  }
  return name;
}

export function isAuthorizedAdmin(fromId: number | string | undefined, adminIdsConfig: string | string[]): boolean {
  if (fromId === undefined || fromId === null) return false;
  const target = String(fromId).trim();
  if (!target) return false;
  const allowed = Array.isArray(adminIdsConfig)
    ? adminIdsConfig.map(s => String(s).trim())
    : String(adminIdsConfig).split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(target);
}

export function getExpectedZipSha256(manifest: any, zipFileName?: string): string | null {
  if (!manifest) return null;
  if (manifest.zipSha256) return String(manifest.zipSha256);
  if (manifest.zipHash) return String(manifest.zipHash);
  if (manifest.sha256) return String(manifest.sha256);
  if (Array.isArray(manifest.files)) {
    if (zipFileName) {
      const match = manifest.files.find((f: any) => f.path === zipFileName || path.basename(f.path) === zipFileName);
      if (match?.sha256) return String(match.sha256);
    }
    const zipEntry = manifest.files.find((f: any) => typeof f.path === 'string' && f.path.endsWith('.zip'));
    if (zipEntry?.sha256) return String(zipEntry.sha256);
  }
  return null;
}

export async function checkOpenJornada(apiUrl = 'http://localhost:3000/api/jornadas/current', dbPath?: string): Promise<boolean> {
  try {
    const res = await fetch(apiUrl, { method: 'GET', signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const body = (await res.json()) as { success?: boolean; jornada?: any };
      return !!body?.jornada;
    }
  } catch {}

  const targetDb = dbPath || path.join(PROJECT_ROOT, 'data', 'tocineta.db');
  if (fs.existsSync(targetDb)) {
    try {
      const db = new DatabaseConstructor(targetDb, { readonly: true, fileMustExist: true });
      const row = db.prepare("SELECT id FROM jornadas WHERE (status = 'abierta' OR status = 'OPEN') AND closed_at_ms IS NULL LIMIT 1").get();
      db.close();
      return !!row;
    } catch {}
  }
  return false;
}

export function loadCurrentInstalledVersion(rootDir = PROJECT_ROOT): string {
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.version) return pkg.version;
    }
  } catch {}
  return '1.0.0';
}

export function loadPublicKeyPem(rootDir = PROJECT_ROOT, explicitKey?: string): string {
  if (explicitKey?.trim()) return explicitKey.trim();
  const keyPath = process.env.UPDATE_PUBLIC_KEY_PATH || path.join(rootDir, 'config', 'update-public-key.pem');
  if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath, 'utf-8').trim();
  return (process.env.UPDATE_PUBLIC_KEY || '').trim();
}

export interface VerifyAndApplyPackageOptions {
  sigBuffer: Buffer | string;
  zipBuffer: Buffer;
  zipFileName: string;
  publicKeyPem: string;
  currentVersion?: string;
  rootDir?: string;
  checkJornadaFn?: () => Promise<boolean>;
  applyUpdateFn?: (zipPath: string) => void;
  sendTelegramFn?: (msg: string) => Promise<void>;
}

export async function verifyAndProcessUpdatePackage(options: VerifyAndApplyPackageOptions): Promise<ProcessResult> {
  const rootDir = options.rootDir || PROJECT_ROOT;
  const currentVersion = options.currentVersion || loadCurrentInstalledVersion(rootDir);
  const pendingDir = path.join(rootDir, 'data', 'updates', 'pending');
  try {
    assertSafeZipName(options.zipFileName);
  } catch {
    logActualizacion(`Paquete rechazado: nombre de archivo inválido "${options.zipFileName}".`, 'ERROR', rootDir);
    return { status: 'REJECTED_INVALID_FILENAME', message: `Nombre de archivo zip inválido: ${options.zipFileName}` };
  }


  let sigData: any;
  try {
    const sigStr = Buffer.isBuffer(options.sigBuffer) ? options.sigBuffer.toString('utf-8') : options.sigBuffer;
    sigData = JSON.parse(sigStr);
  } catch {
    logActualizacion('Firma descartada: .sig no es JSON valido.', 'WARN', rootDir);
    return { status: 'REJECTED_INVALID_SIGNATURE', message: 'Archivo .sig con formato JSON invalido' };
  }

  const manifestJson = sigData.manifestJson || (typeof sigData.manifest === 'string' ? sigData.manifest : JSON.stringify(sigData.manifest, null, 2));
  const signatureBase64 = sigData.signatureBase64;
  if (!manifestJson || !signatureBase64) {
    return { status: 'REJECTED_INVALID_SIGNATURE', message: 'Faltan manifestJson o signatureBase64 en .sig' };
  }

  // 1. Verificar firma Ed25519 ANTES DE TOCAR DISCO
  const isValidSig = verifyManifestSignature(manifestJson, signatureBase64, options.publicKeyPem);
  if (!isValidSig) {
    logActualizacion('Paquete rechazado: firma Ed25519 invalida. Abortado antes de tocar disco.', 'ERROR', rootDir);
    return { status: 'REJECTED_INVALID_SIGNATURE', message: 'Firma Ed25519 invalida' };
  }

  // 2. Verificar semver strictly greater
  let manifest: any;
  try {
    manifest = typeof sigData.manifest === 'object' && sigData.manifest !== null ? sigData.manifest : JSON.parse(manifestJson);
  } catch {
    return { status: 'REJECTED_INVALID_SIGNATURE', message: 'Manifiesto invalido' };
  }

  const candidateVersion = manifest.version || sigData.version;
  if (!candidateVersion || !isStrictlyGreaterSemver(candidateVersion, currentVersion)) {
    logActualizacion(`Paquete rechazado: ${candidateVersion} <= ${currentVersion} (downgrade/replay).`, 'WARN', rootDir);
    return { status: 'REJECTED_DOWNGRADE', version: candidateVersion, message: `Version ${candidateVersion} <= ${currentVersion}` };
  }

  // 3. Verificar hash SHA-256 del .zip contra el manifiesto firmado
  const actualZipSha256 = computeSha256(options.zipBuffer);
  const expectedZipSha256 = getExpectedZipSha256(manifest, options.zipFileName);
  if (!expectedZipSha256 || actualZipSha256.toLowerCase() !== expectedZipSha256.toLowerCase()) {
    logActualizacion(`Paquete rechazado: SHA-256 (${actualZipSha256}) no coincide con (${expectedZipSha256}).`, 'ERROR', rootDir);
    return { status: 'REJECTED_INVALID_HASH', version: candidateVersion, message: 'Hash SHA-256 no coincide' };
  }

  // 4. Ventana segura: evaluar jornada abierta
  const checkJornada = options.checkJornadaFn || (() => checkOpenJornada(`http://localhost:${process.env.PORT || 3000}/api/jornadas/current`));
  const isJornadaOpen = await checkJornada();

  if (isJornadaOpen) {
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, options.zipFileName), options.zipBuffer);
    fs.writeFileSync(path.join(pendingDir, `${path.basename(options.zipFileName, '.zip')}.sig`), Buffer.isBuffer(options.sigBuffer) ? options.sigBuffer : Buffer.from(options.sigBuffer, 'utf-8'));
    fs.writeFileSync(path.join(pendingDir, 'pending-update.json'), JSON.stringify({ version: candidateVersion, zipFileName: options.zipFileName, savedAtMs: Date.now() }, null, 2), 'utf-8');

    const waitMsg = `Actualización ${candidateVersion} verificada y en espera: se aplicará automáticamente al cerrar la jornada`;
    logActualizacion(waitMsg, 'INFO', rootDir);
    if (options.sendTelegramFn) await options.sendTelegramFn(waitMsg);
    return { status: 'DEFERRED_OPEN_JORNADA', version: candidateVersion, message: waitMsg };
  }

  // 5. Aplicar actualizacion (sin jornada abierta)
  fs.mkdirSync(pendingDir, { recursive: true });
  const localZipPath = path.join(pendingDir, options.zipFileName);
  fs.writeFileSync(localZipPath, options.zipBuffer);

  logActualizacion(`Ventana segura disponible. Aplicando actualizacion version ${candidateVersion}...`, 'INFO', rootDir);
  if (options.applyUpdateFn) {
    options.applyUpdateFn(localZipPath);
  } else {
    const actScript = path.join(PROJECT_ROOT, 'scripts', 'actualizar.ps1');
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', actScript, '-LocalZip', localZipPath, '-Source', 'Telegram'], { cwd: rootDir, stdio: 'pipe' });
  }

  return { status: 'APPLIED_UPDATE', version: candidateVersion, message: `Actualizacion ${candidateVersion} aplicada exitosamente.` };
}

export async function processPendingUpdateIfJornadaClosed(
  rootDir = PROJECT_ROOT,
  checkJornadaFn?: () => Promise<boolean>,
  applyUpdateFn?: (zipPath: string) => void
): Promise<ProcessResult | null> {
  const pendingMetaPath = path.join(rootDir, 'data', 'updates', 'pending', 'pending-update.json');
  if (!fs.existsSync(pendingMetaPath)) return null;

  try {
    const meta = JSON.parse(fs.readFileSync(pendingMetaPath, 'utf-8'));
    try {
      assertSafeZipName(meta.zipFileName);
    } catch {
      logActualizacion(`Paquete pendiente rechazado: meta.zipFileName inválido "${meta.zipFileName}".`, 'ERROR', rootDir);
      return { status: 'REJECTED_INVALID_FILENAME', version: meta.version, message: `Nombre de archivo zip inválido: ${meta.zipFileName}` };
    }
    const isJornadaOpen = checkJornadaFn ? await checkJornadaFn() : await checkOpenJornada();
    if (isJornadaOpen) {
      return { status: 'DEFERRED_OPEN_JORNADA', version: meta.version, message: `Actualización ${meta.version} verificada y en espera: se aplicará automáticamente al cerrar la jornada` };
    }

    const zipPath = path.join(rootDir, 'data', 'updates', 'pending', meta.zipFileName);
    if (fs.existsSync(zipPath)) {
      logActualizacion(`Jornada cerrada detectada. Aplicando actualizacion pendiente ${meta.version}...`, 'INFO', rootDir);
      if (applyUpdateFn) {
        applyUpdateFn(zipPath);
      } else {
        const actScript = path.join(PROJECT_ROOT, 'scripts', 'actualizar.ps1');
        execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', actScript, '-LocalZip', zipPath, '-Source', 'Telegram'], { cwd: rootDir, stdio: 'pipe' });
      }
      try { fs.unlinkSync(pendingMetaPath); } catch {}
      return { status: 'APPLIED_UPDATE', version: meta.version, message: `Actualizacion ${meta.version} aplicada tras cierre de jornada.` };
    }
  } catch (err: any) {
    logActualizacion(`Error al procesar paquete pendiente: ${err.message}`, 'ERROR', rootDir);
  }
  return null;
}

export function getLastTelegramOffset(rootDir = PROJECT_ROOT): number | null {
  const offsetFile = path.join(rootDir, 'data', 'telegram-offset.txt');
  if (fs.existsSync(offsetFile)) {
    const val = parseInt(fs.readFileSync(offsetFile, 'utf-8').trim(), 10);
    return isNaN(val) ? null : val;
  }
  return null;
}

export function saveLastTelegramOffset(offset: number, rootDir = PROJECT_ROOT): void {
  const dataDir = path.join(rootDir, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'telegram-offset.txt'), String(offset), 'utf-8');
}

export async function sendTelegramMessage(botToken: string, chatId: number | string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

export async function sendTelegramDocument(botToken: string, chatId: number | string, filePath: string, caption = ''): Promise<void> {
  const fileBuffer = fs.readFileSync(filePath);
  const formData = new FormData();
  formData.append('chat_id', String(chatId));
  formData.append('document', new Blob([fileBuffer]), path.basename(filePath));
  if (caption) formData.append('caption', caption);
  await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: 'POST', body: formData });
}

export async function runUpdateReceiver(explicitRootDir = PROJECT_ROOT): Promise<ProcessResult[]> {
  const rootDir = explicitRootDir;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const adminIds = process.env.TELEGRAM_ADMIN_IDS || '';

  if (!botToken || !adminIds.trim()) {
    logActualizacion('TELEGRAM_BOT_TOKEN o TELEGRAM_ADMIN_IDS no configurados. Saltando recepcion.', 'WARN', rootDir);
    return [];
  }

  await processPendingUpdateIfJornadaClosed(rootDir);

  const lastOffset = getLastTelegramOffset(rootDir);
  const queryOffset = lastOffset !== null ? lastOffset + 1 : 0;
  const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${queryOffset}&timeout=5`;

  let updates: any[] = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const body = (await res.json()) as { ok: boolean; result?: any[] };
      if (body.ok && Array.isArray(body.result)) updates = body.result;
    }
  } catch (e: any) {
    logActualizacion(`Fallo en getUpdates de Telegram: ${e.message}`, 'WARN', rootDir);
    return [];
  }

  const results: ProcessResult[] = [];
  const incomingDir = path.join(rootDir, 'data', 'updates', 'incoming');
  fs.mkdirSync(incomingDir, { recursive: true });

  for (const u of updates) {
    saveLastTelegramOffset(u.update_id, rootDir);
    const msg = u.message;
    if (!msg) continue;

    const fromId = msg.from?.id;
    if (!isAuthorizedAdmin(fromId, adminIds)) {
      results.push({ status: 'IGNORED_UNAUTHORIZED', updateId: u.update_id });
      continue;
    }

    const chatId = msg.chat?.id || fromId;
    const text = (msg.text || '').trim();

    if (text === '/estado') {
      try {
        const v = loadCurrentInstalledVersion(rootDir);
        const isOpen = await checkOpenJornada();
        await sendTelegramMessage(botToken, chatId, `TOCINETA activo. Versión ${v}. Jornada actual: ${isOpen ? 'Abierta' : 'Cerrada'}. Receptor de actualizaciones en línea.`);
        logActualizacion(`Comando /estado atendido para admin ${fromId}.`, 'INFO', rootDir);
        results.push({ status: 'COMMAND_EXECUTED', chatId, updateId: u.update_id, details: '/estado' });
      } catch {}
      continue;
    }

    if (text === '/diag') {
      try {
        const diagScript = path.join(PROJECT_ROOT, 'scripts', 'diagnostico.ps1');
        const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', diagScript], { cwd: rootDir, encoding: 'utf-8' });
        const lastLine = out.trim().split(/\r?\n/).pop()?.trim() || '';
        if (fs.existsSync(lastLine) && lastLine.endsWith('.zip')) {
          await sendTelegramDocument(botToken, chatId, lastLine, 'TOCINETA — Paquete de Diagnóstico Forense');
          logActualizacion(`Diagnostico generado y transmitido a admin ${fromId}.`, 'INFO', rootDir);
          results.push({ status: 'COMMAND_EXECUTED', chatId, updateId: u.update_id, details: '/diag' });
        }
      } catch (err: any) {
        logActualizacion(`Error generando diagnostico para /diag: ${err.message}`, 'ERROR', rootDir);
      }
      continue;
    }

    const doc = msg.document;
    if (doc?.file_name && /^tocineta-([0-9]+\.[0-9]+\.[0-9]+)\.(zip|sig)$/i.test(doc.file_name)) {
      try {
        const fileInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${doc.file_id}`);
        const fileInfo = (await fileInfoRes.json()) as { ok: boolean; result?: { file_path: string } };
        if (fileInfo.ok && fileInfo.result?.file_path) {
          const dlRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`);
          const buf = Buffer.from(await dlRes.arrayBuffer());
          const savePath = path.join(incomingDir, doc.file_name);
          fs.writeFileSync(savePath, buf);

          const match = doc.file_name.match(/^tocineta-([0-9]+\.[0-9]+\.[0-9]+)\.(zip|sig)$/i)!;
          const version = match[1];
          const zipCandidate = path.join(incomingDir, `tocineta-${version}.zip`);
          const sigCandidate = path.join(incomingDir, `tocineta-${version}.sig`);

          if (fs.existsSync(zipCandidate) && fs.existsSync(sigCandidate)) {
            const pubKey = loadPublicKeyPem(rootDir);
            const res = await verifyAndProcessUpdatePackage({
              sigBuffer: fs.readFileSync(sigCandidate),
              zipBuffer: fs.readFileSync(zipCandidate),
              zipFileName: `tocineta-${version}.zip`,
              publicKeyPem: pubKey,
              rootDir,
              sendTelegramFn: async (txt) => { await sendTelegramMessage(botToken, chatId, txt); }
            });
            results.push(res);
            try {
              fs.unlinkSync(zipCandidate);
              fs.unlinkSync(sigCandidate);
            } catch {}
          } else {
            results.push({ status: 'PENDING_PAIR', version, updateId: u.update_id });
          }
        }
      } catch (e: any) {
        logActualizacion(`Error descargando documento ${doc.file_name}: ${e.message}`, 'ERROR', rootDir);
      }
    }
  }

  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runUpdateReceiver().catch(err => {
    console.error('[FATAL] Error en update-receiver:', err);
    process.exit(1);
  });
}
