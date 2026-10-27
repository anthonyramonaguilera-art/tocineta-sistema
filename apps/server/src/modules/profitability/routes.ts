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

import { generateUuidV7, usdToBsCents, formatMicroBsToRate } from '@tocineta/shared';
import { getCurrentExchangeRate } from '../menu/menu-service.js';
import { ensureBusinessSettingsDefensive } from '../../db/business-settings.js';

export const profitabilityRoutes: FastifyPluginAsync = async (fastify) => {
  const getUserFromRequest = (req: any) => {
    const dbCtx = getDatabaseContext();
    const rawToken = extractSessionToken(req.headers.authorization);
    if (!rawToken) return null;
    const tokenHash = hashToken(rawToken);
    return dbCtx.rawDb.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at_ms > ?').get(tokenHash, Date.now()) as { user_id: string } | undefined;
  };

  // 1. Configuración de Interruptores (profitability_pro_enabled, fiscal_module_enabled, IGTF)
  fastify.get('/api/profitability/settings', async (_request, reply) => {
    try {
      const dbCtx = getDatabaseContext();
      const row = ensureBusinessSettingsDefensive(dbCtx.rawDb);

      return reply.status(200).send({
        success: true,
        profitabilityProEnabled: Boolean(row.profitability_pro_enabled),
        fiscalModuleEnabled: Boolean(row.fiscal_module_enabled),
        fiscalPriceMode: row.fiscal_price_mode || 'INCLUSIVE',
        igtfEnabled: Boolean(row.igtf_enabled),
        igtfRateBps: row.igtf_rate_bps ?? 300,
        igtfAppliesTo: row.igtf_applies_to || 'CASH_USD',
        isDemoMode: Boolean(row.is_demo_mode)
      });
    } catch (err: any) {
      fastify.log.error(err, 'Error defensivo en GET /api/profitability/settings');
      return reply.status(200).send({
        success: true,
        profitabilityProEnabled: false,
        fiscalModuleEnabled: false,
        fiscalPriceMode: 'INCLUSIVE',
        igtfEnabled: false,
        igtfRateBps: 300,
        igtfAppliesTo: 'CASH_USD',
        isDemoMode: false
      });
    }
  });

  fastify.patch('/api/profitability/settings', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = request.body as {
      profitabilityProEnabled?: boolean;
      fiscalModuleEnabled?: boolean;
      fiscalPriceMode?: 'INCLUSIVE' | 'EXCLUSIVE';
      igtfEnabled?: boolean;
      igtfRateBps?: number;
      igtfAppliesTo?: 'CASH_USD' | 'ALL_USD' | 'NONE';
    } | undefined;

    const row = dbCtx.rawDb.prepare(`
      SELECT profitability_pro_enabled, fiscal_module_enabled, fiscal_price_mode,
             igtf_enabled, igtf_rate_bps, igtf_applies_to
      FROM business_settings
      WHERE id = 'default'
    `).get() as any;

    const newPro = body?.profitabilityProEnabled !== undefined
      ? (body.profitabilityProEnabled ? 1 : 0)
      : (row?.profitability_pro_enabled ?? 0);

    const newFiscal = body?.fiscalModuleEnabled !== undefined
      ? (body.fiscalModuleEnabled ? 1 : 0)
      : (row?.fiscal_module_enabled ?? 0);

    const newPriceMode = body?.fiscalPriceMode || row?.fiscal_price_mode || 'INCLUSIVE';

    const newIgtf = body?.igtfEnabled !== undefined
      ? (body.igtfEnabled ? 1 : 0)
      : (row?.igtf_enabled ?? 0);

    const newIgtfRate = body?.igtfRateBps ?? row?.igtf_rate_bps ?? 300;
    const newIgtfApplies = body?.igtfAppliesTo || row?.igtf_applies_to || 'CASH_USD';

    dbCtx.rawDb.prepare(`
      UPDATE business_settings
      SET profitability_pro_enabled = ?,
          fiscal_module_enabled = ?,
          fiscal_price_mode = ?,
          igtf_enabled = ?,
          igtf_rate_bps = ?,
          igtf_applies_to = ?,
          updated_at_ms = ?
      WHERE id = 'default'
    `).run(newPro, newFiscal, newPriceMode, newIgtf, newIgtfRate, newIgtfApplies, Date.now());

    return reply.status(200).send({
      success: true,
      profitabilityProEnabled: Boolean(newPro),
      fiscalModuleEnabled: Boolean(newFiscal),
      fiscalPriceMode: newPriceMode,
      igtfEnabled: Boolean(newIgtf),
      igtfRateBps: newIgtfRate,
      igtfAppliesTo: newIgtfApplies,
      message: 'Configuración de Rentabilidad Pro, Módulo Fiscal e IGTF actualizada'
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
      authorizedByUserId: user?.user_id || 'usr_admin'
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

  // 7. Salidas de Inventario Especiales: Mermas a Socios, Cena Empleados, Gas Operativo
  fastify.post('/api/profitability/inventory-output', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as {
      supplyId: string;
      movementType: 'MERMA_SOCIOS' | 'CENA_EMPLEADOS' | 'GASTO_GAS_INSUMO';
      quantity: number;
      unitCostUsdCents?: number;
      partnerCustomerId?: string;
      notes?: string;
    };

    if (!body?.supplyId || !body?.movementType || !body?.quantity || body.quantity <= 0) {
      return reply.status(400).send({
        success: false,
        error: 'supplyId, movementType válido y quantity positiva son obligatorios'
      });
    }

    const supply = dbCtx.rawDb.prepare('SELECT id, name, unit, cost_per_unit_usd_cents, current_stock_qty FROM supply_items WHERE id = ?').get(body.supplyId) as any;
    if (!supply) {
      return reply.status(404).send({ success: false, error: 'Insumo no encontrado' });
    }

    const unitCost = body.unitCostUsdCents ?? supply.cost_per_unit_usd_cents ?? 0;
    const totalCostUsdCents = Math.round(body.quantity * unitCost);
    const now = Date.now();
    const movementId = `mov_${generateUuidV7()}`;
    const actorId = user?.user_id || 'usr_admin';

    let partnerInfo: any = null;
    let printableTicket: any = null;

    const tx = dbCtx.rawDb.transaction(() => {
      // 1. Descontar cantidad del inventario
      dbCtx.rawDb.prepare(`
        UPDATE supply_items
        SET current_stock_qty = MAX(0, current_stock_qty - ?),
            updated_at_ms = ?
        WHERE id = ?
      `).run(body.quantity, now, supply.id);

      // 2. Ejecutar lógica según tipo de salida
      if (body.movementType === 'MERMA_SOCIOS') {
        let partnerId = body.partnerCustomerId;
        if (!partnerId) {
          const firstPartner = dbCtx.rawDb.prepare("SELECT id FROM customers WHERE is_partner = 1 LIMIT 1").get() as any;
          partnerId = firstPartner?.id || 'cust_partner_admin';
        }

        dbCtx.rawDb.prepare(`
          UPDATE customers
          SET balance_receivable_usd_cents = balance_receivable_usd_cents + ?,
              total_orders = total_orders + 1
          WHERE id = ?
        `).run(totalCostUsdCents, partnerId);

        partnerInfo = dbCtx.rawDb.prepare('SELECT id, name, phone, identification, balance_receivable_usd_cents FROM customers WHERE id = ?').get(partnerId);

        printableTicket = {
          title: 'FACTURA DE REPOSICIÓN - MERMA A SOCIOS',
          docNumber: `REP-${now.toString().slice(-6)}`,
          partnerName: partnerInfo?.name || 'Socio',
          partnerId: partnerInfo?.identification || '',
          supplyName: supply.name,
          quantity: body.quantity,
          unit: supply.unit,
          unitCostUsdCents: unitCost,
          totalCostUsdCents,
          totalCostFormattedUsd: `$${(totalCostUsdCents / 100).toFixed(2)}`,
          updatedBalanceUsd: `$${((partnerInfo?.balance_receivable_usd_cents || 0) / 100).toFixed(2)}`,
          notes: body.notes || 'Reposición obligatoria por daño / merma de turno',
          createdAtMs: now
        };
      } else if (body.movementType === 'CENA_EMPLEADOS') {
        const openJornada = dbCtx.rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
        const targetJornada = openJornada?.id || 'jornada_default';
        createOperatingExpense(dbCtx.rawDb, {
          jornadaId: targetJornada,
          category: 'CENA_EMPLEADOS',
          amountUsdCents: totalCostUsdCents,
          description: `Consumo comida de personal / Cena empleados: ${body.quantity} ${supply.unit} de ${supply.name}. ${body.notes || ''}`.trim(),
          authorizedByUserId: actorId
        });
      } else if (body.movementType === 'GASTO_GAS_INSUMO') {
        const openJornada = dbCtx.rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
        const targetJornada = openJornada?.id || 'jornada_default';
        createOperatingExpense(dbCtx.rawDb, {
          jornadaId: targetJornada,
          category: 'GAS_OPERATIVO',
          amountUsdCents: totalCostUsdCents,
          description: `Consumo operativo directo: ${body.quantity} ${supply.unit} de ${supply.name}. ${body.notes || ''}`.trim(),
          authorizedByUserId: actorId
        });
      }

      // 3. Registrar en kardex de movimientos
      dbCtx.rawDb.prepare(`
        INSERT INTO inventory_movements (
          id, supply_id, movement_type, quantity_delta, unit_cost_usd_cents,
          total_cost_usd_cents, partner_customer_id, reference_doc, notes, created_by, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        movementId,
        supply.id,
        body.movementType,
        -body.quantity,
        unitCost,
        totalCostUsdCents,
        partnerInfo?.id || null,
        printableTicket ? printableTicket.docNumber : null,
        body.notes || null,
        actorId,
        now
      );
    });

    tx();

    return reply.status(201).send({
      success: true,
      movementId,
      movementType: body.movementType,
      totalCostUsdCents,
      partner: partnerInfo,
      printableTicket,
      message: body.movementType === 'MERMA_SOCIOS'
        ? `✓ Merma descontada. Se generó Factura de Reposición al socio por $${(totalCostUsdCents / 100).toFixed(2)}.`
        : `✓ Salida de inventario registrada exitosamente.`
    });
  });

  // 8. Proveedores (Suppliers)
  fastify.get('/api/profitability/suppliers', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const list = dbCtx.rawDb.prepare('SELECT * FROM suppliers ORDER BY name ASC').all();
    return reply.send({ success: true, suppliers: list });
  });

  fastify.post('/api/profitability/suppliers', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = request.body as { name?: string; rifPhone?: string; category?: string };
    if (!body?.name?.trim()) {
      return reply.status(400).send({ success: false, error: 'El nombre del proveedor es obligatorio' });
    }
    const id = `sup_${generateUuidV7()}`;
    const now = Date.now();
    dbCtx.rawDb.prepare(`
      INSERT INTO suppliers (id, name, rif_phone, category, balance_owed_usd_cents, created_at_ms)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(id, body.name.trim(), body.rifPhone?.trim() || null, body.category?.trim() || null, now);

    return reply.status(201).send({ success: true, supplier: { id, ...body } });
  });

  // 9. Clientes y Socios (Customers)
  fastify.get('/api/profitability/customers', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const list = dbCtx.rawDb.prepare('SELECT * FROM customers ORDER BY is_partner DESC, name ASC').all();
    return reply.send({ success: true, customers: list });
  });

  fastify.post('/api/profitability/customers', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = request.body as { name?: string; phone?: string; identification?: string; address?: string; isPartner?: boolean };
    if (!body?.name?.trim()) {
      return reply.status(400).send({ success: false, error: 'El nombre del cliente/socio es obligatorio' });
    }
    const id = `cust_${generateUuidV7()}`;
    const now = Date.now();
    dbCtx.rawDb.prepare(`
      INSERT INTO customers (id, name, phone, identification, address, is_partner, balance_receivable_usd_cents, total_orders, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
    `).run(id, body.name.trim(), body.phone?.trim() || null, body.identification?.trim() || null, body.address?.trim() || null, body.isPartner ? 1 : 0, now);

    return reply.status(201).send({ success: true, customer: { id, ...body } });
  });

  fastify.post('/api/profitability/customers/:id/pay-receivable', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const { id } = request.params as { id: string };
    const body = request.body as { amountUsdCents: number; paymentMethod?: string; notes?: string };
    if (!body?.amountUsdCents || body.amountUsdCents <= 0) {
      return reply.status(400).send({ success: false, error: 'Monto a abonar debe ser positivo' });
    }

    const customer = dbCtx.rawDb.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
    if (!customer) {
      return reply.status(404).send({ success: false, error: 'Cliente o socio no encontrado' });
    }

    dbCtx.rawDb.prepare(`
      UPDATE customers
      SET balance_receivable_usd_cents = MAX(0, balance_receivable_usd_cents - ?)
      WHERE id = ?
    `).run(body.amountUsdCents, id);

    return reply.send({
      success: true,
      message: `Abono de $${(body.amountUsdCents / 100).toFixed(2)} registrado correctamente.`
    });
  });

  // 10. Compras de Materia Prima (Purchases)
  fastify.get('/api/profitability/purchases', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const purchasesList = dbCtx.rawDb.prepare(`
      SELECT p.*, s.name as supplier_name
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      ORDER BY p.created_at_ms DESC
      LIMIT 50
    `).all() as any[];

    const purchaseIds = purchasesList.map(p => p.id);
    let itemsMap: Record<string, any[]> = {};
    if (purchaseIds.length > 0) {
      const placeholders = purchaseIds.map(() => '?').join(',');
      const items = dbCtx.rawDb.prepare(`
        SELECT pi.*, si.name as supply_name, si.unit as supply_unit
        FROM purchase_items pi
        JOIN supply_items si ON pi.supply_id = si.id
        WHERE pi.purchase_id IN (${placeholders})
      `).all(...purchaseIds) as any[];

      for (const item of items) {
        if (!itemsMap[item.purchase_id]) itemsMap[item.purchase_id] = [];
        itemsMap[item.purchase_id].push(item);
      }
    }

    const result = purchasesList.map(p => ({
      ...p,
      items: itemsMap[p.id] || []
    }));

    return reply.send({ success: true, purchases: result });
  });

  fastify.post('/api/profitability/purchases', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const user = getUserFromRequest(request);
    const body = request.body as {
      supplierId: string;
      invoiceNumber?: string;
      paymentCondition: 'CONTADO' | 'CREDITO';
      items: Array<{ supplyId: string; quantity: number; unitCostUsdCents: number }>;
      notes?: string;
    };

    if (!body?.supplierId || !body?.paymentCondition || !body?.items?.length) {
      return reply.status(400).send({ success: false, error: 'supplierId, paymentCondition y al menos un ítem son obligatorios' });
    }

    const rateMicroBs = getCurrentExchangeRate(dbCtx.rawDb);
    const now = Date.now();
    const purchaseId = `pur_${generateUuidV7()}`;
    const actorId = user?.user_id || 'usr_admin';

    let totalUsdCents = 0;
    for (const it of body.items) {
      totalUsdCents += Math.round(it.quantity * it.unitCostUsdCents);
    }
    const totalBsCents = usdToBsCents(totalUsdCents, rateMicroBs);

    const tx = dbCtx.rawDb.transaction(() => {
      // 1. Insertar compra principal
      dbCtx.rawDb.prepare(`
        INSERT INTO purchases (
          id, supplier_id, invoice_number, payment_condition, status,
          total_usd_cents, total_bs_cents, notes, created_by, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        purchaseId,
        body.supplierId,
        body.invoiceNumber || `FAC-${now.toString().slice(-6)}`,
        body.paymentCondition,
        body.paymentCondition === 'CONTADO' ? 'PAGADA' : 'PENDIENTE',
        totalUsdCents,
        totalBsCents,
        body.notes || null,
        actorId,
        now
      );

      // 2. Si es crédito, aumentar deuda con el proveedor
      if (body.paymentCondition === 'CREDITO') {
        dbCtx.rawDb.prepare(`
          UPDATE suppliers
          SET balance_owed_usd_cents = balance_owed_usd_cents + ?
          WHERE id = ?
        `).run(totalUsdCents, body.supplierId);
      } else {
        // Contado: registrar egreso en caja chica de la jornada abierta
        const openJornada = dbCtx.rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
        const targetJornada = openJornada?.id || 'jornada_default';
        createOperatingExpense(dbCtx.rawDb, {
          jornadaId: targetJornada,
          category: 'COMPRA_MATERIA_PRIMA',
          amountUsdCents: totalUsdCents,
          description: `Compra contado de materia prima (Factura ${body.invoiceNumber || 'S/N'})`.trim(),
          authorizedByUserId: actorId
        });
      }

      // 3. Procesar cada ítem
      for (const it of body.items) {
        const supply = dbCtx.rawDb.prepare('SELECT cost_per_unit_usd_cents FROM supply_items WHERE id = ?').get(it.supplyId) as any;
        const prevCost = supply?.cost_per_unit_usd_cents || it.unitCostUsdCents;
        const subtotal = Math.round(it.quantity * it.unitCostUsdCents);

        dbCtx.rawDb.prepare(`
          INSERT INTO purchase_items (
            id, purchase_id, supply_id, quantity, unit_cost_usd_cents,
            prev_unit_cost_usd_cents, subtotal_usd_cents
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          `pi_${generateUuidV7()}`,
          purchaseId,
          it.supplyId,
          it.quantity,
          it.unitCostUsdCents,
          prevCost,
          subtotal
        );

        // Actualizar stock y costo en supply_items
        dbCtx.rawDb.prepare(`
          UPDATE supply_items
          SET current_stock_qty = current_stock_qty + ?,
              previous_cost_usd_cents = CASE WHEN cost_per_unit_usd_cents != ? THEN cost_per_unit_usd_cents ELSE previous_cost_usd_cents END,
              cost_per_unit_usd_cents = ?,
              last_supplier_id = ?,
              updated_at_ms = ?
          WHERE id = ?
        `).run(it.quantity, it.unitCostUsdCents, it.unitCostUsdCents, body.supplierId, now, it.supplyId);

        // Registrar en kardex de movimientos
        dbCtx.rawDb.prepare(`
          INSERT INTO inventory_movements (
            id, supply_id, movement_type, quantity_delta, unit_cost_usd_cents,
            total_cost_usd_cents, partner_customer_id, reference_doc, notes, created_by, created_at_ms
          ) VALUES (?, ?, 'COMPRA_ENTRADA', ?, ?, ?, NULL, ?, ?, ?, ?)
        `).run(
          `mov_${generateUuidV7()}`,
          it.supplyId,
          it.quantity,
          it.unitCostUsdCents,
          subtotal,
          body.invoiceNumber || null,
          `Compra a proveedor ${body.paymentCondition}`,
          actorId,
          now
        );
      }
    });

    tx();

    return reply.status(201).send({
      success: true,
      purchaseId,
      totalUsdCents,
      totalBsCents,
      message: `✓ Compra registrada exitosamente por $${(totalUsdCents / 100).toFixed(2)}.`
    });
  });

  // 11. Nómina y Pagos a Personal (Payroll)
  fastify.get('/api/profitability/payroll', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const list = dbCtx.rawDb.prepare(`
      SELECT p.*, u.role as staff_role
      FROM staff_payroll_payments p
      LEFT JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at_ms DESC
      LIMIT 100
    `).all();
    return reply.send({ success: true, payments: list });
  });

  fastify.post('/api/profitability/payroll', async (request, reply) => {
    const dbCtx = getDatabaseContext();
    const body = request.body as {
      userId: string;
      staffName?: string;
      paymentType: 'SUELDO_TURNO' | 'QUINCENA' | 'BONO' | 'ADELANTO_VALE';
      amountUsdCents: number;
      paymentMethod?: string;
      notes?: string;
    };

    if (!body?.userId || !body?.paymentType || !body?.amountUsdCents || body.amountUsdCents <= 0) {
      return reply.status(400).send({ success: false, error: 'userId, paymentType y amountUsdCents positivo son obligatorios' });
    }

    const user = dbCtx.rawDb.prepare('SELECT name FROM users WHERE id = ?').get(body.userId) as any;
    const staffName = body.staffName || user?.name || 'Personal';
    const rateMicroBs = getCurrentExchangeRate(dbCtx.rawDb);
    const amountBsCents = usdToBsCents(body.amountUsdCents, rateMicroBs);
    const now = Date.now();
    const id = `pay_${generateUuidV7()}`;

    dbCtx.rawDb.prepare(`
      INSERT INTO staff_payroll_payments (
        id, user_id, staff_name, payment_type, amount_usd_cents,
        amount_bs_cents, payment_method, notes, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.userId,
      staffName,
      body.paymentType,
      body.amountUsdCents,
      amountBsCents,
      body.paymentMethod || 'EFECTIVO_USD',
      body.notes || null,
      now
    );

    return reply.status(201).send({
      success: true,
      paymentId: id,
      message: `✓ Pago de nómina a ${staffName} registrado por $${(body.amountUsdCents / 100).toFixed(2)}.`
    });
  });

  // 12. Kardex Completo de Movimientos de Inventario
  fastify.get('/api/profitability/movements', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const movements = dbCtx.rawDb.prepare(`
      SELECT m.*, si.name as supply_name, si.unit as supply_unit,
             c.name as partner_name
      FROM inventory_movements m
      JOIN supply_items si ON m.supply_id = si.id
      LEFT JOIN customers c ON m.partner_customer_id = c.id
      ORDER BY m.created_at_ms DESC
      LIMIT 100
    `).all();
    return reply.send({ success: true, movements });
  });

  // 13. Balance Financiero Gerencial
  fastify.get('/api/profitability/executive-balance', async (_request, reply) => {
    const dbCtx = getDatabaseContext();
    const rateMicroBs = getCurrentExchangeRate(dbCtx.rawDb);
    const formattedRate = formatMicroBsToRate(rateMicroBs);

    // 1. Ventas Totales Pagadas
    const salesRow = dbCtx.rawDb.prepare(`
      SELECT COALESCE(SUM(total_to_collect_usd_cents), 0) as total_sales_usd
      FROM orders
      WHERE payment_status = 'PAGADO'
    `).get() as any;
    const totalSalesUsdCents = Number(salesRow?.total_sales_usd || 0);

    // 2. Gastos de Caja Chica
    const expensesRow = dbCtx.rawDb.prepare(`
      SELECT 
        COALESCE(SUM(amount_usd_cents), 0) as total_expenses_usd,
        COALESCE(SUM(CASE WHEN category = 'CENA_EMPLEADOS' THEN amount_usd_cents ELSE 0 END), 0) as cena_usd,
        COALESCE(SUM(CASE WHEN category = 'GAS_OPERATIVO' THEN amount_usd_cents ELSE 0 END), 0) as gas_usd
      FROM operating_expenses
    `).get() as any;
    const totalExpensesUsdCents = Number(expensesRow?.total_expenses_usd || 0);
    const cenaEmpleadosUsdCents = Number(expensesRow?.cena_usd || 0);
    const gasOperativoUsdCents = Number(expensesRow?.gas_usd || 0);

    // 3. Compras de Materia Prima
    const purchasesRow = dbCtx.rawDb.prepare(`
      SELECT COALESCE(SUM(total_usd_cents), 0) as total_purchases_usd
      FROM purchases
    `).get() as any;
    const totalPurchasesUsdCents = Number(purchasesRow?.total_purchases_usd || 0);

    // 4. Mermas Registradas
    const mermasRow = dbCtx.rawDb.prepare(`
      SELECT COALESCE(SUM(total_cost_usd_cents), 0) as total_mermas_usd
      FROM inventory_movements
      WHERE movement_type = 'MERMA_SOCIOS'
    `).get() as any;
    const totalMermasUsdCents = Number(mermasRow?.total_mermas_usd || 0);

    // 5. Nómina Pagada
    const payrollRow = dbCtx.rawDb.prepare(`
      SELECT COALESCE(SUM(amount_usd_cents), 0) as total_payroll_usd
      FROM staff_payroll_payments
    `).get() as any;
    const totalPayrollUsdCents = Number(payrollRow?.total_payroll_usd || 0);

    // 6. Cuentas por Cobrar (Socios y Clientes)
    const receivableRow = dbCtx.rawDb.prepare(`
      SELECT 
        COALESCE(SUM(balance_receivable_usd_cents), 0) as total_receivable_usd,
        COALESCE(SUM(CASE WHEN is_partner = 1 THEN balance_receivable_usd_cents ELSE 0 END), 0) as partners_receivable_usd
      FROM customers
    `).get() as any;
    const totalReceivableUsdCents = Number(receivableRow?.total_receivable_usd || 0);
    const partnersReceivableUsdCents = Number(receivableRow?.partners_receivable_usd || 0);

    // 7. Cuentas por Pagar (Proveedores)
    const payableRow = dbCtx.rawDb.prepare(`
      SELECT COALESCE(SUM(balance_owed_usd_cents), 0) as total_payable_usd
      FROM suppliers
    `).get() as any;
    const totalPayableUsdCents = Number(payableRow?.total_payable_usd || 0);

    // Totales calculados
    const totalOutflowsUsdCents = totalPurchasesUsdCents + totalExpensesUsdCents + totalPayrollUsdCents;
    const netProfitUsdCents = totalSalesUsdCents - totalOutflowsUsdCents;
    const netProfitBsCents = usdToBsCents(netProfitUsdCents, rateMicroBs);

    // Costo de recetas de platos vendidos (Food Cost Teórico)
    const recipeCostRow = dbCtx.rawDb.prepare(`
      SELECT COALESCE(SUM(ol.quantity * COALESCE(p.estimated_cost_usd_cents, 150)), 0) as total_recipe_cost
      FROM order_lines ol
      JOIN orders o ON ol.order_id = o.id
      JOIN products p ON ol.product_id = p.id
      WHERE o.payment_status = 'PAGADO' AND ol.line_role != 'COMBO_CHILD'
    `).get() as any;
    const foodCostUsdCents = Number(recipeCostRow?.total_recipe_cost || 0);
    const grossProfitUsdCents = totalSalesUsdCents - foodCostUsdCents;

    return reply.send({
      success: true,
      rateMicroBs,
      formattedRate,
      rateLabel: 'Tasa BCV Vigente / Día Siguiente',
      sales: {
        usdCents: totalSalesUsdCents,
        bsCents: usdToBsCents(totalSalesUsdCents, rateMicroBs)
      },
      outflows: {
        totalUsdCents: totalOutflowsUsdCents,
        purchasesUsdCents: totalPurchasesUsdCents,
        expensesUsdCents: totalExpensesUsdCents,
        cenaEmpleadosUsdCents,
        gasOperativoUsdCents,
        payrollUsdCents: totalPayrollUsdCents,
        mermasUsdCents: totalMermasUsdCents
      },
      profits: {
        grossProfitUsdCents,
        grossMarginPercentage: totalSalesUsdCents > 0 ? Math.round((grossProfitUsdCents / totalSalesUsdCents) * 100) : 0,
        netProfitUsdCents,
        netProfitBsCents
      },
      receivables: {
        totalUsdCents: totalReceivableUsdCents,
        partnersUsdCents: partnersReceivableUsdCents
      },
      payables: {
        totalUsdCents: totalPayableUsdCents
      }
    });
  });
};

