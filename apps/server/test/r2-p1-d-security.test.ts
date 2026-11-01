import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { buildServer } from '../src/server.js';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  seedInitialUsers,
  seedInitialUsersDetailed,
  deleteAdminInitialFileIfExists
} from '../src/modules/auth/seed-users.js';
import { isTrivialPin } from '../src/modules/auth/pin.js';
import { loginAs } from './test-helpers.js';

describe('P1-D — Blindaje de init-prod/seed-demo y Credenciales Iniciales de Admin', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_p1_d_${Date.now()}`);
  const tempDb = path.join(tempDir, 'p1_d.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDbPath = process.env.DB_PATH;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    process.env.DB_PATH = tempDb;
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    rawDb.prepare('UPDATE users SET must_change_pin = 0').run();

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      app.server.closeAllConnections?.();
      await app.close();
    }
    process.env.NODE_ENV = originalNodeEnv;
    if (originalDbPath !== undefined) {
      process.env.DB_PATH = originalDbPath;
    } else {
      delete process.env.DB_PATH;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('1. Protección en profundidad de /init-prod y /seed-demo', () => {
    it('init-prod anónimo (sin sesión) -> 401 UNAUTHENTICATED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/fase3/setup-wizard/init-prod',
        payload: { pin: '123456' }
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNAUTHENTICATED');
    });

    it('seed-demo anónimo (sin sesión) -> 401 UNAUTHENTICATED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/fase3/setup-wizard/seed-demo',
        payload: { pin: '123456' }
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('UNAUTHENTICATED');
    });

    it('mesero (rol distinto de admin) -> 403 FORBIDDEN', async () => {
      const mesero = await loginAs(app, 'mesero', rawDb);
      const res = await app.inject({
        method: 'POST',
        url: '/api/fase3/setup-wizard/init-prod',
        headers: mesero.headers,
        payload: { pin: '2222' }
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('FORBIDDEN');
    });

    it('admin con PIN ausente o incorrecto -> 403 FORBIDDEN y registra DESTRUCTIVE_ACTION_DENIED en auditoría', async () => {
      const admin = await loginAs(app, 'admin', rawDb);

      const resNoPin = await app.inject({
        method: 'POST',
        url: '/api/fase3/setup-wizard/init-prod',
        headers: admin.headers,
        payload: {}
      });
      expect(resNoPin.statusCode).toBe(403);
      expect(JSON.parse(resNoPin.payload).code).toBe('FORBIDDEN');

      const resBadPin = await app.inject({
        method: 'POST',
        url: '/api/fase3/setup-wizard/init-prod',
        headers: admin.headers,
        payload: { pin: '000000' }
      });
      expect(resBadPin.statusCode).toBe(403);
      expect(JSON.parse(resBadPin.payload).code).toBe('FORBIDDEN');

      // Verificar que se registró el evento DESTRUCTIVE_ACTION_DENIED
      const auditRow = rawDb
        .prepare("SELECT * FROM audit_events WHERE action = 'DESTRUCTIVE_ACTION_DENIED' ORDER BY seq DESC LIMIT 1")
        .get() as any;
      expect(auditRow).toBeDefined();
      expect(auditRow.actor_user_id).toBe('usr_admin');
    });

    it('admin con PIN correcto en NODE_ENV="test" -> 200 OK y registra PRODUCTION_RESET_REQUESTED', async () => {
      process.env.NODE_ENV = 'test';
      const admin = await loginAs(app, 'admin', rawDb);

      const res = await app.inject({
        method: 'POST',
        url: '/api/fase3/setup-wizard/init-prod',
        headers: admin.headers,
        payload: { pin: '123456' }
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).success).toBe(true);

      const auditRow = rawDb
        .prepare("SELECT * FROM audit_events WHERE action = 'PRODUCTION_RESET_REQUESTED' ORDER BY seq DESC LIMIT 1")
        .get() as any;
      expect(auditRow).toBeDefined();
      expect(auditRow.actor_user_id).toBe('usr_admin');
    });

    it('admin con PIN correcto en NODE_ENV="production" y jornada existente -> 409 PRODUCTION_RESET_BLOCKED', async () => {
      process.env.NODE_ENV = 'production';
      const admin = await loginAs(app, 'admin', rawDb);

      // Insertar una fila simulada en jornadas
      const now = Date.now();
      rawDb.prepare(`
        INSERT INTO jornadas (id, location_id, opened_by_user_id, opened_at_ms, status)
        VALUES ('jrn_test_guard', 'loc_alta_vista', 'usr_admin', ?, 'abierta')
      `).run(now);

      try {
        const resInitProd = await app.inject({
          method: 'POST',
          url: '/api/fase3/setup-wizard/init-prod',
          headers: admin.headers,
          payload: { pin: '123456' }
        });
        expect(resInitProd.statusCode).toBe(409);
        const bodyInit = JSON.parse(resInitProd.payload);
        expect(bodyInit.code).toBe('PRODUCTION_RESET_BLOCKED');

        const resSeedDemo = await app.inject({
          method: 'POST',
          url: '/api/fase3/setup-wizard/seed-demo',
          headers: admin.headers,
          payload: { pin: '123456' }
        });
        expect(resSeedDemo.statusCode).toBe(409);
        const bodyDemo = JSON.parse(resSeedDemo.payload);
        expect(bodyDemo.code).toBe('PRODUCTION_RESET_BLOCKED');
      } finally {
        rawDb.prepare("DELETE FROM jornadas WHERE id = 'jrn_test_guard'").run();
        process.env.NODE_ENV = 'test';
      }
    });
  });

  describe('2. Generación segura de credenciales en producción (seedInitialUsersDetailed)', () => {
    it('seedInitialUsersDetailed con production: true genera credenciales aleatorias seguras, must_change_pin=1 en admin y 0 en operativos', async () => {
      const freshDir = path.join(os.tmpdir(), `tocineta_seed_prod_${Date.now()}`);
      fs.mkdirSync(freshDir, { recursive: true });
      const freshDbPath = path.join(freshDir, 'fresh_prod.db');
      const freshCtx = initSqlite(freshDbPath);
      await runMigrations(freshCtx.rawDb);

      try {
        const res = seedInitialUsersDetailed(freshCtx.rawDb, { production: true });
        expect(res.count).toBe(5);
        expect(res.adminSecrets).toBeDefined();
        expect(res.adminSecrets!.password).not.toBe('admin123');
        expect(res.adminSecrets!.password.length).toBe(16);
        expect(res.adminSecrets!.pin).not.toBe('123456');
        expect(res.adminSecrets!.pin.length).toBe(6);
        expect(isTrivialPin(res.adminSecrets!.pin)).toBe(false);

        // Verificar datos en DB
        const adminRow = freshCtx.rawDb.prepare("SELECT * FROM users WHERE id = 'usr_admin'").get() as any;
        expect(adminRow.must_change_pin).toBe(1);

        const cajeraRow = freshCtx.rawDb.prepare("SELECT * FROM users WHERE id = 'usr_cajera'").get() as any;
        expect(cajeraRow.must_change_pin).toBe(0);

        const meseroRow = freshCtx.rawDb.prepare("SELECT * FROM users WHERE id = 'usr_mesero'").get() as any;
        expect(meseroRow.must_change_pin).toBe(0);

        // Verificar archivo ADMIN_INICIAL.txt creado en el directorio de la base de datos
        const adminFile = path.join(freshDir, 'ADMIN_INICIAL.txt');
        expect(fs.existsSync(adminFile)).toBe(true);
        const fileContent = fs.readFileSync(adminFile, 'utf8');
        expect(fileContent).toContain(res.adminSecrets!.password);
        expect(fileContent).toContain(res.adminSecrets!.pin);

        // Verificar eliminación automática mediante deleteAdminInitialFileIfExists
        deleteAdminInitialFileIfExists(freshDir);
        expect(fs.existsSync(adminFile)).toBe(false);
      } finally {
        freshCtx.rawDb.close();
        initSqlite(tempDb);
        try {
          fs.rmSync(freshDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it('seedInitialUsersDetailed con production: false mantiene credenciales conocidas de desarrollo', async () => {
      const devDir = path.join(os.tmpdir(), `tocineta_seed_dev_${Date.now()}`);
      fs.mkdirSync(devDir, { recursive: true });
      const devDbPath = path.join(devDir, 'dev.db');
      const devCtx = initSqlite(devDbPath);
      await runMigrations(devCtx.rawDb);

      try {
        const res = seedInitialUsersDetailed(devCtx.rawDb, { production: false });
        expect(res.count).toBe(5);
        expect(res.adminSecrets).toBeUndefined();

        const adminRow = devCtx.rawDb.prepare("SELECT * FROM users WHERE id = 'usr_admin'").get() as any;
        expect(adminRow).toBeDefined();

        const adminFile = path.join(devDir, 'ADMIN_INICIAL.txt');
        expect(fs.existsSync(adminFile)).toBe(false);
      } finally {
        devCtx.rawDb.close();
        initSqlite(tempDb);
        try {
          fs.rmSync(devDir, { recursive: true, force: true });
        } catch {}
      }
    });
  });

  describe('3. Validación y rechazo de PIN trivial en /api/auth/change-pin', () => {
    it('Admin intentando cambiar a PIN trivial (secuencias o dígitos iguales) es rechazado con 400', async () => {
      const admin = await loginAs(app, 'admin', rawDb);

      const trivialPins = ['111111', '000000', '123456', '654321', '012345', '987654'];
      for (const trivialPin of trivialPins) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/change-pin',
          headers: admin.headers,
          payload: { currentPin: '123456', newPin: trivialPin }
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.payload);
        expect(body.error).toContain('secuencia');
      }
    });

    it('Admin cambiando a PIN válido (no trivial de 6 dígitos) tiene éxito y borra ADMIN_INICIAL.txt', async () => {
      const admin = await loginAs(app, 'admin', rawDb);

      // Crear archivo simulado ADMIN_INICIAL.txt en tempDir
      const adminFile = path.join(tempDir, 'ADMIN_INICIAL.txt');
      fs.writeFileSync(adminFile, 'credenciales secretas');
      expect(fs.existsSync(adminFile)).toBe(true);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/change-pin',
        headers: admin.headers,
        payload: { currentPin: '123456', newPin: '829401' }
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).success).toBe(true);

      // Verificar que el archivo fue borrado
      expect(fs.existsSync(adminFile)).toBe(false);

      // Restaurar el PIN del admin a 123456 para no afectar otros tests que usen la misma instancia
      await app.inject({
        method: 'POST',
        url: '/api/auth/change-pin',
        headers: admin.headers,
        payload: { currentPin: '829401', newPin: '749203' }
      });
      // Restaurar en DB a 123456 con must_change_pin=0
      rawDb.prepare("UPDATE users SET pin_hash = ?, pin_salt = ?, must_change_pin = 0 WHERE id = 'usr_admin'")
        .run('72e3ea860477bfb3cb40db03632abdecf4fdb4ea5fffc6f849ffb673df66ee2b', '180c43666270ad9b1f237bf4165d2182');
    });
  });
});
