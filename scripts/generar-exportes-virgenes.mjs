import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

console.log('=============================================================');
console.log('📦 GENERADOR DE EXPORTES LIMPIOS Y SEGUROS (TOCINETA ERP)');
console.log('=============================================================');
console.log(`📁 Directorio raíz: ${ROOT_DIR}\n`);

// 1. Compilación previa para asegurar que no hay errores de sintaxis o tipo
console.log('1️⃣ Verificando compilación de proyectos (pnpm run build)...');
execSync('pnpm run build', { cwd: ROOT_DIR, stdio: 'inherit' });
console.log('✅ Compilación de proyectos exitosa.\n');

// 2. Importar creadores de bases de datos
const { createFreshTotalDatabase, createFreshProductionDatabase } = await import(
  '../apps/server/dist/db/fresh-prod.js'
);

// 3. Generar bases de datos temporales limpias
const tempTotalDb = path.join(ROOT_DIR, 'data', 'export_virgen_total.db');
const tempTocinetaDb = path.join(ROOT_DIR, 'data', 'export_virgen_tocineta.db');

console.log('2️⃣ Generando base de datos: VIRGEN TOTAL (0 productos, 0 órdenes)...');
await createFreshTotalDatabase(tempTotalDb);

console.log('3️⃣ Generando base de datos: VIRGEN TOCINETA (Menú real, 0 órdenes)...');
await createFreshProductionDatabase(tempTocinetaDb);

// Lista de archivos y carpetas a incluir
const entriesToCopy = [
  // Raíz
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'tsconfig.base.json',
  'tsconfig.json',
  '.gitignore',
  '.env.example',
  'AGENTS.md',
  'README.md',
  'INFORME-DIRECTOR.md',
  'BITACORA-DE-CONTEXTO.md',
  'PLAN-DE-EJECUCION.md',
  'PRD.md',
  'playwright.r2.config.ts',

  // Apps Server
  'apps/server/src',
  'apps/server/test',
  'apps/server/scripts',
  'apps/server/package.json',
  'apps/server/tsconfig.json',
  'apps/server/vitest.config.ts',
  'apps/server/update-printers.cjs',

  // Apps Web
  'apps/web/src',
  'apps/web/public',
  'apps/web/index.html',
  'apps/web/package.json',
  'apps/web/tsconfig.json',
  'apps/web/vite.config.ts',
  'apps/web/tailwind.config.js',
  'apps/web/postcss.config.js',

  // Packages Shared
  'packages/shared/src',
  'packages/shared/test',
  'packages/shared/package.json',
  'packages/shared/tsconfig.json',
  'packages/shared/vitest.config.ts',

  // Scripts, Docs & Tools
  'scripts',
  'docs',
  'tools'
];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      // Excluir directorios y archivos no deseados
      if (
        item === 'node_modules' ||
        item === 'dist' ||
        item === '.git' ||
        item === '.cache' ||
        item === '.vite' ||
        item === 'coverage' ||
        item === 'test-results' ||
        item === 'capturas' ||
        item.endsWith('.tsbuildinfo') ||
        item.endsWith('.db-wal') ||
        item.endsWith('.db-shm') ||
        item === '.env'
      ) {
        continue;
      }
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function cleanUnwanted(targetDir) {
  const items = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(targetDir, item.name);
    if (item.isDirectory()) {
      if (
        ['node_modules', 'dist', '.git', '.cache', '.vite', 'coverage', 'test-results', 'capturas'].includes(item.name)
      ) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        cleanUnwanted(fullPath);
      }
    } else {
      if (
        item.name.endsWith('.tsbuildinfo') ||
        item.name.endsWith('.db-wal') ||
        item.name.endsWith('.db-shm') ||
        item.name.endsWith('.log') ||
        (item.name === '.env' && !item.name.includes('.example'))
      ) {
        fs.unlinkSync(fullPath);
      }
    }
  }
}

