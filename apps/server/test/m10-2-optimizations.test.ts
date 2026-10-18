import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
import { buildServer } from '../src/server.js';
import { runMigrations } from '../src/db/migrate.js';
import { appendAuditEvent } from '../src/modules/audit/audit-service.js';
import {
  detectUsbVault,
  executeDryRunVerification,
  createEncryptedBackup
} from '../src/modules/backups/backup-service.js';
import { archiveOldEventsAndPurgeIdempotency } from '../src/modules/closures/closures-service.js';
import type { FastifyInstance } from 'fastify';

describe('Hito M10.2 - Optimizaciones Operativas (SUG-01 a SUG-05)', () => {
  let app: FastifyInstance;
  const testDir = path.resolve(process.cwd(), './data/test-m10-2');

  beforeAll(async () => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    app = await buildServer({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {
      // Ignorar error de limpieza
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. SUG-02: Detección de USB con marcador .tocineta-usb-vault y espacio > 85%
  // ───────────────────────────────────────────────────────────────────────────
  describe('SUG-02: Autodetección de Bóveda USB (.tocineta-usb-vault)', () => {
    it('detecta .tocineta-usb-vault, elige la más reciente cuando hay 2 candidatos y alerta >85%', () => {
      const usbRootA = path.join(testDir, 'drive-A');
      const usbRootB = path.join(testDir, 'drive-B');
      const usbRootC = path.join(testDir, 'drive-C-sin-marcador');

      fs.mkdirSync(usbRootA, { recursive: true });
      fs.mkdirSync(usbRootB, { recursive: true });
      fs.mkdirSync(usbRootC, { recursive: true });

      // Marcar A y B con el marcador oficial
      fs.writeFileSync(path.join(usbRootA, '.tocineta-usb-vault'), 'TOCINETA_VAULT_A');
      fs.writeFileSync(path.join(usbRootB, '.tocineta-usb-vault'), 'TOCINETA_VAULT_B');

      // En A, respaldo antiguo (mtime anterior)
      const fileA = path.join(usbRootA, 'tocineta-backup-1000.db.age');
      fs.writeFileSync(fileA, 'BACKUP_A');
      const oldTime = new Date('2026-01-01T00:00:00Z');
      fs.utimesSync(fileA, oldTime, oldTime);

      // En B, respaldo reciente (mtime posterior)
      const fileB = path.join(usbRootB, 'tocineta-backup-2000.db.age');
      fs.writeFileSync(fileB, 'BACKUP_B');
      const newTime = new Date('2026-10-17T20:00:00Z');
      fs.utimesSync(fileB, newTime, newTime);

      // 1. Detección entre A y B: B debe ser seleccionada por tener el respaldo más reciente
      const detectionAB = detectUsbVault([usbRootA, usbRootB]);
      expect(detectionAB.detected).toBe(true);
      expect(detectionAB.vaultPath).toBe(usbRootB);
      expect(detectionAB.isContingency).toBe(false);

      // 2. Detección cuando solo está C (sin marcador): debe caer en contingencia local
      const detectionC = detectUsbVault([usbRootC]);
      expect(detectionC.detected).toBe(false);
      expect(detectionC.isContingency).toBe(true);
      expect(detectionC.vaultPath).toContain(path.normalize('data/backups/usb'));

      // 3. Alerta de capacidad > 85%
      const mockStatfs90 = () => ({
        bsize: 4096,
        blocks: 1000,
        bfree: 100 // 10% libre = 90% ocupado (>85%)
      });

      const warningDetection = detectUsbVault([usbRootB], mockStatfs90);
      expect(warningDetection.warning).toBe('Memoria USB al >85% de capacidad');
      expect(warningDetection.percentUsed).toBe(90);
      expect(warningDetection.percentFree).toBe(10);

      // Simular 50% de uso (50% libre) -> Sin advertencia
      const mockStatfs50 = () => ({
        bsize: 4096,
        blocks: 1000,
        bfree: 500
      });
      const normalDetection = detectUsbVault([usbRootB], mockStatfs50);
      expect(normalDetection.warning).toBeUndefined();
      expect(normalDetection.percentUsed).toBe(50);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. SUG-03: Simulacro Automático de Restauración (Dry-Run)
  // ───────────────────────────────────────────────────────────────────────────
  describe('SUG-03: Simulacro Dry-Run de Restauración', () => {
    it('valida integridad y cadena SHA-256 en solo lectura sin bloquear ni alterar la DB activa', async () => {
      const snapDir = path.join(testDir, 'snapshots-dryrun');
      fs.mkdirSync(snapDir, { recursive: true });

      // Crear base de datos de snapshot de prueba con cadena de auditoría válida
      const snapDbPath = path.join(snapDir, 'pre-migrate-test-dryrun.db');
      const tempDb = new DatabaseConstructor(snapDbPath);
      await runMigrations(tempDb);

      appendAuditEvent(tempDb, {
        actorUserId: null,
        action: 'TEST_AUDIT_1',
        entityType: 'order',
        entityId: 'ord_1',
        payload: { test: true }
      });
      appendAuditEvent(tempDb, {
        actorUserId: null,
        action: 'TEST_AUDIT_2',
        entityType: 'order',
        entityId: 'ord_2',
        payload: { test: true }
      });
      tempDb.close();

      const statBefore = fs.statSync(snapDbPath);

      // Ejecutar verificación Dry-Run directa
      const dryRunRes = await executeDryRunVerification(snapDir);
      expect(dryRunRes.status).toBe('OK');
      expect(dryRunRes.snapshotVerified).toBe('pre-migrate-test-dryrun.db');
      expect(dryRunRes.auditChainValid).toBe(true);
      expect(dryRunRes.auditCount).toBe(2);

      // Comprobar que el archivo físico NO fue modificado (solo lectura)
      const statAfter = fs.statSync(snapDbPath);
      expect(statAfter.size).toBe(statBefore.size);
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);

      // Probar a través del endpoint HTTP POST /api/backups/dry-run-verify
      const response = await app.inject({
        method: 'POST',
        url: '/api/backups/dry-run-verify'
      });
      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(['OK', 'NO_SNAPSHOT']).toContain(json.status);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. SUG-04: Archivado Seguro de events_log y Purga de idempotency_keys
  // ───────────────────────────────────────────────────────────────────────────
  describe('SUG-04: Archivado Seguro de Eventos y Purga de Idempotencia', () => {
    it('mueve eventos > 30 días a events_log_archive preservando los últimos 1.000 activos y purga idempotency expiradas', async () => {
      const archiveDbPath = path.join(testDir, `test-archive-${Date.now()}.db`);
      const rawDb = new DatabaseConstructor(archiveDbPath);
      await runMigrations(rawDb);

      const now = Date.now();
      const fortyDaysAgo = now - (40 * 24 * 60 * 60 * 1000);
      const thirtyFiveDaysAgo = now - (35 * 24 * 60 * 60 * 1000);
      const fiveHoursAgo = now - (5 * 60 * 60 * 1000);

      // 1. Insertar claves de idempotencia: 1 expirada y 1 vigente
      rawDb.prepare(`
        INSERT INTO idempotency_keys (
          idempotency_key, method, route, request_hash, status_code, response_json, created_at_ms, expires_at_ms
        ) VALUES 
          ('key_expired', 'POST', '/api/orders', 'hash1', 200, '{}', ?, ?),
          ('key_valid', 'POST', '/api/orders', 'hash2', 200, '{}', ?, ?)
      `).run(fortyDaysAgo, now - 10000, now - 1000, now + 60000);

      // 2. Insertar 1.200 eventos en events_log:
      // - 100 eventos con 40 días de antigüedad (> 30 días)
      // - 100 eventos con 35 días de antigüedad (> 30 días)
      // - 1.000 eventos recientes (5 horas atrás)
      const insertEvent = rawDb.prepare(`
        INSERT INTO events_log (event_type, entity_id, payload_json, created_at_ms)
        VALUES (?, ?, ?, ?)
      `);

      const insertMany = rawDb.transaction(() => {
        for (let i = 0; i < 100; i++) {
          insertEvent.run('ORDER_OLD_40D', `ent_40_${i}`, JSON.stringify({ i }), fortyDaysAgo);
        }
        for (let i = 0; i < 100; i++) {
          insertEvent.run('ORDER_OLD_35D', `ent_35_${i}`, JSON.stringify({ i }), thirtyFiveDaysAgo);
        }
        for (let i = 0; i < 1000; i++) {
          insertEvent.run('ORDER_RECENT', `ent_recent_${i}`, JSON.stringify({ i }), fiveHoursAgo);
        }
      });
      insertMany();

      const totalBefore = rawDb.prepare('SELECT count(*) as cnt FROM events_log').get() as { cnt: number };
      expect(totalBefore.cnt).toBe(1200);

      // 3. Ejecutar archivado
      const result = archiveOldEventsAndPurgeIdempotency(rawDb, now);

      // Validar purga de idempotency
      expect(result.purgedIdempotencyKeys).toBe(1);
      const remainingKeys = rawDb.prepare('SELECT idempotency_key FROM idempotency_keys').all() as any[];
      expect(remainingKeys.length).toBe(1);
      expect(remainingKeys[0].idempotency_key).toBe('key_valid');

      // Validar regla de oro: exactamente 1.000 eventos activos en events_log
      expect(result.remainingEventsCount).toBe(1000);
      expect(result.archivedEventsCount).toBe(200);

      const activeEvents = rawDb.prepare('SELECT count(*) as cnt FROM events_log').get() as { cnt: number };
      expect(activeEvents.cnt).toBe(1000);

      const archivedEvents = rawDb.prepare('SELECT count(*) as cnt FROM events_log_archive').get() as { cnt: number };
      expect(archivedEvents.cnt).toBe(200);

      // 4. Caso borde: Base de datos con menos de 1.000 eventos
      // Aunque todos tengan 50 días de antigüedad, NINGUNO debe ser archivado
      // para garantizar reconexión móvil continua por WebSocket (?since=<seq>).
      const smallDbPath = path.join(testDir, `test-small-archive-${Date.now()}.db`);
      const smallDb = new DatabaseConstructor(smallDbPath);
      await runMigrations(smallDb);

      const insertSmall = smallDb.transaction(() => {
        for (let i = 0; i < 400; i++) {
          smallDb.prepare(`
            INSERT INTO events_log (event_type, entity_id, payload_json, created_at_ms)
            VALUES (?, ?, ?, ?)
          `).run('ORDER_OLD', `small_${i}`, '{}', fortyDaysAgo);
        }
      });
      insertSmall();

      const smallResult = archiveOldEventsAndPurgeIdempotency(smallDb, now);
      expect(smallResult.archivedEventsCount).toBe(0);
      expect(smallResult.remainingEventsCount).toBe(400);

      const smallActive = smallDb.prepare('SELECT count(*) as cnt FROM events_log').get() as { cnt: number };
      expect(smallActive.cnt).toBe(400);

      rawDb.close();
      smallDb.close();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. SUG-05: Integración de Estado de Custodia en Salud del Sistema
  // ───────────────────────────────────────────────────────────────────────────
  describe('SUG-05: Estado de Custodia en GET /api/system-health', () => {
    it('devuelve estado del último Dry-Run, estado USB Vault y custodia de claves age', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/system-health'
      });
      expect(response.statusCode).toBe(200);
      const json = response.json();

      // Verificar sección Dry-Run
      expect(json.dryRun).toBeDefined();
      expect(typeof json.dryRun.status).toBe('string');

      // Verificar sección USB Vault
      expect(json.usbVault).toBeDefined();
      expect(typeof json.usbVault.connected).toBe('boolean');

      // Verificar sección Age Keys
      expect(json.ageKeys).toBeDefined();
      expect(['PRODUCTION', 'DEVELOPMENT']).toContain(json.ageKeys.mode);
      expect(typeof json.ageKeys.isProduction).toBe('boolean');
      expect(json.ageKeys.recipientsCount).toBeGreaterThanOrEqual(2);
    });
  });
});
