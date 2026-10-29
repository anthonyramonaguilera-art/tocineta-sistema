import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { createFreshProductionDatabase } from '../src/db/fresh-prod.js';
import { initSqlite } from '../src/db/connection.js';

describe('R2 — Fresh Production Database (db:fresh-prod)', () => {
  it('Crea una base de datos nueva y limpia en entorno temporal con todos los conteos y verificaciones correctos', async () => {
    const tempDir = path.join(os.tmpdir(), `tocineta_fresh_prod_test_${Date.now()}`);
    const tempDbPath = path.join(tempDir, 'tocineta_fresh.db');
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      const result = await createFreshProductionDatabase(tempDbPath);

      expect(result.counts.orders).toBe(0);
      expect(result.counts.operatingExpenses).toBe(0);
      expect(result.counts.socios).toBe(0);
      expect(result.counts.proveedores).toBe(0);
      expect(result.counts.customers).toBe(0);
      expect(result.counts.sedes).toBe(2);
      expect(result.counts.users).toBe(5);
      expect(result.counts.printers).toBe(2);
      expect(result.counts.products).toBeGreaterThan(0);
      expect(result.counts.supplyItems).toBeGreaterThanOrEqual(0);
      expect(result.counts.recipes).toBeGreaterThan(0);

      // Verificar conectando directamente a la base temporal generada
      const dbCtx = initSqlite(tempDbPath);
      const rawDb = dbCtx.rawDb;

      const settings = rawDb.prepare('SELECT inventory_operation_mode, print_mode FROM business_settings WHERE id = ?').get('default') as any;
      expect(settings.inventory_operation_mode).toBe('free');
      expect(settings.print_mode).toBe('one');

      rawDb.close();
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });
});
