import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * Obtiene el directorio de subidas de fotos atado a la ubicación de la base de datos SQLite (leyendo process.env.DB_PATH en tiempo de ejecución).
 * Si existe un directorio legado en process.cwd()/data/uploads y es distinto,
 * copia los archivos faltantes de forma no destructiva.
 */
export function getUploadsDir(): string {
  const dbPath = process.env.DB_PATH || './data/tocineta.db';
  const dbDir = path.dirname(path.resolve(dbPath));
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
