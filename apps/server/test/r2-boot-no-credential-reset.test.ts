import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { warnIfSiblingDatabaseHasUsers } from '../src/index.js';
import { getProjectRoot } from '../src/config/paths.js';
import { initSqlite, resetDatabaseContext, type DatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  seedInitialUsers,
  seedInitialUsersDetailed,
  ensureCorporateUsersNonDestructive
} from '../src/modules/auth/seed-users.js';
import { hashPin, verifyPin } from '../src/modules/auth/pin.js';

describe('T-01: No resetear credenciales ni hashes de usuarios en arranque de servidor', () => {
  let tempDir: string;
  let tempDbPath: string;
  let dbCtx: DatabaseContext;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `tocineta_t01_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    tempDbPath = path.join(tempDir, 'boot_no_reset.test.db');
    dbCtx = initSqlite(tempDbPath);
    await runMigrations(dbCtx.rawDb, { dbPath: tempDbPath });
  });

  afterEach(() => {
    try {
      if (dbCtx?.rawDb) {
        dbCtx.rawDb.close();
      }
    } catch {}
    resetDatabaseContext();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function simulateServerBootstrap(rawDb: DatabaseContext['rawDb']): void {
    const userCountRow = rawDb.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
    if (userCountRow.cnt === 0) {
      seedInitialUsers(rawDb);
    } else {
      ensureCorporateUsersNonDestructive(rawDb);
    }
  }

  it('base vacía -> se siembran los 5 usuarios corporativos', () => {
    const countBefore = (dbCtx.rawDb.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
    expect(countBefore).toBe(0);

    simulateServerBootstrap(dbCtx.rawDb);

    const countAfter = (dbCtx.rawDb.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
    expect(countAfter).toBe(5);

    const users = dbCtx.rawDb.prepare('SELECT id, username, name, role FROM users ORDER BY id ASC').all() as any[];
    const ids = users.map(u => u.id);
    expect(ids).toContain('usr_admin');
    expect(ids).toContain('usr_cajera');
    expect(ids).toContain('usr_mesero');
    expect(ids).toContain('usr_plancha');
    expect(ids).toContain('usr_despacho');
  });

  it('siembra usuarios, cambia PIN de admin y cajera; dos arranques seguidos conservan PINs y must_change_pin=0', () => {
    simulateServerBootstrap(dbCtx.rawDb);

    // Cambiar PIN de admin a uno no trivial (ej. 839201) y must_change_pin = 0
    const newAdminPin = '839201';
    const { hash: adminHash, salt: adminSalt } = hashPin(newAdminPin);
    dbCtx.rawDb.prepare(`
      UPDATE users 
      SET pin_hash = ?, pin_salt = ?, pin_length = ?, must_change_pin = 0, updated_at_ms = ?
      WHERE id = 'usr_admin'
    `).run(adminHash, adminSalt, newAdminPin.length, Date.now());

    // Cambiar PIN de cajera a 7821
    const newCajeraPin = '7821';
    const { hash: cajeraHash, salt: cajeraSalt } = hashPin(newCajeraPin);
    dbCtx.rawDb.prepare(`
      UPDATE users 
      SET pin_hash = ?, pin_salt = ?, pin_length = ?, must_change_pin = 0, updated_at_ms = ?
      WHERE id = 'usr_cajera'
    `).run(cajeraHash, cajeraSalt, newCajeraPin.length, Date.now());

    // Ejecutar la secuencia de arranque dos veces seguidas
    simulateServerBootstrap(dbCtx.rawDb);
    simulateServerBootstrap(dbCtx.rawDb);

    // Verificar que el admin conserva el nuevo PIN y must_change_pin = 0
    const admin = dbCtx.rawDb.prepare('SELECT * FROM users WHERE id = ?').get('usr_admin') as any;
    expect(verifyPin(newAdminPin, admin.pin_salt, admin.pin_hash)).toBe(true);
    expect(verifyPin('123456', admin.pin_salt, admin.pin_hash)).toBe(false);
    expect(admin.must_change_pin).toBe(0);

    // Verificar que la cajera conserva su nuevo PIN
    const cajera = dbCtx.rawDb.prepare('SELECT * FROM users WHERE id = ?').get('usr_cajera') as any;
    expect(verifyPin(newCajeraPin, cajera.pin_salt, cajera.pin_hash)).toBe(true);
    expect(verifyPin('1111', cajera.pin_salt, cajera.pin_hash)).toBe(false);
    expect(cajera.must_change_pin).toBe(0);
  });

  it('un usuario con failed_attempts=3 conserva ese valor tras el arranque', () => {
    simulateServerBootstrap(dbCtx.rawDb);

    const lockedUntil = Date.now() + 600000;
    dbCtx.rawDb.prepare(`
      UPDATE users 
      SET failed_attempts = 3, lockout_stage = 1, locked_until_ms = ?
      WHERE id = 'usr_cajera'
    `).run(lockedUntil);

    // Ejecutar arranque
    simulateServerBootstrap(dbCtx.rawDb);

    const cajera = dbCtx.rawDb.prepare('SELECT failed_attempts, lockout_stage, locked_until_ms FROM users WHERE id = ?').get('usr_cajera') as any;
    expect(cajera.failed_attempts).toBe(3);
    expect(cajera.lockout_stage).toBe(1);
    expect(cajera.locked_until_ms).toBe(lockedUntil);
  });

  it('CRITERIO DE ACEPTACIÓN: reiniciar el servidor 3 veces seguidas no altera ningún hash de la tabla users', () => {
    simulateServerBootstrap(dbCtx.rawDb);

    // Personalizar credenciales de admin
    const customAdminPin = '948215';
    const { hash: admH, salt: admS } = hashPin(customAdminPin);
    dbCtx.rawDb.prepare(`
      UPDATE users 
      SET pin_hash = ?, pin_salt = ?, pin_length = ?, must_change_pin = 0
      WHERE id = 'usr_admin'
    `).run(admH, admS, customAdminPin.length);

    // Capturar estado exacto de hashes, salts y campos de seguridad antes de los arranques
    const usersBefore = dbCtx.rawDb.prepare(`
      SELECT id, name, username, role, pin_hash, pin_salt, pin_length, password_hash, password_salt, must_change_pin, failed_attempts, lockout_stage, is_active
      FROM users
      ORDER BY id ASC
    `).all();

    // Ejecutar 3 arranques consecutivos
    simulateServerBootstrap(dbCtx.rawDb);
    simulateServerBootstrap(dbCtx.rawDb);
    simulateServerBootstrap(dbCtx.rawDb);

    const usersAfter = dbCtx.rawDb.prepare(`
      SELECT id, name, username, role, pin_hash, pin_salt, pin_length, password_hash, password_salt, must_change_pin, failed_attempts, lockout_stage, is_active
      FROM users
      ORDER BY id ASC
    `).all();

    // Comparar exactamente cada usuario
    expect(usersAfter).toEqual(usersBefore);
  });

  it('normaliza name y username de registros existentes sin tocar credenciales', () => {
    simulateServerBootstrap(dbCtx.rawDb);

    // Modificar name a un alias con Anthony
    const customPin = '654321';
    const { hash: h, salt: s } = hashPin(customPin);
    dbCtx.rawDb.prepare(`
      UPDATE users 
      SET name = 'Anthony Admin', pin_hash = ?, pin_salt = ?, pin_length = ?
      WHERE id = 'usr_admin'
    `).run(h, s, customPin.length);

    // Ejecutar arranque no destructivo
    ensureCorporateUsersNonDestructive(dbCtx.rawDb);

    const admin = dbCtx.rawDb.prepare('SELECT name, username, pin_hash, pin_salt FROM users WHERE id = ?').get('usr_admin') as any;
    expect(admin.name).toBe('ADMIN');
    expect(admin.username).toBe('admin');
    expect(verifyPin(customPin, admin.pin_salt, admin.pin_hash)).toBe(true);
  });

  it('endpoint POST /api/auth/change-pin: actualiza PIN, clave opcional, must_change_pin=0 en una transacción y borra ADMIN_INICIAL.txt', async () => {
    simulateServerBootstrap(dbCtx.rawDb);

    // Crear un archivo ficticio ADMIN_INICIAL.txt en el directorio de la DB
    const adminFilePath = path.join(tempDir, 'ADMIN_INICIAL.txt');
    fs.writeFileSync(adminFilePath, 'credenciales temporales');
    expect(fs.existsSync(adminFilePath)).toBe(true);

    const app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    try {
      // Login como admin
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          username: 'admin',
          pin: '123456'
        }
      });
      expect(loginRes.statusCode).toBe(200);
      const { token } = JSON.parse(loginRes.payload);

      // Cambiar PIN y password
      const newPin = '839402';
      const newPassword = 'PasswordSeguro123!';
      const changeRes = await app.inject({
        method: 'POST',
        url: '/api/auth/change-pin',
        headers: {
          authorization: `Bearer ${token}`
        },
        payload: {
          currentPin: '123456',
          newPin,
          newPassword
        }
      });

      expect(changeRes.statusCode).toBe(200);
      expect(JSON.parse(changeRes.payload).success).toBe(true);

      // Verificar en base de datos
      const admin = dbCtx.rawDb.prepare('SELECT * FROM users WHERE id = ?').get('usr_admin') as any;
      expect(verifyPin(newPin, admin.pin_salt, admin.pin_hash)).toBe(true);
      expect(admin.must_change_pin).toBe(0);

      // Verificar que la nueva clave funciona
      const derived = crypto.scryptSync(newPassword, admin.password_salt, 64).toString('hex');
      expect(crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(admin.password_hash, 'hex'))).toBe(true);

      // Verificar que ADMIN_INICIAL.txt fue eliminado
      expect(fs.existsSync(adminFilePath)).toBe(false);
    } finally {
      await app.close();
    }
  });
  describe('PASO B — Refuerzo de rutas y advertencias de producción', () => {
    it('getProjectRoot encuentra la raíz del proyecto con pnpm-workspace.yaml', () => {
      const root = getProjectRoot();
      expect(fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))).toBe(true);
    });

    it('getProjectRoot prioriza TOCINETA_HOME cuando está definido', () => {
      const original = process.env.TOCINETA_HOME;
      try {
        const customHome = path.join(tempDir, 'custom_tocineta_home');
        process.env.TOCINETA_HOME = customHome;
        expect(getProjectRoot()).toBe(path.resolve(customHome));
      } finally {
        if (original === undefined) {
          delete process.env.TOCINETA_HOME;
        } else {
          process.env.TOCINETA_HOME = original;
        }
      }
    });

    it('warnIfSiblingDatabaseHasUsers detecta base hermana con usuarios cuando la actual está vacía', () => {
      // Crear base hermana con usuarios
      const siblingDbPath = path.join(tempDir, 'tocineta.db');
      const siblingCtx = initSqlite(siblingDbPath);
      runMigrations(siblingCtx.rawDb, { dbPath: siblingDbPath });
      seedInitialUsers(siblingCtx.rawDb);
      siblingCtx.rawDb.close();

      // Crear base actual vacía dentro de una subcarpeta (ej. data/temp)
      const subDir = path.join(tempDir, 'subfolder');
      fs.mkdirSync(subDir, { recursive: true });
      const emptyDbPath = path.join(subDir, 'empty.test.db');
      const emptyCtx = initSqlite(emptyDbPath);
      runMigrations(emptyCtx.rawDb, { dbPath: emptyDbPath });
      emptyCtx.rawDb.close();

      const warned = warnIfSiblingDatabaseHasUsers(emptyDbPath);
      expect(warned).toBe(true);
    });
  });
});