import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { getDatabaseContext } from '../../db/connection.js';
import type { UserRole } from '../../db/schema.js';
import { extractSessionToken, hashToken } from '../../routes/auth.js';
import { parseRateToMicroBs } from '@tocineta/shared';
import {
  getPosMenu,
  getAdminMenu,
  toggleCategoryActive,
  setProductAvailability,
  setFlavorAvailability,
  createProduct,
  updateProduct,
  saveProductPhoto,
  addProductIngredient,
  removeProductIngredient,
  setExchangeRate
} from './menu-service.js';
import { ensureBusinessSettingsDefensive } from '../../db/business-settings.js';
import { getEventsSince } from '../events/event-bus.js';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';
import { syncBcvRateFromInternet } from './bcv-auto-sync.js';

function getSessionUser(
  rawDb: Database.Database,
  authHeader?: string
): { userId: string; role: UserRole } | null {
  const token = extractSessionToken(authHeader);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const now = Date.now();
  const row = rawDb.prepare(`
    SELECT s.user_id, s.role, u.is_active
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token_hash = ? AND s.revoked_at_ms IS NULL AND s.expires_at_ms > ?
  `).get(tokenHash, now) as { user_id: string; role: UserRole; is_active: number } | undefined;

  if (!row || !row.is_active) return null;
  return { userId: row.user_id, role: row.role };
}

function requireRoles(
  request: FastifyRequest,
  reply: FastifyReply,
  rawDb: Database.Database,
  allowedRoles: UserRole[]
): { userId: string; role: UserRole } | null {
  const user = getSessionUser(rawDb, request.headers.authorization);
  if (!user) {
    reply.status(401).send({ success: false, error: 'Sesión no válida o no autenticada' });
    return null;
  }

  if (!allowedRoles.includes(user.role)) {
    reply.status(403).send({ success: false, error: `Acceso denegado: el rol '${user.role}' no tiene permisos para esta acción` });
    return null;
  }

  return user;
}

