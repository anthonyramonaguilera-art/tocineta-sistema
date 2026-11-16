import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { loginAs } from './test-helpers.js';

const KB = 1024;
const MB = 1024 * KB;

/**
 * Arma un data URL con un base64 que ocupa aproximadamente `base64Bytes`.
 * El binario decodificado mide 3/4 de esa cifra y empieza con la cabecera JPEG
 * para que la validación de formato lo acepte.
 */
function photoPayload(base64Bytes: number, mime = 'image/jpeg'): string {
  const rawBytes = Math.floor((base64Bytes * 3) / 4);
  const buffer = Buffer.alloc(rawBytes);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

describe('H4 — Subida de fotos de platos sin 413', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_photo_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_photo.db');
  let rawDb: Database.Database;
  let adminToken: string;
  let productId: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    process.env.DB_PATH = tempDb;
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    const product = rawDb.prepare('SELECT id FROM products ORDER BY id ASC LIMIT 1').get() as
      | { id: string }
      | undefined;
    if (!product) throw new Error('El catálogo sembrado no tiene productos para la prueba');
    productId = product.id;

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    const adminLogin = await loginAs(app, 'admin', rawDb);
    adminToken = adminLogin.token;
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      const dbCtx = getDatabaseContext();
      dbCtx.rawDb.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('acepta una foto de ~2,5 MB en base64 (≈1,9 MB decodificados) sin 413', async () => {
    // Con el bodyLimit global (1 MiB) esta petición habría muerto con 413 antes
    // de llegar a la validación del servicio.
    const payload = photoPayload(2.5 * MB);
    expect(payload.length).toBeGreaterThan(MB);
    expect(payload.length).toBeLessThan(5 * MB);

    const res = await app.inject({
      method: 'POST',
      url: `/api/menu/products/${productId}/photo`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { base64: payload }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.imageUrl).toMatch(new RegExp(`^/uploads/${productId}-\\d+\\.jpg\\?t=\\d+$`));

    // Persistencia de la ruta en el producto
    const row = rawDb.prepare('SELECT image_url FROM products WHERE id = ?').get(productId) as any;
    expect(row.image_url).toBe(body.imageUrl);

    // El archivo se escribió en el directorio de subidas de la BD de prueba
    const fileName = String(body.imageUrl).split('/uploads/')[1].split('?')[0];
    const filePath = path.join(path.dirname(tempDb), 'uploads', fileName);
    expect(fs.existsSync(filePath)).toBe(true);
    fs.rmSync(filePath, { force: true });
  });

  it('responde 400 (no 413) cuando el base64 supera el límite propio del servidor', async () => {
    // ~3 MB en base64 (2,25 MB decodificados): cabe en el bodyLimit de la ruta,
    // pero excede los 2 MB que valida saveProductPhoto.
    const payload = photoPayload(3 * MB);

    const res = await app.inject({
      method: 'POST',
      url: `/api/menu/products/${productId}/photo`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { base64: payload }
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('2 MB');
  });

  it('documenta el rechazo de un cuerpo de ~6 MB (413 del bodyLimit de 5 MiB)', async () => {
    // 6 MB en base64 (4,5 MB decodificados) supera el bodyLimit de la ruta, así
    // que Fastify corta con 413 antes de la validación. El cliente comprime a
    // menos de 2 MB, por lo que este caso no ocurre desde la app.
    const payload = photoPayload(6 * MB);

    const res = await app.inject({
      method: 'POST',
      url: `/api/menu/products/${productId}/photo`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { base64: payload }
    });

    expect([400, 413]).toContain(res.statusCode);
    expect(res.json().success).toBe(false);
  });

  it('rechaza un tipo que no es imagen con 400 y mensaje en español', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/menu/products/${productId}/photo`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { base64: 'data:application/pdf;base64,JVBERi0xLjQKJcfsj6IK' }
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Formato de imagen no soportado');
  });

  it('rechaza formatos de imagen no soportados (SVG) con 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/menu/products/${productId}/photo`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { base64: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Formato de imagen no soportado');
  });

  it('mantiene el 400 cuando falta el base64', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/menu/products/${productId}/photo`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {}
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('base64');
  });
});