async function buildZip(variant, dbSourcePath, zipFileName) {
  console.log(`\n-------------------------------------------------------------`);
  console.log(`📦 Empaquetando versión: ${variant}`);
  console.log(`-------------------------------------------------------------`);

  const stageDir = path.join(ROOT_DIR, 'data', `stage_${variant}`);
  if (fs.existsSync(stageDir)) {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stageDir, { recursive: true });

  // 1. Copiar archivos fuente
  for (const entry of entriesToCopy) {
    const srcPath = path.join(ROOT_DIR, entry);
    const destPath = path.join(stageDir, entry);
    if (fs.existsSync(srcPath)) {
      copyRecursive(srcPath, destPath);
    } else {
      console.warn(`⚠️ No encontrado: ${entry}`);
    }
  }

  // 2. Colocar base de datos limpia en data/tocineta.db
  const targetDataDir = path.join(stageDir, 'data');
  fs.mkdirSync(targetDataDir, { recursive: true });
  const targetDbPath = path.join(targetDataDir, 'tocineta.db');
  fs.copyFileSync(dbSourcePath, targetDbPath);

  // Crear carpeta uploads
  const targetUploads = path.join(targetDataDir, 'uploads');
  fs.mkdirSync(targetUploads, { recursive: true });

  // 3. Limpieza profunda
  cleanUnwanted(stageDir);

  // 4. Crear archivo zip
  const zipDest = path.join(ROOT_DIR, zipFileName);
  if (fs.existsSync(zipDest)) {
    fs.unlinkSync(zipDest);
  }

  console.log(`🗜️ Comprimiendo a ${zipFileName}...`);
  // Usar PowerShell Compress-Archive
  const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipDest}' -CompressionLevel Optimal"`;
  execSync(psCmd, { stdio: 'inherit' });

  // Limpiar staging
  fs.rmSync(stageDir, { recursive: true, force: true });

  const stat = fs.statSync(zipDest);
  const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
  console.log(`✅ ${zipFileName} generado con éxito (${sizeMB} MB)`);
  return zipDest;
}

// Generar los 2 ZIPs
const zipVirgenTotal = await buildZip('virgen_total', tempTotalDb, 'TOCINETA-VIRGEN-TOTAL.zip');
const zipVirgenTocineta = await buildZip('virgen_tocineta', tempTocinetaDb, 'TOCINETA-VIRGEN-TOCINETA.zip');

// Limpiar dbs temporales
if (fs.existsSync(tempTotalDb)) fs.unlinkSync(tempTotalDb);
if (fs.existsSync(tempTocinetaDb)) fs.unlinkSync(tempTocinetaDb);

console.log('\n=============================================================');
console.log('🧪 VERIFICACIÓN RIGUROSA DE AMBOS PAQUETES EXPORTADOS');
console.log('=============================================================');

