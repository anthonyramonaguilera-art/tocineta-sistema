#!/usr/bin/env node
/**
 * SISTEMA OPERATIVO LOCAL TOCINETA
 * Empaquetador Oficial de Actualizaciones Firmadas (release.mjs)
 *
 * Crea el paquete tocineta-X.Y.Z.zip y su firma digital Ed25519 tocineta-X.Y.Z.sig.
 * Límite estricto de tamaño: < 19 MB (para transporte vía bot de Telegram).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..');

export function computeSha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function canonicalizeManifest(manifest) {
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

export function signManifest(manifest, privateKeyPem) {
  const manifestJson = canonicalizeManifest(manifest);
  const signatureBuffer = crypto.sign(null, Buffer.from(manifestJson, 'utf-8'), privateKeyPem);
  return {
    manifestJson,
    signatureBase64: signatureBuffer.toString('base64')
  };
}

export function verifyManifestSignature(manifestJson, signatureBase64, publicKeyPem) {
  try {
    const signatureBuffer = Buffer.from(signatureBase64, 'base64');
    return crypto.verify(null, Buffer.from(manifestJson, 'utf-8'), publicKeyPem, signatureBuffer);
  } catch {
    return false;
  }
}

export function verifyReleaseSignature(manifest, signatureBase64, publicKeyPem) {
  const manifestJson = typeof manifest === 'string' ? manifest : canonicalizeManifest(manifest);
  return verifyManifestSignature(manifestJson, signatureBase64, publicKeyPem);
}

function copyFileSafe(src, dest) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(src, dest);
}

function copyDirSafe(src, dest) {
  if (!fs.existsSync(src)) return;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'data' || entry.name === '.git') {
        continue;
      }
      copyDirSafe(srcPath, destPath);
    } else {
      if (
        entry.name.startsWith('.env') ||
        entry.name.endsWith('.db') ||
        entry.name.endsWith('.db-wal') ||
        entry.name.endsWith('.db-shm') ||
        entry.name.endsWith('.log') ||
        entry.name.endsWith('.tmp')
      ) {
        continue;
      }
      copyFileSafe(srcPath, destPath);
    }
  }
}

function getAllFiles(dir, baseDir = dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results.push(...getAllFiles(fullPath, baseDir));
    } else {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      results.push({ fullPath, relPath });
    }
  }
  return results;
}

export function packageRelease(options = {}) {
  const rootDir = options.rootDir || PROJECT_ROOT;
  const skipGitCheck = options.skipGitCheck || process.env.SKIP_GIT_CHECK === 'true';
  const skipBuild = options.skipBuild || false;
  const outputDir = options.outputDir || rootDir;

  const pkgJsonPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
  const version = options.version || pkg.version;

  // 1. Verificación git status
  if (!skipGitCheck) {
    console.log('Verificando estado del repositorio Git...');
    const status = execSync('git status --porcelain', { cwd: rootDir, encoding: 'utf-8' }).trim();
    if (status) {
      throw new Error(`El repositorio tiene cambios pendientes sin commitear:\n${status}`);
    }
  }

  // 2. Ejecutar validaciones y compilación
  if (!skipBuild) {
    console.log('\n[1/3] Ejecutando pnpm run guard...');
    execSync('pnpm run guard', { cwd: rootDir, stdio: 'inherit' });

    console.log('\n[2/3] Ejecutando linter del servidor...');
    execSync('pnpm --filter @tocineta/server run lint', { cwd: rootDir, stdio: 'inherit' });

    console.log('\n[3/3] Compilando monorepo para producción...');
    execSync('pnpm -r run build', { cwd: rootDir, stdio: 'inherit' });
  }

  // 3. Crear área de preparación (stage)
  const stageDir = path.join(os.tmpdir(), `tocineta-stage-${version}-${Date.now()}`);
  if (fs.existsSync(stageDir)) {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stageDir, { recursive: true });

  try {
    console.log(`\nPreparando artefactos de ejecución para versión ${version}...`);

    // Artefactos permitidos:
    // apps/server/dist
    copyDirSafe(path.join(rootDir, 'apps', 'server', 'dist'), path.join(stageDir, 'apps', 'server', 'dist'));
    // apps/web/dist
    copyDirSafe(path.join(rootDir, 'apps', 'web', 'dist'), path.join(stageDir, 'apps', 'web', 'dist'));
    // apps/server/src/db/migrations
    copyDirSafe(
      path.join(rootDir, 'apps', 'server', 'src', 'db', 'migrations'),
      path.join(stageDir, 'apps', 'server', 'src', 'db', 'migrations')
    );
    // scripts
    copyDirSafe(path.join(rootDir, 'scripts'), path.join(stageDir, 'scripts'));
    // package.json
    copyFileSafe(path.join(rootDir, 'package.json'), path.join(stageDir, 'package.json'));
    // pnpm-lock.yaml
    const lockfile = path.join(rootDir, 'pnpm-lock.yaml');
    if (fs.existsSync(lockfile)) {
      copyFileSafe(lockfile, path.join(stageDir, 'pnpm-lock.yaml'));
    }

    // Auditoría de prohibición estricta
    const stagedFiles = getAllFiles(stageDir);
    for (const file of stagedFiles) {
      if (file.relPath.includes('node_modules') || file.relPath.startsWith('data/') || file.relPath.includes('/data/')) {
        throw new Error(`VIOLACIÓN DE SEGURIDAD: Archivo prohibido en stage: ${file.relPath}`);
      }
      const filename = path.basename(file.relPath);
      if (filename.startsWith('.env') && filename !== '.env.example') {
        throw new Error(`VIOLACIÓN DE SEGURIDAD: Archivo de entorno prohibido en stage: ${file.relPath}`);
      }
    }

    // 4. Construir ReleaseManifest
    const manifestFiles = stagedFiles.map(f => ({
      path: f.relPath,
      sha256: computeSha256(fs.readFileSync(f.fullPath))
    }));

    const migrationsDir = path.join(rootDir, 'apps', 'server', 'src', 'db', 'migrations');
    const migrations = [];
    if (fs.existsSync(migrationsDir)) {
      const sqlFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
      for (const sqlFile of sqlFiles) {
        migrations.push({
          name: sqlFile,
          sql: fs.readFileSync(path.join(migrationsDir, sqlFile), 'utf-8')
        });
      }
    }

    const manifest = {
      version,
      createdAtMs: Date.now(),
      description: `Release oficial TOCINETA v${version}`,
      files: manifestFiles,
      migrations
    };

    // 5. Empaquetar en .zip
    const zipFilename = `tocineta-${version}.zip`;
    const zipPath = path.join(outputDir, zipFilename);
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    try {
      execSync(`tar -a -c -f "${zipPath}" *`, { cwd: stageDir, stdio: 'pipe' });
    } catch {
      execSync(
        `powershell -ExecutionPolicy Bypass -Command "Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -CompressionLevel Optimal"`,
        { stdio: 'pipe' }
      );
    }

    // 6. Verificar límite de 19 MB
    const stat = fs.statSync(zipPath);
    const sizeMb = stat.size / (1024 * 1024);
    console.log(`Paquete generado: ${zipFilename} (${sizeMb.toFixed(2)} MB)`);
    if (sizeMb >= 19) {
      fs.unlinkSync(zipPath);
      throw new Error(
        `El paquete generado pesa ${sizeMb.toFixed(2)} MB y supera el límite de 19 MB para bots de Telegram.`
      );
    }

    // 7. Firmar con clave privada Ed25519
    const privateKeyPem = options.privateKeyPem || (
      process.env.RELEASE_PRIVATE_KEY_PATH && fs.existsSync(process.env.RELEASE_PRIVATE_KEY_PATH)
        ? fs.readFileSync(process.env.RELEASE_PRIVATE_KEY_PATH, 'utf-8')
        : null
    );

    if (!privateKeyPem) {
      throw new Error(
        'RELEASE_PRIVATE_KEY_PATH no configurada o el archivo no existe. Se requiere la clave privada Ed25519 para firmar.'
      );
    }

    const { manifestJson, signatureBase64 } = signManifest(manifest, privateKeyPem);
    const sigFilename = `tocineta-${version}.sig`;
    const sigPath = path.join(outputDir, sigFilename);

    const sigPayload = {
      version,
      createdAtMs: manifest.createdAtMs,
      signatureBase64,
      manifestJson,
      manifest
    };
    fs.writeFileSync(sigPath, JSON.stringify(sigPayload, null, 2), 'utf-8');
    console.log(`Firma digital generada: ${sigFilename}`);

    return {
      version,
      zipPath,
      sigPath,
      sizeMb,
      manifest,
      manifestJson,
      signatureBase64
    };
  } finally {
    try {
      fs.rmSync(stageDir, { recursive: true, force: true });
    } catch {}
  }
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  const currentPath = path.resolve(process.argv[1]);
  return (
    currentPath.endsWith('release.mjs') ||
    (typeof import.meta.url === 'string' && currentPath === fileURLToPath(import.meta.url))
  );
}

if (isDirectRun()) {
  try {
    const result = packageRelease();
    console.log(`\n✓ Release ${result.version} empaquetado y firmado con éxito.`);
    console.log(`  - ZIP:   ${result.zipPath}`);
    console.log(`  - SIG:   ${result.sigPath}`);
    console.log(`  - Tamaño: ${result.sizeMb.toFixed(2)} MB`);
  } catch (err) {
    console.error(`\n[ERROR EN RELEASE] ${err.message}`);
    process.exit(1);
  }
}
