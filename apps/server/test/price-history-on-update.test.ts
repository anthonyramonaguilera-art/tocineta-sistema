import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { updateProduct } from '../src/modules/menu/menu-service.js';

describe('Carta y Precios — historial de precios al actualizar un producto', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_price_history_${Date.now()}`);
  const tempDbPath = path.join(tempDir, 'price_history.db');
  const productId = 'prod_street_dog';
  let rawDb: Database.Database;

  function countHistory(): number {
    const row = rawDb
      .prepare('SELECT COUNT(*) as count FROM price_history WHERE product_id = ?')
      .get(productId) as any;
    return row.count;
  }

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDbPath);
    rawDb = dbCtx.rawDb;
    rawDb.pragma('foreign_keys = ON');

    await runMigrations(rawDb, { dbPath: tempDbPath });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    // Precio base determinista para el escenario 500 -> 550 (sin pasar por updateProduct).
    rawDb.prepare('UPDATE products SET price_usd_cents = 500 WHERE id = ?').run(productId);
  });

  afterAll(() => {
    try {
      if (rawDb) rawDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('cambiar el precio 500 -> 550 inserta 1 fila en price_history con old/new correctos', () => {
    expect(countHistory()).toBe(0);

    const result = updateProduct(rawDb, productId, { priceUsdCents: 550 }, 'usr_admin');
    expect(result.priceUsdCents).toBe(550);

    const current = rawDb.prepare('SELECT price_usd_cents FROM products WHERE id = ?').get(productId) as any;
    expect(current.price_usd_cents).toBe(550);

    const rows = rawDb
      .prepare('SELECT * FROM price_history WHERE product_id = ? ORDER BY created_at_ms DESC')
      .all(productId) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].old_price_usd_cents).toBe(500);
    expect(rows[0].new_price_usd_cents).toBe(550);
    expect(rows[0].reason).toBe('MANUAL_CARTA');
    expect(rows[0].confirmed_by_user_id).toBe('usr_admin');
    expect(rows[0].id).toMatch(/^ph_/);

    // La auditoría PRODUCT_UPDATED se conserva.
    const auditRow = rawDb
      .prepare("SELECT COUNT(*) as count FROM audit_events WHERE action = 'PRODUCT_UPDATED' AND entity_id = ?")
      .get(productId) as any;
    expect(auditRow.count).toBe(1);
  });

  it('guardar sin cambiar el precio no inserta filas en price_history', () => {
    expect(countHistory()).toBe(1);

    const before = rawDb
      .prepare('SELECT price_usd_cents FROM products WHERE id = ?')
      .get(productId) as any;

    updateProduct(rawDb, productId, { name: 'Street Dog Clásico' }, 'usr_admin');

    const after = rawDb
      .prepare('SELECT price_usd_cents FROM products WHERE id = ?')
      .get(productId) as any;
    expect(after.price_usd_cents).toBe(before.price_usd_cents);
    expect(countHistory()).toBe(1);
  });
});
