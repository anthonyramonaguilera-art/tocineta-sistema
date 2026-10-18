import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateEd25519KeyPair,
  canonicalizeManifest,
  signManifest,
  verifyManifestSignature,
  computeSha256,
  createSignedReleasePackage,
  type ReleaseFileEntry,
  type ReleaseMigrationEntry,
  type ReleaseManifest,
  type SignedReleasePackage,
  type Ed25519KeyPair
} from '../../apps/server/src/modules/updater/signer.js';

export {
  generateEd25519KeyPair,
  canonicalizeManifest,
  signManifest,
  verifyManifestSignature,
  computeSha256,
  createSignedReleasePackage,
  type ReleaseFileEntry,
  type ReleaseMigrationEntry,
  type ReleaseManifest,
  type SignedReleasePackage,
  type Ed25519KeyPair
};

// ----------------------------------------------------------------------------
// CLI RUNNER
// ----------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const command = process.argv[2];

  if (command === 'generate-keys') {
    const keys = generateEd25519KeyPair();
    console.log('=== CLAVE PÚBLICA VARONS MEDIA (Ed25519 SPKI PEM) ===');
    console.log(keys.publicKeyPem);
    console.log('=== CLAVE PRIVADA DE FIRMA (Ed25519 PKCS8 PEM - GUARDAR EN BÓVEDA SEGURA) ===');
    console.log(keys.privateKeyPem);
  } else {
    console.log('Uso: npx tsx tools/release-signer/sign-release.ts generate-keys');
  }
}
