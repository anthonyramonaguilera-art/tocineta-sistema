import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseContext } from '../../db/connection.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import {
  getAllLocations,
  createLocation,
  updateLocation,
  getUserLocations,
  setUserLocations
} from './locations-service.js';
import {
  getSubRecipes,
  saveSubRecipe,
  getAllProductRecipes,
  getProductRecipe,
  saveProductRecipe
} from './recipes-service.js';
import {
  registerPurchase,
  confirmPriceAdjustments,
  getPriceHistory
} from './purchases-service.js';
import {
  registerWasteLog,
  getWasteLogs,
  performPhysicalStockCount
} from './waste-service.js';
import {
  generateTemplateCsv,
  exportSetupCsv,
  importSetupCsv,
  saveWizardData,
  resetToProductionClean,
  seedDemoData
} from './setup-wizard-service.js';
import { generateUuidV7 } from '@tocineta/shared';

export const fase3Routes: FastifyPluginAsync = async (fastify) => {
  const getUserFromRequest = (req: any) => {
    const dbCtx = getDatabaseContext();
    const rawToken = extractSessionToken(req.headers.authorization);
    if (!rawToken) return null;
    const tokenHash = hashToken(rawToken);
    return dbCtx.rawDb.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at_ms > ?').get(tokenHash, Date.now()) as { user_id: string } | undefined;
  };

  // --------------------------------------------------------------------------
  // 1. SEDES (LOCATIONS)
  // --------------------------------------------------------------------------

  fastify.get('/api/locations', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const onlyActive = (request.query as any)?.active === 'true';
    const locs = getAllLocations(dbCtx.rawDb, onlyActive);
    return reply.send({ success: true, locations: locs });
  });

  fastify.post('/api/locations', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = request.body as any;
    if (!body?.name?.trim()) {
      return reply.status(400).send({ success: false, error: 'El nombre de la sede es obligatorio' });
    }
    const loc = createLocation(dbCtx.rawDb, {
      name: body.name,
      type: body.type || 'sale',
      address: body.address,
      phone: body.phone
    });
    return reply.status(201).send({ success: true, location: loc });
  });

  fastify.patch('/api/locations/:id', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const loc = updateLocation(dbCtx.rawDb, id, body);
    return reply.send({ success: true, location: loc });
  });

  fastify.get('/api/user-locations', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const userId = user?.user_id || 'usr_admin';
    const userLocs = getUserLocations(dbCtx.rawDb, userId);
    return reply.send({ success: true, ...userLocs });
  });

  fastify.patch('/api/user-locations', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const userId = user?.user_id || 'usr_admin';
    const body = request.body as { defaultLocationId: string; allowedLocationIds: string[] };
    if (!body?.defaultLocationId) {
      return reply.status(400).send({ success: false, error: 'defaultLocationId es obligatorio' });
    }
    setUserLocations(dbCtx.rawDb, userId, body.defaultLocationId, body.allowedLocationIds || [body.defaultLocationId]);
    return reply.send({ success: true, message: 'Sedes de usuario actualizadas' });
  });

  // --------------------------------------------------------------------------
  // 2. INVENTARIO & INSUMOS (STOCK POR SEDE)
  // --------------------------------------------------------------------------

  fastify.get('/api/fase3/supplies', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const locationId = (request.query as any)?.locationId;

    const supplies = dbCtx.rawDb.prepare(`
      SELECT s.*,
             COALESCE(s.weighted_avg_cost_usd_cents, s.cost_per_unit_usd_cents, 0) as effective_cost_cents
      FROM supply_items s
      WHERE s.is_active = 1
      ORDER BY s.name ASC
    `).all() as any[];

    const locInvs = dbCtx.rawDb.prepare('SELECT location_id, supply_id, current_stock_qty, minimum_stock_qty FROM location_inventory').all() as any[];
    const locInvMap = new Map<string, number>();
    for (const li of locInvs) {
      locInvMap.set(`${li.location_id}:${li.supply_id}`, li.current_stock_qty);
    }

    const result = supplies.map(s => {
      const stockAltaVista = locInvMap.get(`loc_alta_vista:${s.id}`) || 0;
      const stockLosOlivos = locInvMap.get(`loc_los_olivos:${s.id}`) || 0;
      const currentSelectedStock = locationId && locationId !== 'ALL'
        ? (locInvMap.get(`${locationId}:${s.id}`) || 0)
        : (s.current_stock_qty || 0);

      return {
        id: s.id,
        name: s.name,
        unit: s.unit,
        purchaseUnit: s.purchase_unit || s.unit || 'paquete',
        usageUnit: s.usage_unit || 'und',
        conversionFactor: s.conversion_factor || 1.0,
        category: s.category || 'general',
        minStock: s.min_stock || s.minimum_stock_qty || 0,
        costPerUnitUsdCents: s.cost_per_unit_usd_cents || 0,
        weightedAvgCostUsdCents: s.weighted_avg_cost_usd_cents || s.cost_per_unit_usd_cents || 0,
        lastCostUsdCents: s.last_cost_usd_cents || s.cost_per_unit_usd_cents || 0,
        currentStockQty: currentSelectedStock,
        stockByLocation: {
          loc_alta_vista: stockAltaVista,
          loc_los_olivos: stockLosOlivos
        }
      };
    });

    return reply.send({ success: true, supplies: result });
  });

  fastify.post('/api/fase3/supplies', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = request.body as any;
    if (!body?.name?.trim()) {
      return reply.status(400).send({ success: false, error: 'El nombre del insumo es obligatorio' });
    }
    const id = body.id || `sup_${body.name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30)}`;
    const now = Date.now();
    const cost = Math.round(Number(body.costPerUnitUsdCents || 0));

    dbCtx.rawDb.prepare(`
      INSERT INTO supply_items (
        id, name, unit, unit_measure, purchase_unit, usage_unit, conversion_factor,
        category, min_stock, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents,
        last_cost_usd_cents, is_active, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        purchase_unit = excluded.purchase_unit,
        usage_unit = excluded.usage_unit,
        conversion_factor = excluded.conversion_factor,
        category = excluded.category,
        min_stock = excluded.min_stock,
        cost_per_unit_usd_cents = excluded.cost_per_unit_usd_cents,
        updated_at_ms = excluded.updated_at_ms
    `).run(
      id,
      body.name.trim(),
      body.purchaseUnit || 'paquete',
      body.usageUnit || 'und',
      body.purchaseUnit || 'paquete',
      body.usageUnit || 'und',
      body.conversionFactor || 1.0,
      body.category || 'general',
      body.minStock || 0,
      cost,
      cost,
      cost,
      now,
      now
    );

    return reply.status(201).send({ success: true, supplyId: id });
  });

  fastify.get('/api/fase3/inventory/movements', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const locationId = (request.query as any)?.locationId;

    const sql = locationId && locationId !== 'ALL'
      ? `
        SELECT im.*, s.name as supply_name, s.usage_unit, l.name as location_name
        FROM inventory_movements im
        JOIN supply_items s ON im.supply_id = s.id
        JOIN locations l ON im.location_id = l.id
        WHERE im.location_id = ?
        ORDER BY im.created_at_ms DESC
        LIMIT 150
      `
      : `
        SELECT im.*, s.name as supply_name, s.usage_unit, l.name as location_name
        FROM inventory_movements im
        JOIN supply_items s ON im.supply_id = s.id
        JOIN locations l ON im.location_id = l.id
        ORDER BY im.created_at_ms DESC
        LIMIT 150
      `;

    const rows = (locationId && locationId !== 'ALL'
      ? dbCtx.rawDb.prepare(sql).all(locationId)
      : dbCtx.rawDb.prepare(sql).all()) as any[];

    return reply.send({ success: true, movements: rows });
  });

  fastify.post('/api/fase3/inventory/transfer', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as {
      fromLocationId: string;
      toLocationId: string;
      supplyId: string;
      quantity: number;
      notes?: string;
    };

    if (!body?.fromLocationId || !body?.toLocationId || !body?.supplyId || !body?.quantity || body.quantity <= 0) {
      return reply.status(400).send({ success: false, error: 'Parámetros de transferencia inválidos' });
    }

    if (body.fromLocationId === body.toLocationId) {
      return reply.status(400).send({ success: false, error: 'La sede origen y destino deben ser distintas' });
    }

    const now = Date.now();
    const actorId = user?.user_id || 'usr_admin';

    dbCtx.rawDb.transaction(() => {
      const supply = dbCtx.rawDb.prepare('SELECT cost_per_unit_usd_cents, weighted_avg_cost_usd_cents FROM supply_items WHERE id = ?').get(body.supplyId) as any;
      const unitCost = supply?.weighted_avg_cost_usd_cents || supply?.cost_per_unit_usd_cents || 0;
      const totalCost = Math.round(body.quantity * unitCost);

      // Descontar origen
      dbCtx.rawDb.prepare(`
        UPDATE location_inventory
        SET current_stock_qty = current_stock_qty - ?, updated_at_ms = ?
        WHERE location_id = ? AND supply_id = ?
      `).run(body.quantity, now, body.fromLocationId, body.supplyId);

      dbCtx.rawDb.prepare(`
        INSERT INTO inventory_movements (
          id, location_id, supply_id, movement_type, quantity_delta,
          unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
        ) VALUES (?, ?, ?, 'TRANSFERENCIA_SALIDA', ?, ?, ?, 'TRANSFERENCIA', ?, ?, ?)
      `).run(
        `mov_${generateUuidV7()}`,
        body.fromLocationId,
        body.supplyId,
        -body.quantity,
        unitCost,
        totalCost,
        body.notes || `Transferencia a ${body.toLocationId}`,
        actorId,
        now
      );

      // Aumentar destino
      dbCtx.rawDb.prepare(`
        INSERT INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms)
        VALUES (?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO UPDATE SET
          current_stock_qty = current_stock_qty + excluded.current_stock_qty,
          updated_at_ms = excluded.updated_at_ms
      `).run(
        `${body.toLocationId}_${body.supplyId}`,
        body.toLocationId,
        body.supplyId,
        body.quantity,
        now
      );

      dbCtx.rawDb.prepare(`
        INSERT INTO inventory_movements (
          id, location_id, supply_id, movement_type, quantity_delta,
          unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
        ) VALUES (?, ?, ?, 'TRANSFERENCIA_ENTRADA', ?, ?, ?, 'TRANSFERENCIA', ?, ?, ?)
      `).run(
        `mov_${generateUuidV7()}`,
        body.toLocationId,
        body.supplyId,
        body.quantity,
        unitCost,
        totalCost,
        body.notes || `Recepción desde ${body.fromLocationId}`,
        actorId,
        now
      );
    })();

    return reply.send({ success: true, message: 'Transferencia registrada exitosamente' });
  });

  // --------------------------------------------------------------------------
  // 3. RECETAS & SUB-RECETAS
  // --------------------------------------------------------------------------

  fastify.get('/api/fase3/sub-recipes', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const list = getSubRecipes(dbCtx.rawDb);
    return reply.send({ success: true, subRecipes: list });
  });

  fastify.post('/api/fase3/sub-recipes', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = request.body as any;
    if (!body?.name?.trim() || !body?.items?.length) {
      return reply.status(400).send({ success: false, error: 'Nombre e insumos componentes requeridos' });
    }
    const saved = saveSubRecipe(dbCtx.rawDb, body);
    return reply.status(201).send({ success: true, subRecipe: saved });
  });

  fastify.get('/api/fase3/recipes', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const list = getAllProductRecipes(dbCtx.rawDb);
    return reply.send({ success: true, recipes: list });
  });

  fastify.get('/api/fase3/recipes/:productId', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { productId } = request.params as { productId: string };
    const detail = getProductRecipe(dbCtx.rawDb, productId);
    if (!detail) return reply.status(404).send({ success: false, error: 'Producto no encontrado' });
    return reply.send({ success: true, recipe: detail });
  });

  fastify.post('/api/fase3/recipes/:productId', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { productId } = request.params as { productId: string };
    const body = request.body as any;
    const updated = saveProductRecipe(dbCtx.rawDb, productId, body);
    return reply.send({ success: true, recipe: updated });
  });

  // --------------------------------------------------------------------------
  // 4. COMPRAS (PURCHASES ASSISTANT) & PRICE HISTORY
  // --------------------------------------------------------------------------

  fastify.get('/api/fase3/purchases', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const locationId = (request.query as any)?.locationId;

    const sql = locationId && locationId !== 'ALL'
      ? `
        SELECT p.*, s.name as supplier_name, l.name as location_name
        FROM purchases p
        LEFT JOIN suppliers s ON p.supplier_id = s.id
        LEFT JOIN locations l ON p.location_id = l.id
        WHERE p.location_id = ?
        ORDER BY p.created_at_ms DESC
        LIMIT 100
      `
      : `
        SELECT p.*, s.name as supplier_name, l.name as location_name
        FROM purchases p
        LEFT JOIN suppliers s ON p.supplier_id = s.id
        LEFT JOIN locations l ON p.location_id = l.id
        ORDER BY p.created_at_ms DESC
        LIMIT 100
      `;

    const rows = (locationId && locationId !== 'ALL'
      ? dbCtx.rawDb.prepare(sql).all(locationId)
      : dbCtx.rawDb.prepare(sql).all()) as any[];

    return reply.send({ success: true, purchases: rows });
  });

  fastify.post('/api/fase3/purchases', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as any;

    if (!body?.locationId || !body?.items?.length) {
      return reply.status(400).send({ success: false, error: 'Sede destino e ítems de compra obligatorios' });
    }

    const result = registerPurchase(dbCtx.rawDb, {
      ...body,
      createdBy: user?.user_id || 'usr_admin'
    });

    return reply.status(201).send({ success: true, ...result });
  });

  fastify.post('/api/fase3/purchases/adjust-prices', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as { adjustments: Array<{ productId: string; newPriceUsdCents: number; reason?: string }> };

    if (!body?.adjustments?.length) {
      return reply.status(400).send({ success: false, error: 'Lista de ajustes de precio requerida' });
    }

    const res = confirmPriceAdjustments(dbCtx.rawDb, body.adjustments, user?.user_id || 'usr_admin');
    return reply.send({ success: true, ...res });
  });

  fastify.get('/api/fase3/price-history', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const productId = (request.query as any)?.productId;
    const history = getPriceHistory(dbCtx.rawDb, productId);
    return reply.send({ success: true, history });
  });

  // --------------------------------------------------------------------------
  // 5. MERMAS & CONTEO FÍSICO
  // --------------------------------------------------------------------------

  fastify.get('/api/fase3/waste', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const locationId = (request.query as any)?.locationId;
    const logs = getWasteLogs(dbCtx.rawDb, locationId);
    return reply.send({ success: true, wasteLogs: logs });
  });

  fastify.post('/api/fase3/waste', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as any;

    if (!body?.locationId || (!body?.supplyId && !body?.productId) || !body?.quantity || body.quantity <= 0) {
      return reply.status(400).send({ success: false, error: 'Sede, insumo/producto y cantidad positiva obligatorios' });
    }

    const log = registerWasteLog(dbCtx.rawDb, {
      ...body,
      reportedByUserId: user?.user_id || 'usr_admin'
    });

    return reply.status(201).send({ success: true, wasteLog: log });
  });

  fastify.post('/api/fase3/stock-counts', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as any;

    if (!body?.locationId || !body?.counts?.length) {
      return reply.status(400).send({ success: false, error: 'Sede y conteos físicos requeridos' });
    }

    const res = performPhysicalStockCount(dbCtx.rawDb, {
      locationId: body.locationId,
      jornadaId: body.jornadaId,
      countedByUserId: user?.user_id || 'usr_admin',
      counts: body.counts
    });

    return reply.send({ success: true, ...res });
  });

  // --------------------------------------------------------------------------
  // 6. ASISTENTE "CONFIGURA TU NEGOCIO" & DATOS LIMPIOS
  // --------------------------------------------------------------------------

  fastify.get('/api/fase3/setup-wizard/template', async (request, reply) => {
    const type = (request.query as any)?.type || 'supplies';
    const csv = generateTemplateCsv(type as any);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="plantilla_${type}.csv"`);
    return reply.send(csv);
  });

  fastify.get('/api/fase3/setup-wizard/export', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const csv = exportSetupCsv(dbCtx.rawDb);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="inventario_recetas_tocineta.csv"');
    return reply.send(csv);
  });

  fastify.post('/api/fase3/setup-wizard/import', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as { csvContent: string; locationId?: string };

    if (!body?.csvContent) {
      return reply.status(400).send({ success: false, error: 'Contenido CSV obligatorio' });
    }

    const res = importSetupCsv(dbCtx.rawDb, body.csvContent, body.locationId || 'loc_alta_vista', user?.user_id || 'usr_admin');
    return reply.send({ success: true, ...res });
  });

  fastify.post('/api/fase3/setup-wizard/save', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as any;

    saveWizardData(dbCtx.rawDb, body, user?.user_id || 'usr_admin');
    return reply.send({ success: true, message: 'Configuración guardada exitosamente' });
  });

  fastify.post('/api/fase3/setup-wizard/init-prod', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    resetToProductionClean(dbCtx.rawDb);
    return reply.send({ success: true, message: 'Base de datos restablecida limpia para producción (Cero datos demo)' });
  });

  fastify.post('/api/fase3/setup-wizard/seed-demo', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    seedDemoData(dbCtx.rawDb);
    return reply.send({ success: true, message: 'Datos demo sembrados con éxito (Modo DEMO activado)' });
  });
};
