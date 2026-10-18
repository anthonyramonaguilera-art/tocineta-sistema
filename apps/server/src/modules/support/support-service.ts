import * as childProcess from 'node:child_process';
import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { verifyPin } from '../auth/pin.js';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';

export interface SupportStatus {
  active: boolean;
  sessionId?: string | null;
  startedByUserId?: string | null;
  startedByName?: string | null;
  startedAtMs?: number | null;
  expiresAtMs?: number | null;
  remainingSeconds: number;
  quickAssistLaunched: boolean;
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
let autoExpireTimer: NodeJS.Timeout | null = null;

const SUPPORT_DURATION_MS = 2 * 60 * 60 * 1000; // 2 Horas exactas
const BANNER_TEXT = '🛠️ MODO SOPORTE VARONS MEDIA ACTIVO — SESIÓN AUDITADA';

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
    bannerText: BANNER_TEXT
  };
}

/**
 * Inicia el Modo Soporte Auditado exigiendo el PIN de Administrador (Sra. Olinelcys)
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

    const err: any = new Error('PIN de Administrador inválido. Se requiere autorización de la Sra. Olinelcys.');
    err.statusCode = 403;
    throw err;
  }

  const now = Date.now();
  const expiresAtMs = now + SUPPORT_DURATION_MS;
  const sessionId = `sup_${generateUuidV7()}`;

  // 2. Ejecutar Asistencia Rápida nativa de Windows 11 (quickassist.exe)
  let quickAssistLaunched = false;
  try {
    if (process.platform === 'win32') {
      if (process.env.NODE_ENV !== 'test') {
        const child = childProcess.spawn('quickassist.exe', [], {
          detached: true,
          stdio: 'ignore'
        });
        child.on('error', () => {});
        child.unref();
      }
      quickAssistLaunched = true;
    }
  } catch (err: any) {
    // Si no está en Windows o quickassist no está instalado, continúa sin bloquear la sesión auditada
    quickAssistLaunched = false;
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
        actorUserId: options?.actorUserId || 'usr_admin_olinelcys',
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
  if (autoExpireTimer) {
    clearTimeout(autoExpireTimer);
    autoExpireTimer = null;
  }
}
