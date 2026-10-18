import type Database from 'better-sqlite3';
import { hashPin } from './pin.js';
import type { UserRole } from '../../db/schema.js';

export interface SeedUserDefinition {
  id: string;
  name: string;
  role: UserRole;
  pin: string;
}

export const INITIAL_USERS: SeedUserDefinition[] = [
  { id: 'usr_admin_olinelcys', name: 'Sra. Olinelcys', role: 'admin', pin: '123456' },
  { id: 'usr_supervisor_turno', name: 'Supervisor Turno', role: 'supervisor', pin: '654321' },
  { id: 'usr_cajera_principal', name: 'Cajera Principal', role: 'cajera', pin: '1111' },
  { id: 'usr_mesonero_carlos', name: 'Carlos', role: 'mesonero', pin: '2222' },
  { id: 'usr_mesonero_andrea', name: 'Andrea', role: 'mesonero', pin: '3333' },
  { id: 'usr_cocina_plancha', name: 'Cocina Plancha', role: 'cocinero', pin: '4444' },
  { id: 'usr_cocina_perros', name: 'Cocina Perros', role: 'cocinero', pin: '5555' }
];

export function seedInitialUsers(rawDb: Database.Database): number {
  const insertStmt = rawDb.prepare(`
    INSERT OR IGNORE INTO users (
      id, name, role, pin_hash, pin_salt, pin_length,
      must_change_pin, is_active, failed_attempts, lockout_stage,
      locked_until_ms, created_at_ms, updated_at_ms
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      NULL, ?, ?
    )
  `);

  let insertedCount = 0;
  const now = Date.now();

  const transaction = rawDb.transaction(() => {
    for (const u of INITIAL_USERS) {
      const { hash, salt } = hashPin(u.pin);
      const pinLength = u.pin.length;
      const res = insertStmt.run(
        u.id,
        u.name,
        u.role,
        hash,
        salt,
        pinLength,
        (u.role === 'admin' || u.role === 'supervisor') ? 1 : 0, // must_change_pin (1 para admin/supervisor, 0 resto)
        1, // is_active
        0, // failed_attempts
        0, // lockout_stage
        now,
        now
      );
      if (res.changes > 0) {
        insertedCount++;
      }
    }
  });

  transaction();
  return insertedCount;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('seed-users.ts')) {
  import('../../db/connection.js').then(({ initSqlite }) => {
    const dbPath = process.env.DB_PATH || './data/tocineta.db';
    const ctx = initSqlite(dbPath);
    try {
      const count = seedInitialUsers(ctx.rawDb);
      console.log(`BOOTSTRAP: ${count} usuarios iniciales creados`);
    } finally {
      ctx.rawDb.close();
    }
  });
}