function verifyZip(zipPath, expectedVariant) {
  console.log(`\n🔍 Verificando paquete: ${path.basename(zipPath)}...`);
  const testExtractDir = path.join(ROOT_DIR, 'data', `test_verify_${expectedVariant}`);
  if (fs.existsSync(testExtractDir)) {
    fs.rmSync(testExtractDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testExtractDir, { recursive: true });

  // Descomprimir
  const psExpand = `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${testExtractDir}' -Force"`;
  execSync(psExpand, { stdio: 'inherit' });

  // 1. Verificar archivos críticos de TypeScript y Vite
  const criticalFiles = [
    'tsconfig.base.json',
    'tsconfig.json',
    'package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'apps/server/tsconfig.json',
    'apps/server/package.json',
    'apps/web/tsconfig.json',
    'apps/web/package.json',
    'apps/web/index.html',
    'apps/web/vite.config.ts',
    'apps/web/tailwind.config.js',
    'apps/web/postcss.config.js',
    'packages/shared/tsconfig.json',
    'packages/shared/package.json',
    'data/tocineta.db'
  ];

  for (const f of criticalFiles) {
    const full = path.join(testExtractDir, f);
    if (!fs.existsSync(full)) {
      throw new Error(`VERIFY_FAIL: Archivo crítico faltante en zip: ${f}`);
    }
  }
  console.log('  ✓ Todos los archivos de configuración TypeScript y Vite están presentes');

  // 2. Verificar validez de sintaxis y referencias de todos los archivos tsconfig
  console.log('  ✓ Comprobando validez y referencias de tsconfig.base.json y tsconfig.json...');
  const tsconfigFiles = [
    'tsconfig.base.json',
    'tsconfig.json',
    'apps/server/tsconfig.json',
    'apps/web/tsconfig.json',
    'packages/shared/tsconfig.json'
  ];

  for (const tsf of tsconfigFiles) {
    const rawContent = fs.readFileSync(path.join(testExtractDir, tsf), 'utf8');
    try {
      JSON.parse(rawContent);
    } catch (e) {
      throw new Error(`VERIFY_FAIL: ${tsf} no es un JSON válido: ${e.message}`);
    }
  }
  console.log('  ✓ Todos los archivos tsconfig son JSON válidos');

  // 3. Ejecutar ui-guard en el proyecto extraído
  console.log('  ✓ Ejecutando UI-Guard en el paquete extraído...');
  execSync('node scripts/ui-guard.mjs', { cwd: testExtractDir, stdio: 'inherit' });

  // 4. Verificar base de datos
  const dbFile = path.join(testExtractDir, 'data', 'tocineta.db');
  const db = new Database(dbFile);

  const ordersCount = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const sessionsCount = db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
  const productsCount = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  const usersCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const locationsCount = db.prepare('SELECT COUNT(*) as c FROM locations').get().c;

  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
    throw new Error(`VERIFY_FAIL: PRAGMA integrity_check falló: ${JSON.stringify(integrity)}`);
  }

  const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
  if (fkCheck.length > 0) {
    throw new Error(`VERIFY_FAIL: PRAGMA foreign_key_check falló: ${JSON.stringify(fkCheck)}`);
  }

  db.close();

  if (ordersCount !== 0) throw new Error(`VERIFY_FAIL: órdenes no es 0 (${ordersCount})`);
  if (sessionsCount !== 0) throw new Error(`VERIFY_FAIL: sesiones no es 0 (${sessionsCount})`);
  if (usersCount < 5) throw new Error(`VERIFY_FAIL: usuarios < 5 (${usersCount})`);
  if (locationsCount < 2) throw new Error(`VERIFY_FAIL: sedes < 2 (${locationsCount})`);

  if (expectedVariant === 'virgen_total') {
    if (productsCount !== 0) throw new Error(`VERIFY_FAIL: Virgen Total debe tener 0 productos (${productsCount})`);
    console.log(`  ✓ Base Virgen Total verificada: 0 órdenes, 0 productos, 5 roles, 2 sedes.`);
  } else {
    if (productsCount !== 39) throw new Error(`VERIFY_FAIL: Virgen Tocineta debe tener 39 productos (${productsCount})`);
    console.log(`  ✓ Base Virgen Tocineta verificada: 0 órdenes, 39 productos oficiales, 5 roles, 2 sedes.`);
  }

  // Limpiar directorio de prueba
  fs.rmSync(testExtractDir, { recursive: true, force: true });
  console.log(`  ✅ Verificación de ${path.basename(zipPath)} completada con éxito.`);
}

verifyZip(zipVirgenTotal, 'virgen_total');
verifyZip(zipVirgenTocineta, 'virgen_tocineta');

console.log('\n=============================================================');
console.log('🎉 PROCESO FINALIZADO CON ÉXITO ABSOLUTO');
console.log('Los 2 archivos .zip están listos en la raíz del proyecto:');
console.log(`  1. TOCINETA-VIRGEN-TOTAL.zip`);
console.log(`  2. TOCINETA-VIRGEN-TOCINETA.zip`);
console.log('=============================================================\n');
