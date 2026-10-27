import type { FastifyPluginAsync } from 'fastify';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import { getDatabaseContext } from '../../db/connection.js';
import { UsersService } from './users-service.js';
import { validatePinFormat } from '../auth/pin.js';
import type { UserRole } from '../../db/schema.js';

export const staffAdminRoutes: FastifyPluginAsync = async (fastify) => {
  // Helper de autenticación administrativa
  const requireAdminOrSupervisor = (request: any, reply: any, requireOnlyAdmin = false) => {
    const rawToken = extractSessionToken(request.headers.authorization);
    if (!rawToken) {
      reply.status(401).send({ success: false, error: 'Token no proporcionado' });
      return null;
    }

    const tokenHash = hashToken(rawToken);
    const dbCtx = getDatabaseContext();
    const now = Date.now();

    const rawSession = dbCtx.rawDb.prepare(`
      SELECT s.*, u.role as user_role
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL AND s.expires_at_ms > ?
    `).get(tokenHash, now) as any;

    if (!rawSession) {
      reply.status(401).send({ success: false, error: 'Sesión inválida o expirada' });
      return null;
    }

    if (requireOnlyAdmin && rawSession.user_role !== 'admin') {
      reply.status(403).send({ success: false, error: 'Acceso restringido a administradores' });
      return null;
    }

    if (rawSession.user_role !== 'admin' && rawSession.user_role !== 'supervisor') {
      reply.status(403).send({ success: false, error: 'Acceso restringido a administradores y supervisores' });
      return null;
    }

    return rawSession;
  };

  // 1. Listado de usuarios/personal
  fastify.get('/api/admin/users', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply);
    if (!session) return;

    const staff = await UsersService.listStaff();
    return reply.status(200).send({
      success: true,
      users: staff,
      staff
    });
  });

  // 2. Crear nuevo trabajador con credenciales reales
  fastify.post('/api/admin/users', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply, true);
    if (!session) return;

    const body = request.body as {
      name?: string;
      username?: string;
      role?: UserRole;
      pin?: string;
      password?: string;
      cedula?: string;
      phone?: string;
      permissions?: string[];
      salaryScheme?: 'DIARIO' | 'SEMANAL' | 'QUINCENAL';
      baseSalaryUsdCents?: number;
    } | undefined;

    if (!body?.name || !body?.role || !body?.pin) {
      return reply.status(400).send({ success: false, error: 'Debe proporcionar name, role y pin' });
    }

    const formatCheck = validatePinFormat(body.pin, body.role);
    if (!formatCheck.valid) {
      return reply.status(400).send({ success: false, error: formatCheck.error });
    }

    try {
      const newUser = await UsersService.createEmployee({
        name: body.name,
        username: body.username,
        role: body.role,
        pin: body.pin,
        password: body.password,
        cedula: body.cedula,
        phone: body.phone,
        permissions: body.permissions,
        createdByUser: session.user_id,
        salaryScheme: body.salaryScheme,
        baseSalaryUsdCents: body.baseSalaryUsdCents
      });

      return reply.status(201).send({
        success: true,
        user: {
          id: newUser.id,
          name: newUser.name,
          username: newUser.username,
          role: newUser.role,
          permissions: newUser.permissions
        }
      });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // 3. Aprobar trabajador pendiente
  fastify.patch('/api/admin/users/:id/approve', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { role?: UserRole; permissions?: string[] };

    try {
      const updated = await UsersService.approveWorker(id, body.role, body.permissions, session.user_id);
      return reply.status(200).send({
        success: true,
        user: updated
      });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // 4. Modificar permisos de trabajador
  fastify.patch('/api/admin/users/:id/permissions', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { permissions: string[]; role?: UserRole };

    try {
      const updated = await UsersService.updatePermissions(id, body.permissions, body.role, session.user_id);
      return reply.status(200).send({
        success: true,
        user: updated
      });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // 5. Modificar rol de trabajador
  fastify.patch('/api/admin/users/:id/role', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { role: UserRole };

    if (!body?.role) {
      return reply.status(400).send({ success: false, error: 'Debe especificar el rol' });
    }

    try {
      await UsersService.updateRole(id, body.role, session.user_id);
      return reply.status(200).send({ success: true, role: body.role });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // 6. Eliminar / Dar de baja trabajador
  fastify.delete('/api/admin/users/:id', async (request, reply) => {
    const session = requireAdminOrSupervisor(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };

    try {
      const res = await UsersService.deleteOrDeactivate(id, session.user_id);
      return reply.status(200).send(res);
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });
};
