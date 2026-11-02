import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Obtiene la raíz del proyecto.
 * Si existe la variable TOCINETA_HOME, la usa de forma prioritaria.
 * En su defecto, busca la carpeta raíz subiendo hasta encontrar pnpm-workspace.yaml
 * o resolviendo 3 niveles arriba de apps/server/dist.
 */
export function getProjectRoot(): string {
  if (process.env.TOCINETA_HOME) {
    return path.resolve(process.env.TOCINETA_HOME);
  }

  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Carpeta tres niveles arriba de apps/server/dist
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
}

/**
 * Obtiene el directorio de subidas de fotos atado a la ubicación de la base de datos SQLite (leyendo process.env.DB_PATH en tiempo de ejecución).
 * Si existe un directorio legado en process.cwd()/data/uploads y es distinto,
 * copia los archivos faltantes de forma no destructiva.
 */
export function getUploadsDir(): string {
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  const isProd = process.env.NODE_ENV === 'production' && !isTest;
  const rawDbPath = process.env.DB_PATH || './data/tocineta.db';
  const baseDir = (isProd && !path.isAbsolute(rawDbPath)) ? getProjectRoot() : process.cwd();
  const dbPath = path.resolve(baseDir, rawDbPath);
  const dbDir = path.dirname(dbPath);
  const uploadsDir = path.join(dbDir, 'uploads');

  const legacyDir = path.resolve(process.cwd(), 'data/uploads');
  if (path.resolve(legacyDir) !== path.resolve(uploadsDir)) {
    if (fs.existsSync(legacyDir)) {
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      try {
        const files = fs.readdirSync(legacyDir);
        for (const file of files) {
          const srcFile = path.join(legacyDir, file);
          const destFile = path.join(uploadsDir, file);
          if (fs.statSync(srcFile).isFile() && !fs.existsSync(destFile)) {
            fs.copyFileSync(srcFile, destFile);
          }
        }
      } catch (err) {
        // Ignorar errores menores al copiar archivos legados
      }
    }
  }

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
}
