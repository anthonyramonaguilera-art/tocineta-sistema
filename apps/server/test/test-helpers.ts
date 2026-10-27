import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { hashPin } from '../src/modules/auth/pin.js';

export type TestRole =
  | 'admin'
  | 'cajera'
  | 'mesero'
  | 'mesonero'
  | 'plancha'
  | 'cocinero'
  | 'despacho'
  | 'despachador'
  | 'supervisor';

export const CANONICAL_CREDENTIALS: Record<string, { userId: string; username: string; pin: string; role: string }> = {
  admin: { userId: 'usr_admin', username: 'admin', pin: '123456', role: 'admin' },
  cajera: { userId: 'usr_cajera', username: 'cajera', pin: '1111', role: 'cajera' },
  mesero: { userId: 'usr_mesero', username: 'mesero', pin: '2222', role: 'mesonero' },
  mesonero: { userId: 'usr_mesero', username: 'mesero', pin: '2222', role: 'mesonero' },
  plancha: { userId: 'usr_plancha', username: 'plancha', pin: '4444', role: 'cocinero' },
  cocinero: { userId: 'usr_plancha', username: 'plancha', pin: '4444', role: 'cocinero' },
  despacho: { userId: 'usr_despacho', username: 'despacho', pin: '5555', role: 'despachador' },
  despachador: { userId: 'usr_despacho', username: 'despacho', pin: '5555', role: 'despachador' },
  supervisor: { userId: 'usr_supervisor_test', username: 'supervisor_test', pin: '654321', role: 'supervisor' }
};

export function ensureTestSupervisor(rawDb: Database.Database): void {
  const existing = rawDb.prepare("SELECT id FROM users WHERE role = 'supervisor' LIMIT 1").get();
  if (!existing) {
    const { hash: pinHash, salt: pinSalt } = hashPin('654321');
    const now = Date.now();
    rawDb.prepare(`
      INSERT OR IGNORE INTO users (
        id, name, username, role, pin_hash, pin_salt, pin_length,
        password_hash, password_salt, must_change_pin, is_active,
        failed_attempts, lockout_stage, locked_until_ms, created_at_ms, updated_at_ms
      ) VALUES (?, 'SUPERVISOR', 'supervisor_test', 'supervisor', ?, ?, 6, NULL, NULL, 0, 1, 0, 0, NULL, ?, ?)
    `).run('usr_supervisor_test', pinHash, pinSalt, now, now);
  }
}

export async function loginAs(
  app: FastifyInstance,
  role: TestRole,
  rawDb?: Database.Database
): Promise<{ token: string; user: any }> {
  const creds = CANONICAL_CREDENTIALS[role.toLowerCase()];
  if (!creds) {
    throw new Error(`Rol de prueba no reconocido: ${role}`);
  }

  if (creds.role === 'supervisor' && rawDb) {
    ensureTestSupervisor(rawDb);
  }

  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: {
      userId: creds.userId,
      pin: creds.pin
    }
  });

  if (res.statusCode !== 200) {
    // Si falla por userId, intentar por username
    const resUsername = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: creds.username,
        pin: creds.pin
      }
    });
    if (resUsername.statusCode === 200) {
      const data = JSON.parse(resUsername.payload);
      return { token: data.token, user: data.user };
    }
    throw new Error(`Error al autenticar como ${role} (HTTP ${res.statusCode}): ${res.payload}`);
  }

  const data = JSON.parse(res.payload);
  return { token: data.token, user: data.user };
}
