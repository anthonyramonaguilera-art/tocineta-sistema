import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

interface RateLimitEntry {
  count: number;
  resetAtMs: number;
}

interface RateLimitRule {
  maxRequests: number;
  windowMs: number;
  maxContentLength?: number;
}

const PUBLIC_RULES: Record<string, RateLimitRule> = {
  '/api/auth/register': {
    maxRequests: 5,
    windowMs: 10 * 60 * 1000 // 10 minutos
  },
  '/api/client-errors': {
    maxRequests: 60,
    windowMs: 60 * 1000, // 1 minuto
    maxContentLength: 16384 // 16 KB
  }
};

const ipRateLimitStore = new Map<string, RateLimitEntry>();

export function resetRateLimitStore(): void {
  ipRateLimitStore.clear();
}

export const publicRateLimitPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'POST') {
      return;
    }

    const rawUrl = request.raw.url || request.url;
    const urlPath = rawUrl.split('?')[0];

    const rule = PUBLIC_RULES[urlPath];
    if (!rule) {
      return;
    }

    // 1. Verificación de tamaño de payload si la regla define maxContentLength
    if (rule.maxContentLength !== undefined) {
      const contentLengthHeader = request.headers['content-length'];
      if (contentLengthHeader !== undefined) {
        const contentLength = Number(contentLengthHeader);
        if (!isNaN(contentLength) && contentLength > rule.maxContentLength) {
          return reply.status(413).send({
            success: false,
            error: 'Payload Too Large'
          });
        }
      }
    }

    const now = Date.now();

    // 2. Limpieza perezosa de entradas vencidas si el almacén crece
    if (ipRateLimitStore.size > 1000) {
      for (const [key, value] of ipRateLimitStore.entries()) {
        if (now >= value.resetAtMs) {
          ipRateLimitStore.delete(key);
        }
      }
    }

    // 3. Extracción de IP del cliente
    const xForwardedFor = request.headers['x-forwarded-for'];
    const ip = (typeof xForwardedFor === 'string' ? xForwardedFor.split(',')[0].trim() : '') ||
      request.ip ||
      request.socket.remoteAddress ||
      '127.0.0.1';

    const storeKey = `${urlPath}:${ip}`;
    const entry = ipRateLimitStore.get(storeKey);

    if (!entry || now >= entry.resetAtMs) {
      ipRateLimitStore.set(storeKey, {
        count: 1,
        resetAtMs: now + rule.windowMs
      });
      return;
    }

    entry.count += 1;
    if (entry.count > rule.maxRequests) {
      const retryAfterMs = Math.max(0, entry.resetAtMs - now);
      return reply.status(429).send({
        success: false,
        code: 'RATE_LIMITED',
        retryAfterMs
      });
    }
  });
});

export default publicRateLimitPlugin;
