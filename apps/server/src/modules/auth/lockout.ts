import type Database from 'better-sqlite3';
import type { User } from '../../db/schema.js';

export function computeLockoutDurationMs(stage: number): number {
  if (stage <= 1) return 60_000;         // 1 minuto
  if (stage === 2) return 300_000;       // 5 minutos
  return 900_000;                        // 15 minutos (Etapa 3+)
}

export interface LockoutCheckResult {
  isLocked: boolean;
  remainingMs?: number;
  stage?: number;
}

export function checkUserLockout(user: User | any, nowUtcMs = Date.now()): LockoutCheckResult {
  const lockedUntilMs = user.lockedUntilMs ?? user.locked_until_ms;
  const lockoutStage = user.lockoutStage ?? user.lockout_stage ?? 0;
  if (lockedUntilMs && lockedUntilMs > nowUtcMs) {
    return {
      isLocked: true,
      remainingMs: lockedUntilMs - nowUtcMs,
      stage: lockoutStage
    };
  }
  return { isLocked: false };
}

export interface FailedAttemptResult {
  isLockedNow: boolean;
  lockedUntilMs?: number;
  lockoutStage?: number;
  lockDurationMs?: number;
  remainingAttemptsBeforeLock?: number;
}

export function recordFailedAttempt(
  rawDb: Database.Database,
  userId: string,
  currentFailed: number,
  currentStage: number,
  nowUtcMs = Date.now()
): FailedAttemptResult {
  const newFailed = currentFailed + 1;

  if (newFailed >= 5) {
    const nextStage = currentStage + 1;
    const duration = computeLockoutDurationMs(nextStage);
    const lockedUntil = nowUtcMs + duration;

    rawDb.prepare(`
      UPDATE users 
      SET failed_attempts = 0,
          lockout_stage = ?,
          locked_until_ms = ?,
          updated_at_ms = ?
      WHERE id = ?
    `).run(nextStage, lockedUntil, nowUtcMs, userId);

    return {
      isLockedNow: true,
      lockedUntilMs: lockedUntil,
      lockoutStage: nextStage,
      lockDurationMs: duration
    };
  }

  rawDb.prepare(`
    UPDATE users 
    SET failed_attempts = ?,
        updated_at_ms = ?
    WHERE id = ?
  `).run(newFailed, nowUtcMs, userId);

  return {
    isLockedNow: false,
    remainingAttemptsBeforeLock: 5 - newFailed
  };
}

export function resetLockout(rawDb: Database.Database, userId: string, nowUtcMs = Date.now()): void {
  rawDb.prepare(`
    UPDATE users 
    SET failed_attempts = 0,
        lockout_stage = 0,
        locked_until_ms = NULL,
        updated_at_ms = ?
    WHERE id = ?
  `).run(nowUtcMs, userId);
}
