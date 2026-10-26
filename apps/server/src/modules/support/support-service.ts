import * as os from 'node:os';
import * as fs from 'node:fs';
import * as childProcess from 'node:child_process';
import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { verifyPin } from '../auth/pin.js';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';

export const SUPPORT_FALLBACK_OPTIONS = [
  'Instalar Quick Assist desde Microsoft Store',
  'Usar TeamViewer Portable bajo autorización',
  'Soporte presencial'
] as const;

export type QuickAssistLaunchStatus = 'LAUNCHED_EXE' | 'LAUNCHED_PROTOCOL' | 'FALLBACK_OPTIONS_REQUIRED';

export interface QuickAssistCascadeResult {
  success: boolean;
  launchStatus: QuickAssistLaunchStatus;
  detectedOs: 'WINDOWS_10' | 'WINDOWS_11' | 'OTHER_OS';
  fallbackOptions?: readonly string[];
  message: string;
}

export interface SupportStatus {
  active: boolean;
  sessionId?: string | null;
  startedByUserId?: string | null;
  startedByName?: string | null;
  startedAtMs?: number | null;
  expiresAtMs?: number | null;
  remainingSeconds: number;
  quickAssistLaunched: boolean;
  launchStatus?: QuickAssistLaunchStatus;
  fallbackOptions?: readonly string[];
  bannerText: string;
}

export interface StartSupportInput {
  adminPin: string;
  notes?: string;
  actorUserId?: string;
}

// Estado global en memoria para Modo Soporte
let supportModeActive = false;
let currentSessionId: string | null = null;
let currentStartedByUserId: string | null = null;
let currentStartedByName: string | null = null;
let currentStartedAtMs: number | null = null;
let currentExpiresAtMs: number | null = null;
let quickAssistLaunchedState = false;
let currentLaunchStatus: QuickAssistLaunchStatus | undefined = undefined;
let currentFallbackOptions: readonly string[] | undefined = undefined;
let autoExpireTimer: NodeJS.Timeout | null = null;

const SUPPORT_DURATION_MS = 2 * 60 * 60 * 1000; // 2 Horas exactas
const BANNER_TEXT = '🛠️ MODO SOPORTE TÉCNICO ACTIVO — SESIÓN AUDITADA';

/**
 * Detección Real de Versión de Windows para compatibilidad dual Windows 10 / Windows 11.
 * En Node.js sobre Windows, os.release() empieza por '10.0.' tanto en Win10 como en Win11.
 * Win10: build < 22000 (ej. 19045)
 * Win11: build >= 22000 (ej. 22631)
 */
export function detectWindowsVersion(releaseStr: string = os.release()): 'WINDOWS_10' | 'WINDOWS_11' | 'OTHER_OS' {
  if (!releaseStr || typeof releaseStr !== 'string') {
    return 'OTHER_OS';
  }
  const [major, , build] = releaseStr.split('.').map(Number);
  if (major === 10 && build >= 22000) {
    return 'WINDOWS_11';
  }
  if (major === 10 && build < 22000) {
    return 'WINDOWS_10';
  }
  return 'OTHER_OS';
}

/**
 * Fallback en Cascada para Quick Assist (Paso 1 -> Paso 2 -> Paso 3 con opciones de contingencia)
 */
export function launchQuickAssistCascade(options?: {
  forceFallback?: boolean;
  releaseStr?: string;
}): QuickAssistCascadeResult {
  const detectedOs = detectWindowsVersion(options?.releaseStr);

  if (options?.forceFallback) {
    return {
      success: false,
      launchStatus: 'FALLBACK_OPTIONS_REQUIRED',
      detectedOs,
      fallbackOptions: SUPPORT_FALLBACK_OPTIONS,
      message: 'Quick Assist no disponible en esta estación. Seleccione una de las alternativas de soporte.'
    };
  }

  // Paso 1: quickassist.exe en C:\Windows\System32 o en PATH
  const system32Exe = 'C:\\Windows\\System32\\quickassist.exe';
  const exeExists = process.platform === 'win32' && fs.existsSync(system32Exe);

  if (process.platform === 'win32' && (exeExists || process.env.NODE_ENV !== 'test')) {
    try {
      const child = childProcess.spawn(exeExists ? system32Exe : 'quickassist.exe', [], {
        detached: true,
        stdio: 'ignore'
      });
      child.on('error', () => {});
      child.unref();

      return {
        success: true,
        launchStatus: 'LAUNCHED_EXE',
        detectedOs,
        message: 'Quick Assist iniciado exitosamente desde archivo ejecutable'
      };
    } catch {
      // Intentar Paso 2
    }
  }

  // Paso 2: ms-quick-assist: protocolo URI
  if (process.platform === 'win32') {
    try {
      const child = childProcess.spawn('cmd.exe', ['/c', 'start', '""', 'ms-quick-assist:'], {
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: true
      });
      child.on('error', () => {});
      child.unref();

      return {
        success: true,
        launchStatus: 'LAUNCHED_PROTOCOL',
        detectedOs,
        message: 'Quick Assist iniciado mediante protocolo URI ms-quick-assist:'
      };
    } catch {
      // Fallback a Paso 3
    }
  }

  // Paso 3: Fallback con las 3 opciones oficiales
  return {
    success: false,
    launchStatus: 'FALLBACK_OPTIONS_REQUIRED',
    detectedOs,
    fallbackOptions: SUPPORT_FALLBACK_OPTIONS,
    message: 'Quick Assist no instalado o no accesible. Opciones de contingencia requeridas.'
  };
}

