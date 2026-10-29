import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { seedProductPhotos } from '../src/modules/menu/photo-seed.js';
import { getUploadsDir } from '../src/config/paths.js';

describe('R2 — Idempotent Seed Catalog, Uploads Dir & Photo Seeding', () => {
  it('(a) seedCatalog dos veces tras editar precio, image_url y address de una impresora persiste todo; (b) con force:true se restablece', async () => {
    const tempDir = path.join(os.tmpdir(), `tocineta_seed_test_${Date.now()}`);
    const tempDbPath = path.join(tempDir, 'tocineta_test.db');
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      const dbCtx = initSqlite(tempDbPath);
      const rawDb = dbCtx.rawDb;

      await runMigrations(rawDb, { dbPath: tempDbPath });

      // Primera siembra
      seedCatalog(rawDb);

      // Editar precio de un producto, image_url y address de impresora
      rawDb.prepare('UPDATE products SET price_usd_cents = 9999, image_url = ? WHERE id = ?').run('/uploads/custom.jpg', 'prod_street_dog');
      rawDb.prepare('UPDATE printers SET address = ? WHERE id = ?').run('USB-CUSTOM-PORT', 'print_caja_usb');

      // Segunda siembra (idempotente sin force)
      seedCatalog(rawDb);

      // Verificar persistencia de cambios del usuario
      const prod = rawDb.prepare('SELECT price_usd_cents, image_url FROM products WHERE id = ?').get('prod_street_dog') as any;
      expect(prod.price_usd_cents).toBe(9999);
      expect(prod.image_url).toBe('/uploads/custom.jpg');

      const printer = rawDb.prepare('SELECT address FROM printers WHERE id = ?').get('print_caja_usb') as any;
      expect(printer.address).toBe('USB-CUSTOM-PORT');

      // Tercera siembra con force:true (debe restablecer a catálogo oficial)
      seedCatalog(rawDb, { force: true });
      const prodForced = rawDb.prepare('SELECT price_usd_cents, image_url FROM products WHERE id = ?').get('prod_street_dog') as any;
      expect(prodForced.price_usd_cents).toBe(250); // Precio original del street dog
      expect(prodForced.image_url).toBeNull();

      rawDb.close();
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('(c) seedProductPhotos asigna foto correctamente, no pisa image_url previo y devuelve lista de sin foto', async () => {
    const tempDir = path.join(os.tmpdir(), `tocineta_photo_test_${Date.now()}`);
    const tempDbPath = path.join(tempDir, 'tocineta_photo.db');
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      const dbCtx = initSqlite(tempDbPath);
      const rawDb = dbCtx.rawDb;

      await runMigrations(rawDb, { dbPath: tempDbPath });
      seedCatalog(rawDb);

      // Poner image_url previo en prod_americana_deluxe para verificar que no se pisa
      rawDb.prepare("UPDATE products SET image_url = '/uploads/manual.jpg' WHERE id = 'prod_americana_deluxe'").run();

      const result = seedProductPhotos(rawDb);

      expect(result.assignedCount).toBeGreaterThan(0);

      // Verificar que prod_americana_deluxe conserva '/uploads/manual.jpg' y no fue pisado
      const amer = rawDb.prepare("SELECT image_url FROM products WHERE id = 'prod_americana_deluxe'").get() as any;
      expect(amer.image_url).toBe('/uploads/manual.jpg');

      rawDb.close();
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('(d) getUploadsDir() queda junto a la BD', () => {
    const tempDir = path.join(os.tmpdir(), `tocineta_paths_test_${Date.now()}`);
    const tempDbPath = path.join(tempDir, 'subfolder', 'tocineta.db');
    fs.mkdirSync(path.dirname(tempDbPath), { recursive: true });

    // Temporal override env DB_PATH
    const originalDbPath = process.env.DB_PATH;
    process.env.DB_PATH = tempDbPath;

    try {
      const uploadsDir = getUploadsDir();
      const expectedDir = path.resolve(path.dirname(tempDbPath), 'uploads');
      expect(path.resolve(uploadsDir)).toBe(expectedDir);
      expect(fs.existsSync(uploadsDir)).toBe(true);
    } finally {
      if (originalDbPath !== undefined) {
        process.env.DB_PATH = originalDbPath;
      } else {
        delete process.env.DB_PATH;
      }
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });
});
