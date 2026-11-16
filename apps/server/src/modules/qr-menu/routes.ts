import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDatabaseContext } from '../../db/connection.js';
import {
  getPublicQrMenuData,
  generateStaticQrSite,
  getCloudSummaryMetrics,
  generateSelfContainedHtml
} from './qr-menu-service.js';

export interface StaticQrPackageStatus {
  hasPackage: boolean;
  generatedAtMs: number | null;
  lastMenuChangeAtMs: number | null;
  staticStale: boolean;
}

/**
 * Estado del paquete estático del Menú QR.
 * La fecha de generación se toma de la mtime de index.html (el archivo que sirve GET /qr),
 * porque generateStaticQrSite no persiste una marca de tiempo aparte.
 * La fecha de la carta es MAX(updated_at_ms) de products (precios, nombres y disponibilidad).
 */
export function getStaticQrPackageStatus(
  rawDb: Database.Database,
  distDir: string = path.resolve(process.cwd(), './data/qr-static-dist')
): StaticQrPackageStatus {
  const lastChangeRow = rawDb
    .prepare('SELECT MAX(updated_at_ms) AS last_ms FROM products')
    .get() as { last_ms: number | null } | undefined;
  const lastMenuChangeAtMs = lastChangeRow?.last_ms ?? null;

  let generatedAtMs: number | null = null;
  try {
    generatedAtMs = fs.statSync(path.join(distDir, 'index.html')).mtimeMs;
  } catch {
    return { hasPackage: false, generatedAtMs: null, lastMenuChangeAtMs, staticStale: false };
  }

  return {
    hasPackage: true,
    generatedAtMs,
    lastMenuChangeAtMs,
    staticStale: lastMenuChangeAtMs !== null && generatedAtMs < lastMenuChangeAtMs
  };
}

export const qrMenuRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. Payload público sanitizado del Menú Activo
  const menuDataHandler = async (_request: any, reply: any) => {
    const dbCtx = getDatabaseContext();
    const data = getPublicQrMenuData(dbCtx.rawDb);

    return reply.status(200).send({
      success: true,
      ...data,
      data
    });
  };

  fastify.get('/api/qr-menu/data', menuDataHandler);
  fastify.get('/api/qr-menu/menu', menuDataHandler);

  // 2. Generador y exportador del paquete estático para Vercel / Cloudflare Pages / Local
  fastify.post('/api/qr-menu/export-static', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = request.body as { customDistDir?: string } | undefined;

    try {
      const result = await generateStaticQrSite(dbCtx.rawDb, body?.customDistDir);
      return reply.status(200).send({
        success: true,
        message: 'Paquete de Menú Digital QR estático exportado exitosamente',
        ...result
      });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        error: err.message || 'Error al exportar paquete estático del Menú QR'
      });
    }
  });

  // 3. Resumen Financiero Agregado para Sincronización en la Nube (con Privacy Guard)
  fastify.get('/api/qr-menu/cloud-summary', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const query = request.query as { jornadaId?: string } | undefined;

    try {
      const summary = getCloudSummaryMetrics(dbCtx.rawDb, query?.jornadaId);
      const { staticStale } = getStaticQrPackageStatus(dbCtx.rawDb);
      return reply.status(200).send({
        success: true,
        ...summary,
        staticStale,
        summary: { ...summary, staticStale }
      });
    } catch (err: any) {
      if (err.message && err.message.startsWith('DATA_PRIVACY_VIOLATION')) {
        return reply.status(400).send({
          success: false,
          error: err.message,
          code: 'DATA_PRIVACY_VIOLATION'
        });
      }
      return reply.status(500).send({
        success: false,
        error: err.message || 'Error al generar resumen en la nube'
      });
    }
  });

  // 4. Servicio local del Menú QR en GET /qr
  fastify.get('/qr', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const distHtmlPath = path.resolve(process.cwd(), './data/qr-static-dist/index.html');

    if (process.env.NODE_ENV !== 'test' && fs.existsSync(distHtmlPath)) {
      const html = fs.readFileSync(distHtmlPath, 'utf-8');
      return reply.type('text/html; charset=utf-8').send(html);
    }

    // Si aún no se ha generado la carpeta física (o en pruebas), generarla en tiempo real
    const menuData = getPublicQrMenuData(dbCtx.rawDb);
    const html = generateSelfContainedHtml(menuData);
    return reply.type('text/html; charset=utf-8').send(html);
  });

  // 5. Servicio de snapshot JSON en GET /qr/menu-snapshot.json
  fastify.get('/qr/menu-snapshot.json', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const distJsonPath = path.resolve(process.cwd(), './data/qr-static-dist/menu-snapshot.json');

    if (process.env.NODE_ENV !== 'test' && fs.existsSync(distJsonPath)) {
      const json = fs.readFileSync(distJsonPath, 'utf-8');
      return reply.type('application/json; charset=utf-8').send(json);
    }

    const menuData = getPublicQrMenuData(dbCtx.rawDb);
    return reply.type('application/json; charset=utf-8').send(menuData);
  });
};