/**
 * Registra la opción de soporte fallback seleccionada por el administrador en audit_events
 */
export function recordSupportFallbackSelection(
  rawDb: Database.Database,
  input: {
    selectedOption: string;
    actorUserId?: string;
    sessionId?: string;
  }
) {
  appendAuditEvent(rawDb, {
    actorUserId: input.actorUserId || 'usr_admin',
    action: 'SUPPORT_FALLBACK_SELECTED',
    entityType: 'system_support',
    entityId: input.sessionId || currentSessionId || 'sup_general',
    payload: {
      selectedOption: input.selectedOption,
      timestampMs: Date.now()
    }
  });

  return {
    success: true,
    selectedOption: input.selectedOption
  };
}

/**
 * Consulta el estado actual del Modo Soporte (con verificación de expiración automática)
 */
export function getSupportStatus(rawDb: Database.Database): SupportStatus {
  const now = Date.now();

  // Si venció el tiempo de 2 horas, expira automáticamente
  if (supportModeActive && currentExpiresAtMs && now >= currentExpiresAtMs) {
    stopSupportMode(rawDb, { reason: 'EXPIRED' });
  }

  const remainingSeconds = supportModeActive && currentExpiresAtMs
    ? Math.max(0, Math.floor((currentExpiresAtMs - now) / 1000))
    : 0;

  return {
    active: supportModeActive,
    sessionId: currentSessionId,
    startedByUserId: currentStartedByUserId,
    startedByName: currentStartedByName,
    startedAtMs: currentStartedAtMs,
    expiresAtMs: currentExpiresAtMs,
    remainingSeconds,
    quickAssistLaunched: quickAssistLaunchedState,
    launchStatus: currentLaunchStatus,
    fallbackOptions: currentFallbackOptions,
    bannerText: BANNER_TEXT
  };
}

/**
 * Inicia el Modo Soporte Auditado exigiendo el PIN de Administrador
 */
export function startSupportMode(
  rawDb: Database.Database,
  input: StartSupportInput
): SupportStatus {
  if (!input.adminPin || input.adminPin.trim().length === 0) {
    const err: any = new Error('Se requiere el PIN de Administrador de 6 dígitos para iniciar Modo Soporte');
    err.statusCode = 400;
    throw err;
  }

  // 1. Validar que el PIN pertenezca estrictamente a un usuario con rol 'admin'
  const admins = rawDb.prepare(`
    SELECT id, name, role, pin_salt, pin_hash
    FROM users
    WHERE role = 'admin' AND is_active = 1
  `).all() as any[];

  let verifiedAdmin: { id: string; name: string } | null = null;
  for (const a of admins) {
    if (verifyPin(input.adminPin, a.pin_salt, a.pin_hash)) {
      verifiedAdmin = { id: a.id, name: a.name };
      break;
    }
  }

  if (!verifiedAdmin) {
    // Registrar intento fallido no autorizado en auditoría inmutable
    appendAuditEvent(rawDb, {
      actorUserId: input.actorUserId || null,
      action: 'SUPPORT_MODE_START_REJECTED',
      entityType: 'system_support',
      entityId: 'sup_rejected',
      payload: {
        reason: 'PIN_ADMIN_INVALID',
        notes: input.notes || 'Intento no autorizado de activar modo soporte'
      }
    });

    const err: any = new Error('PIN de Administrador inválido. Se requiere autorización del Administrador.');
    err.statusCode = 403;
    throw err;
  }

  const now = Date.now();
  const expiresAtMs = now + SUPPORT_DURATION_MS;
  const sessionId = `sup_${generateUuidV7()}`;

  // 2. Ejecutar Asistencia Rápida nativa de Windows con Cascada
  let quickAssistLaunched = false;
  let launchStatus: QuickAssistLaunchStatus = 'FALLBACK_OPTIONS_REQUIRED';
  let fallbackOptions: readonly string[] | undefined;

  try {
    const cascade = launchQuickAssistCascade();
    quickAssistLaunched = cascade.success;
    launchStatus = cascade.launchStatus;
    fallbackOptions = cascade.fallbackOptions;
  } catch {
    quickAssistLaunched = false;
    launchStatus = 'FALLBACK_OPTIONS_REQUIRED';
    fallbackOptions = SUPPORT_FALLBACK_OPTIONS;
  }

  // 3. Persistir sesión en SQLite
  rawDb.prepare(`
    INSERT INTO support_sessions (
      id, started_by_user_id, started_at_ms, expires_at_ms,
      status, quick_assist_launched, notes
    ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)
  `).run(
    sessionId,
    verifiedAdmin.id,
    now,
    expiresAtMs,
    quickAssistLaunched ? 1 : 0,
    input.notes || null
  );

  // 4. Actualizar estado global en memoria
  supportModeActive = true;
  currentSessionId = sessionId;
  currentStartedByUserId = verifiedAdmin.id;
  currentStartedByName = verifiedAdmin.name;
  currentStartedAtMs = now;
  currentExpiresAtMs = expiresAtMs;
  quickAssistLaunchedState = quickAssistLaunched;
  currentLaunchStatus = launchStatus;
  currentFallbackOptions = fallbackOptions;

  if (autoExpireTimer) {
    clearTimeout(autoExpireTimer);
  }

  autoExpireTimer = setTimeout(() => {
    try {
      stopSupportMode(rawDb, { reason: 'EXPIRED' });
    } catch {
      // Ignorar si la DB ya fue cerrada
    }
  }, SUPPORT_DURATION_MS);

  // 5. Registrar en Auditoría Inmutable SHA-256
  appendAuditEvent(rawDb, {
    actorUserId: verifiedAdmin.id,
    action: 'SUPPORT_MODE_STARTED',
    entityType: 'system_support',
    entityId: sessionId,
    payload: {
      sessionId,
      startedByName: verifiedAdmin.name,
      startedAtMs: now,
      expiresAtMs,
      quickAssistLaunched,
      notes: input.notes || null
    }
  });

  // 6. Emitir evento WebSocket a todas las pantallas activas
  publishDomainEvent(rawDb, {
    eventType: 'SUPPORT_MODE_CHANGED',
    entityId: sessionId,
    payload: {
      active: true,
      sessionId,
      startedByName: verifiedAdmin.name,
      expiresAtMs,
      bannerText: BANNER_TEXT
    }
  });

  return {
    active: true,
    sessionId,
    startedByUserId: verifiedAdmin.id,
    startedByName: verifiedAdmin.name,
    startedAtMs: now,
    expiresAtMs,
    remainingSeconds: Math.floor(SUPPORT_DURATION_MS / 1000),
    quickAssistLaunched,
    launchStatus,
    fallbackOptions,
    bannerText: BANNER_TEXT
  };
}

