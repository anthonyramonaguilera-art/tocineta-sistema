import type { FastifyPluginAsync } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDatabaseContext } from '../../db/connection.js';
import {
  getPublicQrMenuData,
  generateStaticQrSite,
  getCloudSummaryMetrics,
  generateSelfContainedHtml
} from './qr-menu-service.js';

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
      return reply.status(200).send({
        success: true,
        ...summary,
        summary
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
