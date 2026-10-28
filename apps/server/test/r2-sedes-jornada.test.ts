import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations, executeSqlIdempotently } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import {
  ensureOfficialLocations,
  getAllLocations,
  resolveLocationId
} from '../src/modules/profitability/locations-service.js';
import { openJornada, getCurrentJornada } from '../src/modules/cashier/cashier-service.js';
import { AppError } from '../src/lib/app-error.js';

describe('R2 / P2-A — Dos Sedes Oficiales y Jornada Global Única', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_r2_p2a_${Date.now()}`);
  const tempDbPath = path.join(tempDir, 'p2a_test.db');
  let rawDb: Database.Database;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const ctx = initSqlite(tempDbPath);
    rawDb = ctx.rawDb;
    rawDb.pragma('foreign_keys = ON');
    await runMigrations(rawDb, { dbPath: tempDbPath });
    seedInitialUsers(rawDb);
  });

  afterAll(() => {
    try {
      if (rawDb) rawDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. Arrancar el servidor dos veces → exactamente 2 sedes oficiales y cero revivir alias', () => {
    // Primera ejecución (ya corrida en beforeAll)
    ensureOfficialLocations(rawDb);
    let locs = getAllLocations(rawDb, false);
    expect(locs.length, 'Debe haber exactamente 2 sedes').toBe(2);
    expect(locs.map(l => l.id).sort()).toEqual(['loc_alta_vista', 'loc_los_olivos']);

    // Segunda ejecución simulada
    ensureOfficialLocations(rawDb);
    locs = getAllLocations(rawDb, false);
    expect(locs.length, 'Segunda ejecución no debe duplicar ni recrear alias').toBe(2);

    const rowCount = (rawDb.prepare('SELECT count(*) as cnt FROM locations').get() as any).cnt;
    expect(rowCount).toBe(2);

    const aliasExists = (rawDb.prepare("SELECT count(*) as cnt FROM locations WHERE id = 'sede_alta_vista'").get() as any).cnt;
    expect(aliasExists, 'El alias sede_alta_vista no debe existir en locations').toBe(0);
  });

  it('2. Dos aperturas seguidas → 1 jornada abierta (idempotente) y el índice único rechaza duplicados directos', () => {
    const j1 = openJornada(rawDb, {
      openedByUserId: 'usr_cajera',
      initialCashUsdCents: 5000,
      initialCashBsCents: 200000
    });

    const j2 = openJornada(rawDb, {
      openedByUserId: 'usr_cajera',
      initialCashUsdCents: 5000,
      initialCashBsCents: 200000
    });

    expect(j1.id).toBe(j2.id);

    const openCount = (rawDb.prepare("SELECT count(*) as cnt FROM jornadas WHERE status = 'abierta'").get() as any).cnt;
    expect(openCount).toBe(1);

    const current = getCurrentJornada(rawDb);
    expect(current).not.toBeNull();
    expect(current?.id).toBe(j1.id);

    // Inserción directa en SQL debe fallar por el índice único ux_jornada_abierta
    expect(() => {
      rawDb.prepare(`
        INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status)
        VALUES ('jor_violacion_directa', 'usr_admin', ?, 'abierta')
      `).run(Date.now());
    }).toThrow();
  });

  it('3. Migración con datos sembrados en sede_alta_vista → quedan en loc_alta_vista sin huérfanos (FK check vacío)', async () => {
    const isolateDir = path.join(os.tmpdir(), `tocineta_migrate_iso_${Date.now()}`);
    fs.mkdirSync(isolateDir, { recursive: true });
    const isoDbPath = path.join(isolateDir, 'iso.db');

    const isoCtx = initSqlite(isoDbPath);
    const isoDb = isoCtx.rawDb;
    isoDb.pragma('foreign_keys = ON');

    // Aplicar migraciones hasta 0028 manualmente
    const migrationsDir = path.resolve(__dirname, '../src/db/migrations');
    const allFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    const upTo28 = allFiles.filter(f => !f.startsWith('0029'));

    isoDb.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at_ms INTEGER NOT NULL
      );
    `);

    for (const f of upTo28) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf-8');
      executeSqlIdempotently(isoDb, sql);
      isoDb.prepare('INSERT INTO _migrations (name, applied_at_ms) VALUES (?, ?)').run(f, Date.now());
    }

    seedInitialUsers(isoDb);

    // Sembrar sede alias y registros hijos
    isoDb.prepare(`
      INSERT OR IGNORE INTO locations (id, name, type, is_active, created_at_ms, updated_at_ms)
      VALUES ('sede_alta_vista', 'Sede B Alias', 'sale', 1, 1000, 1000)
    `).run();

    isoDb.prepare(`
      INSERT OR IGNORE INTO users (id, name, role, pin_hash, pin_salt, pin_length, is_active, default_location_id, allowed_locations_json, created_at_ms, updated_at_ms)
      VALUES ('u_alias_test', 'Alias Tester', 'cajera', 'hash', 'salt', 4, 1, 'sede_alta_vista', '["sede_alta_vista"]', 1000, 1000)
    `).run();

    isoDb.prepare(`
      INSERT INTO operating_expenses (id, location_id, jornada_id, category, amount_usd_cents, amount_bs_cents, payment_method, description, authorized_by_user_id, created_at_ms)
      VALUES ('exp_iso_1', 'sede_alta_vista', 'jor_test', 'OPERATIVOS', 1500, 75000, 'EFECTIVO_USD', 'Gasto alias', 'usr_admin', 1000)
    `).run();

    // Ahora correr runMigrations (que aplicará 0029)
    const result = await runMigrations(isoDb, { dbPath: isoDbPath });
    expect(result.appliedCount).toBe(1);
    expect(result.appliedMigrations).toContain('0029_r2_sedes_y_jornada_global.sql');

    // Verificar que el gasto y usuario ahora apuntan a loc_alta_vista
    const expRow = isoDb.prepare("SELECT location_id FROM operating_expenses WHERE id = 'exp_iso_1'").get() as any;
    expect(expRow.location_id).toBe('loc_alta_vista');

    const userRow = isoDb.prepare("SELECT default_location_id, allowed_locations_json FROM users WHERE id = 'u_alias_test'").get() as any;
    expect(userRow.default_location_id).toBe('loc_alta_vista');
    expect(userRow.allowed_locations_json).not.toContain('sede_alta_vista');

    // Verificar que el alias fue eliminado de locations
    const aliasInLoc = isoDb.prepare("SELECT count(*) as cnt FROM locations WHERE id = 'sede_alta_vista'").get() as any;
    expect(aliasInLoc.cnt).toBe(0);

    // Foreign key check debe ser completamente vacío
    const fkErrors = isoDb.prepare('PRAGMA foreign_key_check').all();
    expect(fkErrors, 'No debe haber violaciones de Foreign Key tras migrar').toEqual([]);

    isoDb.close();
    try {
      fs.rmSync(isolateDir, { recursive: true, force: true });
    } catch {}
  });

  it('4. Migración aborta de forma segura si hay más de una jornada abierta con actividad', async () => {
    const isolateDir = path.join(os.tmpdir(), `tocineta_abort_test_${Date.now()}`);
    fs.mkdirSync(isolateDir, { recursive: true });
    const isoDbPath = path.join(isolateDir, 'abort.db');

    const isoCtx = initSqlite(isoDbPath);
    const isoDb = isoCtx.rawDb;

    const migrationsDir = path.resolve(__dirname, '../src/db/migrations');
    const allFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    const upTo28 = allFiles.filter(f => !f.startsWith('0029'));

    isoDb.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at_ms INTEGER NOT NULL
      );
    `);

    for (const f of upTo28) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf-8');
      executeSqlIdempotently(isoDb, sql);
      isoDb.prepare('INSERT INTO _migrations (name, applied_at_ms) VALUES (?, ?)').run(f, Date.now());
    }

    seedInitialUsers(isoDb);

    // Sembrar 2 jornadas abiertas; la más antigua con actividad (1 orden)
    isoDb.prepare(`
      INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status)
      VALUES ('jor_antigua_con_actividad', 'usr_admin', 1000, 'abierta')
    `).run();

    isoDb.prepare(`
      INSERT INTO orders (id, order_number, jornada_id, created_by_user_id, rate_micro_bs, total_to_collect_usd_cents, created_at_ms, updated_at_ms)
      VALUES ('ord_activa_test', 1, 'jor_antigua_con_actividad', 'usr_admin', 50000000, 1000, 1000, 1000)
    `).run();

    isoDb.prepare(`
      INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status)
      VALUES ('jor_reciente_vacia', 'usr_admin', 2000, 'abierta')
    `).run();

    // Intentar correr runMigrations debe fallar identificando la jornada con actividad
    await expect(runMigrations(isoDb, { dbPath: isoDbPath })).rejects.toThrow(/jor_antigua_con_actividad/);

    isoDb.close();
    try {
      fs.rmSync(isolateDir, { recursive: true, force: true });
    } catch {}
  });

  it('5. resolveLocationId valida candidato, resuelve sede de usuario y lanza LOCATION_REQUIRED en caso de omisión o invalidez', () => {
    // 1. Sin candidato ni sede de usuario -> AppError LOCATION_REQUIRED (400)
    expect(() => resolveLocationId(rawDb, undefined, undefined)).toThrow(AppError);
    try {
      resolveLocationId(rawDb, undefined, undefined);
    } catch (err: any) {
      expect(err.code).toBe('LOCATION_REQUIRED');
      expect(err.httpStatus).toBe(400);
      expect(err.field).toBe('locationId');
    }

    // 2. Candidato inválido o inactivo -> LOCATION_REQUIRED
    expect(() => resolveLocationId(rawDb, 'sede_inexistente')).toThrow(AppError);

    // 3. Candidato oficial válido -> lo devuelve
    expect(resolveLocationId(rawDb, 'loc_alta_vista')).toBe('loc_alta_vista');
    expect(resolveLocationId(rawDb, 'loc_los_olivos')).toBe('loc_los_olivos');

    // 4. Sin candidato pero con userId que tiene sede asignada -> resuelve sede de usuario
    rawDb.prepare(`
      INSERT OR REPLACE INTO users (id, name, role, pin_hash, pin_salt, pin_length, is_active, default_location_id, allowed_locations_json, created_at_ms, updated_at_ms)
      VALUES ('u_loc_user', 'Loc User', 'mesonero', 'hash', 'salt', 4, 1, 'loc_los_olivos', '["loc_los_olivos"]', 1000, 1000)
    `).run();

    expect(resolveLocationId(rawDb, undefined, 'u_loc_user')).toBe('loc_los_olivos');
  });
});
