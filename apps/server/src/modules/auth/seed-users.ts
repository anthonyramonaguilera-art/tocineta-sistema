import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { hashPin } from './pin.js';
import type { UserRole } from '../../db/schema.js';

export interface SeedUserDefinition {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  pin: string;
  password?: string;
}

export const INITIAL_USERS: SeedUserDefinition[] = [
  { id: 'usr_admin', username: 'admin', name: 'ADMIN', role: 'admin', pin: '123456', password: 'admin123' },
  { id: 'usr_cajera', username: 'cajera', name: 'CAJERA', role: 'cajera', pin: '1111', password: 'caja123' },
  { id: 'usr_mesero', username: 'mesero', name: 'MESERO', role: 'mesonero', pin: '2222', password: 'mesero123' },
  { id: 'usr_plancha', username: 'plancha', name: 'PLANCHA', role: 'cocinero', pin: '4444', password: 'plancha123' },
  { id: 'usr_despacho', username: 'despacho', name: 'DESPACHO', role: 'despachador', pin: '5555', password: 'despacho123' }
];

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function syncAndSanitizeCorporateUsers(rawDb: Database.Database): void {
  // 1. Asegurar columna username en users
  try {
    const cols = rawDb.prepare("PRAGMA table_info('users')").all() as any[];
    if (!cols.some(c => c.name.toLowerCase() === 'username')) {
      rawDb.exec('ALTER TABLE users ADD COLUMN username TEXT');
      rawDb.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
    }
  } catch {
    // Continuar si ya existe
  }

  const now = Date.now();

  // 2. Mapeo y saneamiento de registros históricos
  const legacyUpdates: Array<{
    matchIds: string[];
    role: UserRole;
    canonicalId: string;
    username: string;
    name: string;
    pin: string;
    password: string;
  }> = [
    {
      matchIds: ['usr_admin_olinelcys', 'usr_admin', 'admin'],
      role: 'admin',
      canonicalId: 'usr_admin',
      username: 'admin',
      name: 'ADMIN',
      pin: '123456',
      password: 'admin123'
    },
    {
      matchIds: ['usr_cajera_principal', 'usr_cajera', 'cajera'],
      role: 'cajera',
      canonicalId: 'usr_cajera',
      username: 'cajera',
      name: 'CAJERA',
      pin: '1111',
      password: 'caja123'
    },
    {
      matchIds: ['usr_mesonero_carlos', 'usr_mesonero_andrea', 'usr_mesero', 'mesero'],
      role: 'mesonero',
      canonicalId: 'usr_mesero',
      username: 'mesero',
      name: 'MESERO',
      pin: '2222',
      password: 'mesero123'
    },
    {
      matchIds: ['usr_cocina_plancha', 'usr_plancha', 'plancha'],
      role: 'cocinero',
      canonicalId: 'usr_plancha',
      username: 'plancha',
      name: 'PLANCHA',
      pin: '4444',
      password: 'plancha123'
    },
    {
      matchIds: ['usr_cocina_perros', 'usr_despacho', 'despacho'],
      role: 'despachador',
      canonicalId: 'usr_despacho',
      username: 'despacho',
      name: 'DESPACHO',
      pin: '5555',
      password: 'despacho123'
    }
  ];

  for (const item of legacyUpdates) {
    const { hash: pinHash, salt: pinSalt } = hashPin(item.pin);
    const { hash: pwHash, salt: pwSalt } = hashPassword(item.password);

    // Actualizar usuarios existentes que coincidan por ID
    for (const mId of item.matchIds) {
      rawDb.prepare(`
        UPDATE users 
        SET name = ?, username = ?, role = ?, pin_hash = ?, pin_salt = ?, pin_length = ?,
            password_hash = ?, password_salt = ?, must_change_pin = 0, is_active = 1,
            failed_attempts = 0, lockout_stage = 0, locked_until_ms = NULL, updated_at_ms = ?
        WHERE id = ?
      `).run(
        item.name, item.username, item.role, pinHash, pinSalt, item.pin.length,
        pwHash, pwSalt, now, mId
      );
    }

    // Insertar el usuario corporativo canónico si aún no existe
    rawDb.prepare(`
      INSERT OR IGNORE INTO users (
        id, name, username, role, pin_hash, pin_salt, pin_length,
        password_hash, password_salt, must_change_pin, is_active,
        failed_attempts, lockout_stage, locked_until_ms, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, 0, NULL, ?, ?)
    `).run(
      item.canonicalId, item.name, item.username, item.role, pinHash, pinSalt, item.pin.length,
      pwHash, pwSalt, now, now
    );
  }

  // 3. Saneamiento de usuarios, repartidores y clientes corporativos
  try {
    rawDb.exec(`
      UPDATE users SET name = 'ADMIN', username = 'admin', must_change_pin = 1 WHERE LOWER(name) LIKE '%anthony%' OR LOWER(name) LIKE '%olinelcys%' OR id = 'usr_admin';
      UPDATE users SET name = 'MESERO', username = 'mesero', must_change_pin = 1 WHERE LOWER(name) LIKE '%carlos%' OR LOWER(name) LIKE '%andrea%' OR id = 'usr_mesero';
      UPDATE users SET name = 'PLANCHA', username = 'plancha', must_change_pin = 1 WHERE LOWER(name) LIKE '%jose%' OR LOWER(name) LIKE '%josé%' OR id = 'usr_plancha';
      UPDATE users SET name = 'DESPACHO', username = 'despacho', must_change_pin = 1 WHERE LOWER(name) LIKE '%miguel%' OR id = 'usr_despacho';
      UPDATE users SET name = 'CAJERA', username = 'cajera', must_change_pin = 1 WHERE id = 'usr_cajera';
      UPDATE delivery_drivers SET name = 'REPARTIDOR 1' WHERE id = 'drv_carlos_mora' OR name LIKE '%Carlos%';
      UPDATE delivery_drivers SET name = 'REPARTIDOR 2' WHERE id = 'drv_jose_ramirez' OR name LIKE '%José%' OR name LIKE '%Jose%';
      UPDATE delivery_drivers SET name = 'REPARTIDOR 3' WHERE id = 'drv_miguel_perez' OR name LIKE '%Miguel%';
      UPDATE customers SET name = 'Socio Director', address = 'TOCINETA' WHERE id = 'cust_partner_olinelcys' OR name LIKE '%Olinelcys%';
      UPDATE customers SET name = 'Cliente Frecuente 1' WHERE id = 'cust_vip_carlos' OR name LIKE '%Carlos%';
      UPDATE business_settings SET business_name = 'TOCINETA' WHERE id = 'default';
    `);
  } catch {
    // Si alguna tabla no existe aún, ignorar
  }
}

export function seedInitialUsers(rawDb: Database.Database): number {
  syncAndSanitizeCorporateUsers(rawDb);

  const insertStmt = rawDb.prepare(`
    INSERT OR IGNORE INTO users (
      id, name, username, role, pin_hash, pin_salt, pin_length,
      password_hash, password_salt,
      must_change_pin, is_active, failed_attempts, lockout_stage,
      locked_until_ms, created_at_ms, updated_at_ms
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      NULL, ?, ?
    )
  `);

  let insertedCount = 0;
  const now = Date.now();

  const transaction = rawDb.transaction(() => {
    for (const u of INITIAL_USERS) {
      const { hash: pinHash, salt: pinSalt } = hashPin(u.pin);
      const { hash: pwHash, salt: pwSalt } = hashPassword(u.password || '123456');
      const pinLength = u.pin.length;
      const res = insertStmt.run(
        u.id,
        u.name,
        u.username,
        u.role,
        pinHash,
        pinSalt,
        pinLength,
        pwHash,
        pwSalt,
        1, // must_change_pin = 1
        1, // is_active = 1
        0, // failed_attempts = 0
        0, // lockout_stage = 0
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
