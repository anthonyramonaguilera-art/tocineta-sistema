import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { loginAs } from './test-helpers.js';
import {
  listStaffUsers,
  createStaffUser,
  deleteOrDeactivateStaffUser
} from '../src/modules/staff/users-service.js';

describe('Baja de empleados, visibilidad en staff y liberacion de username', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_staff_del_vis_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_staff_delete_visibility.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureOfficialLocations(rawDb);

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      const dbCtx = getDatabaseContext();
      if (dbCtx && dbCtx.db) {
        dbCtx.db.close();
      }
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('a) Empleado con orden asociada: al dar de baja desaparece de listStaffUsers', async () => {
    // 1. Crear un empleado
    const username = 'mesonero.baja';
    const employee = createStaffUser(rawDb, {
      name: 'Mesonero Operativo',
      username,
      role: 'mesonero',
      pin: '2345'
    });

    // Verificar que aparece inicialmente en listStaffUsers
    const staffBefore = listStaffUsers(rawDb);
    expect(staffBefore.some((u) => u.id === employee.id)).toBe(true);

    // 2. Asociar una orden a este empleado (creando la restriccion de clave foranea)
    const now = Date.now();
    rawDb.prepare(`
      INSERT OR IGNORE INTO jornadas (
        id, location_id, opened_by_user_id, opened_at_ms, status
      ) VALUES ('jor_test_baja', 'loc_alta_vista', 'usr_admin', ?, 'abierta')
    `).run(now);

    rawDb.prepare(`
      INSERT INTO orders (
        id, order_number, location_id, jornada_id, created_by_user_id,
        rate_micro_bs, total_to_collect_usd_cents, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'loc_alta_vista', 'jor_test_baja', ?, 40000000, 1000, ?, ?)
    `).run('ord_test_fk_baja', 201, employee.id, now, now);

    // 3. Dar de baja al empleado (se ejecuta soft-delete por la FK)
    const delResult = deleteOrDeactivateStaffUser(rawDb, employee.id, 'usr_admin');
    expect(delResult.success).toBe(true);

    // 4. Verificar que ya NO aparece en listStaffUsers
    const staffAfter = listStaffUsers(rawDb);
    expect(staffAfter.some((u) => u.id === employee.id)).toBe(false);

    // Verificar via API GET /api/admin/users
    const apiRes = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(apiRes.statusCode).toBe(200);
    const apiUsers = apiRes.json().users;
    expect(apiUsers.some((u: any) => u.id === employee.id)).toBe(false);

    // 5. Verificar estado en base de datos: soft-delete con username liberado
    const dbRow = rawDb.prepare('SELECT id, is_active, approval_status, username FROM users WHERE id = ?').get(employee.id) as any;
    expect(dbRow.is_active).toBe(0);
    expect(dbRow.approval_status).toBe('REJECTED');
    expect(dbRow.username).toMatch(new RegExp(`^${username}__baja_`));
  });

  it('b) Crear de nuevo el mismo username queda permitido tras la baja', async () => {
    const username = 'mesonero.baja';

    // Al haber renombrado el anterior a mesonero.baja__baja_<now>, debe permitir crear uno nuevo con el mismo username
    const newEmployee = createStaffUser(rawDb, {
      name: 'Mesonero Reemplazo',
      username,
      role: 'mesonero',
      pin: '3456'
    });

    expect(newEmployee).toBeDefined();
    expect(newEmployee.username).toBe(username);

    // Aparece en la lista de personal activo
    const staff = listStaffUsers(rawDb);
    const found = staff.find((u) => u.username === username);
    expect(found).toBeDefined();
    expect(found?.id).toBe(newEmployee.id);
  });

  it('c) Un usuario PENDING sigue apareciendo en listStaffUsers (no se oculta)', async () => {
    const now = Date.now();
    const pendingId = `usr_pending_${now}`;

    // Los PENDING nacen con is_active = 0 y approval_status = 'PENDING' (ej. registro publico)
    rawDb.prepare(`
      INSERT INTO users (
        id, name, username, role, pin_hash, pin_salt, pin_length,
        password_hash, password_salt, must_change_pin, is_active,
        failed_attempts, lockout_stage, approval_status, permissions_json,
        created_at_ms, updated_at_ms
      ) VALUES (
        ?, 'Aspirante Postulante', 'aspirante.nuevo', 'mesonero', 'hash_test', 'salt_test', 4,
        NULL, NULL, 0, 0,
        0, 0, 'PENDING', '[]',
        ?, ?
      )
    `).run(pendingId, now, now);

    // Debe seguir apareciendo en listStaffUsers para permitir su aprobacion
    const staff = listStaffUsers(rawDb);
    const pendingUser = staff.find((u) => u.id === pendingId);
    expect(pendingUser).toBeDefined();
    expect(pendingUser?.approvalStatus).toBe('PENDING');
    expect(pendingUser?.isActive).toBe(false);

    // Tambien visible via API
    const apiRes = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(apiRes.statusCode).toBe(200);
    const apiUsers = apiRes.json().users;
    expect(apiUsers.some((u: any) => u.id === pendingId)).toBe(true);
  });

  it('d) El administrador principal no se puede dar de baja', async () => {
    // Intento directo por servicio
    expect(() => {
      deleteOrDeactivateStaffUser(rawDb, 'usr_admin', 'usr_admin');
    }).toThrow('No se puede eliminar al Administrador principal');

    // Intento via API HTTP DELETE /api/admin/users/usr_admin
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/users/usr_admin',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(res.statusCode).toBe(400);
    const json = res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe('No se puede eliminar al Administrador principal');

    // El admin sigue presente y activo
    const adminRow = rawDb.prepare("SELECT id, is_active, approval_status FROM users WHERE id = 'usr_admin'").get() as any;
    expect(adminRow.is_active).toBe(1);
    expect(adminRow.approval_status).toBe('APPROVED');
  });
});
