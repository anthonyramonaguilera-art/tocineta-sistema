import type Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getUploadsDir } from '../../config/paths.js';

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function seedProductPhotos(rawDb: Database.Database): { assignedCount: number; missingProducts: string[] } {
  // 1. Encontrar carpetas de origen candidatas
  const webMenuCandidatePaths = [
    path.resolve(process.cwd(), 'apps/web/public/menu'),
    path.resolve(process.cwd(), '../web/public/menu'),
    path.resolve(process.cwd(), '../../apps/web/public/menu')
  ];
  const webMenuDir = webMenuCandidatePaths.find(p => fs.existsSync(p));

  const docsMenuCandidatePaths = [
    path.resolve(process.cwd(), 'docs/menu-fotos'),
    path.resolve(process.cwd(), '../docs/menu-fotos'),
    path.resolve(process.cwd(), '../../docs/menu-fotos')
  ];
  const docsMenuDir = docsMenuCandidatePaths.find(p => fs.existsSync(p));

  // Recopilar archivos disponibles con su fuente y ruta absoluta
  interface PhotoSource {
    filename: string;
    absolutePath: string;
    sourceType: 'web_menu' | 'docs_fotos';
  }

  const availablePhotos: PhotoSource[] = [];

  if (webMenuDir) {
    try {
      const files = fs.readdirSync(webMenuDir);
      for (const f of files) {
        const fp = path.join(webMenuDir, f);
        if (fs.statSync(fp).isFile() && /\.(jpg|jpeg|png|webp)$/i.test(f)) {
          availablePhotos.push({ filename: f, absolutePath: fp, sourceType: 'web_menu' });
        }
      }
    } catch (err) {
      // Ignorar
    }
  }

  if (docsMenuDir) {
    try {
      const files = fs.readdirSync(docsMenuDir);
      for (const f of files) {
        const fp = path.join(docsMenuDir, f);
        if (fs.statSync(fp).isFile() && /\.(jpg|jpeg|png|webp)$/i.test(f)) {
          availablePhotos.push({ filename: f, absolutePath: fp, sourceType: 'docs_fotos' });
        }
      }
    } catch (err) {
      // Ignorar
    }
  }

  // 2. Obtener productos activos con image_url NULL o ''
  const products = rawDb.prepare(`
    SELECT id, name, is_active FROM products WHERE image_url IS NULL OR image_url = ''
  `).all() as Array<{ id: string; name: string; is_active: number }>;

  let assignedCount = 0;
  const now = Date.now();
  const uploadsDir = getUploadsDir();

  const updateStmt = rawDb.prepare(`
    UPDATE products SET image_url = ?, updated_at_ms = ? WHERE id = ?
  `);

  // Mapeo de alias explícitos
  const explicitAliases: Record<string, string> = {
    'deluxe-americana': 'prod_americana_deluxe',
    'nuggets-meats': 'prod_nuggets_meat',
    'jalapeños-dog': 'prod_jalapenos_dog',
    'jalapenos-dog': 'prod_jalapenos_dog',
    'doritos-dog': 'prod_doritos_dog_snacks',
    'tocineta-dog': 'prod_tocineta_dog_parmesano'
  };

  const assignedPhotoFiles = new Set<string>();

  for (const p of products) {
    // Buscar foto para este producto
    const idCore = p.id.replace(/^prod_/, '').replace(/_/g, '-');
    const idSlug = slugify(idCore);
    const nameSlug = slugify(p.name);

    let matchedPhoto: PhotoSource | undefined;

    for (const photo of availablePhotos) {
      if (assignedPhotoFiles.has(photo.filename)) continue;

      const ext = path.extname(photo.filename);
      const baseName = path.basename(photo.filename, ext);
      const fileSlug = slugify(baseName);

      // Comprobar alias explícito
      if (explicitAliases[fileSlug] === p.id) {
        matchedPhoto = photo;
        break;
      }

      // Comprobar coincidencias por slug / prefijo
      if (
        fileSlug === idSlug ||
        fileSlug === nameSlug ||
        fileSlug.startsWith(idSlug) ||
        idSlug.startsWith(fileSlug) ||
        fileSlug.startsWith(nameSlug) ||
        nameSlug.startsWith(fileSlug) ||
        idSlug.includes(fileSlug) ||
        fileSlug.includes(idSlug) ||
        nameSlug.includes(fileSlug) ||
        fileSlug.includes(nameSlug)
      ) {
        matchedPhoto = photo;
        break;
      }
    }

    if (matchedPhoto) {
      assignedPhotoFiles.add(matchedPhoto.filename);
      let imageUrl = '';

      if (matchedPhoto.sourceType === 'web_menu') {
        imageUrl = `/menu/${matchedPhoto.filename}`;
      } else {
        // Copiar a uploadsDir como <productId>-seed<ext>
        const ext = path.extname(matchedPhoto.filename);
        const targetFilename = `${p.id}-seed${ext}`;
        const targetPath = path.join(uploadsDir, targetFilename);
        if (!fs.existsSync(targetPath)) {
          fs.copyFileSync(matchedPhoto.absolutePath, targetPath);
        }
        imageUrl = `/uploads/${targetFilename}`;
      }

      updateStmt.run(imageUrl, now, p.id);
      assignedCount++;
    }
  }

  // Obtener lista de productos activos (is_active = 1) que siguen sin foto
  const missingActiveProducts = rawDb.prepare(`
    SELECT name FROM products WHERE is_active = 1 AND (image_url IS NULL OR image_url = '')
  `).all() as Array<{ name: string }>;

  const missingNames = missingActiveProducts.map(m => m.name);

  console.log(`🖼️ [photo-seed] Se asignaron fotos a ${assignedCount} productos.`);
  if (missingNames.length > 0) {
    console.log(`⚠️ [photo-seed] Productos activos sin foto: ${missingNames.join(', ')}`);
  } else {
    console.log(`✨ [photo-seed] ¡Todos los productos activos tienen fotografía asignada!`);
  }

  return { assignedCount, missingProducts: missingNames };
}
