import type { FastifyPluginAsync } from 'fastify';
import fastifyStatic from '@fastify/static';
import * as path from 'node:path';
import * as fs from 'node:fs';

export const staticPlugin: FastifyPluginAsync = async (fastify) => {
  // Buscar apps/web/dist relativo a la raíz del monorepo
  const candidatePaths = [
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(process.cwd(), '../../apps/web/dist')
  ];

  let webDistDir = candidatePaths.find(p => fs.existsSync(p));

  // Carpeta de subida local de fotos de productos (data/uploads)
  const uploadsDir = path.resolve(process.cwd(), 'data/uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  await fastify.register(fastifyStatic, {
    root: uploadsDir,
    prefix: '/uploads/',
    decorateReply: false
  });

  if (!webDistDir) {
    fastify.log.warn('⚠️ No se encontró la carpeta compilada de la UI (apps/web/dist). La API responderá normalmente.');
    return;
  }

  fastify.log.info(`📁 Servidor estático montado desde: ${webDistDir}`);

  await fastify.register(fastifyStatic, {
    root: webDistDir,
    prefix: '/',
    wildcard: false
  });

  // Fallback SPA para rutas que no sean /api ni /ws ni /uploads
  fastify.setNotFoundHandler(async (request, reply) => {
    if (request.raw.url && (request.raw.url.startsWith('/api') || request.raw.url.startsWith('/ws') || request.raw.url.startsWith('/uploads'))) {
      return reply.status(404).send({
        success: false,
        error: `Ruta no encontrada: ${request.raw.url}`
      });
    }

    const indexHtmlPath = path.join(webDistDir!, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      return reply.sendFile('index.html');
    }

    return reply.status(404).send({
      success: false,
      error: 'Página no encontrada y index.html no disponible.'
    });
  });
};
