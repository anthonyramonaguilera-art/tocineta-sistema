import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { buildServer } from '../src/server.js';
import { getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import {
  _resetSupportStateForTesting,
  getSupportStatus
} from '../src/modules/support/support-service.js';
import {
  getCurrentSystemVersion,
  applySignedUpdatePackage,
  isSalesHours
} from '../src/modules/updater/updater-service.js';
import {
  generateEd25519KeyPair,
  createSignedReleasePackage,
  signManifest,
  type ReleaseManifest
} from '../src/modules/updater/signer.js';

describe('Hito M12 - Modo Soporte Auditado y Motor de Actualizaciones Firmadas Ed25519 (@tocineta/server)', () => {
  let app: FastifyInstance;
  let rawDb: Database.Database;
  let adminToken: string;
  let mesoneroToken: string;

  beforeAll(async () => {
    // Inicializar servidor de pruebas y base de datos SQLite WAL
    app = await buildServer({ disableStatic: true });
    await app.ready();

    const dbCtx = getDatabaseContext();
    rawDb = dbCtx.rawDb;

    // Ejecutar todas las migraciones hasta la 0013
    await runMigrations(rawDb);
    seedInitialUsers(rawDb);

    // Login Admin (Sra. Olinelcys)
    const resAdmin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_admin_olinelcys', pin: '123456' }
    });
    adminToken = JSON.parse(resAdmin.payload).token;

    // Login Mesonero (Carlos)
    const resMesonero = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_mesonero_carlos', pin: '2222' }
    });
    mesoneroToken = JSON.parse(resMesonero.payload).token;
  });

  afterAll(async () => {
    _resetSupportStateForTesting();
    await app.close();
  });

  beforeEach(() => {
    _resetSupportStateForTesting();
  });

  // ==========================================================================
  // BLOQUE 1: MODO SOPORTE AUDITADO CON WINDOWS QUICK ASSIST
  // ==========================================================================
  describe('1. Modo Soporte Auditado (POST /api/support/start y stop)', () => {

    it('Rechaza activar Modo Soporte con PIN incorrecto o usuario sin rol Admin (403)', async () => {
      // 1. Intento con PIN erróneo
      const resBadPin = await app.inject({
        method: 'POST',
        url: '/api/support/start',
        payload: { adminPin: '999999', notes: 'Intento con PIN falso' }
      });
      expect(resBadPin.statusCode).toBe(403);
      const dataBad = JSON.parse(resBadPin.payload);
      expect(dataBad.success).toBe(false);
      expect(dataBad.error).toContain('PIN de Administrador inválido');

      // 2. Intento con PIN de mesonero (no es admin)
      const resMesoneroPin = await app.inject({
        method: 'POST',
        url: '/api/support/start',
        payload: { adminPin: '2222' }
      });
      expect(resMesoneroPin.statusCode).toBe(403);

      // 3. Verificar que se registró en auditoría inmutable
      const auditAttempt = rawDb.prepare(`
        SELECT * FROM audit_events 
        WHERE action = 'SUPPORT_MODE_START_REJECTED'
        ORDER BY created_at_ms DESC LIMIT 1
      `).get() as any;

      expect(auditAttempt).toBeDefined();
      expect(auditAttempt.entity_type).toBe('system_support');
    });

    it('Activa Modo Soporte con PIN de 6 dígitos de Admin, emite evento y audita sesión de 2 horas', async () => {
      // 1. Activar con PIN de la Sra. Olinelcys ('123456')
      const resStart = await app.inject({
        method: 'POST',
        url: '/api/support/start',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          adminPin: '123456',
          notes: 'Mantenimiento preventivo e inspección de impresoras térmicas'
        }
      });

      expect(resStart.statusCode).toBe(200);
      const dataStart = JSON.parse(resStart.payload);
      expect(dataStart.success).toBe(true);
      expect(dataStart.support.active).toBe(true);
      expect(dataStart.support.startedByName).toContain('Olinelcys');
      expect(dataStart.support.bannerText).toContain('MODO SOPORTE VARONS MEDIA ACTIVO — SESIÓN AUDITADA');
      expect(dataStart.support.remainingSeconds).toBeGreaterThan(7000); // ~2 horas (7200s)

      // 2. Consultar GET /api/support/status
      const resStatus = await app.inject({
        method: 'GET',
        url: '/api/support/status'
      });
      expect(resStatus.statusCode).toBe(200);
      const dataStatus = JSON.parse(resStatus.payload);
      expect(dataStatus.support.active).toBe(true);
      expect(dataStatus.support.startedByUserId).toBe('usr_admin_olinelcys');

      // 3. Verificar persistencia en support_sessions
      const sessionRow = rawDb.prepare(`
        SELECT * FROM support_sessions WHERE id = ?
      `).get(dataStart.support.sessionId) as any;

      expect(sessionRow).toBeDefined();
      expect(sessionRow.status).toBe('ACTIVE');
      expect(sessionRow.notes).toContain('Mantenimiento preventivo');

      // 4. Verificar asiento en audit_events con cadena SHA-256
      const auditStart = rawDb.prepare(`
        SELECT * FROM audit_events WHERE action = 'SUPPORT_MODE_STARTED' AND entity_id = ?
      `).get(dataStart.support.sessionId) as any;

      expect(auditStart).toBeDefined();
      expect(auditStart.actor_user_id).toBe('usr_admin_olinelcys');

      // 5. Detener Modo Soporte inmediatamente (POST /api/support/stop)
      const resStop = await app.inject({
        method: 'POST',
        url: '/api/support/stop',
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      expect(resStop.statusCode).toBe(200);
      const dataStop = JSON.parse(resStop.payload);
      expect(dataStop.success).toBe(true);
      expect(dataStop.support.active).toBe(false);

      // 6. Verificar actualización en base de datos y auditoría de cierre
      const updatedSession = rawDb.prepare(`
        SELECT * FROM support_sessions WHERE id = ?
      `).get(dataStart.support.sessionId) as any;

      expect(updatedSession.status).toBe('ENDED');
      expect(updatedSession.ended_at_ms).toBeGreaterThan(0);

      const auditStop = rawDb.prepare(`
        SELECT * FROM audit_events WHERE action = 'SUPPORT_MODE_STOPPED' AND entity_id = ?
      `).get(dataStart.support.sessionId) as any;

      expect(auditStop).toBeDefined();
    });

  });

  // ==========================================================================
  // BLOQUE 2: MOTOR DE ACTUALIZACIONES FIRMADAS CON ED25519
  // ==========================================================================
  describe('2. Motor de Actualizaciones Firmadas Ed25519 (POST /api/updater/apply)', () => {
    // Par de claves Ed25519 para pruebas
    const testKeys = generateEd25519KeyPair();

    it('Verifica e instala correctamente un paquete firmado con Ed25519 válido', async () => {
      const targetVersion = '1.2.0';
      const fileContent = 'console.log("Release 2 - Tocineta Sonrie Local OS");';

      // 1. Crear paquete firmado válido
      const signedPackage = createSignedReleasePackage(
        targetVersion,
        'Actualización M12 - Modo Soporte y Actualizador Firmado',
        [{ path: 'dist/server.js', content: fileContent }],
        [
          {
            name: '0014_test_migration_ok.sql',
            sql: 'CREATE TABLE IF NOT EXISTS test_m12_feature (id TEXT PRIMARY KEY, title TEXT);'
          }
        ],
        testKeys.privateKeyPem
      );

      // 2. Aplicar actualización (simulando horario fuera de ventas, ej: 10:00 AM)
      const outsideSalesDate = new Date('2026-10-18T10:00:00-04:00');
      expect(isSalesHours(outsideSalesDate)).toBe(false);

      const updateResult = await applySignedUpdatePackage(
        rawDb,
        {
          manifestJson: signedPackage.manifestJson,
          signatureBase64: signedPackage.signatureBase64,
          filesData: signedPackage.filesData
        },
        {
          publicKeyPem: testKeys.publicKeyPem,
          currentDate: outsideSalesDate,
          actorUserId: 'usr_admin_olinelcys'
        }
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.version).toBe(targetVersion);
      expect(updateResult.appliedMigrationsCount).toBe(1);

      // 3. Verificar que _system_meta.version se actualizó
      const currentVer = getCurrentSystemVersion(rawDb);
      expect(currentVer).toBe(targetVersion);

      // 4. Verificar que la tabla creada por la migración existe físicamente
      const tableCheck = rawDb.prepare(`
        SELECT count(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = 'test_m12_feature'
      `).get() as { cnt: number };
      expect(tableCheck.cnt).toBe(1);

      // 5. Verificar registro en system_updates y audit_events
      const updateRow = rawDb.prepare(`
        SELECT * FROM system_updates WHERE version = ?
      `).get(targetVersion) as any;
      expect(updateRow).toBeDefined();
      expect(updateRow.status).toBe('APPLIED');

      const auditEvent = rawDb.prepare(`
        SELECT * FROM audit_events WHERE action = 'UPDATE_APPLIED_SUCCESS'
        ORDER BY created_at_ms DESC LIMIT 1
      `).get() as any;
      expect(auditEvent).toBeDefined();
    });

    it('Rechaza instantáneamente un paquete alterado o con firma Ed25519 inválida (INVALID_SIGNATURE)', async () => {
      const originalVersion = getCurrentSystemVersion(rawDb);

      // 1. Crear un paquete firmado legítimo
      const legitPackage = createSignedReleasePackage(
        '1.2.1',
        'Paquete para prueba de alteración',
        [{ path: 'dist/app.js', content: 'código original auténtico' }],
        undefined,
        testKeys.privateKeyPem
      );

      // 2. Simular ataque o archivo corrupto en pendrive: modificar un byte del manifest
      const tamperedManifest = JSON.parse(legitPackage.manifestJson);
      tamperedManifest.version = '1.2.1-hacked';
      const tamperedManifestJson = JSON.stringify(tamperedManifest);

      // 3. Intentar aplicar el paquete alterado
      await expect(
        applySignedUpdatePackage(
          rawDb,
          {
            manifestJson: tamperedManifestJson,
            signatureBase64: legitPackage.signatureBase64, // La firma no coincide con el manifest adulterado
            filesData: legitPackage.filesData
          },
          {
            publicKeyPem: testKeys.publicKeyPem,
            currentDate: new Date('2026-10-18T10:00:00-04:00')
          }
        )
      ).rejects.toThrow('INVALID_SIGNATURE');

      // 4. Verificar que en audit_events quedó asentado el rechazo del intento no autorizado
      const auditReject = rawDb.prepare(`
        SELECT * FROM audit_events WHERE action = 'UPDATE_ATTEMPT_REJECTED'
        ORDER BY created_at_ms DESC LIMIT 1
      `).get() as any;

      expect(auditReject).toBeDefined();
      expect(auditReject.payload_json).toContain('INVALID_SIGNATURE');

      // 5. La versión del sistema NO debe haber cambiado
      expect(getCurrentSystemVersion(rawDb)).toBe(originalVersion);
    });

    it('Prueba de Aceptación #23: Paquete con firma válida pero migración SQL corrupta dispara Rollback Automático dejando el sistema intacto', async () => {
      const versionBefore = getCurrentSystemVersion(rawDb);

      // 1. Crear paquete con firma Ed25519 100% válida pero con sentencia SQL inválida deliberada
      const badSqlPackage = createSignedReleasePackage(
        '1.3.0-bad-migration',
        'Paquete para certificar Rollback Automático ante fallo de SQL',
        [{ path: 'dist/index.js', content: 'console.log("good code");' }],
        [
          {
            name: '0015_broken_migration.sql',
            sql: 'SELEC * INVALID_SQL FROM non_existent_table WHERE 1 = 1;' // Error de sintaxis SQL
          }
        ],
        testKeys.privateKeyPem
      );

      // 2. Intentar aplicar el paquete
      let errorThrown: any = null;
      try {
        await applySignedUpdatePackage(
          rawDb,
          {
            manifestJson: badSqlPackage.manifestJson,
            signatureBase64: badSqlPackage.signatureBase64,
            filesData: badSqlPackage.filesData
          },
          {
            publicKeyPem: testKeys.publicKeyPem,
            currentDate: new Date('2026-10-18T10:00:00-04:00')
          }
        );
      } catch (err: any) {
        errorThrown = err;
      }

      // 3. Comprobar que abortó con AUTOMATIC_ROLLBACK_COMPLETED
      expect(errorThrown).toBeDefined();
      expect(errorThrown.code).toBe('AUTOMATIC_ROLLBACK_COMPLETED');
      expect(errorThrown.message).toContain('reversión automática total');

      // 4. CERTIFICACIÓN DE INMUTABILIDAD TRAS ROLLBACK:
      // La versión del sistema permanece intacta en su estado anterior
      const versionAfter = getCurrentSystemVersion(rawDb);
      expect(versionAfter).toBe(versionBefore);

      // 5. Verificar que no se insertó la migración rota en _migrations
      const brokenMig = rawDb.prepare("SELECT * FROM _migrations WHERE name = '0015_broken_migration.sql'").get();
      expect(brokenMig).toBeUndefined();

      // 6. Verificar registro del incidente en system_updates (FAILED_ROLLBACK) y audit_events
      const failedUpdateRecord = rawDb.prepare(`
        SELECT * FROM system_updates WHERE version = '1.3.0-bad-migration'
      `).get() as any;

      expect(failedUpdateRecord).toBeDefined();
      expect(failedUpdateRecord.status).toBe('FAILED_ROLLBACK');
      expect(failedUpdateRecord.error_details).toContain('syntax error');

      const auditRollback = rawDb.prepare(`
        SELECT * FROM audit_events WHERE action = 'UPDATE_FAILED_ROLLBACK'
        ORDER BY created_at_ms DESC LIMIT 1
      `).get() as any;

      expect(auditRollback).toBeDefined();
      expect(auditRollback.payload_json).toContain('AUTOMATIC_ROLLBACK_COMPLETED');
    });

    it('Protección de Horario de Venta: Bloquea actualizaciones entre 16:00 y 02:00 Caracas salvo desbloqueo de emergencia con PIN de Admin', async () => {
      // Hora pico de ventas: 20:30 Caracas (8:30 PM)
      const salesPeakDate = new Date('2026-10-18T20:30:00-04:00');
      expect(isSalesHours(salesPeakDate)).toBe(true);

      const pkg = createSignedReleasePackage(
        '1.2.2',
        'Prueba horario de ventas',
        [{ path: 'dist/test.js', content: 'test' }],
        undefined,
        testKeys.privateKeyPem
      );

      // 1. Intento sin forzar emergencia -> Bloqueado (403 SALES_HOURS_BLOCKED)
      await expect(
        applySignedUpdatePackage(
          rawDb,
          {
            manifestJson: pkg.manifestJson,
            signatureBase64: pkg.signatureBase64,
            filesData: pkg.filesData
          },
          {
            publicKeyPem: testKeys.publicKeyPem,
            currentDate: salesPeakDate,
            forceEmergencyUpdate: false
          }
        )
      ).rejects.toThrow('SALES_HOURS_BLOCKED');

      // 2. Intento forzando emergencia pero con PIN de Admin falso -> Bloqueado (403 PIN_ADMIN_INVALID)
      await expect(
        applySignedUpdatePackage(
          rawDb,
          {
            manifestJson: pkg.manifestJson,
            signatureBase64: pkg.signatureBase64,
            filesData: pkg.filesData
          },
          {
            publicKeyPem: testKeys.publicKeyPem,
            currentDate: salesPeakDate,
            forceEmergencyUpdate: true,
            adminPin: '000000'
          }
        )
      ).rejects.toThrow('PIN de Administrador inválido');

      // 3. Intento forzando emergencia con PIN legítimo de Admin ('123456') -> Permitido exitosamente
      const emergencyResult = await applySignedUpdatePackage(
        rawDb,
        {
          manifestJson: pkg.manifestJson,
          signatureBase64: pkg.signatureBase64,
          filesData: pkg.filesData
        },
        {
          publicKeyPem: testKeys.publicKeyPem,
          currentDate: salesPeakDate,
          forceEmergencyUpdate: true,
          adminPin: '123456',
          actorUserId: 'usr_admin_olinelcys'
        }
      );

      expect(emergencyResult.success).toBe(true);
      expect(getCurrentSystemVersion(rawDb)).toBe('1.2.2');
    });

  });

});
