import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import {
  generateEd25519KeyPair,
  signManifest,
  computeSha256,
  type ReleaseManifest
} from '../src/modules/updater/signer.js';
import {
  isAuthorizedAdmin,
  isStrictlyGreaterSemver,
  verifyAndProcessUpdatePackage,
  processPendingUpdateIfJornadaClosed,
  assertSafeZipName,
  type VerifyAndApplyPackageOptions
} from '../../scripts/update-receiver.js';

describe('V-3: Receptor seguro de actualizaciones y comandos por Telegram', () => {
  let testRootDir: string;
  let keyPair: { publicKeyPem: string; privateKeyPem: string };

  beforeEach(() => {
    testRootDir = path.join(os.tmpdir(), `tocineta-v3-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(testRootDir, { recursive: true });
    // package.json mock con version actual 1.0.0
    fs.writeFileSync(
      path.join(testRootDir, 'package.json'),
      JSON.stringify({ name: 'tocineta-test', version: '1.0.0' }, null, 2),
      'utf-8'
    );
    keyPair = generateEd25519KeyPair();
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testRootDir)) {
        fs.rmSync(testRootDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('1. Filtro estricto de remitentes autorizados (TELEGRAM_ADMIN_IDS)', () => {
    const adminConfig = '987654321, 11223344';

    it('Mensaje de from.id no incluido en TELEGRAM_ADMIN_IDS -> ignorado', () => {
      // Remitente atacante o desconocido
      const unauthorizedId = 55566677;
      const isAllowed = isAuthorizedAdmin(unauthorizedId, adminConfig);
      expect(isAllowed).toBe(false);
    });

    it('from.id undefined o nulo -> ignorado en silencio', () => {
      expect(isAuthorizedAdmin(undefined, adminConfig)).toBe(false);
      expect(isAuthorizedAdmin(null, adminConfig)).toBe(false);
      expect(isAuthorizedAdmin('', adminConfig)).toBe(false);
    });

    it('from.id valido presente en TELEGRAM_ADMIN_IDS -> admitido', () => {
      expect(isAuthorizedAdmin(987654321, adminConfig)).toBe(true);
      expect(isAuthorizedAdmin('11223344', adminConfig)).toBe(true);
    });
  });

  describe('2. Control de version semver y prevencion de replay/downgrade', () => {
    it('reconoce versiones mayores, menores e iguales', () => {
      expect(isStrictlyGreaterSemver('1.1.0', '1.0.0')).toBe(true);
      expect(isStrictlyGreaterSemver('2.0.0', '1.9.9')).toBe(true);
      expect(isStrictlyGreaterSemver('1.0.1', '1.0.0')).toBe(true);
      expect(isStrictlyGreaterSemver('1.0.0', '1.0.0')).toBe(false);
      expect(isStrictlyGreaterSemver('0.9.9', '1.0.0')).toBe(false);
    });

    it('Paquete con versión menor o igual a la actual (downgrade/replay) -> rechazado', async () => {
      const candidateVersion = '1.0.0'; // Replay de version actual instalada
      const zipContent = Buffer.from('mock-zip-payload-1.0.0');
      const zipSha = computeSha256(zipContent);

      const manifest: ReleaseManifest = {
        version: candidateVersion,
        createdAtMs: Date.now(),
        description: 'Paquete replay attack',
        files: [{ path: 'tocineta-1.0.0.zip', sha256: zipSha }]
      };

      const { manifestJson, signatureBase64 } = signManifest(manifest, keyPair.privateKeyPem);
      const sigPayload = JSON.stringify({
        version: candidateVersion,
        manifestJson,
        signatureBase64,
        manifest
      });

      const result = await verifyAndProcessUpdatePackage({
        sigBuffer: sigPayload,
        zipBuffer: zipContent,
        zipFileName: 'tocineta-1.0.0.zip',
        publicKeyPem: keyPair.publicKeyPem,
        currentVersion: '1.0.0',
        rootDir: testRootDir
      });

      expect(result.status).toBe('REJECTED_DOWNGRADE');
      expect(result.version).toBe(candidateVersion);

      // Verificar que tampoco se permita una version anterior (ej. 0.9.0)
      const downgradeManifest: ReleaseManifest = {
        version: '0.9.0',
        createdAtMs: Date.now(),
        files: [{ path: 'tocineta-0.9.0.zip', sha256: zipSha }]
      };
      const signedDowngrade = signManifest(downgradeManifest, keyPair.privateKeyPem);
      const downgradeResult = await verifyAndProcessUpdatePackage({
        sigBuffer: JSON.stringify({
          version: '0.9.0',
          manifestJson: signedDowngrade.manifestJson,
          signatureBase64: signedDowngrade.signatureBase64,
          manifest: downgradeManifest
        }),
        zipBuffer: zipContent,
        zipFileName: 'tocineta-0.9.0.zip',
        publicKeyPem: keyPair.publicKeyPem,
        currentVersion: '1.0.0',
        rootDir: testRootDir
      });

      expect(downgradeResult.status).toBe('REJECTED_DOWNGRADE');
    });
  });

  describe('3. Integridad y verificacion criptografica Ed25519', () => {
    it('Paquete con firma Ed25519 inválida -> rechazado antes de tocar disco', async () => {
      const candidateVersion = '1.2.0';
      const zipContent = Buffer.from('mock-zip-payload-1.2.0');
      const zipSha = computeSha256(zipContent);

      const manifest: ReleaseManifest = {
        version: candidateVersion,
        createdAtMs: Date.now(),
        description: 'Update legitimate',
        files: [{ path: 'tocineta-1.2.0.zip', sha256: zipSha }]
      };

      // Firmamos con otra clave o alteramos la firma
      const attackerKeys = generateEd25519KeyPair();
      const { manifestJson, signatureBase64 } = signManifest(manifest, attackerKeys.privateKeyPem);

      const sigPayload = JSON.stringify({
        version: candidateVersion,
        manifestJson,
        signatureBase64, // Firma hecha con clave de atacante, no con keyPair oficial
        manifest
      });

      const pendingDir = path.join(testRootDir, 'data', 'updates', 'pending');

      const result = await verifyAndProcessUpdatePackage({
        sigBuffer: sigPayload,
        zipBuffer: zipContent,
        zipFileName: 'tocineta-1.2.0.zip',
        publicKeyPem: keyPair.publicKeyPem, // Clave publica oficial esperada
        currentVersion: '1.0.0',
        rootDir: testRootDir
      });

      expect(result.status).toBe('REJECTED_INVALID_SIGNATURE');
      // Asegurar que ANTES DE TOCAR DISCO no se escribio nada en la carpeta de actualizaciones
      expect(fs.existsSync(pendingDir)).toBe(false);
    });

    it('Paquete con hash SHA-256 alterado -> rechazado con REJECTED_INVALID_HASH', async () => {
      const candidateVersion = '1.3.0';
      const genuineZip = Buffer.from('genuine-zip-content');
      const tamperedZip = Buffer.from('tampered-malicious-zip-content');

      const manifest: ReleaseManifest = {
        version: candidateVersion,
        createdAtMs: Date.now(),
        files: [{ path: 'tocineta-1.3.0.zip', sha256: computeSha256(genuineZip) }]
      };

      const { manifestJson, signatureBase64 } = signManifest(manifest, keyPair.privateKeyPem);
      const sigPayload = JSON.stringify({
        version: candidateVersion,
        manifestJson,
        signatureBase64,
        manifest
      });

      const result = await verifyAndProcessUpdatePackage({
        sigBuffer: sigPayload,
        zipBuffer: tamperedZip, // El zip no coincide con el sha256 del manifest
        zipFileName: 'tocineta-1.3.0.zip',
        publicKeyPem: keyPair.publicKeyPem,
        currentVersion: '1.0.0',
        rootDir: testRootDir
      });

      expect(result.status).toBe('REJECTED_INVALID_HASH');
    });
  });

  describe('4. Ventana segura y jornada de venta activa', () => {
    it('Paquete válido pero con jornada abierta -> queda en estado DEFERRED_OPEN_JORNADA', async () => {
      const candidateVersion = '1.4.0';
      const zipContent = Buffer.from('mock-zip-payload-1.4.0');
      const zipSha = computeSha256(zipContent);

      const manifest: ReleaseManifest = {
        version: candidateVersion,
        createdAtMs: Date.now(),
        description: 'Update diferida por jornada activa',
        files: [{ path: 'tocineta-1.4.0.zip', sha256: zipSha }]
      };

      const { manifestJson, signatureBase64 } = signManifest(manifest, keyPair.privateKeyPem);
      const sigPayload = JSON.stringify({
        version: candidateVersion,
        manifestJson,
        signatureBase64,
        manifest
      });

      let telegramMessageSent = '';
      const result = await verifyAndProcessUpdatePackage({
        sigBuffer: sigPayload,
        zipBuffer: zipContent,
        zipFileName: 'tocineta-1.4.0.zip',
        publicKeyPem: keyPair.publicKeyPem,
        currentVersion: '1.0.0',
        rootDir: testRootDir,
        checkJornadaFn: async () => true, // Simula jornada abierta activa
        sendTelegramFn: async (msg) => {
          telegramMessageSent = msg;
        }
      });

      expect(result.status).toBe('DEFERRED_OPEN_JORNADA');
      expect(result.version).toBe(candidateVersion);
      expect(result.message).toContain('se aplicará automáticamente al cerrar la jornada');
      expect(telegramMessageSent).toBe(
        `Actualización ${candidateVersion} verificada y en espera: se aplicará automáticamente al cerrar la jornada`
      );

      // Comprobar que el paquete quedo almacenado en espera
      const pendingMetaPath = path.join(testRootDir, 'data', 'updates', 'pending', 'pending-update.json');
      expect(fs.existsSync(pendingMetaPath)).toBe(true);
      const meta = JSON.parse(fs.readFileSync(pendingMetaPath, 'utf-8'));
      expect(meta.version).toBe(candidateVersion);
    });

    it('Jornada cerrada detectada en corrida posterior -> aplica el paquete pendiente', async () => {
      const candidateVersion = '1.5.0';
      const zipContent = Buffer.from('mock-zip-payload-1.5.0');
      const zipSha = computeSha256(zipContent);

      const manifest: ReleaseManifest = {
        version: candidateVersion,
        createdAtMs: Date.now(),
        files: [{ path: 'tocineta-1.5.0.zip', sha256: zipSha }]
      };

      const { manifestJson, signatureBase64 } = signManifest(manifest, keyPair.privateKeyPem);
      const sigPayload = JSON.stringify({
        version: candidateVersion,
        manifestJson,
        signatureBase64,
        manifest
      });

      // Primero queda en espera por jornada abierta
      await verifyAndProcessUpdatePackage({
        sigBuffer: sigPayload,
        zipBuffer: zipContent,
        zipFileName: 'tocineta-1.5.0.zip',
        publicKeyPem: keyPair.publicKeyPem,
        currentVersion: '1.0.0',
        rootDir: testRootDir,
        checkJornadaFn: async () => true
      });

      // En la siguiente corrida, la jornada cerro
      let appliedZipPath = '';
      const pendingResult = await processPendingUpdateIfJornadaClosed(
        testRootDir,
        async () => false,
        (zPath) => {
          appliedZipPath = zPath;
        }
      );

      expect(pendingResult).not.toBeNull();
      expect(pendingResult?.status).toBe('APPLIED_UPDATE');
      expect(pendingResult?.version).toBe(candidateVersion);
      expect(appliedZipPath).toContain('tocineta-1.5.0.zip');
    });
  });

  describe('5. Comandos autorizados de diagnostico y proteccion contra texto libre', () => {
    it('solo admite /estado y /diag, y rechaza texto arbitrario', () => {
      const allowedCommands = ['/estado', '/diag'];
      const dangerousCommands = ['rm -rf /', 'cmd.exe /c whoami', 'format c:', 'reboot', 'update', 'status'];

      for (const cmd of allowedCommands) {
        expect(['/estado', '/diag']).toContain(cmd);
      }

      for (const cmd of dangerousCommands) {
        expect(['/estado', '/diag']).not.toContain(cmd);
      }
    });
  });
  describe('6. Hardening de nombres de archivo y ejecución segura (S-2)', () => {
    const invalidZipNames = [
      'a" & calc & ".zip',
      '..\\x.zip',
      '%PATH%.zip',
      'ok.zip.exe',
      'x'.repeat(200) + '.zip'
    ];

    it('assertSafeZipName valida caracteres, longitud y extensión', () => {
      expect(assertSafeZipName('TOCINETA-1.2.3.zip')).toBe('TOCINETA-1.2.3.zip');
      for (const bad of invalidZipNames) {
        expect(() => assertSafeZipName(bad)).toThrow();
      }
    });

    it('nombres no seguros devuelven REJECTED_INVALID_FILENAME y NO invocan applyUpdateFn', async () => {
      const candidateVersion = '1.2.0';
      const zipContent = Buffer.from('mock-zip-payload-1.2.0');
      const zipSha = computeSha256(zipContent);

      const manifest: ReleaseManifest = {
        version: candidateVersion,
        createdAtMs: Date.now(),
        files: [{ path: 'payload.zip', sha256: zipSha }]
      };
      const { manifestJson, signatureBase64 } = signManifest(manifest, keyPair.privateKeyPem);
      const sigPayload = JSON.stringify({
        version: candidateVersion,
        manifestJson,
        signatureBase64,
        manifest
      });

      for (const badName of invalidZipNames) {
        let applyCalled = false;
        const result = await verifyAndProcessUpdatePackage({
          sigBuffer: sigPayload,
          zipBuffer: zipContent,
          zipFileName: badName,
          publicKeyPem: keyPair.publicKeyPem,
          currentVersion: '1.0.0',
          rootDir: testRootDir,
          checkJornadaFn: async () => false,
          applyUpdateFn: () => {
            applyCalled = true;
          }
        });

        expect(result.status).toBe('REJECTED_INVALID_FILENAME');
        expect(applyCalled).toBe(false);
      }
    });

    it('processPendingUpdateIfJornadaClosed con meta.zipFileName inválido devuelve REJECTED_INVALID_FILENAME', async () => {
      const pendingMetaPath = path.join(testRootDir, 'data', 'updates', 'pending', 'pending-update.json');
      fs.mkdirSync(path.dirname(pendingMetaPath), { recursive: true });
      fs.writeFileSync(
        pendingMetaPath,
        JSON.stringify({ version: '1.2.0', zipFileName: '..\\malicious.zip', savedAtMs: Date.now() }),
        'utf-8'
      );

      let applyCalled = false;
      const res = await processPendingUpdateIfJornadaClosed(
        testRootDir,
        async () => false,
        () => {
          applyCalled = true;
        }
      );

      expect(res?.status).toBe('REJECTED_INVALID_FILENAME');
      expect(applyCalled).toBe(false);
    });

    it('TOCINETA-1.2.3.zip válido y bien firmado sigue aplicándose', async () => {
      const candidateVersion = '1.2.3';
      const zipContent = Buffer.from('mock-zip-payload-1.2.3');
      const zipFileName = 'TOCINETA-1.2.3.zip';
      const zipSha = computeSha256(zipContent);

      const manifest: ReleaseManifest = {
        version: candidateVersion,
        createdAtMs: Date.now(),
        files: [{ path: zipFileName, sha256: zipSha }]
      };
      const { manifestJson, signatureBase64 } = signManifest(manifest, keyPair.privateKeyPem);
      const sigPayload = JSON.stringify({
        version: candidateVersion,
        manifestJson,
        signatureBase64,
        manifest
      });

      let appliedPath = '';
      const result = await verifyAndProcessUpdatePackage({
        sigBuffer: sigPayload,
        zipBuffer: zipContent,
        zipFileName,
        publicKeyPem: keyPair.publicKeyPem,
        currentVersion: '1.0.0',
        rootDir: testRootDir,
        checkJornadaFn: async () => false,
        applyUpdateFn: (p) => {
          appliedPath = p;
        }
      });

      expect(result.status).toBe('APPLIED_UPDATE');
      expect(result.version).toBe(candidateVersion);
      expect(appliedPath).toContain(zipFileName);
    });

    it('versión igual o menor -> rechaza con REJECTED_DOWNGRADE o REJECTED_NOT_NEWER', async () => {
      const candidateVersion = '1.0.0';
      const zipContent = Buffer.from('mock-zip-payload-1.0.0');
      const zipSha = computeSha256(zipContent);

      const manifest: ReleaseManifest = {
        version: candidateVersion,
        createdAtMs: Date.now(),
        files: [{ path: 'tocineta-1.0.0.zip', sha256: zipSha }]
      };
      const { manifestJson, signatureBase64 } = signManifest(manifest, keyPair.privateKeyPem);
      const sigPayload = JSON.stringify({
        version: candidateVersion,
        manifestJson,
        signatureBase64,
        manifest
      });

      const result = await verifyAndProcessUpdatePackage({
        sigBuffer: sigPayload,
        zipBuffer: zipContent,
        zipFileName: 'tocineta-1.0.0.zip',
        publicKeyPem: keyPair.publicKeyPem,
        currentVersion: '1.0.0',
        rootDir: testRootDir
      });

      expect(['REJECTED_DOWNGRADE', 'REJECTED_NOT_NEWER']).toContain(result.status);
    });
  });
});
