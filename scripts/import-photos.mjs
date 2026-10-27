import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.join(process.cwd(), 'apps', 'server', 'package.json'));
const Database = require('better-sqlite3');

const ROOT_DIR = process.cwd();
const MENU_DIR = path.join(ROOT_DIR, 'apps', 'web', 'public', 'menu');

// Locate active DBs
const DB_PATHS = [
  path.join(ROOT_DIR, 'data', 'tocineta.db'),
  path.join(ROOT_DIR, 'apps', 'server', 'data', 'tocineta.db')
];

export function importPhotos() {
  if (!fs.existsSync(MENU_DIR)) {
    console.error('No existe el directorio apps/web/public/menu');
    return;
  }

  const files = fs.readdirSync(MENU_DIR).filter(f => f.endsWith('.jpg') || f.endsWith('.png'));
  console.log(`Encontradas ${files.length} fotos en apps/web/public/menu/`);

  for (const dbPath of DB_PATHS) {
    if (!fs.existsSync(dbPath)) continue;
    console.log(`Actualizando base de datos: ${dbPath}`);
    const db = new Database(dbPath);

    const updateStmt = db.prepare(`
      UPDATE products
      SET image_url = ?, updated_at_ms = ?
      WHERE id = ? OR id = ? OR REPLACE(LOWER(name), ' ', '-') = ?
    `);

    let updated = 0;
    for (const file of files) {
      const slug = path.parse(file).name;
      const imageUrl = `/menu/${file}`;
      const prodId1 = `prod_${slug.replace(/-/g, '_')}`;
      const prodId2 = slug;
      const nameSlug = slug;

      const res = updateStmt.run(imageUrl, Date.now(), prodId1, prodId2, nameSlug);
      if (res.changes > 0) {
        updated += res.changes;
      }
    }
    console.log(`✓ Actualizados ${updated} productos en ${path.basename(dbPath)}`);
    db.close();
  }
}

if (process.argv[1]?.endsWith('import-photos.mjs')) {
  importPhotos();
}
