#!/usr/bin/env node
/**
 * SISTEMA OPERATIVO LOCAL TOCINETA
 * Actualizador de Versión Unificada (bump-version.mjs)
 *
 * Sincroniza la versión SemVer entre package.json raíz, apps/server y apps/web.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const newVersion = process.argv[2]?.trim();

if (!newVersion) {
  console.error('Uso: node scripts/bump-version.mjs <X.Y.Z>');
  process.exit(1);
}

// Validación de formato SemVer (ej. 1.0.0 o 1.0.0-rc.1)
const semverRegex = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
if (!semverRegex.test(newVersion)) {
  console.error(`Error: "${newVersion}" no es un formato semver válido (debe ser X.Y.Z)`);
  process.exit(1);
}

const targetPackages = [
  path.join(rootDir, 'package.json'),
  path.join(rootDir, 'apps', 'server', 'package.json'),
  path.join(rootDir, 'apps', 'web', 'package.json')
];

for (const pkgPath of targetPackages) {
  if (!fs.existsSync(pkgPath)) {
    console.error(`Error: No se encontró el archivo ${pkgPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(pkgPath, 'utf-8');
  const pkg = JSON.parse(raw);
  const oldVersion = pkg.version;
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  console.log(`✓ ${path.relative(rootDir, pkgPath)}: ${oldVersion} -> ${newVersion}`);
}

console.log(`\nVersión del sistema actualizada a ${newVersion} exitosamente.`);
