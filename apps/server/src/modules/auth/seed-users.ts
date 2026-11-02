import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { hashPin, isTrivialPin } from './pin.js';
import type { UserRole } from '../../db/schema.js';
import { getProjectRoot } from '../../config/paths.js';

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

export function generateSecureAdminPassword(length = 16): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
}

export function generateSecureAdminPin(): string {
  while (true) {
    let pin = '';
    for (let i = 0; i < 6; i++) {
      pin += crypto.randomInt(0, 10).toString();
    }
    if (!isTrivialPin(pin)) {
      return pin;
    }
  }
}

export function getDataDir(): string {
  const dbPath = process.env.TOCINETA_DB_PATH || process.env.DB_PATH || './data/tocineta.db';
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  const isProd = process.env.NODE_ENV === 'production' && !isTest;
  const baseDir = (isProd && !path.isAbsolute(dbPath)) ? getProjectRoot() : process.cwd();
  return path.dirname(path.resolve(baseDir, dbPath));
}

export function deleteAdminInitialFileIfExists(customDir?: string): void {
  try {
    const dataDir = customDir || getDataDir();
    const adminFilePath = path.join(dataDir, 'ADMIN_INICIAL.txt');
    if (fs.existsSync(adminFilePath)) {
      fs.unlinkSync(adminFilePath);
    }
  } catch {
    // Continuar si no se pudo eliminar o no existe
  }
}

