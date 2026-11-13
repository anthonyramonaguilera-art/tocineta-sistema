import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';

describe('R2 — Migración 0043: Reconstrucción de printers con connection_type CLIENT_BT y directiva -- tocineta:fk-off', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_mig_0043_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'tocineta_migration_test.db');
  const tempMigrationsDir = path.join(tempDir, 'migrations');
  const snapshotsDir = path.join(tempDir, 'snapshots');

  fs.mkdirSync(tempMigrationsDir, { recursive: true });
  fs.mkdirSync(snapshotsDir, { recursive: true });

  const realMigrationsDir = path.resolve(__dirname, '../src/db/migrations');
  const allSqlFiles = fs.readdirSync(realMigrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  // Migraciones 0001 a 0042
  const migrationsUpTo0042 = allSqlFiles.filter(f => f <= '0042_client_print_routing.sql');

  let db: Database.Database;

  afterAll(() => {
    try {
      if (db) db.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('Aplica migraciones hasta 0042, siembra datos con FK y luego aplica 0043 verificando integridad total', async () => {
    // 1. Copiar migraciones hasta 0042 al directorio temporal
    for (const file of migrationsUpTo0042) {
      fs.copyFileSync(path.join(realMigrationsDir, file), path.join(tempMigrationsDir, file));
    }

    db = new Database(tempDb);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('foreign_keys = ON');

    // 2. Ejecutar runner hasta 0042
    const firstRun = await runMigrations(db, {
      migrationsDir: tempMigrationsDir,
      snapshotsDir,
      dbPath: tempDb
    });

    expect(firstRun.appliedCount).toBe(migrationsUpTo0042.length);
    expect(firstRun.appliedMigrations).toContain('0042_client_print_routing.sql');
    expect(firstRun.appliedMigrations).not.toContain('0043_printers_client_bt.sql');

    // 3. Insertar datos en varias tablas: usuarios, jornadas, órdenes, impresoras y print_jobs
    seedInitialUsers(db);
    const adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: string };

    db.prepare(`
      INSERT INTO jornadas (id, status, opened_at_ms, opened_by_user_id)
      VALUES ('jor_test_01', 'abierta', ?, ?)
    `).run(Date.now(), adminUser.id);

    db.prepare(`
      INSERT INTO orders (id, order_number, jornada_id, created_by_user_id, rate_micro_bs, created_at_ms, updated_at_ms)
      VALUES ('ord_test_01', 101, 'jor_test_01', ?, 50000000, ?, ?)
    `).run(adminUser.id, Date.now(), Date.now());

    // Insertar impresora adicional para verificar múltiples impresoras existentes
    db.prepare(`
      INSERT INTO printers (id, name, connection_type, address, columns, codepage, has_cutter, has_buzzer, is_active)
      VALUES ('print_custom_desk', 'Impresora Mostrador Extra', 'windows_raw', 'CUSTOM_USB_PRINTER', 32, 16, 1, 1, 1)
    `).run();

    // Insertar print_jobs en varios estados referenciando las impresoras y órdenes
    const jobsToInsert = [
      { id: 'job_state_cola', printerId: 'print_caja_usb', orderId: 'ord_test_01', status: 'en_cola', target: 'server' },
      { id: 'job_state_imp', printerId: 'print_cocina', orderId: 'ord_test_01', status: 'imprimiendo', target: 'server' },
      { id: 'job_state_done', printerId: 'print_custom_desk', orderId: 'ord_test_01', status: 'impreso', target: 'server' },
      { id: 'job_state_err', printerId: 'print_caja_usb', orderId: null, status: 'fallido', target: 'client' },
      { id: 'job_state_req', printerId: 'print_cocina', orderId: null, status: 'requiere_atencion', target: 'server' }
    ];

    const insertJob = db.prepare(`
      INSERT INTO print_jobs (id, printer_id, order_id, job_type, payload_bytes, status, target, created_at_ms)
      VALUES (?, ?, ?, 'TEST', X'001122', ?, ?, ?)
    `);

    for (const j of jobsToInsert) {
      insertJob.run(j.id, j.printerId, j.orderId, j.status, j.target, Date.now());
    }

    // Tomar snapshot de filas antes de la migración 0043
    const printersBefore = db.prepare('SELECT * FROM printers ORDER BY id ASC').all() as any[];
    const jobsBefore = db.prepare('SELECT id, printer_id, order_id, status, target FROM print_jobs ORDER BY id ASC').all() as any[];

    expect(printersBefore.length).toBe(3); // print_caja_usb, print_cocina, print_custom_desk
    expect(jobsBefore.length).toBe(5);

    // 4. Copiar migración 0043 al directorio y ejecutar runMigrations
    fs.copyFileSync(
      path.join(realMigrationsDir, '0043_printers_client_bt.sql'),
      path.join(tempMigrationsDir, '0043_printers_client_bt.sql')
    );

    const secondRun = await runMigrations(db, {
      migrationsDir: tempMigrationsDir,
      snapshotsDir,
      dbPath: tempDb
    });

    expect(secondRun.appliedCount).toBe(1);
    expect(secondRun.appliedMigrations).toEqual(['0043_printers_client_bt.sql']);

    // 5. Verificación: MISMAS FILAS en printers (valores idénticos y sin pérdida de datos)
    const printersAfter = db.prepare('SELECT * FROM printers ORDER BY id ASC').all() as any[];
    expect(printersAfter.length).toBe(printersBefore.length);

    for (let i = 0; i < printersBefore.length; i++) {
      const b = printersBefore[i];
      const a = printersAfter[i];
      expect(a.id).toBe(b.id);
      expect(a.name).toBe(b.name);
      expect(a.connection_type).toBe(b.connection_type);
      expect(a.address).toBe(b.address);
      expect(a.columns).toBe(b.columns);
      expect(a.codepage).toBe(b.codepage);
      expect(a.has_cutter).toBe(b.has_cutter);
      expect(a.has_buzzer).toBe(b.has_buzzer);
      expect(a.is_active).toBe(b.is_active);
      expect(a.owner_terminal_id).toBeNull();
    }

    // Filas en print_jobs intactas y manteniendo sus referencias FK
    const jobsAfter = db.prepare('SELECT id, printer_id, order_id, status, target FROM print_jobs ORDER BY id ASC').all() as any[];
    expect(jobsAfter).toEqual(jobsBefore);

    // 6. Verificación: PRAGMA foreign_key_check vacío
    const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
    expect(fkCheck).toEqual([]);

    // 7. Verificación: foreign_keys=ON al terminar
    const fkStatus = db.pragma('foreign_keys', { simple: true });
    expect(fkStatus).toBe(1);

    // 8. Verificación: inserción válida de una impresora CLIENT_BT con owner_terminal_id
    db.prepare(`
      INSERT INTO printers (id, name, connection_type, address, columns, codepage, has_cutter, has_buzzer, is_active, owner_terminal_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('print_bt_mesero_1', 'Impresora Bluetooth Mozo 1', 'CLIENT_BT', 'AA:BB:CC:DD:EE:FF', 32, 16, 0, 0, 1, 'term_pos_01');

    const btPrinter = db.prepare('SELECT * FROM printers WHERE id = ?').get('print_bt_mesero_1') as any;
    expect(btPrinter).toBeDefined();
    expect(btPrinter.connection_type).toBe('CLIENT_BT');
    expect(btPrinter.owner_terminal_id).toBe('term_pos_01');

    // Asociar un print_job a la nueva impresora CLIENT_BT para confirmar integridad referencial
    db.prepare(`
      INSERT INTO print_jobs (id, printer_id, job_type, payload_bytes, status, target, target_terminal_id, created_at_ms)
      VALUES ('job_bt_01', 'print_bt_mesero_1', 'TEST', X'1234', 'en_cola', 'client', 'term_pos_01', ?)
    `).run(Date.now());

    const insertedBtJob = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get('job_bt_01') as any;
    expect(insertedBtJob.printer_id).toBe('print_bt_mesero_1');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    // 9. Verificación: rechazo de un connection_type inválido por CHECK constraint
    expect(() => {
      db.prepare(`
        INSERT INTO printers (id, name, connection_type, address, columns, codepage, has_cutter, has_buzzer, is_active)
        VALUES ('print_invalid', 'Impresora Invalida', 'INVALID_TRANSPORT', '127.0.0.1', 32, 16, 0, 0, 1)
      `).run();
    }).toThrow();
  });

  it('Verifica que una migración con -- tocineta:fk-off que rompa FK revierte la transacción y restaura foreign_keys=ON', async () => {
    // Crear una migración defectuosa con la directiva que borre filas de printers referenciadas por print_jobs
    const badMigrationName = '0099_broken_fk_migration.sql';
    const badMigrationSql = `-- tocineta:fk-off
-- Eliminar las impresoras deja a los print_jobs huérfanos violando FK
DELETE FROM printers;
`;
    fs.writeFileSync(path.join(tempMigrationsDir, badMigrationName), badMigrationSql, 'utf-8');

    // Debe lanzar error por MIGRACION_FK_ERROR
    await expect(
      runMigrations(db, {
        migrationsDir: tempMigrationsDir,
        snapshotsDir,
        dbPath: tempDb
      })
    ).rejects.toThrow(/MIGRACION_FK_ERROR/);

    // La migración defectuosa no debe haberse registrado en _migrations
    const applied = db.prepare('SELECT name FROM _migrations WHERE name = ?').get(badMigrationName);
    expect(applied).toBeUndefined();

    // Las impresoras originales no se perdieron (transacción revertida)
    const count = db.prepare('SELECT COUNT(*) as cnt FROM printers').get() as { cnt: number };
    expect(count.cnt).toBeGreaterThan(0);

    // foreign_keys debe seguir en ON tras el fallo
    const fkStatus = db.pragma('foreign_keys', { simple: true });
    expect(fkStatus).toBe(1);
  });
});
