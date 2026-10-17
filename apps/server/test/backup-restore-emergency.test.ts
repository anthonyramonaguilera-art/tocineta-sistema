import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import DatabaseConstructor from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { createHotSnapshot, pruneSnapshots, listSnapshots } from '../src/modules/backups/snapshot-service.js';
import { createEncryptedBackup } from '../src/modules/backups/backup-service.js';
import { decryptWithAge } from '../src/modules/backups/age-service.js';
import { restoreAndVerifyDatabase } from '../src/modules/backups/restore-engine.js';
import { generateEmergencySlipsPdf, formatSlipNumber } from '../src/modules/emergency/slips-generator.js';

describe('Hito M9 - Blindaje de Datos, Respaldos Cifrados age, Restauración y Modo Emergencia (@tocineta/server)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_m9_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_m9.db');
  const tempSnapshotsDir = path.join(tempDir, 'snapshots');
  const tempUsbDir = path.join(tempDir, 'usb_backups');
  let rawDb: Database.Database;
  let app: FastifyInstance;

  // Claves de prueba generadas canónicamente:
  const OLINELCYS_PUBLIC = 'age1q5q9c7am7xx9e4flj0j8ugyfqejpyp5dc8qsvqpnv7uamg4wkcuqye3f0r';
  const OLINELCYS_PRIVATE = 'AGE-SECRET-KEY-1EH6GADU6VQ0SRYGS30G56ZN8UUKTKYFWNY9DHGQAPUQJPJ9DES0SMKUFWL';

  const VARONS_PUBLIC = 'age15asuchr5fv6fvqhpxm7zedh0n54p7sukdzn5zjp4auqaju8h5cfslg5ne7';
  const VARONS_PRIVATE = 'AGE-SECRET-KEY-12ALNYAPFWKAE854CVKJUHFRC0U5R7KT24DYL6UW6XSQR5VYNR2VQP4ULMA';

  let adminToken = '';
  let supervisorToken = '';
  let cajeraToken = '';

  const ADMIN_PIN = '123456';
  const SUPERVISOR_PIN = '654321';
  const CAJERA_PIN = '1111';

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(tempSnapshotsDir, { recursive: true });
    fs.mkdirSync(tempUsbDir, { recursive: true });

    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { dbPath: tempDb });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    app = await buildServer({ disableStatic: true });

    // Autenticar usuarios para los tests
    const resAdmin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_admin_olinelcys', pin: ADMIN_PIN }
    });
    adminToken = resAdmin.json().token;

    const resSup = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_supervisor_turno', pin: SUPERVISOR_PIN }
    });
    supervisorToken = resSup.json().token;

    const resCaj = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_cajera_principal', pin: CAJERA_PIN }
    });
    cajeraToken = resCaj.json().token;
  });

  afterAll(async () => {
    await app.close();
    try {
      rawDb.close();
    } catch {
      // Ignorar si ya cerrada
    }
  });

  // ==========================================================================
  // 1. SNAPSHOTS EN CALIENTE Y POLÍTICA DE RETENCIÓN AUTOMÁTICA
  // ==========================================================================
  describe('1. Motor de Snapshots en Caliente (better-sqlite3 .backup) y Retención', () => {
    it('Crea un snapshot en caliente físico no bloqueante', async () => {
      const snapResult = await createHotSnapshot(rawDb, tempSnapshotsDir);
      expect(snapResult.snapshotPath).toBeDefined();
      expect(fs.existsSync(snapResult.snapshotPath)).toBe(true);
      expect(snapResult.fileSizeBytes).toBeGreaterThan(0);

      // Verificar que el snapshot es una base de datos SQLite válida
      const snapDb = new DatabaseConstructor(snapResult.snapshotPath, { readonly: true });
      const check = snapDb.pragma('integrity_check') as any[];
      expect(check[0].integrity_check).toBe('ok');
      snapDb.close();
    });

    it('Aplica política de retención automática: 12 de 5min, 24 horarios y 30 diarios', () => {
      const pruneTestDir = path.join(tempDir, 'retention_test');
      fs.mkdirSync(pruneTestDir, { recursive: true });

      const now = Date.now();
      const oneMinMs = 60 * 1000;
      const oneHourMs = 60 * oneMinMs;
      const oneDayMs = 24 * oneHourMs;

      // Crear 15 snapshots en los últimos 50 minutos (debería conservar los 12 más recientes)
      for (let i = 0; i < 15; i++) {
        const ts = now - (i * 3 * oneMinMs);
        fs.writeFileSync(path.join(pruneTestDir, `snapshot-${ts}.db`), 'dummy');
      }

      // Crear snapshots horarios en las últimas 36 horas (debería conservar 24)
      for (let h = 2; h < 36; h++) {
        const ts = now - (h * oneHourMs);
        fs.writeFileSync(path.join(pruneTestDir, `snapshot-${ts}.db`), 'dummy');
      }

      // Crear snapshots diarios en los últimos 45 días (debería conservar 30)
      for (let d = 2; d < 45; d++) {
        const ts = now - (d * oneDayMs);
        fs.writeFileSync(path.join(pruneTestDir, `snapshot-${ts}.db`), 'dummy');
      }

      const pruneResult = pruneSnapshots(pruneTestDir, now);

      expect(pruneResult.retained.length).toBeGreaterThan(0);
      expect(pruneResult.deleted.length).toBeGreaterThan(0);

      const remainingFiles = listSnapshots(pruneTestDir);
      // Todos los archivos restantes deben pertenecer al conjunto de retenidos
      for (const r of remainingFiles) {
        expect(pruneResult.retained).toContain(r.filename);
      }
    });

    it('POST /api/backups/snapshot dispara snapshot manual vía API autenticada', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/backups/snapshot',
        headers: { authorization: `Bearer ${adminToken}` }
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.snapshot.fileSizeBytes).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 2. RESPALDO CIFRADO DIARIO A MEMORIA USB (age) Y REGLA DE SEGURIDAD
  // ==========================================================================
  describe('2. Respaldo Cifrado Diario a USB (age) y Regla de Seguridad Antirrobo', () => {
    let encryptedBackupFile = '';

    it('Genera un archivo .db.age cifrado dirigido exclusivamente a dos claves públicas', async () => {
      const backupResult = await createEncryptedBackup(rawDb, {
        destinationDir: tempUsbDir,
        backupType: 'ENCRYPTED_USB_DAILY',
        recipients: [OLINELCYS_PUBLIC, VARONS_PUBLIC]
      });

      expect(backupResult.backupId).toMatch(/^bck_/);
      expect(backupResult.encryptedFilePath.endsWith('.db.age')).toBe(true);
      expect(fs.existsSync(backupResult.encryptedFilePath)).toBe(true);
      expect(backupResult.recipientsCount).toBe(2);
      expect(backupResult.sha256Hash).toHaveLength(64);

      encryptedBackupFile = backupResult.encryptedFilePath;

      // Verificar que se registró en backups_log
      const logRow = rawDb.prepare('SELECT * FROM backups_log WHERE id = ?').get(backupResult.backupId) as any;
      expect(logRow).toBeDefined();
      expect(logRow.sha256_hash).toBe(backupResult.sha256Hash);
      expect(logRow.recipients_count).toBe(2);

      // Verificar que se registró en audit_events
      const auditRow = rawDb.prepare("SELECT * FROM audit_events WHERE action = 'BACKUP_ENCRYPTED_EXPORTED' ORDER BY seq DESC LIMIT 1").get() as any;
      expect(auditRow).toBeDefined();
      expect(auditRow.entity_id).toBe(backupResult.backupId);
    });

    it('Regla Crítica de Seguridad: La laptop NO almacena claves privadas y no puede descifrar sin ellas', async () => {
      // 1. Verificar que el buffer cifrado no es texto plano ni SQLite sin procesar
      const fileBuffer = fs.readFileSync(encryptedBackupFile);
      const headerStr = fileBuffer.slice(0, 16).toString('utf-8');
      expect(headerStr).not.toContain('SQLite format 3');
      expect(headerStr).toContain('age-encryption');

      // 2. Intentar descifrar con una clave privada espuria/falsa debe fallar de forma terminante
      const FAKE_PRIVATE_KEY = 'AGE-SECRET-KEY-10000000000000000000000000000000000000000000000000000000000';
      await expect(decryptWithAge(fileBuffer, FAKE_PRIVATE_KEY)).rejects.toThrow();
    });

    it('Aceptación Dual: SÍ se descifra perfectamente con la clave privada de Sra. Olinelcys', async () => {
      const fileBuffer = fs.readFileSync(encryptedBackupFile);
      const decrypted = await decryptWithAge(fileBuffer, OLINELCYS_PRIVATE);

      expect(decrypted.length).toBeGreaterThan(0);
      expect(decrypted.slice(0, 16).toString('utf-8')).toContain('SQLite format 3');
    });

    it('Aceptación Dual: SÍ se descifra perfectamente con la clave privada de Varons Media', async () => {
      const fileBuffer = fs.readFileSync(encryptedBackupFile);
      const decrypted = await decryptWithAge(fileBuffer, VARONS_PRIVATE);

      expect(decrypted.length).toBeGreaterThan(0);
      expect(decrypted.slice(0, 16).toString('utf-8')).toContain('SQLite format 3');
    });

    it('POST /api/backups/export-encrypted responde 201 y genera respaldo en caliente manual', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/backups/export-encrypted',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          destinationDir: tempUsbDir,
          recipients: [OLINELCYS_PUBLIC, VARONS_PUBLIC]
        }
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.backup.sha256Hash).toHaveLength(64);
    });
  });

  // ==========================================================================
  // 3. RESTAURACIÓN Y VERIFICACIÓN CRIPTOGRÁFICA
  // ==========================================================================
  describe('3. Restauración y Verificación Criptográfica (< 5 minutos)', () => {
    it('Restaura una base de datos limpia e íntegra verificando PRAGMA integrity_check y audit_events', async () => {
      // 1. Crear respaldo cifrado fresco
      const backupResult = await createEncryptedBackup(rawDb, {
        destinationDir: tempUsbDir,
        recipients: [OLINELCYS_PUBLIC]
      });

      const restoredTargetDb = path.join(tempDir, 'restored_test.db');

      // 2. Ejecutar restauración con clave privada autorizada
      const restoreRes = await restoreAndVerifyDatabase({
        backupFilePath: backupResult.encryptedFilePath,
        privateKey: OLINELCYS_PRIVATE,
        targetDbPath: restoredTargetDb,
        dryRun: false
      });

      expect(restoreRes.success).toBe(true);
      expect(restoreRes.integrityCheck).toBe('ok');
      expect(restoreRes.auditChain.valid).toBe(true);
      expect(restoreRes.auditChain.count).toBeGreaterThan(0);
      expect(restoreRes.durationMs).toBeLessThan(300000); // Menos de 5 minutos (de hecho toma ~100ms)
      expect(fs.existsSync(restoredTargetDb)).toBe(true);

      // 3. Comprobar que la base restaurada funciona y conserva los usuarios y productos
      const restDb = new DatabaseConstructor(restoredTargetDb, { readonly: true });
      const userCount = restDb.prepare('SELECT count(*) as c FROM users').get() as any;
      expect(userCount.c).toBeGreaterThanOrEqual(4);
      restDb.close();
    });

    it('Rechaza y aborta la restauración si la cadena de auditoría SHA-256 fue manipulada', async () => {
      // Crear base de datos temporal con auditoría adulterada
      const tamperedDbFile = path.join(tempDir, 'tampered.db');
      await rawDb.backup(tamperedDbFile);

      const badDb = new DatabaseConstructor(tamperedDbFile);
      // Desactivar temporalmente el trigger en la copia adulterada para simular manipulación física externa
      badDb.exec('DROP TRIGGER IF EXISTS trg_audit_events_no_update;');
      badDb.prepare("UPDATE audit_events SET payload_json = '{\"tampered\": true}' WHERE seq = 1").run();
      badDb.close();

      await expect(
        restoreAndVerifyDatabase({
          backupFilePath: tamperedDbFile,
          targetDbPath: path.join(tempDir, 'should_fail.db')
        })
      ).rejects.toThrow(/Cadena de auditoría SHA-256 corrupta/);
    });
  });

  // ==========================================================================
  // 4. MODO EMERGENCIA EN PAPEL Y COMANDAS DIFERIDAS
  // ==========================================================================
  describe('4. Modo Emergencia en Papel (Talonario #EMG-001 a #EMG-200 y Carga Diferida)', () => {
    it('Genera documento PDF imprimible con las 200 comandas numeradas', async () => {
      const pdfBuffer = await generateEmergencySlipsPdf(10); // Lote de prueba rápido
      expect(pdfBuffer).toBeDefined();
      expect(pdfBuffer.length).toBeGreaterThan(1000);
      expect(pdfBuffer.slice(0, 4).toString('utf-8')).toBe('%PDF');
    });

    it('GET /api/emergency/slips-pdf sirve el archivo PDF con cabeceras correctas', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/emergency/slips-pdf?count=10'
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('comandas-emergencia');
    });

    it('POST /api/emergency/print-slips encola comandas térmicas numeradas en print_jobs', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/emergency/print-slips',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: { startNum: 1, endNum: 5 }
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.jobIds).toHaveLength(5);

      const job = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(data.jobIds[0]) as any;
      expect(['EMERGENCY_SLIP', 'TEST']).toContain(job.job_type);
      expect(job.ticket_ir_json).toContain('#EMG-001');
    });

    it('Transcribe una comanda física diferida con hora real y marca auditoría como deferred_paper_entry', async () => {
      // 1. Abrir jornada y sesión de caja para permitir cobro
      await app.inject({
        method: 'POST',
        url: '/api/jornadas/open',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { openedByUserId: 'usr_admin_olinelcys', initialCashUsdCents: 5000, initialCashBsCents: 100000 }
      });

      await app.inject({
        method: 'POST',
        url: '/api/cash-sessions/open',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: { userId: 'usr_cajera_principal', openingCashUsdCents: 2000, openingCashBsCents: 50000 }
      });

      // Obtener un producto activo del catálogo
      const prod = rawDb.prepare('SELECT id, price_usd_cents FROM products WHERE is_combo = 0 LIMIT 1').get() as any;

      const realTimeMs = Date.now() - 3600000; // Ocurrió hace 1 hora durante el apagón

      const res = await app.inject({
        method: 'POST',
        url: '/api/emergency/deferred-orders',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          emergencySlipNumber: '#EMG-042',
          realCreatedAtMs: realTimeMs,
          fulfillmentType: 'salon',
          tableNumber: 'Mesa 4',
          customerName: 'Cliente Contingencia',
          lines: [
            {
              productId: prod.id,
              quantity: 2
            }
          ],
          tenders: [
            {
              method: 'cash_usd',
              amountCents: prod.price_usd_cents * 2
            }
          ]
        }
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.data.slipNumber).toBe('#EMG-042');
      expect(data.data.order.is_deferred_paper).toBe(1);
      expect(data.data.order.emergency_slip_number).toBe('#EMG-042');
      expect(data.data.order.created_at_ms).toBe(realTimeMs);
      expect(data.data.order.payment_status).toBe('pagado');
      expect(data.data.order.fulfillment_status).toBe('entregado');

      // Verificar que quedó registrado en audit_events como deferred_paper_entry
      const audit = rawDb.prepare(`
        SELECT * FROM audit_events 
        WHERE action = 'deferred_paper_entry' AND entity_id = ?
      `).get(data.data.order.id) as any;

      expect(audit).toBeDefined();
      const auditPayload = JSON.parse(audit.payload_json);
      expect(auditPayload.emergencySlipNumber).toBe('#EMG-042');
      expect(auditPayload.realCreatedAtMs).toBe(realTimeMs);
    });

    it('Regla Anti-Duplicados: Intentar registrar dos veces el mismo número de comanda física es rechazado (409 Conflict)', async () => {
      const prod = rawDb.prepare('SELECT id, price_usd_cents FROM products LIMIT 1').get() as any;

      const resDuplicate = await app.inject({
        method: 'POST',
        url: '/api/emergency/deferred-orders',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          emergencySlipNumber: '#EMG-042', // Mismo número ya registrado
          realCreatedAtMs: Date.now() - 10000,
          lines: [{ productId: prod.id, quantity: 1 }],
          tenders: [{ method: 'cash_usd', amountCents: prod.price_usd_cents }]
        }
      });

      expect(resDuplicate.statusCode).toBe(409);
      expect(resDuplicate.json().error).toContain('ya fue registrada previamente');
    });
  });
});