export function syncAndSanitizeCorporateUsers(
  rawDb: Database.Database,
  opts?: { isProduction?: boolean; adminSecrets?: { password: string; pin: string } }
): void {
  const isProduction = opts?.isProduction ?? (process.env.NODE_ENV === 'production');
  const adminSecrets = opts?.adminSecrets;

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

  const adminPin = (isProduction && adminSecrets) ? adminSecrets.pin : '123456';
  const adminPassword = (isProduction && adminSecrets) ? adminSecrets.password : 'admin123';

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
      pin: adminPin,
      password: adminPassword
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
    const mustChangePin = item.role === 'admin' ? 1 : 0;

    // Actualizar usuarios existentes que coincidan por ID
    for (const mId of item.matchIds) {
      rawDb.prepare(`
        UPDATE users 
        SET name = ?, username = ?, role = ?, pin_hash = ?, pin_salt = ?, pin_length = ?,
            password_hash = ?, password_salt = ?, must_change_pin = ?, is_active = 1,
            failed_attempts = 0, lockout_stage = 0, locked_until_ms = NULL, updated_at_ms = ?
        WHERE id = ?
      `).run(
        item.name, item.username, item.role, pinHash, pinSalt, item.pin.length,
        pwHash, pwSalt, mustChangePin, now, mId
      );
    }

    // Insertar el usuario corporativo canónico si aún no existe
    rawDb.prepare(`
      INSERT OR IGNORE INTO users (
        id, name, username, role, pin_hash, pin_salt, pin_length,
        password_hash, password_salt, must_change_pin, is_active,
        failed_attempts, lockout_stage, locked_until_ms, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, NULL, ?, ?)
    `).run(
      item.canonicalId, item.name, item.username, item.role, pinHash, pinSalt, item.pin.length,
      pwHash, pwSalt, item.role === 'admin' ? 1 : (isProduction ? 0 : 1), now, now
    );
  }

  // 3. Saneamiento de usuarios, repartidores y clientes corporativos
  try {
    if (isProduction) {
      rawDb.exec(`
        UPDATE users SET name = 'ADMIN', username = 'admin', must_change_pin = 1 WHERE LOWER(name) LIKE '%anthony%' OR LOWER(name) LIKE '%olinelcys%' OR id = 'usr_admin';
        UPDATE users SET name = 'MESERO', username = 'mesero', must_change_pin = 0 WHERE LOWER(name) LIKE '%carlos%' OR LOWER(name) LIKE '%andrea%' OR id = 'usr_mesero';
        UPDATE users SET name = 'PLANCHA', username = 'plancha', must_change_pin = 0 WHERE LOWER(name) LIKE '%jose%' OR LOWER(name) LIKE '%josé%' OR id = 'usr_plancha';
        UPDATE users SET name = 'DESPACHO', username = 'despacho', must_change_pin = 0 WHERE LOWER(name) LIKE '%miguel%' OR id = 'usr_despacho';
        UPDATE users SET name = 'CAJERA', username = 'cajera', must_change_pin = 0 WHERE id = 'usr_cajera';
      `);
    } else {
      rawDb.exec(`
        UPDATE users SET name = 'ADMIN', username = 'admin', must_change_pin = 1 WHERE LOWER(name) LIKE '%anthony%' OR LOWER(name) LIKE '%olinelcys%' OR id = 'usr_admin';
        UPDATE users SET name = 'MESERO', username = 'mesero', must_change_pin = 1 WHERE LOWER(name) LIKE '%carlos%' OR LOWER(name) LIKE '%andrea%' OR id = 'usr_mesero';
        UPDATE users SET name = 'PLANCHA', username = 'plancha', must_change_pin = 1 WHERE LOWER(name) LIKE '%jose%' OR LOWER(name) LIKE '%josé%' OR id = 'usr_plancha';
        UPDATE users SET name = 'DESPACHO', username = 'despacho', must_change_pin = 1 WHERE LOWER(name) LIKE '%miguel%' OR id = 'usr_despacho';
        UPDATE users SET name = 'CAJERA', username = 'cajera', must_change_pin = 1 WHERE id = 'usr_cajera';
      `);
    }
    rawDb.exec(`
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

export interface SeedUsersOptions {
  production?: boolean;
}

export interface SeedUsersResult {
  count: number;
  adminSecrets?: {
    password: string;
    pin: string;
  };
}

export function seedInitialUsersDetailed(
  rawDb: Database.Database,
  opts?: SeedUsersOptions
): SeedUsersResult {
  const isProduction = opts?.production ?? (process.env.NODE_ENV === 'production');

  let adminPassword = 'admin123';
  let adminPin = '123456';

  if (isProduction) {
    adminPassword = generateSecureAdminPassword(16);
    adminPin = generateSecureAdminPin();
  } else {
    console.warn('⚠️ AVISO DE SEGURIDAD: Base de datos sembrada con credenciales de prueba conocidas (admin/123456). NO USAR EN PRODUCCIÓN.');
  }

  syncAndSanitizeCorporateUsers(rawDb, {
    isProduction,
    adminSecrets: isProduction ? { password: adminPassword, pin: adminPin } : undefined
  });

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

  const usersToSeed: SeedUserDefinition[] = [
    { id: 'usr_admin', username: 'admin', name: 'ADMIN', role: 'admin', pin: adminPin, password: adminPassword },
    { id: 'usr_cajera', username: 'cajera', name: 'CAJERA', role: 'cajera', pin: '1111', password: 'caja123' },
    { id: 'usr_mesero', username: 'mesero', name: 'MESERO', role: 'mesonero', pin: '2222', password: 'mesero123' },
    { id: 'usr_plancha', username: 'plancha', name: 'PLANCHA', role: 'cocinero', pin: '4444', password: 'plancha123' },
    { id: 'usr_despacho', username: 'despacho', name: 'DESPACHO', role: 'despachador', pin: '5555', password: 'despacho123' }
  ];

  const transaction = rawDb.transaction(() => {
    for (const u of usersToSeed) {
      const { hash: pinHash, salt: pinSalt } = hashPin(u.pin);
      const { hash: pwHash, salt: pwSalt } = hashPassword(u.password || '123456');
      const pinLength = u.pin.length;
      const mustChangePin = u.role === 'admin' ? 1 : (isProduction ? 0 : 1);

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
        mustChangePin,
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

    if (isProduction) {
      rawDb.prepare("UPDATE users SET must_change_pin = 0 WHERE id != 'usr_admin'").run();
      rawDb.prepare("UPDATE users SET must_change_pin = 1 WHERE id = 'usr_admin'").run();
    }
  });

  transaction();

  if (isProduction) {
    const box = [
      '',
      '┌─────────────────────────────────────────────────────────────────┐',
      '│              CREDENCIALES INICIALES DE ADMIN                    │',
      '│         guárdelas ahora, no se volverán a mostrar               │',
      '├─────────────────────────────────────────────────────────────────┤',
      '│  Usuario:  admin                                                │',
      `│  Password: ${adminPassword.padEnd(53, ' ')}│`,
      `│  PIN:      ${adminPin.padEnd(53, ' ')}│`,
      '└─────────────────────────────────────────────────────────────────┘',
      ''
    ].join('\n');
    process.stdout.write(box);

    const dbPath = (rawDb.name && rawDb.name !== '' && rawDb.name !== ':memory:') ? rawDb.name : undefined;
    const dataDir = dbPath ? path.dirname(path.resolve(dbPath)) : getDataDir();

    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch {}
    }

    const adminFilePath = path.join(dataDir, 'ADMIN_INICIAL.txt');
    const fileContent = [
      '=================================================================',
      '               CREDENCIALES INICIALES DE ADMIN',
      '         guárdelas ahora, no se volverán a mostrar',
      '=================================================================',
      'Usuario:  admin',
      `Password: ${adminPassword}`,
      `PIN:      ${adminPin}`,
      '',
      'ADVERTENCIA DE SEGURIDAD:',
      'Guarde estas credenciales en un lugar seguro.',
      'Este archivo se eliminará automáticamente al cambiar el PIN de administrador',
      'desde la aplicación (o debe ser eliminado manualmente tras su resguardo).',
      '=================================================================\n'
    ].join('\n');

    try {
      fs.writeFileSync(adminFilePath, fileContent, { encoding: 'utf-8', mode: 0o600 });
    } catch {
      try {
        fs.writeFileSync(adminFilePath, fileContent, { encoding: 'utf-8' });
      } catch {}
    }
  }

  const totalUsers = (rawDb.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;

  return {
    count: insertedCount > 0 ? insertedCount : totalUsers,
    adminSecrets: isProduction ? { password: adminPassword, pin: adminPin } : undefined
  };
}

export function ensureCorporateUsersNonDestructive(rawDb: Database.Database): void {
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

  // 2. Normalizar name/username de usuarios corporativos canónicos y alias legados
  // SIN tocar pin_hash, pin_salt, pin_length, password_hash, password_salt,
  // must_change_pin, failed_attempts, lockout_stage, locked_until_ms ni is_active.
  try {
    rawDb.exec(`
      UPDATE users SET name = 'ADMIN', username = 'admin' WHERE LOWER(name) LIKE '%anthony%' OR LOWER(name) LIKE '%olinelcys%' OR id IN ('usr_admin', 'usr_admin_olinelcys', 'admin');
      UPDATE users SET name = 'MESERO', username = 'mesero' WHERE LOWER(name) LIKE '%carlos%' OR LOWER(name) LIKE '%andrea%' OR id IN ('usr_mesero', 'usr_mesonero_carlos', 'usr_mesonero_andrea', 'mesero');
      UPDATE users SET name = 'PLANCHA', username = 'plancha' WHERE LOWER(name) LIKE '%jose%' OR LOWER(name) LIKE '%josé%' OR id IN ('usr_plancha', 'usr_cocina_plancha', 'plancha');
      UPDATE users SET name = 'DESPACHO', username = 'despacho' WHERE LOWER(name) LIKE '%miguel%' OR id IN ('usr_despacho', 'usr_cocina_perros', 'despacho');
      UPDATE users SET name = 'CAJERA', username = 'cajera' WHERE id IN ('usr_cajera', 'usr_cajera_principal', 'cajera');
    `);
    rawDb.exec(`
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

  // 3. Insertar con INSERT OR IGNORE los usuarios canónicos que falten
  const now = Date.now();
  const canonicalUsers: SeedUserDefinition[] = [
    { id: 'usr_admin', username: 'admin', name: 'ADMIN', role: 'admin', pin: '123456', password: 'admin123' },
    { id: 'usr_cajera', username: 'cajera', name: 'CAJERA', role: 'cajera', pin: '1111', password: 'caja123' },
    { id: 'usr_mesero', username: 'mesero', name: 'MESERO', role: 'mesonero', pin: '2222', password: 'mesero123' },
    { id: 'usr_plancha', username: 'plancha', name: 'PLANCHA', role: 'cocinero', pin: '4444', password: 'plancha123' },
    { id: 'usr_despacho', username: 'despacho', name: 'DESPACHO', role: 'despachador', pin: '5555', password: 'despacho123' }
  ];

  const insertStmt = rawDb.prepare(`
    INSERT OR IGNORE INTO users (
      id, name, username, role, pin_hash, pin_salt, pin_length,
      password_hash, password_salt, must_change_pin, is_active,
      failed_attempts, lockout_stage, locked_until_ms, created_at_ms, updated_at_ms
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, 1,
      0, 0, NULL, ?, ?
    )
  `);

  const isProduction = process.env.NODE_ENV === 'production';

  for (const u of canonicalUsers) {
    const { hash: pinHash, salt: pinSalt } = hashPin(u.pin);
    const { hash: pwHash, salt: pwSalt } = hashPassword(u.password || '123456');
    const mustChangePin = u.role === 'admin' ? 1 : (isProduction ? 0 : 1);

    insertStmt.run(
      u.id,
      u.name,
      u.username,
      u.role,
      pinHash,
      pinSalt,
      u.pin.length,
      pwHash,
      pwSalt,
      mustChangePin,
      now,
      now
    );
  }
}

export function seedInitialUsers(rawDb: Database.Database): number {
  return seedInitialUsersDetailed(rawDb).count;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('seed-users.ts')) {
  import('../../db/connection.js').then(({ initSqlite }) => {
    const dbPath = process.env.DB_PATH || './data/tocineta.db';
    const ctx = initSqlite(dbPath);
    try {
      const res = seedInitialUsersDetailed(ctx.rawDb);
      console.log(`BOOTSTRAP: ${res.count} usuarios iniciales creados`);
    } finally {
      ctx.rawDb.close();
    }
  });
}
