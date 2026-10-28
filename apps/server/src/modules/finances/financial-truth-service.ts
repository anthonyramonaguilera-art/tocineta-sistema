/**
 * SISTEMA OPERATIVO TOCINETA — SERVICIO DE VERDAD FINANCIERA ÚNICA (R2 P2-B)
 * Fuente única de cálculo de ventas, cobros, caja esperada, costos y utilidad.
 */

import type Database from 'better-sqlite3';
import { calculateOrderLineRealCost } from '../profitability/costing.js';
import { OFFICIAL_LOCATIONS } from '../profitability/locations-service.js';

import type {
  FinancialTruthParams,
  MethodBreakdown,
  ExpectedCashBreakdown,
  SedeFinancialTruth,
  FinancialTruthResult
} from './financial-truth-types.js';

export type {
  FinancialTruthParams,
  MethodBreakdown,
  ExpectedCashBreakdown,
  SedeFinancialTruth,
  FinancialTruthResult
};

import {
  normalizePaymentMethod,
  calculateDeduplicatedWaste
} from './financial-truth-helpers.js';

/**
 * Servicio Central de Verdad Financiera
 */
export function getFinancialTruth(
  rawDb: Database.Database,
  params: FinancialTruthParams = {}
): FinancialTruthResult {
  const now = Date.now();
  let jornada: any = null;

  if (params.jornadaId) {
    jornada = rawDb.prepare('SELECT * FROM jornadas WHERE id = ?').get(params.jornadaId) as any;
  } else {
    jornada = rawDb.prepare("SELECT * FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1").get() as any;
    if (!jornada) {
      jornada = rawDb.prepare('SELECT * FROM jornadas ORDER BY opened_at_ms DESC LIMIT 1').get() as any;
    }
  }

  const rateRow = rawDb.prepare('SELECT rate_micro_bs FROM exchange_rates WHERE is_current = 1 ORDER BY created_at_ms DESC LIMIT 1').get() as any;
  const rateMicroBs: number = jornada?.rate_micro_bs || rateRow?.rate_micro_bs || 40_000_000;

  const startOfDay = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const fromMs = params.from ?? (jornada ? jornada.opened_at_ms : startOfDay);
  const toMs = params.to ?? (jornada?.closed_at_ms || now);
  const filterLoc = params.locationId && params.locationId !== 'ALL' ? params.locationId : null;

  // 1. Sedes activas
  const dbLocations = rawDb.prepare('SELECT id, name FROM locations WHERE is_active = 1 ORDER BY id ASC').all() as Array<{ id: string; name: string }>;
  const locations = dbLocations.length > 0 ? dbLocations : OFFICIAL_LOCATIONS.map(l => ({ id: l.id, name: l.name }));

  // Helper para calcular métricas por filtro de sede
  function computeMetrics(targetLocId: string | null) {
    // A. Órdenes
    const orderConditions = ["o.fulfillment_status != 'anulado'"];
    const orderParams: any[] = [];

    if (jornada?.id) {
      orderConditions.push('o.jornada_id = ?');
      orderParams.push(jornada.id);
    } else {
      orderConditions.push('o.created_at_ms >= ? AND o.created_at_ms <= ?');
      orderParams.push(fromMs, toMs);
    }

    if (targetLocId) {
      orderConditions.push('(o.location_id = ? OR (o.location_id IS NULL AND ? = ?))');
      orderParams.push(targetLocId, targetLocId, 'loc_alta_vista');
    }

    const orders = rawDb.prepare(`
      SELECT o.id, o.order_number, o.location_id, o.payment_status, o.gross_food_subtotal_usd_cents,
             o.discount_usd_cents, o.net_food_sales_usd_cents, o.delivery_fee_usd_cents
      FROM orders o
      WHERE ${orderConditions.join(' AND ')}
    `).all(...orderParams) as any[];

    let collectedCount = 0;
    let uncollectedCount = 0;
    let grossSalesUsdCents = 0;
    let discountsUsdCents = 0;
    let netSalesUsdCents = 0;
    let deliveryFeesUsdCents = 0;

    for (const o of orders) {
      if (o.payment_status === 'pagado') {
        collectedCount++;
        grossSalesUsdCents += o.gross_food_subtotal_usd_cents || 0;
        discountsUsdCents += o.discount_usd_cents || 0;
        netSalesUsdCents += o.net_food_sales_usd_cents || 0;
        deliveryFeesUsdCents += o.delivery_fee_usd_cents || 0;
      } else {
        uncollectedCount++;
      }
    }

    // B. Medios de Pago y Cobros
    const paymentConditions = ["o.fulfillment_status != 'anulado'", "o.payment_status = 'pagado'"];
    const paymentParams: any[] = [];
    if (jornada?.id) {
      paymentConditions.push('o.jornada_id = ?');
      paymentParams.push(jornada.id);
    } else {
      paymentConditions.push('o.created_at_ms >= ? AND o.created_at_ms <= ?');
      paymentParams.push(fromMs, toMs);
    }
    if (targetLocId) {
      paymentConditions.push('(o.location_id = ? OR (o.location_id IS NULL AND ? = ?))');
      paymentParams.push(targetLocId, targetLocId, 'loc_alta_vista');
    }

    const payments = rawDb.prepare(`
      SELECT p.method, p.amount_cents, p.usd_equivalent_cents, p.currency
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE ${paymentConditions.join(' AND ')}
    `).all(...paymentParams) as any[];

    // Vueltos entregados
    const changes = rawDb.prepare(`
      SELECT cd.change_usd_cents, cd.change_bs_cents, cd.method
      FROM change_deliveries cd
      JOIN orders o ON cd.order_id = o.id
      WHERE ${paymentConditions.join(' AND ')}
    `).all(...paymentParams) as any[];

    const methodMap = new Map<string, MethodBreakdown>();
    let collectedCashUsd = 0;
    let collectedCashBs = 0;

    for (const p of payments) {
      const norm = normalizePaymentMethod(p.method);
      if (!methodMap.has(norm)) {
        methodMap.set(norm, {
          method: norm,
          grossUsdCents: 0,
          grossBsCents: 0,
          changeDeliveredUsdCents: 0,
          changeDeliveredBsCents: 0,
          netUsdCents: 0,
          netBsCents: 0,
          count: 0
        });
      }
      const item = methodMap.get(norm)!;
      item.count++;

      if (norm === 'EFECTIVO_USD' || p.currency === 'USD') {
        item.grossUsdCents += p.amount_cents;
        if (norm === 'EFECTIVO_USD') collectedCashUsd += p.amount_cents;
      } else {
        item.grossBsCents += p.amount_cents;
        item.grossUsdCents += p.usd_equivalent_cents || Math.round((p.amount_cents * 1_000_000) / rateMicroBs);
        if (norm === 'EFECTIVO_BS') collectedCashBs += p.amount_cents;
      }
    }

    let changeDeliveredUsd = 0;
    let changeDeliveredBs = 0;

    for (const c of changes) {
      changeDeliveredUsd += c.change_usd_cents || 0;
      changeDeliveredBs += c.change_bs_cents || 0;
    }

    if (methodMap.has('EFECTIVO_USD')) {
      const item = methodMap.get('EFECTIVO_USD')!;
      item.changeDeliveredUsdCents = changeDeliveredUsd;
    }
    if (methodMap.has('EFECTIVO_BS')) {
      const item = methodMap.get('EFECTIVO_BS')!;
      item.changeDeliveredBsCents = changeDeliveredBs;
    }

    for (const item of methodMap.values()) {
      item.netUsdCents = Math.max(0, item.grossUsdCents - item.changeDeliveredUsdCents);
      item.netBsCents = Math.max(0, item.grossBsCents - item.changeDeliveredBsCents);
    }

    // C. Gastos Operativos (excluyendo MERMAS_DESPERDICIOS)
    const expConditions = ["category != 'MERMAS_DESPERDICIOS'"];
    const expParams: any[] = [];
    if (jornada?.id) {
      expConditions.push('jornada_id = ?');
      expParams.push(jornada.id);
    } else {
      expConditions.push('created_at_ms >= ? AND created_at_ms <= ?');
      expParams.push(fromMs, toMs);
    }
    if (targetLocId) {
      expConditions.push('(location_id = ? OR (location_id IS NULL AND ? = ?))');
      expParams.push(targetLocId, targetLocId, 'loc_alta_vista');
    }

    const expenses = rawDb.prepare(`
      SELECT amount_usd_cents, amount_bs_cents, payment_method
      FROM operating_expenses
      WHERE ${expConditions.join(' AND ')}
    `).all(...expParams) as any[];

    let operatingExpensesUsd = 0;
    let expensesPaidInCashUsd = 0;
    let expensesPaidInCashBs = 0;

    for (const exp of expenses) {
      operatingExpensesUsd += exp.amount_usd_cents || 0;
      const m = normalizePaymentMethod(exp.payment_method);
      if (m === 'EFECTIVO_USD') {
        expensesPaidInCashUsd += exp.amount_usd_cents || 0;
      } else if (m === 'EFECTIVO_BS') {
        expensesPaidInCashBs += exp.amount_bs_cents || 0;
      }
    }

    // D. Caja de apertura
    let openingCashUsd = 0;
    let openingCashBs = 0;
    if (jornada?.id) {
      const sessionWhere = ['jornada_id = ?'];
      const sessionParams: any[] = [jornada.id];
      if (targetLocId) {
        sessionWhere.push('(location_id = ? OR (location_id IS NULL AND ? = ?))');
        sessionParams.push(targetLocId, targetLocId, 'loc_alta_vista');
      }
      const sessionAgg = rawDb.prepare(`
        SELECT COALESCE(SUM(opening_cash_usd_cents), 0) as s_usd, COALESCE(SUM(opening_cash_bs_cents), 0) as s_bs
        FROM cash_sessions
        WHERE ${sessionWhere.join(' AND ')}
      `).get(...sessionParams) as any;

      if (sessionAgg && (sessionAgg.s_usd > 0 || sessionAgg.s_bs > 0)) {
        openingCashUsd = sessionAgg.s_usd;
        openingCashBs = sessionAgg.s_bs;
      } else if (!targetLocId || targetLocId === 'loc_alta_vista') {
        openingCashUsd = jornada.initial_cash_usd_cents || 0;
        openingCashBs = jornada.initial_cash_bs_cents || 0;
      }
    }

    const netCashUsd = openingCashUsd + collectedCashUsd - changeDeliveredUsd - expensesPaidInCashUsd;
    const netCashBs = openingCashBs + collectedCashBs - changeDeliveredBs - expensesPaidInCashBs;

    // E. Costo Teórico de Recetas (COGS)
    let cogsTheoretical = 0;
    const orderIds = orders.map(o => o.id);
    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => '?').join(',');
      const movRow = rawDb.prepare(`
        SELECT COALESCE(SUM(im.total_cost_usd_cents), 0) as total_cogs
        FROM inventory_movements im
        JOIN orders o ON im.reference_doc = '#CMD-' || o.order_number
        WHERE o.id IN (${placeholders}) AND im.movement_type = 'VENTA_RECETA'
      `).get(...orderIds) as any;

      if (movRow?.total_cogs > 0) {
        cogsTheoretical = movRow.total_cogs;
      } else {
        const lines = rawDb.prepare(`
          SELECT ol.id, ol.product_id, ol.line_role, ol.quantity
          FROM order_lines ol
          WHERE ol.order_id IN (${placeholders})
            AND ol.line_role IN ('STANDARD', 'COMBO_CHILD', 'COURTESY_ITEM')
        `).all(...orderIds) as any[];

        const modsStmt = rawDb.prepare(`
          SELECT modifier_type, ingredient_id, ingredient_name, extra_price_usd_cents, internal_cost_usd_cents
          FROM order_line_modifiers WHERE order_line_id = ?
        `);

        for (const line of lines) {
          const mods = modsStmt.all(line.id) as any[];
          const costRes = calculateOrderLineRealCost(rawDb, {
            productId: line.product_id,
            quantity: line.quantity,
            lineRole: line.line_role,
            modifiers: mods.map(m => ({
              modifierType: m.modifier_type,
              ingredientId: m.ingredient_id,
              ingredientName: m.ingredient_name,
              extraPriceUsdCents: m.extra_price_usd_cents,
              internalCostUsdCents: m.internal_cost_usd_cents
            }))
          });
          cogsTheoretical += costRes.totalFoodCostUsdCents;
        }
      }
    }

    // F. Mermas (Deduplicación estricta entre waste_logs y worker_incidents)
    const { totalWasteUsd, wasteLogsUsd, workerIncidentsUsd } = calculateDeduplicatedWaste(
      rawDb,
      jornada?.id,
      fromMs,
      toMs,
      targetLocId
    );
    const netProfitUsd = netSalesUsdCents - cogsTheoretical - totalWasteUsd - operatingExpensesUsd;

    return {
      orders: {
        collectedCount,
        uncollectedCount,
        totalCount: orders.length,
        grossSalesUsdCents,
        discountsUsdCents,
        netSalesUsdCents,
        deliveryFeesUsdCents
      },
      collectedByMethod: Array.from(methodMap.values()),
      expectedCash: {
        openingCashUsdCents: openingCashUsd,
        openingCashBsCents: openingCashBs,
        collectedCashUsdCents: collectedCashUsd,
        collectedCashBsCents: collectedCashBs,
        changeDeliveredUsdCents: changeDeliveredUsd,
        changeDeliveredBsCents: changeDeliveredBs,
        expensesPaidInCashUsdCents: expensesPaidInCashUsd,
        expensesPaidInCashBsCents: expensesPaidInCashBs,
        netCashUsdCents: netCashUsd,
        netCashBsCents: netCashBs
      },
      cogsTheoretical,
      waste: {
        totalUsdCents: totalWasteUsd,
        wasteLogsUsdCents: wasteLogsUsd,
        workerIncidentsUsdCents: workerIncidentsUsd
      },
      operatingExpensesUsdCents: operatingExpensesUsd,
      netProfitUsdCents: netProfitUsd
    };
  }

  // 2. Cuentas por Cobrar y por Pagar
  const recWhere = ['balance_usd_cents > 0'];
  const recParams: any[] = [];
  if (filterLoc) {
    recWhere.push('location_id = ?');
    recParams.push(filterLoc);
  }
  const recRow = rawDb.prepare(`
    SELECT COALESCE(SUM(balance_usd_cents), 0) as total, COUNT(*) as count
    FROM receivable_accounts
    WHERE ${recWhere.join(' AND ')}
  `).get(...recParams) as any;

  const payabWhere = ["payment_condition = 'CREDITO'", 'balance_owed_usd_cents > 0'];
  const payabParams: any[] = [];
  if (filterLoc) {
    payabWhere.push('location_id = ?');
    payabParams.push(filterLoc);
  }
  const payabRow = rawDb.prepare(`
    SELECT COALESCE(SUM(balance_owed_usd_cents), 0) as total, COUNT(*) as count
    FROM purchases
    WHERE ${payabWhere.join(' AND ')}
  `).get(...payabParams) as any;

  // 3. Desglose por Sede (Invariant: sum(sedes) === total)
  const bySede: SedeFinancialTruth[] = [];
  for (const loc of locations) {
    const locMetrics = computeMetrics(loc.id);
    bySede.push({
      locationId: loc.id,
      locationName: loc.name,
      totalOrders: locMetrics.orders.totalCount,
      collectedOrdersCount: locMetrics.orders.collectedCount,
      uncollectedOrdersCount: locMetrics.orders.uncollectedCount,
      grossSalesUsdCents: locMetrics.orders.grossSalesUsdCents,
      discountsUsdCents: locMetrics.orders.discountsUsdCents,
      netSalesUsdCents: locMetrics.orders.netSalesUsdCents,
      deliveryFeesUsdCents: locMetrics.orders.deliveryFeesUsdCents,
      expectedCashUsdCents: locMetrics.expectedCash.netCashUsdCents,
      expectedCashBsCents: locMetrics.expectedCash.netCashBsCents,
      cogsTheoretical: locMetrics.cogsTheoretical,
      wasteUsdCents: locMetrics.waste.totalUsdCents,
      operatingExpensesUsdCents: locMetrics.operatingExpensesUsdCents,
      netProfitUsdCents: locMetrics.netProfitUsdCents
    });
  }

  // Métricas globales
  const overallMetrics = computeMetrics(filterLoc);

  return {
    period: {
      jornadaId: jornada?.id,
      from: fromMs,
      to: toMs,
      locationId: filterLoc || 'ALL'
    },
    rateMicroBs,
    orders: overallMetrics.orders,
    collectedByMethod: overallMetrics.collectedByMethod,
    expectedCash: overallMetrics.expectedCash,
    cogsTheoretical: overallMetrics.cogsTheoretical,
    waste: overallMetrics.waste,
    operatingExpensesUsdCents: overallMetrics.operatingExpensesUsdCents,
    netProfitUsdCents: overallMetrics.netProfitUsdCents,
    receivables: {
      totalUsdCents: recRow?.total || 0,
      pendingCount: recRow?.count || 0
    },
    payables: {
      totalUsdCents: payabRow?.total || 0,
      pendingCount: payabRow?.count || 0
    },
    bySede
  };
}
