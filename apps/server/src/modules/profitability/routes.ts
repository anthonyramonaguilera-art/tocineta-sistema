import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import {
  getSupplyItems,
  bulkUpdateSupplyCosts,
  type SupplyBulkUpdateItem
} from './costing.js';
import {
  seedCriticalSuppliesAndRecipes,
  reconcileCriticalInventory,
  calculateTheoreticalConsumption,
  CRITICAL_SUPPLIES
} from './inventory.js';
import {
  createOperatingExpense,
  getOperatingExpenses,
  calculateJornadaNetProfit,
  type OperatingExpenseInput
} from './net-profit.js';
import { generateMenuEngineeringReport } from './menu-engineering.js';

export const profitabilityRoutes: FastifyPluginAsync = async (fastify) => {
  const getUserFromRequest = (req: any) => {
    const dbCtx = getDatabaseContext();
    const rawToken = extractSessionToken(req.headers.authorization);
    if (!rawToken) return null;
    const tokenHash = hashToken(rawToken);
    return dbCtx.rawDb.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at_ms > ?').get(tokenHash, Date.now()) as { user_id: string } | undefined;
  };

  // 1. Configuración de Interruptores (profitability_pro_enabled & fiscal_module_enabled)
  fastify.get('/api/profitability/settings', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const row = dbCtx.rawDb.prepare(`
      SELECT profitability_pro_enabled, fiscal_module_enabled
      FROM business_settings
      WHERE id = 'default'
    `).get() as any;

    return reply.status(200).send({
      success: true,
      profitabilityProEnabled: Boolean(row?.profitability_pro_enabled),
      fiscalModuleEnabled: Boolean(row?.fiscal_module_enabled)
    });
  });

  fastify.patch('/api/profitability/settings', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = request.body as {
      profitabilityProEnabled?: boolean;
      fiscalModuleEnabled?: boolean;
    } | undefined;

    const row = dbCtx.rawDb.prepare(`
      SELECT profitability_pro_enabled, fiscal_module_enabled
      FROM business_settings
      WHERE id = 'default'
    `).get() as any;

    const newPro = body?.profitabilityProEnabled !== undefined
      ? (body.profitabilityProEnabled ? 1 : 0)
      : (row?.profitability_pro_enabled ?? 0);

    const newFiscal = body?.fiscalModuleEnabled !== undefined
      ? (body.fiscalModuleEnabled ? 1 : 0)
      : (row?.fiscal_module_enabled ?? 0);

    dbCtx.rawDb.prepare(`
      UPDATE business_settings
      SET profitability_pro_enabled = ?,
          fiscal_module_enabled = ?,
          updated_at_ms = ?
      WHERE id = 'default'
    `).run(newPro, newFiscal, Date.now());

    return reply.status(200).send({
      success: true,
      profitabilityProEnabled: Boolean(newPro),
      fiscalModuleEnabled: Boolean(newFiscal),
      message: 'Configuración de Rentabilidad Pro y Módulo Fiscal actualizada'
    });
  });

  // 2. Sembrar los 8 insumos críticos y recetas técnicas
  fastify.post('/api/profitability/seed-critical', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    seedCriticalSuppliesAndRecipes(dbCtx.rawDb);

    return reply.status(200).send({
      success: true,
      message: '8 Insumos Críticos y Recetas Técnicas sembrados exitosamente'
    });
  });

  // 3. Nivel 1: Insumos, Alerta >30 días y Asistente de Actualización Masiva
  fastify.get('/api/profitability/supplies', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    seedCriticalSuppliesAndRecipes(dbCtx.rawDb);
    const supplies = getSupplyItems(dbCtx.rawDb);

    return reply.status(200).send({
      success: true,
      supplies
    });
  });

  fastify.post('/api/profitability/supplies/bulk-update', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as { items: SupplyBulkUpdateItem[] };

    if (!body?.items || !Array.isArray(body.items)) {
      return reply.status(400).send({
        success: false,
        error: 'Debe enviar un arreglo de items a actualizar'
      });
    }

    const result = bulkUpdateSupplyCosts(dbCtx.rawDb, body.items, user?.user_id);
    return reply.status(200).send({
      success: true,
      ...result,
      message: `${result.updatedCount} insumo(s) actualizado(s) y ${result.historyCount} cambio(s) registrado(s) en historial`
    });
  });

  // 4. Nivel 2: Control de Inventario Crítico y Varianza
  fastify.get('/api/profitability/inventory/critical', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    seedCriticalSuppliesAndRecipes(dbCtx.rawDb);
    const query = request.query as { jornadaId?: string } | undefined;

    let targetJornadaId = query?.jornadaId;
    if (!targetJornadaId) {
      const openJornada = dbCtx.rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
      targetJornadaId = openJornada?.id;
    }

    const supplies = getSupplyItems(dbCtx.rawDb);
    const criticalOnly = supplies.filter(s => CRITICAL_SUPPLIES.some(c => c.id === s.id));
    const theoreticalConsumption = targetJornadaId ? calculateTheoreticalConsumption(dbCtx.rawDb, targetJornadaId) : new Map<string, number>();

    const items = criticalOnly.map(c => ({
      ...c,
      theoreticalConsumptionQty: theoreticalConsumption.get(c.id) || 0
    }));

    return reply.status(200).send({
      success: true,
      jornadaId: targetJornadaId || null,
      criticalSupplies: items
    });
  });

  fastify.post('/api/profitability/inventory/reconcile', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as {
      jornadaId?: string;
      physicalCounts: Array<{ supplyItemId: string; physicalQty: number }>;
    };

    let targetJornadaId = body?.jornadaId;
    if (!targetJornadaId) {
      const openJornada = dbCtx.rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
      targetJornadaId = openJornada?.id;
    }

    if (!targetJornadaId) {
      return reply.status(400).send({
        success: false,
        error: 'No se encontró una jornada activa para conciliar inventario'
      });
    }

    if (!body?.physicalCounts || !Array.isArray(body.physicalCounts)) {
      return reply.status(400).send({
        success: false,
        error: 'Debe ingresar el conteo físico de los insumos'
      });
    }

    const result = reconcileCriticalInventory(
      dbCtx.rawDb,
      targetJornadaId,
      body.physicalCounts,
      user?.user_id
    );

    return reply.status(200).send({
      success: true,
      ...result,
      message: 'Conciliación de inventario crítico completada exitosamente'
    });
  });

  // 5. Nivel 3: Caja Chica, Gastos Operativos y Utilidad Neta Real
  fastify.get('/api/profitability/expenses', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const query = request.query as { jornadaId?: string };

    let targetJornadaId = query?.jornadaId;
    if (!targetJornadaId) {
      const openJornada = dbCtx.rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
      targetJornadaId = openJornada?.id;
    }

    const expenses = targetJornadaId ? getOperatingExpenses(dbCtx.rawDb, targetJornadaId) : [];
    return reply.status(200).send({
      success: true,
      jornadaId: targetJornadaId || null,
      expenses
    });
  });

  fastify.post('/api/profitability/expenses', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as OperatingExpenseInput;

    if (!body?.category || !body?.amountUsdCents || !body?.description) {
      return reply.status(400).send({
        success: false,
        error: 'Categoría, monto en centavos y descripción son obligatorios'
      });
    }

    let targetJornadaId = body.jornadaId;
    if (!targetJornadaId) {
      const openJornada = dbCtx.rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
      targetJornadaId = openJornada?.id;
    }

    if (!targetJornadaId) {
      return reply.status(400).send({
        success: false,
        error: 'No hay una jornada abierta para imputar el gasto'
      });
    }

    const expense = createOperatingExpense(dbCtx.rawDb, {
      ...body,
      jornadaId: targetJornadaId,
      authorizedByUserId: user?.user_id || 'usr_admin_olinelcys'
    });

    return reply.status(201).send({
      success: true,
      expense,
      message: 'Gasto operativo registrado exitosamente en caja chica'
    });
  });

  fastify.get('/api/profitability/net-profit', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const query = request.query as { jornadaId?: string };

    let targetJornadaId = query?.jornadaId;
    if (!targetJornadaId) {
      const openJornada = dbCtx.rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
      targetJornadaId = openJornada?.id;
    }

    if (!targetJornadaId) {
      return reply.status(400).send({
        success: false,
        error: 'No se especificó ni se encontró una jornada activa'
      });
    }

    const report = calculateJornadaNetProfit(dbCtx.rawDb, targetJornadaId);
    return reply.status(200).send({
      success: true,
      report
    });
  });

  // 6. Nivel 4: Ingeniería de Menú de Kasavana & Smith, ABC y Punto de Equilibrio
  fastify.get('/api/profitability/menu-engineering', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const query = request.query as {
      startDateMs?: string;
      endDateMs?: string;
      jornadaId?: string;
    };

    seedCriticalSuppliesAndRecipes(dbCtx.rawDb);

    const report = generateMenuEngineeringReport(dbCtx.rawDb, {
      startDateMs: query.startDateMs ? Number(query.startDateMs) : undefined,
      endDateMs: query.endDateMs ? Number(query.endDateMs) : undefined,
      jornadaId: query.jornadaId
    });

    return reply.status(200).send({
      success: true,
      report
    });
  });
};
