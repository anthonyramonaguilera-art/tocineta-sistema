import * as crypto from 'node:crypto';

export interface ReleaseFileEntry {
  path: string;
  sha256: string;
}

export interface ReleaseMigrationEntry {
  name: string;
  sql: string;
}

export interface ReleaseManifest {
  version: string;
  createdAtMs: number;
  description?: string;
  files: ReleaseFileEntry[];
  migrations?: ReleaseMigrationEntry[];
}

export interface SignedReleasePackage {
  manifest: ReleaseManifest;
  manifestJson: string;
  signatureBase64: string;
  filesData?: Record<string, string>;
}

export interface Ed25519KeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

/**
 * Genera un par de claves criptográficas Ed25519 nativas con node:crypto
 */
export function generateEd25519KeyPair(): Ed25519KeyPair {
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
export function canonicalizeManifest(manifest: ReleaseManifest): string {
  const sortedFiles = [...manifest.files].sort((a, b) => a.path.localeCompare(b.path));
  const sortedMigrations = manifest.migrations
    ? [...manifest.migrations].sort((a, b) => a.name.localeCompare(b.name))
    : undefined;

  const canonicalObj: ReleaseManifest = {
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
export function signManifest(manifest: ReleaseManifest, privateKeyPem: string): {
  manifestJson: string;
  signatureBase64: string;
} {
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
export function verifyManifestSignature(
  manifestJson: string,
  signatureBase64: string,
  publicKeyPem: string
): boolean {
  try {
    const signatureBuffer = Buffer.from(signatureBase64, 'base64');
    return crypto.verify(null, Buffer.from(manifestJson, 'utf-8'), publicKeyPem, signatureBuffer);
  } catch {
    return false;
  }
}

/**
 * Calcula el hash SHA-256 de un buffer o string
 */
export function computeSha256(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Crea un paquete completo firmado listo para distribución local o USB
 */
export function createSignedReleasePackage(
  version: string,
  description: string,
  filesList: Array<{ path: string; content: string | Buffer }>,
  migrationsList: ReleaseMigrationEntry[] | undefined,
  privateKeyPem: string
): SignedReleasePackage {
  const fileEntries: ReleaseFileEntry[] = filesList.map(f => ({
    path: f.path,
    sha256: computeSha256(f.content)
  }));

  const manifest: ReleaseManifest = {
    version,
    createdAtMs: Date.now(),
    description,
    files: fileEntries,
    migrations: migrationsList
  };

  const { manifestJson, signatureBase64 } = signManifest(manifest, privateKeyPem);

  const filesData: Record<string, string> = {};
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
