import * as crypto from 'node:crypto';
import * as path from 'node:path';
/**
 * Genera un par de claves criptográficas Ed25519 nativas con node:crypto
 */
export function generateEd25519KeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
        }
    });
    return {
        publicKeyPem: publicKey,
        privateKeyPem: privateKey
    };
}
/**
 * Serializa de forma determinista y canónica un objeto manifest
 */
export function canonicalizeManifest(manifest) {
    // Ordenar files por path alfabéticamente
    const sortedFiles = [...manifest.files].sort((a, b) => a.path.localeCompare(b.path));
    const sortedMigrations = manifest.migrations
        ? [...manifest.migrations].sort((a, b) => a.name.localeCompare(b.name))
        : undefined;
    const canonicalObj = {
        version: manifest.version,
        createdAtMs: manifest.createdAtMs,
        ...(manifest.description ? { description: manifest.description } : {}),
        files: sortedFiles,
        ...(sortedMigrations ? { migrations: sortedMigrations } : {})
    };
    return JSON.stringify(canonicalObj, null, 2);
}
/**
 * Firma un manifest con la clave privada Ed25519
 */
export function signManifest(manifest, privateKeyPem) {
    const manifestJson = canonicalizeManifest(manifest);
    const signatureBuffer = crypto.sign(null, Buffer.from(manifestJson, 'utf-8'), privateKeyPem);
    return {
        manifestJson,
        signatureBase64: signatureBuffer.toString('base64')
    };
}
/**
 * Verifica la firma Ed25519 de un manifest contra la clave pública oficial
 */
export function verifyManifestSignature(manifestJson, signatureBase64, publicKeyPem) {
    try {
        const signatureBuffer = Buffer.from(signatureBase64, 'base64');
        return crypto.verify(null, Buffer.from(manifestJson, 'utf-8'), publicKeyPem, signatureBuffer);
    }
    catch {
        return false;
    }
}
/**
 * Calcula el hash SHA-256 de un buffer o string
 */
export function computeSha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}
/**
 * Crea un paquete completo firmado listo para distribución local o USB
 */
export function createSignedReleasePackage(version, description, filesList, migrationsList, privateKeyPem) {
    const fileEntries = filesList.map(f => ({
        path: f.path,
        sha256: computeSha256(f.content)
    }));
    const manifest = {
        version,
        createdAtMs: Date.now(),
        description,
        files: fileEntries,
        migrations: migrationsList
    };
    const { manifestJson, signatureBase64 } = signManifest(manifest, privateKeyPem);
    const filesData = {};
    for (const f of filesList) {
        filesData[f.path] = Buffer.isBuffer(f.content) ? f.content.toString('utf-8') : f.content;
    }
    return {
        manifest,
        manifestJson,
        signatureBase64,
        filesData
    };
}
import { fileURLToPath } from 'node:url';
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
    }
    else {
        console.log('Uso: npx tsx tools/release-signer/sign-release.ts generate-keys');
    }
}
//# sourceMappingURL=sign-release.js.map