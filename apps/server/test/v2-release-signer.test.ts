import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import {
  signManifest,
  generateEd25519KeyPair,
  type ReleaseManifest
} from '../src/modules/updater/signer.js';
import { verifyReleaseSignature } from '../../scripts/release.mjs';

describe('V-2: Firma digital de release Ed25519 y versión unificada', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({ disableStatic: true });
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Ed25519 Signer & verifyReleaseSignature', () => {
    it('genera claves en memoria, firma manifiesto y verifyReleaseSignature aprueba', () => {
      const { publicKeyPem, privateKeyPem } = generateEd25519KeyPair();

      const sampleManifest: ReleaseManifest = {
        version: '1.0.0',
        createdAtMs: Date.now(),
        description: 'Test release manifest',
        files: [
          { path: 'apps/server/dist/index.js', sha256: crypto.createHash('sha256').update('console.log(1);').digest('hex') },
          { path: 'package.json', sha256: crypto.createHash('sha256').update('{"version":"1.0.0"}').digest('hex') }
        ],
        migrations: [
          { name: '0001_initial.sql', sql: 'CREATE TABLE test (id TEXT PRIMARY KEY);' }
        ]
      };

      const { signatureBase64, manifestJson } = signManifest(sampleManifest, privateKeyPem);

      // Verificación con objeto manifest
      const isValidObj = verifyReleaseSignature(sampleManifest, signatureBase64, publicKeyPem);
      expect(isValidObj).toBe(true);

      // Verificación con JSON canónico
      const isValidJson = verifyReleaseSignature(manifestJson, signatureBase64, publicKeyPem);
      expect(isValidJson).toBe(true);
    });

    it('altera 1 byte de un hash en el manifiesto -> la verificación falla', () => {
      const { publicKeyPem, privateKeyPem } = generateEd25519KeyPair();

      const originalHash = crypto.createHash('sha256').update('file content').digest('hex');
      const sampleManifest: ReleaseManifest = {
        version: '1.0.0',
        createdAtMs: Date.now(),
        files: [
          { path: 'apps/server/dist/index.js', sha256: originalHash }
        ]
      };

      const { signatureBase64 } = signManifest(sampleManifest, privateKeyPem);

      // Alterar exactamente 1 byte (carácter hex) del hash
      const alteredLastChar = originalHash.slice(-1) === 'a' ? 'b' : 'a';
      const alteredHash = originalHash.slice(0, -1) + alteredLastChar;

      const alteredManifest: ReleaseManifest = {
        ...sampleManifest,
        files: [
          { path: 'apps/server/dist/index.js', sha256: alteredHash }
        ]
      };

      const isValidAltered = verifyReleaseSignature(alteredManifest, signatureBase64, publicKeyPem);
      expect(isValidAltered).toBe(false);
    });
  });

  describe('Endpoint GET /api/updater/version', () => {
    it('devuelve "1.0.0" leyendo el package.json raíz con getProjectRoot()', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/updater/version'
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.success).toBe(true);
      expect(data.version).toBe('1.0.0');
    });
  });
});