export const menuRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. Catálogo Operativo para Comandero y Caja (GET /api/menu/pos)
  fastify.get('/api/menu/pos', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    try {
      ensureBusinessSettingsDefensive(dbCtx.rawDb);
      const data = getPosMenu(dbCtx.rawDb);
      return reply.status(200).send(data);
    } catch (err: any) {
      fastify.log.error(err, 'Error defensivo en GET /api/menu/pos');
      return reply.status(200).send({
        categories: [],
        products: [],
        exchangeRate: { rateMicroBs: 40_000_000, formattedRate: '40.00' },
        businessSettings: { businessName: 'Tocineta Sonríe', phone: '0412-0000000' }
      });
    }
  });

  // 2. Catálogo Completo para Admin (GET /api/menu/admin)
  fastify.get('/api/menu/admin', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = requireRoles(request, reply, dbCtx.rawDb, ['admin', 'supervisor']);
    if (!user) return;

    const data = getAdminMenu(dbCtx.rawDb);
    return reply.status(200).send(data);
  });

  // 3. Conmutar Feature Flag de Categoría (PATCH /api/menu/categories/:id/toggle-active)
  fastify.patch('/api/menu/categories/:id/toggle-active', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = requireRoles(request, reply, dbCtx.rawDb, ['admin']);
    if (!user) return;

    const { id } = request.params as { id: string };
    try {
      const result = toggleCategoryActive(dbCtx.rawDb, id, user.userId);
      return reply.status(200).send({ success: true, ...result });
    } catch (err: any) {
      return reply.status(404).send({ success: false, error: err.message });
    }
  });

  // 3.1 Crear Nueva Categoría (POST /api/menu/categories)
  fastify.post('/api/menu/categories', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = requireRoles(request, reply, dbCtx.rawDb, ['admin']);
    if (!user) return;

    const body = request.body as { name?: string; description?: string; station?: 'hot_dogs' | 'hamburguesas' | 'caja_bebidas' } | undefined;
    if (!body?.name?.trim()) {
      return reply.status(400).send({ success: false, error: 'Debe especificar el nombre de la categoría' });
    }

    const catId = `cat_${body.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
    const maxOrderRow = dbCtx.rawDb.prepare('SELECT MAX(display_order) as max_ord FROM categories').get() as any;
    const displayOrder = (maxOrderRow?.max_ord ?? 0) + 1;

    try {
      dbCtx.rawDb.prepare(`
        INSERT INTO categories (id, name, description, display_order, is_active, is_internal, station)
        VALUES (?, ?, ?, ?, 1, 0, ?)
      `).run(catId, body.name.trim(), body.description?.trim() || null, displayOrder, body.station || 'hot_dogs');

      appendAuditEvent(dbCtx.rawDb, {
        actorUserId: user.userId,
        action: 'CATEGORY_CREATED',
        entityType: 'category',
        entityId: catId,
        payload: { name: body.name }
      });

      return reply.status(201).send({ success: true, category: { id: catId, name: body.name } });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // 4. Toggle Rápido Disponibilidad Producto (PATCH /api/menu/products/:id/availability)
  // Accesible por admin, supervisor o cajera (mesonero/cocinero reciben 403)
  fastify.patch('/api/menu/products/:id/availability', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = requireRoles(request, reply, dbCtx.rawDb, ['admin', 'supervisor', 'cajera']);
    if (!user) return;

    const { id } = request.params as { id: string };
    const body = request.body as { isAvailable?: boolean; is_available?: number | boolean } | undefined;

    let targetAvailable: boolean;
    if (body?.isAvailable !== undefined) {
      targetAvailable = Boolean(body.isAvailable);
    } else if (body?.is_available !== undefined) {
      targetAvailable = Boolean(body.is_available);
    } else {
      // Toggle automático si no viene en el body
      const current = dbCtx.rawDb.prepare('SELECT is_available FROM products WHERE id = ?').get(id) as { is_available: number } | undefined;
      if (!current) {
        return reply.status(404).send({ success: false, error: `Producto '${id}' no encontrado` });
      }
      targetAvailable = current.is_available === 0;
    }

    try {
      const result = setProductAvailability(dbCtx.rawDb, id, targetAvailable, user.userId);
      return reply.status(200).send({ success: true, ...result });
    } catch (err: any) {
      return reply.status(404).send({ success: false, error: err.message });
    }
  });

  // 5. Toggle Rápido Disponibilidad Sabor (PATCH /api/menu/flavors/:id/availability)
  fastify.patch('/api/menu/flavors/:id/availability', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = requireRoles(request, reply, dbCtx.rawDb, ['admin', 'supervisor', 'cajera']);
    if (!user) return;

    const { id } = request.params as { id: string };
    const body = request.body as { isAvailable?: boolean; is_available?: number | boolean } | undefined;

    let targetAvailable: boolean;
    if (body?.isAvailable !== undefined) {
      targetAvailable = Boolean(body.isAvailable);
    } else if (body?.is_available !== undefined) {
      targetAvailable = Boolean(body.is_available);
    } else {
      const current = dbCtx.rawDb.prepare('SELECT is_available FROM product_flavor_options WHERE id = ?').get(id) as { is_available: number } | undefined;
      if (!current) {
        return reply.status(404).send({ success: false, error: `Sabor '${id}' no encontrado` });
      }
      targetAvailable = current.is_available === 0;
    }

    try {
      const result = setFlavorAvailability(dbCtx.rawDb, id, targetAvailable, user.userId);
      return reply.status(200).send({ success: true, ...result });
    } catch (err: any) {
      return reply.status(404).send({ success: false, error: err.message });
    }
  });

  // 6. Crear Producto (POST /api/menu/products)
  fastify.post('/api/menu/products', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = requireRoles(request, reply, dbCtx.rawDb, ['admin']);
    if (!user) return;

    const body = request.body as {
      categoryId?: string;
      name?: string;
      priceUsdCents?: number;
      estimatedCostUsdCents?: number;
      station?: 'hot_dogs' | 'hamburguesas' | 'caja_bebidas';
      description?: string;
      allowsFlavors?: boolean;
      isCombo?: boolean;
      baseIngredientIds?: string[];
    } | undefined;

    if (!body?.categoryId || !body?.name || body?.priceUsdCents === undefined || !body?.station) {
      return reply.status(400).send({
        success: false,
        error: 'Debe especificar categoryId, name, priceUsdCents y station'
      });
    }

    try {
      const created = createProduct(
        dbCtx.rawDb,
        {
          categoryId: body.categoryId,
          name: body.name,
          priceUsdCents: body.priceUsdCents,
          estimatedCostUsdCents: body.estimatedCostUsdCents,
          station: body.station,
          description: body.description,
          allowsFlavors: body.allowsFlavors,
          isCombo: body.isCombo,
          baseIngredientIds: body.baseIngredientIds
        },
        user.userId
      );
      return reply.status(201).send({ success: true, product: created });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // 7. Actualizar Producto (PATCH /api/menu/products/:id)
  fastify.patch('/api/menu/products/:id', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = requireRoles(request, reply, dbCtx.rawDb, ['admin']);
    if (!user) return;

    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      description?: string;
      priceUsdCents?: number;
      estimatedCostUsdCents?: number;
      station?: 'hot_dogs' | 'hamburguesas' | 'caja_bebidas';
      isActive?: boolean;
    } | undefined;

    try {
      const updated = updateProduct(dbCtx.rawDb, id, body || {}, user.userId);
      return reply.status(200).send({ success: true, product: updated });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // 8. Subida Local de Fotografía (POST /api/menu/products/:id/photo)
  fastify.post('/api/menu/products/:id/photo', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = requireRoles(request, reply, dbCtx.rawDb, ['admin', 'supervisor']);
    if (!user) return;

    const { id } = request.params as { id: string };
    const body = request.body as { base64?: string; photoBase64?: string } | undefined;
    const base64Data = body?.base64 || body?.photoBase64;

    if (!base64Data) {
      return reply.status(400).send({ success: false, error: 'Debe enviar la imagen en formato base64' });
    }

    try {
      const result = saveProductPhoto(dbCtx.rawDb, id, base64Data, user.userId);
      return reply.status(200).send({ success: true, ...result });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // 8.1 Agregar / Asociar Ingrediente al Producto (POST /api/menu/products/:id/ingredients)
  fastify.post('/api/menu/products/:id/ingredients', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = requireRoles(request, reply, dbCtx.rawDb, ['admin', 'supervisor']);
    if (!user) return;

    const { id } = request.params as { id: string };
    const body = request.body as { ingredientId?: string; name?: string; isRemovable?: boolean } | undefined;

    try {
      const result = addProductIngredient(dbCtx.rawDb, id, body || {}, user.userId);
      return reply.status(200).send(result);
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // 8.2 Desasociar Ingrediente del Producto (DELETE /api/menu/products/:id/ingredients/:ingredientId)
  fastify.delete('/api/menu/products/:id/ingredients/:ingredientId', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = requireRoles(request, reply, dbCtx.rawDb, ['admin', 'supervisor']);
    if (!user) return;

    const { id, ingredientId } = request.params as { id: string; ingredientId: string };

    try {
      const result = removeProductIngredient(dbCtx.rawDb, id, ingredientId, user.userId);
      return reply.status(200).send(result);
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // 9. Actualización de Tasa Oficial BCV (POST /api/menu/exchange-rate)
  fastify.post('/api/menu/exchange-rate', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = requireRoles(request, reply, dbCtx.rawDb, ['admin', 'supervisor']);
    if (!user) return;

    const body = request.body as { rateStr?: string; rateMicroBs?: number } | undefined;
    let rateMicroBs: number;

    try {
      if (body?.rateStr) {
        rateMicroBs = parseRateToMicroBs(body.rateStr);
      } else if (body?.rateMicroBs) {
        rateMicroBs = body.rateMicroBs;
      } else {
        return reply.status(400).send({ success: false, error: 'Debe especificar rateStr o rateMicroBs' });
      }

      const source = user.role === 'admin' ? 'MANUAL_ADMIN' : 'MANUAL_SUPERVISOR';
      const result = setExchangeRate(dbCtx.rawDb, rateMicroBs, user.userId, source);
      return reply.status(200).send({ success: true, ...result });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // 9.1 Sincronización Automática de Tasa BCV por Internet (POST /api/menu/exchange-rate/sync-now)
  fastify.post('/api/menu/exchange-rate/sync-now', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    try {
      const result = await syncBcvRateFromInternet(dbCtx.rawDb);
      return reply.status(200).send({
        success: true,
        ...result
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: err?.message || 'Error al sincronizar tasa BCV'
      });
    }
  });

  // 10. Gestión de Cupones (POST /api/menu/coupons)
  fastify.post('/api/menu/coupons', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = requireRoles(request, reply, dbCtx.rawDb, ['admin', 'supervisor']);
    if (!user) return;

    const body = request.body as {
      code?: string;
      description?: string;
      couponType?: 'DISCOUNT' | 'COURTESY_ITEM';
      discountMode?: 'FIXED_USD' | 'PERCENTAGE_BPS';
      discountValue?: number;
      courtesyProductId?: string;
      maxUses?: number;
    } | undefined;

    if (!body?.code || !body?.couponType) {
      return reply.status(400).send({ success: false, error: 'Debe especificar code y couponType' });
    }

    const couponId = `coup_${body.code.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
    const now = Date.now();

    try {
      dbCtx.rawDb.prepare(`
        INSERT INTO coupons (
          id, code, description, coupon_type, discount_mode, discount_value,
          courtesy_product_id, max_uses, used_count, expires_at_ms, is_active, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 1, ?)
      `).run(
        couponId,
        body.code.toUpperCase().trim(),
        body.description || null,
        body.couponType,
        body.discountMode || null,
        body.discountValue || null,
        body.courtesyProductId || null,
        body.maxUses || null,
        now
      );

      appendAuditEvent(dbCtx.rawDb, {
        actorUserId: user.userId,
        action: 'COUPON_CREATED',
        entityType: 'coupon',
        entityId: couponId,
        payload: { code: body.code, type: body.couponType }
      });

      publishDomainEvent(dbCtx.rawDb, {
        eventType: 'COUPON_UPDATED',
        entityId: couponId,
        payload: { couponId, code: body.code, isActive: true }
      });

      return reply.status(201).send({ success: true, coupon: { id: couponId, ...body } });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // 11. Toggle Cupón Activo / Inactivo (PATCH /api/menu/coupons/:id)
  fastify.patch('/api/menu/coupons/:id', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = requireRoles(request, reply, dbCtx.rawDb, ['admin', 'supervisor']);
    if (!user) return;

    const { id } = request.params as { id: string };
    const current = dbCtx.rawDb.prepare('SELECT is_active, code FROM coupons WHERE id = ?').get(id) as { is_active: number; code: string } | undefined;
    if (!current) {
      return reply.status(404).send({ success: false, error: `Cupón '${id}' no encontrado` });
    }

    const newActive = current.is_active === 1 ? 0 : 1;
    dbCtx.rawDb.prepare('UPDATE coupons SET is_active = ? WHERE id = ?').run(newActive, id);

    appendAuditEvent(dbCtx.rawDb, {
      actorUserId: user.userId,
      action: 'COUPON_TOGGLE_ACTIVE',
      entityType: 'coupon',
      entityId: id,
      payload: { code: current.code, isActive: Boolean(newActive) }
    });

    publishDomainEvent(dbCtx.rawDb, {
      eventType: 'COUPON_UPDATED',
      entityId: id,
      payload: { couponId: id, code: current.code, isActive: Boolean(newActive) }
    });

    return reply.status(200).send({ success: true, couponId: id, isActive: Boolean(newActive) });
  });

  // 11.1 Eliminar Cupón (DELETE /api/menu/coupons/:id)
  fastify.delete('/api/menu/coupons/:id', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = requireRoles(request, reply, dbCtx.rawDb, ['admin', 'supervisor']);
    if (!user) return;

    const { id } = request.params as { id: string };
    const current = dbCtx.rawDb.prepare('SELECT id, code FROM coupons WHERE id = ?').get(id) as { id: string; code: string } | undefined;
    if (!current) {
      return reply.status(404).send({ success: false, error: `Cupón '${id}' no encontrado` });
    }

    try {
      dbCtx.rawDb.transaction(() => {
        dbCtx.rawDb.prepare('UPDATE orders SET coupon_id = NULL WHERE coupon_id = ?').run(id);
        dbCtx.rawDb.prepare('DELETE FROM coupon_redemptions WHERE coupon_id = ?').run(id);
        dbCtx.rawDb.prepare('DELETE FROM coupons WHERE id = ?').run(id);

        appendAuditEvent(dbCtx.rawDb, {
          actorUserId: user.userId,
          action: 'COUPON_DELETED',
          entityType: 'coupon',
          entityId: id,
          payload: { code: current.code }
        });

        publishDomainEvent(dbCtx.rawDb, {
          eventType: 'COUPON_DELETED',
          entityId: id,
          payload: { couponId: id, code: current.code }
        });
      })();

      return reply.status(200).send({ success: true, message: `Cupón '${current.code}' eliminado correctamente` });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // 12. Actualización de Configuración de Negocio (PATCH /api/menu/settings)
  fastify.patch('/api/menu/settings', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = requireRoles(request, reply, dbCtx.rawDb, ['admin']);
    if (!user) return;

    const body = request.body as {
      deliveryAccountingMode?: 'THIRD_PARTY_PASS_THROUGH' | 'HOUSE_REVENUE';
      deliveryQuickTiersJson?: string;
      businessName?: string;
      phone?: string;
      fiscalModuleEnabled?: boolean | number;
      fiscal_module_enabled?: boolean | number;
      fiscalPriceMode?: 'INCLUSIVE' | 'EXCLUSIVE';
      fiscal_price_mode?: 'INCLUSIVE' | 'EXCLUSIVE';
      igtfEnabled?: boolean | number;
      igtf_enabled?: boolean | number;
      igtfRateBps?: number;
      igtf_rate_bps?: number;
      igtfAppliesTo?: 'CASH_USD' | 'ALL_USD' | 'NONE';
      igtf_applies_to?: 'CASH_USD' | 'ALL_USD' | 'NONE';
    } | undefined;

    const current = dbCtx.rawDb.prepare('SELECT * FROM business_settings WHERE id = \'default\'').get() as any;
    const deliveryMode = body?.deliveryAccountingMode || current.delivery_accounting_mode;
    const tiersJson = body?.deliveryQuickTiersJson || current.delivery_quick_tiers_json;
    const name = body?.businessName || current.business_name;
    const phone = body?.phone || current.phone;

    const fiscalEnabledVal = body?.fiscalModuleEnabled !== undefined
      ? (body.fiscalModuleEnabled ? 1 : 0)
      : (body?.fiscal_module_enabled !== undefined ? (body.fiscal_module_enabled ? 1 : 0) : current.fiscal_module_enabled);

    const fiscalPriceModeVal = body?.fiscalPriceMode || body?.fiscal_price_mode || current.fiscal_price_mode || 'INCLUSIVE';

    const igtfEnabledVal = body?.igtfEnabled !== undefined
      ? (body.igtfEnabled ? 1 : 0)
      : (body?.igtf_enabled !== undefined ? (body.igtf_enabled ? 1 : 0) : current.igtf_enabled);

    const igtfRateBpsVal = body?.igtfRateBps ?? body?.igtf_rate_bps ?? current.igtf_rate_bps ?? 300;

    const igtfAppliesToVal = body?.igtfAppliesTo || body?.igtf_applies_to || current.igtf_applies_to || 'CASH_USD';

    const now = Date.now();

    dbCtx.rawDb.prepare(`
      UPDATE business_settings
      SET delivery_accounting_mode = ?, delivery_quick_tiers_json = ?,
          business_name = ?, phone = ?,
          fiscal_module_enabled = ?, fiscal_price_mode = ?,
          igtf_enabled = ?, igtf_rate_bps = ?, igtf_applies_to = ?,
          updated_at_ms = ?
      WHERE id = 'default'
    `).run(
      deliveryMode,
      tiersJson,
      name,
      phone,
      fiscalEnabledVal,
      fiscalPriceModeVal,
      igtfEnabledVal,
      igtfRateBpsVal,
      igtfAppliesToVal,
      now
    );

    appendAuditEvent(dbCtx.rawDb, {
      actorUserId: user.userId,
      action: 'BUSINESS_SETTINGS_UPDATED',
      entityType: 'business_settings',
      entityId: 'default',
      payload: {
        deliveryMode,
        fiscalModuleEnabled: Boolean(fiscalEnabledVal),
        fiscalPriceMode: fiscalPriceModeVal,
        igtfEnabled: Boolean(igtfEnabledVal),
        igtfRateBps: igtfRateBpsVal,
        igtfAppliesTo: igtfAppliesToVal
      }
    });

    publishDomainEvent(dbCtx.rawDb, {
      eventType: 'BUSINESS_SETTINGS_UPDATED',
      entityId: 'default',
      payload: { deliveryMode }
    });

    return reply.status(200).send({
      success: true,
      settings: {
        deliveryAccountingMode: deliveryMode,
        deliveryQuickTiersJson: tiersJson,
        businessName: name,
        phone,
        fiscalModuleEnabled: Boolean(fiscalEnabledVal),
        fiscalPriceMode: fiscalPriceModeVal,
        igtfEnabled: Boolean(igtfEnabledVal),
        igtfRateBps: igtfRateBpsVal,
        igtfAppliesTo: igtfAppliesToVal
      }
    });
  });

  // 13. Endpoint de Recuperación Secuencial de Eventos (GET /api/events?since=<lastSeq>)
  fastify.get('/api/events', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const query = request.query as { since?: string };
    const sinceSeq = Number(query.since ?? 0);
    const result = getEventsSince(dbCtx.rawDb, Number.isNaN(sinceSeq) ? 0 : sinceSeq);
    return reply.status(200).send({ success: true, ...result });
  });
};
