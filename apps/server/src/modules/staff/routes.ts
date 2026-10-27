import type { FastifyPluginAsync } from 'fastify';
import { staffAdminRoutes } from './admin-routes.js';
import { staffPayrollRoutes } from './payroll-routes.js';
import { staffTipsRoutes } from './tips-routes.js';

export const staffRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(staffAdminRoutes);
  await fastify.register(staffPayrollRoutes);
  await fastify.register(staffTipsRoutes);
};
