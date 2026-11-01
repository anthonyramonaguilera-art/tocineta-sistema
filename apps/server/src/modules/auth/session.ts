import type Database from 'better-sqlite3';
import type { UserRole } from '../../db/schema.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';

/**
 * Usuario autenticado resuelto desde una sesión. Se expone con `id` Y `userId`
 * para ser compatible con los dos formatos que hoy usan los handlers
 * ({ id, role, name, permissions } en caja/cierres y { userId, role } en impresión).
 */
export interface SessionUser {
  id: string;
  userId: string;
  name: string;
  role: UserRole;
  permissions: string[];
  sessionId: string;
  mustChangePin: boolean;
}

interface SessionJoinRow {
  session_id: string;
  user_id: string;
  name: string;
  role: UserRole;
  permissions_json: string | null;
  must_change_pin: number;
}

function parsePermissions(json: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * FUENTE ÚNICA DE VERDAD para validar una sesión (BUG-07).
 * Exige simultáneamente: sesión no revocada, no expirada y usuario activo.
 * Usa el rol VIVO de users.role (no la copia de sessions.role) para que un cambio
 * de rol aplique de inmediato.
 */
export function getSessionUserByToken(
  rawDb: Database.Database,
  token: string | null | undefined,
  nowMs: number = Date.now()
): SessionUser | null {
  if (!token) return null;
  const row = rawDb
    .prepare(
      `SELECT s.id AS session_id, s.user_id, u.name, u.role, u.permissions_json, u.must_change_pin
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND s.revoked_at_ms IS NULL
          AND s.expires_at_ms > ?
          AND u.is_active = 1
        LIMIT 1`
    )
    .get(hashToken(token), nowMs) as SessionJoinRow | undefined;

  if (!row) return null;
  return {
    id: row.user_id,
    userId: row.user_id,
    name: row.name,
    role: row.role,
    permissions: parsePermissions(row.permissions_json),
    sessionId: row.session_id,
    mustChangePin: Boolean(row.must_change_pin)
  };
}

/** Variante que recibe el valor crudo de la cabecera Authorization ("Bearer xxx"). */
export function getSessionUser(
  rawDb: Database.Database,
  authHeader?: string,
  nowMs: number = Date.now()
): SessionUser | null {
  return getSessionUserByToken(rawDb, extractSessionToken(authHeader), nowMs);
}
