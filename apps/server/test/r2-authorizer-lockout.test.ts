import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { buildServer } from '../src/server.js';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { loginAs, ensureTestSupervisor } from './test-helpers.js';
import {
  assertAuthorizerAttemptAllowed,
  recordAuthorizerFailure,
  recordAuthorizerSuccess,
  findAuthorizerByPin,
  computeAuthorizerLockoutDurationMs,
  _resetAuthorizerGuardState
} from '../src/modules/auth/authorizer-guard.js';

describe('P3-C — Límite de intentos en PIN de autorización (SEV-203)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_p3_c_${Date.now()}`);
  const tempDb = path.join(tempDir, 'p3_c.db');
  let rawDb: Database.Database;
  let app: FastifyInstance;
  const originalDbPath = process.env.DB_PATH;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    process.env.DB_PATH = tempDb;
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    ensureTestSupervisor(rawDb);
    rawDb.prepare('UPDATE users SET must_change_pin = 0').run();

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      app.server.closeAllConnections?.();
      await app.close();
    }
    if (originalDbPath !== undefined) {
      process.env.DB_PATH = originalDbPath;
    } else {
      delete process.env.DB_PATH;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(() => {
    _resetAuthorizerGuardState();
  });

  describe('1. Unidad: Guard de memoria (authorizer-guard.ts)', () => {
    it('5 fallos seguidos bloquean al usuario; el 6.º intento lanza 423 AUTHORIZER_LOCKED', () => {
      const key = 'usr_cajera_1';
      const baseNow = 1_000_000;

      // 4 primeros fallos: no bloquean
      for (let i = 1; i <= 4; i++) {
        const res = recordAuthorizerFailure(key, baseNow + i * 1000);
        expect(res.isLocked).toBe(false);
        expect(res.remainingAttempts).toBe(5 - i);
        expect(() => assertAuthorizerAttemptAllowed(key, baseNow + i * 1000)).not.toThrow();
      }

      // 5.º fallo: bloquea con etapa 1 (5 minutos)
      const lockRes = recordAuthorizerFailure(key, baseNow + 5000);
      expect(lockRes.isLocked).toBe(true);
      expect(lockRes.stage).toBe(1);
      expect(lockRes.durationMs).toBe(5 * 60 * 1000);
      expect(lockRes.lockedUntilMs).toBe(baseNow + 5000 + 300_000);

      // 6.º intento: lanza error 423 AUTHORIZER_LOCKED con remainingMs
      try {
        assertAuthorizerAttemptAllowed(key, baseNow + 6000);
        expect.unreachable('Debe haber lanzado excepción 423');
      } catch (err: any) {
        expect(err.statusCode).toBe(423);
        expect(err.code).toBe('AUTHORIZER_LOCKED');
        expect(err.remainingMs).toBeGreaterThan(0);
        expect(err.remainingMs).toBeLessThanOrEqual(300_000);
      }
    });

    it('Avanzar el reloj (parámetro now) tras 5 minutos permite reintentar', () => {
      const key = 'usr_cajera_2';
      const baseNow = 1_000_000;

      for (let i = 0; i < 5; i++) {
        recordAuthorizerFailure(key, baseNow);
      }

      // Dentro de la ventana de 5 minutos: bloqueado
      expect(() => assertAuthorizerAttemptAllowed(key, baseNow + 299_000)).toThrow();

      // Pasados los 5 minutos (300_000 ms): permitido
      expect(() => assertAuthorizerAttemptAllowed(key, baseNow + 300_001)).not.toThrow();
    });

    it('Éxito reinicia el contador de fallos y etapas', () => {
      const key = 'usr_cajera_3';
      const baseNow = 1_000_000;

      // 4 fallos
      for (let i = 0; i < 4; i++) {
        recordAuthorizerFailure(key, baseNow);
      }

      // Éxito
      recordAuthorizerSuccess(key);

      // Los siguientes 4 fallos NO deben bloquear (el contador se reinició)
      for (let i = 0; i < 4; i++) {
        const res = recordAuthorizerFailure(key, baseNow + 1000);
        expect(res.isLocked).toBe(false);
      }
    });

    it('La clave es por usuario/origen actuante (otro usuario no queda bloqueado)', () => {
      const userA = 'usr_mesonero_a';
      const userB = 'usr_mesonero_b';
      const now = Date.now();

      for (let i = 0; i < 5; i++) {
        recordAuthorizerFailure(userA, now);
      }

      // User A está bloqueado
      expect(() => assertAuthorizerAttemptAllowed(userA, now)).toThrow();

      // User B NO está bloqueado
      expect(() => assertAuthorizerAttemptAllowed(userB, now)).not.toThrow();
    });

    it('Bloqueo escalonado: 5 min -> 15 min -> 60 min', () => {
      expect(computeAuthorizerLockoutDurationMs(1)).toBe(5 * 60 * 1000);
      expect(computeAuthorizerLockoutDurationMs(2)).toBe(15 * 60 * 1000);
      expect(computeAuthorizerLockoutDurationMs(3)).toBe(60 * 60 * 1000);
      expect(computeAuthorizerLockoutDurationMs(4)).toBe(60 * 60 * 1000);

      const key = 'usr_escalation_test';
      let now = 1_000_000;

      // 1.er bloqueo (5 fallos) -> 5 min
      for (let i = 0; i < 5; i++) recordAuthorizerFailure(key, now);
      expect(() => assertAuthorizerAttemptAllowed(key, now)).toThrow();

      // Desbloqueo temporal tras 5 min + 1ms
      now += 300_001;
      expect(() => assertAuthorizerAttemptAllowed(key, now)).not.toThrow();

      // 2.º bloqueo (otros 5 fallos) -> 15 min
      for (let i = 0; i < 5; i++) recordAuthorizerFailure(key, now);
      expect(() => assertAuthorizerAttemptAllowed(key, now)).toThrow();

      // A los 10 min sigue bloqueado
      expect(() => assertAuthorizerAttemptAllowed(key, now + 600_000)).toThrow();
      // Pasados 15 min + 1ms desbloquea
      now += 900_001;
      expect(() => assertAuthorizerAttemptAllowed(key, now)).not.toThrow();
    });

    it('Registra evento de auditoría AUTHORIZER_PIN_LOCKED al bloquearse', () => {
      const key = 'usr_audited_key';
      const now = Date.now();

      for (let i = 0; i < 5; i++) {
        recordAuthorizerFailure(key, now, rawDb);
      }

      const auditEvent = rawDb.prepare(`
        SELECT * FROM audit_events 
        WHERE action = 'AUTHORIZER_PIN_LOCKED' AND entity_id = ?
        ORDER BY created_at_ms DESC LIMIT 1
      `).get(key) as any;

      expect(auditEvent).toBeDefined();
      expect(auditEvent.action).toBe('AUTHORIZER_PIN_LOCKED');
      expect(auditEvent.entity_type).toBe('authorizer_guard');
    });
  });

  describe('2. Helper findAuthorizerByPin', () => {
    it('5 PIN erróneos seguidos → el 6.º intento devuelve 423 AUTHORIZER_LOCKED incluso con el PIN correcto', () => {
      const actingKey = 'acting_worker_x';
      const correctAdminPin = '123456';
      const wrongPin = '000000';
      const now = 2_000_000;

      // 5 intentos con PIN erróneo
      for (let i = 0; i < 5; i++) {
        const found = findAuthorizerByPin(rawDb, wrongPin, actingKey, now);
        expect(found).toBeNull();
      }

      // 6.º intento con el PIN CORRECTO: lanza 423 AUTHORIZER_LOCKED
      expect(() => {
        findAuthorizerByPin(rawDb, correctAdminPin, actingKey, now);
      }).toThrowError(expect.objectContaining({
        statusCode: 423,
        code: 'AUTHORIZER_LOCKED'
      }));
    });

    it('PIN correcto reinicia el contador de fallos para ese usuario', () => {
      const actingKey = 'acting_worker_y';
      const correctAdminPin = '123456';
      const wrongPin = '000000';
      const now = Date.now();

      // 4 fallos
      for (let i = 0; i < 4; i++) {
        expect(findAuthorizerByPin(rawDb, wrongPin, actingKey, now)).toBeNull();
      }

      // Éxito con PIN correcto
      const authorizer = findAuthorizerByPin(rawDb, correctAdminPin, actingKey, now);
      expect(authorizer).toBeDefined();
      expect(authorizer?.role).toBe('admin');

      // Otros 4 fallos no bloquean
      for (let i = 0; i < 4; i++) {
        expect(findAuthorizerByPin(rawDb, wrongPin, actingKey, now)).toBeNull();
      }
    });
  });

  describe('3. Rutas HTTP protegidas por authorizer-guard', () => {
    it('POST /api/auth/unlock-user bloquea fuerza bruta por IP con 423', async () => {
      const fakeIp = '192.168.1.100';

      // 5 intentos fallidos desde la misma IP
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/unlock-user',
          remoteAddress: fakeIp,
          payload: {
            authorizerUserId: 'usr_admin',
            authorizerPin: '999999',
            targetUserId: 'usr_cajera'
          }
        });
        expect(res.statusCode).toBe(401);
      }

      // 6.º intento (incluso con PIN correcto) debe devolver 423 AUTHORIZER_LOCKED
      const blockedRes = await app.inject({
        method: 'POST',
        url: '/api/auth/unlock-user',
        remoteAddress: fakeIp,
        payload: {
          authorizerUserId: 'usr_admin',
          authorizerPin: '123456',
          targetUserId: 'usr_cajera'
        }
      });

      expect(blockedRes.statusCode).toBe(423);
      const data = blockedRes.json();
      expect(data.code).toBe('AUTHORIZER_LOCKED');
      expect(data.remainingMs).toBeGreaterThan(0);
    });

    it('POST /api/auth/verify-action-pin bloquea fuerza bruta con 423', async () => {
      const token = (await loginAs(app, 'cajera', rawDb)).token;

      // 5 intentos con PIN erróneo
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/verify-action-pin',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            authorizerUserId: 'usr_admin',
            pin: '000000',
            action: 'DISCOUNT_OVERRIDE'
          }
        });
        expect(res.statusCode).toBe(401);
      }

      // 6.º intento con PIN correcto devuelve 423
      const blockedRes = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-action-pin',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          authorizerUserId: 'usr_admin',
          pin: '123456',
          action: 'DISCOUNT_OVERRIDE'
        }
      });

      expect(blockedRes.statusCode).toBe(423);
      expect(blockedRes.json().code).toBe('AUTHORIZER_LOCKED');
    });

    it('POST /api/orders/:id/incident bloquea tras 5 PINs erróneos con 423', async () => {
      const mesoneroToken = (await loginAs(app, 'mesonero', rawDb)).token;

      // Crear una jornada y orden de prueba para incidentes
      const jorId = `jor_inc_${Date.now()}`;
      rawDb.prepare(`
        INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status, initial_cash_usd_cents, initial_cash_bs_cents)
        VALUES (?, 'usr_admin', ?, 'abierta', 0, 0)
      `).run(jorId, Date.now());

      const orderId = `ord_test_inc_${Date.now()}`;
      rawDb.prepare(`
        INSERT INTO orders (id, order_number, location_id, jornada_id, payment_status, fulfillment_status, created_by_user_id, total_to_collect_usd_cents, rate_micro_bs, created_at_ms, updated_at_ms)
        VALUES (?, 9999, 'loc_alta_vista', ?, 'pagado', 'entregado', 'usr_mesero', 1000, 40000000, ?, ?)
      `).run(orderId, jorId, Date.now(), Date.now());

      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/orders/${orderId}/incident`,
          headers: { authorization: `Bearer ${mesoneroToken}` },
          payload: {
            reason_code: 'comida_fria',
            responsible_area: 'cocina',
            resolution: 'refund',
            authorizer_pin: '000000'
          }
        });
        expect(res.statusCode).toBe(403);
      }

      // 6.º intento devuelve 423 AUTHORIZER_LOCKED
      const blockedRes = await app.inject({
        method: 'POST',
        url: `/api/orders/${orderId}/incident`,
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          reason_code: 'comida_fria',
          responsible_area: 'cocina',
          resolution: 'refund',
          authorizer_pin: '123456'
        }
      });

      expect(blockedRes.statusCode).toBe(423);
      expect(blockedRes.json().code).toBe('AUTHORIZER_LOCKED');
    });

    it('TODO(M12) Cierre destructivo init-prod bloquea tras 5 intentos fallidos de PIN admin con 423', async () => {
      const adminToken = (await loginAs(app, 'admin', rawDb)).token;

      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/fase3/setup-wizard/init-prod',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { pin: '000000' }
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('FORBIDDEN');
      }

      // 6.º intento devuelve 423 AUTHORIZER_LOCKED
      const blockedRes = await app.inject({
        method: 'POST',
        url: '/api/fase3/setup-wizard/init-prod',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { pin: '123456' }
      });

      expect(blockedRes.statusCode).toBe(423);
      expect(blockedRes.json().code).toBe('AUTHORIZER_LOCKED');
      expect(blockedRes.json().remainingMs).toBeGreaterThan(0);
    });
  });
});
