import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { createHotSnapshot, listSnapshots } from './snapshot-service.js';
import { createEncryptedBackup, getBackupsHistory, executeDryRunVerification } from './backup-service.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';

interface BackupsRoutesOptions {
  rawDb: Database.Database;
}

export const backupsRoutes: FastifyPluginAsync<BackupsRoutesOptions> = async (fastify, options) => {
  const { rawDb } = options;

  // Helper para autenticar sesión
  const getUserFromRequest = (req: any) => {
    const rawToken = extractSessionToken(req.headers.authorization);
    if (!rawToken) return null;
    const tokenHash = hashToken(rawToken);
    const session = rawDb.prepare(`
      SELECT s.user_id, u.name, u.role 
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL
    `).get(tokenHash) as { user_id: string; name: string; role: any } | undefined;

    if (!session) return null;
    return {
      id: session.user_id,
      name: session.name,
      role: session.role
    };
  };

  /**
   * Dispara un Hot Snapshot manual inmediato
   */
  fastify.post('/api/backups/snapshot', async (request, reply) => {
    const user = getUserFromRequest(request);
    if (!user || (user.role !== 'admin' && user.role !== 'supervisor')) {
      return reply.status(403).send({ error: 'Solo Admin o Supervisor pueden disparar snapshots manuales' });
    }

    try {
      const result = await createHotSnapshot(rawDb);
      return reply.status(201).send({
        success: true,
        message: 'Snapshot en caliente creado exitosamente',
        snapshot: result
      });
    } catch (err: any) {
      fastify.log.error(err, 'Error al crear snapshot en caliente');
      return reply.status(500).send({ error: 'Error al generar snapshot en caliente', details: err.message });
    }
  });

  /**
   * Dispara el respaldo cifrado con age (Botón "Respaldar Ahora")
   */
  fastify.post('/api/backups/export-encrypted', async (request, reply) => {
    const user = getUserFromRequest(request);
    if (!user || (user.role !== 'admin' && user.role !== 'supervisor')) {
      return reply.status(403).send({ error: 'Solo Admin o Supervisor pueden exportar respaldos cifrados' });
    }

    const body = (request.body as any) || {};

    try {
      const result = await createEncryptedBackup(rawDb, {
        destinationDir: body.destinationDir,
        jornadaId: body.jornadaId,
        actorUserId: user.id,
        backupType: 'MANUAL_EXPORT',
        recipients: body.recipients,
        scanRoots: body.scanRoots
      });

      return reply.status(201).send({
        success: true,
        message: 'Respaldo cifrado con age exportado exitosamente',
        backup: result
      });
    } catch (err: any) {
      fastify.log.error(err, 'Error al exportar respaldo cifrado');
      return reply.status(500).send({ error: 'Error al generar respaldo cifrado age', details: err.message });
    }
  });

  /**
   * SUG-03: Simulacro Automático de Restauración (Dry-Run)
   */
  fastify.post('/api/backups/dry-run-verify', async (_request, reply) => {
    try {
      const result = await executeDryRunVerification();
      return reply.status(200).send(result);
    } catch (err: any) {
      fastify.log.error(err, 'Error al ejecutar simulacro dry-run');
      return reply.status(500).send({
        status: 'ERROR',
        error: err.message,
        checkedAtMs: Date.now()
      });
    }
  });

  /**
   * Consulta el historial de respaldos en bitácora
   */
  fastify.get('/api/backups/history', async (_request, reply) => {
    try {
      const history = getBackupsHistory(rawDb, 50);
      return reply.send({ success: true, history });
    } catch (err: any) {
      return reply.status(500).send({ error: 'Error al consultar historial de respaldos', details: err.message });
    }
  });

  /**
   * Lista los snapshots locales existentes
   */
  fastify.get('/api/backups/snapshots', async (_request, reply) => {
    try {
      const snapshots = listSnapshots();
      return reply.send({ success: true, snapshots });
    } catch (err: any) {
      return reply.status(500).send({ error: 'Error al listar snapshots', details: err.message });
    }
  });
};
