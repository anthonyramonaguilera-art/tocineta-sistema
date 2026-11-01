import type Database from 'better-sqlite3';
import { appendAuditEvent } from '../audit/audit-service.js';
import { verifyPin } from './pin.js';
import { getDatabaseContext } from '../../db/connection.js';
import type { UserRole } from '../../db/schema.js';

export class AuthorizerLockedError extends Error {
  statusCode: number;
  code: string;
  remainingMs: number;

  constructor(remainingMs: number) {
    super(`Demasiados intentos fallidos de PIN de autorización. Bloqueado temporalmente. Reintente en ${Math.ceil(remainingMs / 1000)}s.`);
    this.name = 'AuthorizerLockedError';
    this.statusCode = 423;
    this.code = 'AUTHORIZER_LOCKED';
    this.remainingMs = remainingMs;
  }
}

export interface AuthorizerLockoutEntry {
  failedAttempts: number;
  stage: number;
  lockedUntilMs: number | null;
  lastAttemptMs: number;
}

export function computeAuthorizerLockoutDurationMs(stage: number): number {
  if (stage <= 1) return 5 * 60 * 1000;   // 5 minutos (300_000 ms)
  if (stage === 2) return 15 * 60 * 1000;  // 15 minutos (900_000 ms)
  return 60 * 60 * 1000;                   // 60 minutos (3_600_000 ms) (Etapa 3+)
}

const authorizerAttemptsMap = new Map<string, AuthorizerLockoutEntry>();

function cleanupOldEntries(now: number): void {
  if (authorizerAttemptsMap.size < 50) return;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  for (const [key, entry] of authorizerAttemptsMap.entries()) {
    if (
      (!entry.lockedUntilMs || entry.lockedUntilMs <= now) &&
      now - entry.lastAttemptMs > ONE_DAY_MS
    ) {
      authorizerAttemptsMap.delete(key);
    }
  }
}

export function assertAuthorizerAttemptAllowed(key: string, now: number = Date.now()): void {
  const entry = authorizerAttemptsMap.get(key);
  if (!entry) return;

  if (entry.lockedUntilMs && entry.lockedUntilMs > now) {
    throw new AuthorizerLockedError(entry.lockedUntilMs - now);
  }

  if (entry.lockedUntilMs && entry.lockedUntilMs <= now) {
    entry.lockedUntilMs = null;
    entry.failedAttempts = 0;
  }
}

export function recordAuthorizerFailure(
  key: string,
  now: number = Date.now(),
  rawDb?: Database.Database
): { isLocked: boolean; remainingAttempts?: number; lockedUntilMs?: number; stage?: number; durationMs?: number } {
  cleanupOldEntries(now);

  let entry = authorizerAttemptsMap.get(key);
  if (!entry) {
    entry = {
      failedAttempts: 0,
      stage: 0,
      lockedUntilMs: null,
      lastAttemptMs: now
    };
    authorizerAttemptsMap.set(key, entry);
  }

  if (entry.lockedUntilMs && entry.lockedUntilMs <= now) {
    entry.lockedUntilMs = null;
    entry.failedAttempts = 0;
  }

  entry.failedAttempts += 1;
  entry.lastAttemptMs = now;

  if (entry.failedAttempts >= 5) {
    entry.stage += 1;
    const duration = computeAuthorizerLockoutDurationMs(entry.stage);
    entry.lockedUntilMs = now + duration;
    entry.failedAttempts = 0;

    try {
      const db = rawDb || getDatabaseContext()?.rawDb;
      if (db) {
        let actorUserId: string | null = null;
        if (key.startsWith('usr_')) {
          try {
            const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(key);
            if (exists) actorUserId = key;
          } catch {}
        }

        appendAuditEvent(db, {
          actorUserId,
          action: 'AUTHORIZER_PIN_LOCKED',
          entityType: 'authorizer_guard',
          entityId: key,
          payload: {
            key,
            stage: entry.stage,
            durationMs: duration,
            lockedUntilMs: entry.lockedUntilMs
          },
          createdAtMs: now
        });
      }
    } catch {
      // En caso de que la DB aún no esté inicializada
    }

    return {
      isLocked: true,
      lockedUntilMs: entry.lockedUntilMs,
      stage: entry.stage,
      durationMs: duration
    };
  }

  return {
    isLocked: false,
    remainingAttempts: 5 - entry.failedAttempts,
    stage: entry.stage
  };
}

export function recordAuthorizerSuccess(key: string): void {
  authorizerAttemptsMap.delete(key);
}

export function _resetAuthorizerGuardState(): void {
  authorizerAttemptsMap.clear();
}

export interface AuthorizerUser {
  id: string;
  name: string;
  role: UserRole;
  pin_salt?: string;
  pin_hash?: string;
}

export function findAuthorizerByPin(
  rawDb: Database.Database,
  pin: string,
  key: string,
  now: number = Date.now(),
  targetAuthorizerUserId?: string
): AuthorizerUser | null {
  assertAuthorizerAttemptAllowed(key, now);

  let query = "SELECT id, name, role, pin_salt, pin_hash FROM users WHERE role IN ('admin', 'supervisor') AND is_active = 1";
  const params: any[] = [];
  if (targetAuthorizerUserId) {
    query += " AND id = ?";
    params.push(targetAuthorizerUserId);
  }

  const authorizers = rawDb.prepare(query).all(...params) as AuthorizerUser[];

  let verified: AuthorizerUser | null = null;
  for (const a of authorizers) {
    if (a.pin_salt && a.pin_hash && verifyPin(pin, a.pin_salt, a.pin_hash)) {
      verified = a;
      break;
    }
  }

  if (verified) {
    recordAuthorizerSuccess(key);
    return { id: verified.id, name: verified.name, role: verified.role };
  } else {
    recordAuthorizerFailure(key, now, rawDb);
    return null;
  }
}