/**
 * Detiene el Modo Soporte inmediatamente y registra el evento
 */
export function stopSupportMode(
  rawDb: Database.Database,
  options?: { actorUserId?: string; reason?: 'MANUAL' | 'EXPIRED' }
): SupportStatus {
  const sessionId = currentSessionId;
  const wasActive = supportModeActive;
  const reason = options?.reason || 'MANUAL';
  const now = Date.now();

  supportModeActive = false;
  currentSessionId = null;
  currentStartedByUserId = null;
  currentStartedByName = null;
  currentStartedAtMs = null;
  currentExpiresAtMs = null;
  quickAssistLaunchedState = false;
  currentLaunchStatus = undefined;
  currentFallbackOptions = undefined;

  if (autoExpireTimer) {
    clearTimeout(autoExpireTimer);
    autoExpireTimer = null;
  }

  if (sessionId) {
    try {
      rawDb.prepare(`
        UPDATE support_sessions
        SET ended_at_ms = ?,
            status = ?
        WHERE id = ?
      `).run(now, reason === 'EXPIRED' ? 'EXPIRED' : 'ENDED', sessionId);
    } catch {
      // Ignorar si tabla no existe aún
    }
  }

  if (wasActive) {
    // Registrar en auditoría inmutable
    try {
      appendAuditEvent(rawDb, {
        actorUserId: options?.actorUserId || 'usr_admin',
        action: 'SUPPORT_MODE_STOPPED',
        entityType: 'system_support',
        entityId: sessionId || 'sup_general',
        payload: {
          sessionId,
          endedAtMs: now,
          reason
        }
      });
    } catch {
      // Ignorar si fallara el hash
    }

    // Emitir evento WebSocket
    try {
      publishDomainEvent(rawDb, {
        eventType: 'SUPPORT_MODE_CHANGED',
        entityId: sessionId || 'sup_general',
        payload: {
          active: false,
          sessionId,
          reason
        }
      });
    } catch {
      // Ignorar si websocket no está activo
    }
  }

  return {
    active: false,
    sessionId: null,
    startedByUserId: null,
    startedByName: null,
    startedAtMs: null,
    expiresAtMs: null,
    remainingSeconds: 0,
    quickAssistLaunched: false,
    bannerText: BANNER_TEXT
  };
}

/**
 * Resetea el estado interno (para tests aislados)
 */
export function _resetSupportStateForTesting(): void {
  supportModeActive = false;
  currentSessionId = null;
  currentStartedByUserId = null;
  currentStartedByName = null;
  currentStartedAtMs = null;
  currentExpiresAtMs = null;
  quickAssistLaunchedState = false;
  currentLaunchStatus = undefined;
  currentFallbackOptions = undefined;
  if (autoExpireTimer) {
    clearTimeout(autoExpireTimer);
    autoExpireTimer = null;
  }
}
