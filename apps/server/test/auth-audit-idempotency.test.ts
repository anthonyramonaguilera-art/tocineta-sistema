import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { generateUuidV7, createIdempotencyKey } from '@tocineta/shared';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { validatePinFormat, hashPin, verifyPin } from '../src/modules/auth/pin.js';
import { appendAuditEvent, verifyAuditChain, GENESIS_HASH } from '../src/modules/audit/audit-service.js';

describe('Hito M1 - Autenticación PIN, Auditoría Inmutable e Idempotencia (@tocineta/server)', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_m1_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_m1.db');

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    await runMigrations(dbCtx.rawDb, { dbPath: tempDb });
    seedInitialUsers(dbCtx.rawDb);

    app = await buildServer({ logger: false, disableStatic: true });

    // Ruta de prueba para verificar Idempotency-Key en endpoints de negocio
    app.post('/api/test-idempotent-action', async (req, reply) => {
      const body = req.body as { orderId: string; amountUsdCents: number };
      return reply.status(201).send({
        success: true,
        orderId: body.orderId,
        processedAt: Date.now()
      });
    });

    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      const dbCtx = getDatabaseContext();
      dbCtx.rawDb.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // --------------------------------------------------------------------------
  // 1. REGLAS DE PIN Y CRIPTOGRAFÍA SCRYPT
  // --------------------------------------------------------------------------
  describe('Criptografía y Formato de PIN (scrypt)', () => {
    it('Exige 6 dígitos numéricos para admin y supervisor', () => {
      expect(validatePinFormat('123456', 'admin')).toMatchObject({ valid: true, requiredLength: 6 });
      expect(validatePinFormat('654321', 'supervisor')).toMatchObject({ valid: true, requiredLength: 6 });
      expect(validatePinFormat('1234', 'admin').valid).toBe(false);
      expect(validatePinFormat('12345a', 'admin').valid).toBe(false);
    });

    it('Exige 4 dígitos numéricos para personal operativo (cajera, mesonero, etc.)', () => {
      expect(validatePinFormat('1111', 'cajera')).toMatchObject({ valid: true, requiredLength: 4 });
      expect(validatePinFormat('2222', 'mesonero')).toMatchObject({ valid: true, requiredLength: 4 });
      expect(validatePinFormat('123456', 'cajera').valid).toBe(false);
      expect(validatePinFormat('abcd', 'cajera').valid).toBe(false);
    });

    it('Genera hash scrypt seguro y lo verifica con timingSafeEqual', () => {
      const { hash, salt } = hashPin('123456');
      expect(hash.length).toBe(128); // 64 bytes en hex
      expect(salt.length).toBe(32);  // 16 bytes en hex
      expect(verifyPin('123456', salt, hash)).toBe(true);
      expect(verifyPin('654321', salt, hash)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 2. SEMILLA DE USUARIOS Y AUTENTICACIÓN POR PIN
  // --------------------------------------------------------------------------
  describe('Endpoints de Autenticación (/api/auth)', () => {
    it('Lista usuarios activos para el selector POS (/api/auth/users-public)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/users-public'
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.success).toBe(true);
      expect(data.users.length).toBeGreaterThanOrEqual(7);

      const olinelcys = data.users.find((u: any) => u.name === 'Sra. Olinelcys');
      expect(olinelcys).toBeDefined();
      expect(olinelcys.role).toBe('admin');
      expect(olinelcys.pinLength).toBe(6);
    });

    it('Inicia sesión exitosamente con PIN correcto (Sra. Olinelcys PIN 123456)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          userId: 'usr_admin_olinelcys',
          pin: '123456'
        }
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.success).toBe(true);
      expect(data.token).toBeDefined();
      expect(data.user.name).toBe('Sra. Olinelcys');

      // Validar endpoint /me con token Bearer
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${data.token}`
        }
      });
      expect(meRes.statusCode).toBe(200);
      const meData = JSON.parse(meRes.payload);
      expect(meData.user.id).toBe('usr_admin_olinelcys');
      expect(meData.user.role).toBe('admin');

      // Logout
      const logoutRes = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          authorization: `Bearer ${data.token}`
        }
      });
      expect(logoutRes.statusCode).toBe(200);

      // Subsequent /me falla por token revocado
      const meAfterLogout = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${data.token}`
        }
      });
      expect(meAfterLogout.statusCode).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // 3. BLOQUEO ESCALONADO DE PIN Y DESBLOQUEO DE SUPERVISOR
  // --------------------------------------------------------------------------
  describe('Bloqueo Escalonado de PIN (Lockout)', () => {
    it('Bloquea al usuario tras 5 intentos fallidos consecutivos y permite desbloqueo de supervisor', async () => {
      const targetUserId = 'usr_mesonero_carlos';

      // 4 intentos fallidos: debe avisar intentos restantes
      for (let i = 1; i <= 4; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { userId: targetUserId, pin: '9999' }
        });
        expect(res.statusCode).toBe(401);
        const data = JSON.parse(res.payload);
        expect(data.remainingAttempts).toBe(5 - i);
      }

      // Quinto intento fallido: Bloqueo inmediato (HTTP 423)
      const lockRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { userId: targetUserId, pin: '9999' }
      });
      expect(lockRes.statusCode).toBe(423);
      const lockData = JSON.parse(lockRes.payload);
      expect(lockData.error).toContain('bloqueado');

      // Intento posterior con PIN correcto es rechazado por estar bloqueado
      const blockedRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { userId: targetUserId, pin: '2222' }
      });
      expect(blockedRes.statusCode).toBe(423);

      // Supervisor desbloquea al usuario vía /api/auth/unlock-user
      const unlockRes = await app.inject({
        method: 'POST',
        url: '/api/auth/unlock-user',
        payload: {
          authorizerUserId: 'usr_supervisor_turno',
          authorizerPin: '654321',
          targetUserId: targetUserId
        }
      });
      expect(unlockRes.statusCode).toBe(200);

      // Ahora el usuario puede ingresar normalmente
      const successRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { userId: targetUserId, pin: '2222' }
      });
      expect(successRes.statusCode).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // 4. CADENA DE AUDITORÍA SHA-256 E INMUTABILIDAD POR TRIGGER SQLITE
  // --------------------------------------------------------------------------
  describe('Cadena de Auditoría Inmutable (audit_events)', () => {
    it('Encadena hashes SHA-256 desde GENESIS y valida la integridad', () => {
      const dbCtx = getDatabaseContext();

      const e1 = appendAuditEvent(dbCtx.rawDb, {
        action: 'ORDER_CREATED',
        entityType: 'order',
        entityId: 'ord_1',
        payload: { totalUsdCents: 1500 }
      });
      expect(e1.prevHash).toBeDefined();

      const e2 = appendAuditEvent(dbCtx.rawDb, {
        action: 'ORDER_PAID',
        entityType: 'order',
        entityId: 'ord_1',
        payload: { paidUsdCents: 1500 }
      });
      expect(e2.prevHash).toBe(e1.entryHash);

      const verification = verifyAuditChain(dbCtx.rawDb);
      expect(verification.valid).toBe(true);
      expect(verification.count).toBeGreaterThanOrEqual(2);
      expect(verification.headHash).toBe(e2.entryHash);
    });

    it('Trigger de SQLite impide UPDATE sobre audit_events (ABORT)', () => {
      const dbCtx = getDatabaseContext();
      expect(() => {
        dbCtx.rawDb.prepare(`
          UPDATE audit_events SET action = 'HACKED' WHERE seq = 1
        `).run();
      }).toThrow(/audit_events is append-only and immutable/i);
    });

    it('Trigger de SQLite impide DELETE sobre audit_events (ABORT)', () => {
      const dbCtx = getDatabaseContext();
      expect(() => {
        dbCtx.rawDb.prepare(`
          DELETE FROM audit_events WHERE seq = 1
        `).run();
      }).toThrow(/audit_events is append-only and immutable/i);
    });

    it('GET /api/system-health retorna auditChain verificado', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/system-health'
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.database.auditChain).toBeDefined();
      expect(data.database.auditChain.valid).toBe(true);
      expect(data.database.auditChain.count).toBeGreaterThan(0);
      expect(typeof data.database.auditChain.headHash).toBe('string');
    });
  });

  // --------------------------------------------------------------------------
  // 5. PLUGIN DE IDEMPOTENCIA Y DETECCIÓN DE CONFLICTOS 409
  // --------------------------------------------------------------------------
  describe('Plugin de Idempotencia Fastify', () => {
    it('Deduplica peticiones idénticas y retorna respuesta en caché con X-Cache: IDEMPOTENT', async () => {
      const key = createIdempotencyKey('order', generateUuidV7());
      const payload = { orderId: 'ord_test_100', amountUsdCents: 2500 };

      // Primera petición
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/test-idempotent-action',
        headers: { 'idempotency-key': key },
        payload
      });
      expect(res1.statusCode).toBe(201);
      const data1 = JSON.parse(res1.payload);
      expect(data1.orderId).toBe('ord_test_100');
      expect(res1.headers['x-cache']).toBeUndefined();

      // Segunda petición con mismo payload y misma clave
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/test-idempotent-action',
        headers: { 'idempotency-key': key },
        payload
      });
      expect(res2.statusCode).toBe(201);
      expect(res2.headers['x-cache']).toBe('IDEMPOTENT');
      const data2 = JSON.parse(res2.payload);
      expect(data2.processedAt).toBe(data1.processedAt);
    });

    it('Retorna 409 Conflict si se envía payload diferente con la misma Idempotency-Key', async () => {
      const key = createIdempotencyKey('order', generateUuidV7());

      // Petición inicial
      await app.inject({
        method: 'POST',
        url: '/api/test-idempotent-action',
        headers: { 'idempotency-key': key },
        payload: { orderId: 'ord_A', amountUsdCents: 1000 }
      });

      // Petición con payload modificado
      const conflictRes = await app.inject({
        method: 'POST',
        url: '/api/test-idempotent-action',
        headers: { 'idempotency-key': key },
        payload: { orderId: 'ord_A', amountUsdCents: 9999 } // payload diferente!
      });

      expect(conflictRes.statusCode).toBe(409);
      const conflictData = JSON.parse(conflictRes.payload);
      expect(conflictData.error).toContain('Conflicto de idempotencia');
    });

    it('Rechaza peticiones con Idempotency-Key en formato inválido con 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/test-idempotent-action',
        headers: { 'idempotency-key': 'formato-invalido-sin-dos-puntos-ni-uuid' },
        payload: { orderId: 'ord_X', amountUsdCents: 500 }
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.payload);
      expect(data.error).toContain('Clave de idempotencia inválida');
    });
  });
});
