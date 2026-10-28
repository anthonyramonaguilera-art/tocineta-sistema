import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import {
  getCurrentSystemVersion,
  applySignedUpdatePackage,
  isSalesHours,
  OFFICIAL_UPDATE_PUBLIC_KEY
} from './updater-service.js';
import { verifyManifestSignature } from './signer.js';

export const updaterRoutes: FastifyPluginAsync = async (fastify) => {
  const getUserFromRequest = (req: any) => {
    const dbCtx = getDatabaseContext();
    const rawToken = extractSessionToken(req.headers.authorization);
    if (!rawToken) return null;
    const tokenHash = hashToken(rawToken);
    return dbCtx.rawDb.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at_ms > ?').get(tokenHash, Date.now()) as { user_id: string } | undefined;
  };
  // 1. Consultar versión actual del sistema y ventana de mantenimiento
  fastify.get('/api/updater/version', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const version = getCurrentSystemVersion(dbCtx.rawDb);
    const inSalesWindow = isSalesHours();

    return reply.status(200).send({
      success: true,
      version,
      isSalesHours: inSalesWindow,
      maintenanceWindowActive: !inSalesWindow,
      message: inSalesWindow
        ? 'Horario de venta activo (16:00 a 02:00 Caracas). Actualizaciones ordinarias bloqueadas.'
        : 'Ventana de mantenimiento activa. Actualizaciones permitidas.'
    });
  });

  // 2. Aplicar paquete de actualización firmado con Ed25519
  fastify.post('/api/updater/apply', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as {
      manifestJson?: string;
      signatureBase64?: string;
      filesData?: Record<string, string>;
      forceEmergencyUpdate?: boolean;
      adminPin?: string;
    } | undefined;

    if (!body?.manifestJson || !body?.signatureBase64) {
      return reply.status(400).send({
        success: false,
        error: 'Debe proporcionar manifestJson y signatureBase64 del paquete firmado'
      });
    }

    try {
      const result = await applySignedUpdatePackage(
        dbCtx.rawDb,
        {
          manifestJson: body.manifestJson,
          signatureBase64: body.signatureBase64,
          filesData: body.filesData
        },
        {
          forceEmergencyUpdate: body.forceEmergencyUpdate,
          adminPin: body.adminPin,
          actorUserId: user?.user_id
        }
      );

      return reply.status(200).send(result);
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({
        success: false,
        code: err.code || 'UPDATE_ERROR',
        error: err.message || 'Error al aplicar actualización'
      });
    }
  });

  // 3. Verificar firma de paquete sin aplicar (Dry-Run de firma)
  fastify.post('/api/updater/verify', async (request, reply) => {
    const body = request.body as {
      manifestJson?: string;
      signatureBase64?: string;
      publicKeyPem?: string;
    } | undefined;

    if (!body?.manifestJson || !body?.signatureBase64) {
      return reply.status(400).send({
        success: false,
        error: 'Debe proporcionar manifestJson y signatureBase64'
      });
    }

    const publicKey = body.publicKeyPem || OFFICIAL_UPDATE_PUBLIC_KEY;
    const isValid = verifyManifestSignature(body.manifestJson, body.signatureBase64, publicKey);

    return reply.status(200).send({
      success: true,
      isValid,
      message: isValid
        ? 'Firma digital Ed25519 válida'
        : 'Firma digital Ed25519 inválida o alterada'
    });
  });
};
