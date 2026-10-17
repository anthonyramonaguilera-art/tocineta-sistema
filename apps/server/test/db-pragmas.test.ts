import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initSqlite } from '../src/db/connection.js';

describe('SQLite PRAGMAs (WAL, synchronous=FULL, foreign_keys=ON, busy_timeout=5000)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_pragmas_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test.db');

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('enforces journal_mode=WAL, synchronous=2 (FULL), foreign_keys=1 (ON), busy_timeout=5000ms on disk DB', () => {
    const ctx = initSqlite(tempDb);
    const pragmas = ctx.getPragmas();

    expect(pragmas.journalMode.toLowerCase()).toBe('wal');
    expect(pragmas.synchronous).toBe(2); // 2 = FULL
    expect(pragmas.foreignKeys).toBe(1); // 1 = ON
    expect(pragmas.busyTimeoutMs).toBe(5000);

    ctx.rawDb.close();
  });
});
