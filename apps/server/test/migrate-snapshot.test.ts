import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrate.js';

describe('Forward-Only Migrations with Automatic Hot Snapshots', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_migrate_test_${Date.now()}`);
  const dbFile = path.join(tempDir, 'tocineta.db');
  const migrationsDir = path.join(tempDir, 'migrations');
  const snapshotsDir = path.join(tempDir, 'snapshots');

  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.mkdirSync(snapshotsDir, { recursive: true });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('runs initial migration without snapshot, then triggers automatic snapshot before second migration', async () => {
    // 1. Preparar migración inicial
    const initSql = `
      CREATE TABLE IF NOT EXISTS _system_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      INSERT INTO _system_meta (key, value, updated_at_ms) VALUES ('version', '0.0.1', 1000);
    `;
    fs.writeFileSync(path.join(migrationsDir, '0000_init.sql'), initSql, 'utf-8');

    // 2. Abrir DB SQLite y ejecutar primera migración
    const db = new Database(dbFile);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');

    const firstRun = await runMigrations(db, {
      dbPath: dbFile,
      migrationsDir,
      snapshotsDir
    });

    expect(firstRun.appliedCount).toBe(1);
    expect(firstRun.appliedMigrations).toEqual(['0000_init.sql']);
    expect(firstRun.snapshotPath).toBeNull(); // No había tablas previas antes de iniciar

    // 3. Crear segunda migración
    const secondSql = `
      CREATE TABLE orders_test (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total_cents INTEGER NOT NULL
      );
    `;
    fs.writeFileSync(path.join(migrationsDir, '0001_orders.sql'), secondSql, 'utf-8');

    // 4. Ejecutar runner de nuevo: debe detectar tablas existentes y tomar hot snapshot
    const secondRun = await runMigrations(db, {
      dbPath: dbFile,
      migrationsDir,
      snapshotsDir
    });

    expect(secondRun.appliedCount).toBe(1);
    expect(secondRun.appliedMigrations).toEqual(['0001_orders.sql']);
    expect(secondRun.snapshotPath).not.toBeNull();

    // 5. Verificar existencia física y consistencia del snapshot generado
    const snapshotPath = secondRun.snapshotPath!;
    expect(fs.existsSync(snapshotPath)).toBe(true);
    expect(fs.statSync(snapshotPath).size).toBeGreaterThan(0);

    // Verificar que el snapshot contiene la tabla de la migración 0 pero NO la migración 1
    const snapshotDb = new Database(snapshotPath);
    const tablesInSnapshot = snapshotDb.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `).all() as Array<{ name: string }>;
    const tableNames = tablesInSnapshot.map(t => t.name);

    expect(tableNames).toContain('_system_meta');
    expect(tableNames).not.toContain('orders_test'); // Snapshot fue tomado ANTES de aplicar 0001
    snapshotDb.close();

    // 6. Verificar que la base de datos viva sí tiene la nueva tabla
    const tablesInLive = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `).all() as Array<{ name: string }>;
    const liveNames = tablesInLive.map(t => t.name);
    expect(liveNames).toContain('orders_test');

    db.close();
  });
});
