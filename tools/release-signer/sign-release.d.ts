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
export declare function generateEd25519KeyPair(): Ed25519KeyPair;
/**
 * Serializa de forma determinista y canónica un objeto manifest
 */
export declare function canonicalizeManifest(manifest: ReleaseManifest): string;
/**
 * Firma un manifest con la clave privada Ed25519
 */
export declare function signManifest(manifest: ReleaseManifest, privateKeyPem: string): {
    manifestJson: string;
    signatureBase64: string;
};
/**
 * Verifica la firma Ed25519 de un manifest contra la clave pública oficial
 */
export declare function verifyManifestSignature(manifestJson: string, signatureBase64: string, publicKeyPem: string): boolean;
/**
 * Calcula el hash SHA-256 de un buffer o string
 */
export declare function computeSha256(content: Buffer | string): string;
/**
 * Crea un paquete completo firmado listo para distribución local o USB
 */
export declare function createSignedReleasePackage(version: string, description: string, filesList: Array<{
    path: string;
    content: string | Buffer;
}>, migrationsList: ReleaseMigrationEntry[] | undefined, privateKeyPem: string): SignedReleasePackage;
//# sourceMappingURL=sign-release.d.ts.map