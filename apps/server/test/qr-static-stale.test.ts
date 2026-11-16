import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildServer } from '../src/server.js';
import { getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { getStaticQrPackageStatus } from '../src/modules/qr-menu/routes.js';

describe('QR estático — aviso de paquete desactualizado tras cambios de carta', () => {
  let app: FastifyInstance;
  let rawDb: Database.Database;
  let tempDir: string;

  beforeAll(async () => {
    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    const dbCtx = getDatabaseContext();
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tocineta_qr_stale_'));
  });

  afterAll(async () => {
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
    await app.close();
  });

  it('sin paquete estático devuelve staticStale=false', () => {
    const status = getStaticQrPackageStatus(rawDb, tempDir);

    expect(status.hasPackage).toBe(false);
    expect(status.staticStale).toBe(false);
  });

  it('paquete viejo + producto actualizado después devuelve staticStale=true', () => {
    const htmlPath = path.join(tempDir, 'index.html');
    fs.writeFileSync(htmlPath, '<!DOCTYPE html><html><body>menú viejo</body></html>', 'utf-8');
    const oldDate = new Date(Date.now() - 60_000);
    fs.utimesSync(htmlPath, oldDate, oldDate);

    const changedAtMs = Date.now();
    rawDb.prepare("UPDATE products SET updated_at_ms = ? WHERE id = 'prod_street_dog'").run(changedAtMs);

    const status = getStaticQrPackageStatus(rawDb, tempDir);

    expect(status.hasPackage).toBe(true);
    expect(status.lastMenuChangeAtMs).toBe(changedAtMs);
    expect(status.staticStale).toBe(true);
  });

  it('tras re-exportar el paquete devuelve staticStale=false', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/qr-menu/export-static',
      payload: { customDistDir: tempDir }
    });

    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(path.join(tempDir, 'index.html'))).toBe(true);

    const status = getStaticQrPackageStatus(rawDb, tempDir);

    expect(status.hasPackage).toBe(true);
    expect(status.staticStale).toBe(false);
  });

  it('GET /api/qr-menu/cloud-summary expone staticStale booleano en la raíz y en summary', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/qr-menu/cloud-summary'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(typeof body.staticStale).toBe('boolean');
    expect(typeof body.summary.staticStale).toBe('boolean');
    expect(body.summary.staticStale).toBe(body.staticStale);
  });
});
