import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { getOwnerDashboardData } from '../src/modules/transfers/owner-dashboard-service.js';

describe('Panel Dueña — recentTransfers cuenta ítems sin traer items_json', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_owner_transfers_${Date.now()}`);
  const tempDbPath = path.join(tempDir, 'owner_transfers.db');
  let rawDb: Database.Database;

  const transferItems: Record<string, unknown[]> = {
    tr_owner_0: [],
    tr_owner_1: [{ supplyId: 'sup_pan', quantity: 2 }],
    tr_owner_5: [
      { supplyId: 'sup_pan', quantity: 1 },
      { supplyId: 'sup_salchicha', quantity: 2 },
      { supplyId: 'sup_queso', quantity: 3 },
      { supplyId: 'sup_tocineta', quantity: 4 },
      { supplyId: 'sup_salsa', quantity: 5 }
    ]
  };

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDbPath);
    rawDb = dbCtx.rawDb;
    rawDb.pragma('foreign_keys = ON');

    await runMigrations(rawDb, { dbPath: tempDbPath });
    seedInitialUsers(rawDb);
    ensureOfficialLocations(rawDb);

    const now = Date.now();
    const insertTransfer = rawDb.prepare(`
      INSERT INTO inter_location_transfers (
        id, transfer_number, dispatch_note_code, from_location_id, to_location_id,
        status, mode, items_json, total_cost_usd_cents,
        created_by_user_id, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 'loc_alta_vista', 'loc_los_olivos', 'EN_TRANSITO', 'LOOSE_SUPPLIES', ?, 0, 'usr_admin', ?, ?)
    `);

    let n = 1;
    for (const [id, items] of Object.entries(transferItems)) {
      insertTransfer.run(id, n, `ND-O${n}`, JSON.stringify(items), now - n * 1000, now - n * 1000);
      n++;
    }
  });

  afterAll(() => {
    try {
      if (rawDb) rawDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('devuelve el mismo itemsCount que el JSON.parse anterior con 0, 1 y 5 ítems', () => {
    const data = getOwnerDashboardData(rawDb);

    expect(data.recentTransfers).toHaveLength(3);
    for (const [id, items] of Object.entries(transferItems)) {
      const transfer = data.recentTransfers.find((t: any) => t.id === id);
      expect(transfer).toBeDefined();
      expect(transfer.itemsCount).toBe(items.length);
      expect(typeof transfer.itemsCount).toBe('number');
    }
  });

  it('no incluye el payload completo de items_json en la respuesta', () => {
    const data = getOwnerDashboardData(rawDb);

    for (const transfer of data.recentTransfers) {
      expect(transfer).not.toHaveProperty('items_json');
      expect(transfer).not.toHaveProperty('itemsJson');
      expect(transfer).not.toHaveProperty('items');
    }
  });
});
