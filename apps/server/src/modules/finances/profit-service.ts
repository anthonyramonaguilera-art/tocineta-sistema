import type Database from 'better-sqlite3';
import { calculateOrderLineRealCost } from '../profitability/costing.js';
import { generateMenuEngineeringReport, type MenuEngineeringReport } from '../profitability/menu-engineering.js';
import { getFinancialTruth } from './financial-truth-service.js';

export interface ProfitAndLossParams {
  startDateMs?: number;
  endDateMs?: number;
  locationId?: string;
}

export interface SalesByMethodItem {
  method: string;
  count: number;
  totalUsdCents: number;
  totalBsCents: number;
  percentage: number;
}

export interface SalesByCategoryItem {
  categoryId: string;
  categoryName: string;
  unitsSold: number;
  totalUsdCents: number;
  percentage: number;
}

export interface SalesByHourItem {
  hour: number;
  orderCount: number;
  totalUsdCents: number;
}

export interface SalesByLocationItem {
  locationId: string;
  locationName: string;
  orderCount: number;
  totalUsdCents: number;
}

export interface ProductRankingItem {
  productId: string;
  productName: string;
  unitsSold: number;
  totalSalesUsdCents: number;
  recipeCostUsdCents: number;
  marginUsdCents: number;
}

export interface ProfitAndLossStatement {
  period: {
    startDateMs: number;
    endDateMs: number;
    locationId: string | null;
    locationName: string | null;
  };
  summary: {
    grossFoodSalesUsdCents: number;
    discountsUsdCents: number;
    netFoodSalesUsdCents: number;
    costOfGoodsSoldUsdCents: number;
    cogsConfigured: boolean;
    foodCostPercentage: number;
    wasteLossUsdCents: number;
    operatingExpensesUsdCents: number;
    netProfitUsdCents: number;
    netProfitMarginPercentage: number;
    totalOrders: number;
    averageTicketUsdCents: number;
  };
  breakdown: {
    byMethod: SalesByMethodItem[];
    byCategory: SalesByCategoryItem[];
    byHour: SalesByHourItem[];
    byLocation: SalesByLocationItem[];
    topProducts: ProductRankingItem[];
    kasavanaMatrix: MenuEngineeringReport;
  };
}

/**
 * Cálculo del Estado de Resultados (P&L) con desglose completo y matriz de ingeniería de menú
 */
export function calculateProfitAndLoss(
  rawDb: Database.Database,
  params: ProfitAndLossParams = {}
): ProfitAndLossStatement {
  const now = Date.now();
  const startDateMs = params.startDateMs ?? (now - 30 * 24 * 60 * 60 * 1000);
  const endDateMs = params.endDateMs ?? now;
  const locationId = params.locationId || null;

  let locationName: string | null = null;
  if (locationId) {
    const loc = rawDb.prepare('SELECT name FROM locations WHERE id = ?').get(locationId) as any;
    locationName = loc?.name || locationId;
  }

  // 1. Órdenes del período (Conservando la tasa histórica de cada orden)
  const orderWhere = ["o.fulfillment_status != 'anulado'", 'o.created_at_ms >= ?', 'o.created_at_ms <= ?'];
  const orderParams: any[] = [startDateMs, endDateMs];
  if (locationId) {
    orderWhere.push('(o.location_id = ? OR o.location_id IS NULL)');
    orderParams.push(locationId);
  }

  const orders = rawDb.prepare(`
    SELECT o.id, o.location_id, o.gross_food_subtotal_usd_cents as gross_food,
      o.discount_usd_cents as discounts, o.net_food_sales_usd_cents as net_food,
      o.rate_micro_bs, o.created_at_ms
    FROM orders o
    WHERE ${orderWhere.join(' AND ')}
  `).all(...orderParams) as any[];

  // 1. Delegar Verdad Financiera central
  const ft = getFinancialTruth(rawDb, {
    from: startDateMs,
    to: endDateMs,
    locationId: locationId || 'ALL'
  });

  const grossFoodSalesUsdCents = ft.orders.grossSalesUsdCents;
  const discountsUsdCents = ft.orders.discountsUsdCents;
  const netFoodSalesUsdCents = ft.orders.netSalesUsdCents;
  const totalOrders = ft.orders.totalCount;
  const averageTicketUsdCents = totalOrders > 0 ? Math.round(netFoodSalesUsdCents / totalOrders) : 0;
  const costOfGoodsSoldUsdCents = ft.cogsTheoretical;
  const wasteLossUsdCents = ft.waste.totalUsdCents;
  const operatingExpensesUsdCents = ft.operatingExpensesUsdCents;
  const netProfitUsdCents = ft.netProfitUsdCents;

  const foodCostPercentage = netFoodSalesUsdCents > 0
    ? Number(((costOfGoodsSoldUsdCents / netFoodSalesUsdCents) * 100).toFixed(2))
    : 0;

  const netProfitMarginPercentage = netFoodSalesUsdCents > 0
    ? Number(((netProfitUsdCents / netFoodSalesUsdCents) * 100).toFixed(2))
    : 0;

  // 2. Estadísticas de productos para Kasavana & Smith y ranking
  const orderIds = orders.map(o => o.id);
  const productStats: Record<string, { name: string; units: number; sales: number; cost: number }> = {};

  if (orderIds.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < orderIds.length; i += chunkSize) {
      const chunk = orderIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');

      const lines = rawDb.prepare(`
        SELECT ol.id, ol.product_id, COALESCE(p.name, 'PRODUCTO') as product_name, ol.line_role, ol.quantity, ol.subtotal_usd_cents
        FROM order_lines ol
        LEFT JOIN products p ON ol.product_id = p.id
        WHERE ol.order_id IN (${placeholders})
          AND ol.line_role IN ('STANDARD', 'COMBO_CHILD', 'COURTESY_ITEM')
      `).all(...chunk) as any[];

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

        const lineCost = costRes.baseRecipeCostUsdCents + costRes.extraIngredientsCostUsdCents + costRes.barraLibreCostUsdCents;

        if (!productStats[line.product_id]) {
          productStats[line.product_id] = { name: line.product_name, units: 0, sales: 0, cost: 0 };
        }
        productStats[line.product_id].units += line.quantity;
        productStats[line.product_id].sales += line.subtotal_usd_cents;
        productStats[line.product_id].cost += lineCost;
      }
    }
  }

  // 6. Desgloses: Método, Categoría, Hora, Sede, Ranking
  const payRows = rawDb.prepare(`
    SELECT p.method, COUNT(p.id) as count, COALESCE(SUM(p.amount_cents), 0) as total_raw, COALESCE(SUM(p.usd_equivalent_cents), 0) as total_usd
    FROM payments p JOIN orders o ON p.order_id = o.id
    WHERE ${orderWhere.join(' AND ')}
    GROUP BY p.method ORDER BY total_usd DESC
  `).all(...orderParams) as any[];
  const byMethod: SalesByMethodItem[] = payRows.map(r => ({
    method: r.method,
    count: r.count,
    totalUsdCents: r.total_usd,
    totalBsCents: r.total_raw,
    percentage: netFoodSalesUsdCents > 0 ? Number(((r.total_usd / netFoodSalesUsdCents) * 100).toFixed(1)) : 0
  }));

  const catRows = rawDb.prepare(`
    SELECT c.id as category_id, c.name as category_name, COALESCE(SUM(ol.quantity), 0) as units_sold, COALESCE(SUM(ol.subtotal_usd_cents), 0) as total_usd
    FROM order_lines ol JOIN orders o ON ol.order_id = o.id
    JOIN products pr ON ol.product_id = pr.id JOIN categories c ON pr.category_id = c.id
    WHERE ${orderWhere.join(' AND ')}
    GROUP BY c.id ORDER BY total_usd DESC
  `).all(...orderParams) as any[];
  const byCategory: SalesByCategoryItem[] = catRows.map(r => ({
    categoryId: r.category_id,
    categoryName: r.category_name,
    unitsSold: r.units_sold,
    totalUsdCents: r.total_usd,
    percentage: netFoodSalesUsdCents > 0 ? Number(((r.total_usd / netFoodSalesUsdCents) * 100).toFixed(1)) : 0
  }));

  const hourMap: Record<number, { orderCount: number; totalUsdCents: number }> = {};
  for (let h = 0; h < 24; h++) hourMap[h] = { orderCount: 0, totalUsdCents: 0 };
  for (const o of orders) {
    const h = new Date(o.created_at_ms).getHours();
    hourMap[h].orderCount += 1;
    hourMap[h].totalUsdCents += o.net_food || 0;
  }
  const byHour: SalesByHourItem[] = Object.keys(hourMap).map(hStr => ({
    hour: Number(hStr),
    orderCount: hourMap[Number(hStr)].orderCount,
    totalUsdCents: hourMap[Number(hStr)].totalUsdCents
  }));

  const locRows = rawDb.prepare(`
    SELECT COALESCE(l.id, 'loc_general') as location_id, COALESCE(l.name, 'SEDE PRINCIPAL') as location_name,
      COUNT(o.id) as order_count, COALESCE(SUM(o.net_food_sales_usd_cents), 0) as total_usd
    FROM orders o LEFT JOIN locations l ON o.location_id = l.id
    WHERE ${orderWhere.join(' AND ')}
    GROUP BY o.location_id ORDER BY total_usd DESC
  `).all(...orderParams) as any[];
  const byLocation: SalesByLocationItem[] = locRows.map(r => ({
    locationId: r.location_id,
    locationName: r.location_name,
    orderCount: r.order_count,
    totalUsdCents: r.total_usd
  }));

  const topProducts: ProductRankingItem[] = Object.entries(productStats)
    .map(([productId, st]) => ({
      productId,
      productName: st.name,
      unitsSold: st.units,
      totalSalesUsdCents: st.sales,
      recipeCostUsdCents: st.cost,
      marginUsdCents: st.sales - st.cost
    }))
    .sort((a, b) => b.unitsSold - a.unitsSold)
    .slice(0, 15);

  let kasavanaMatrix: MenuEngineeringReport;
  try {
    kasavanaMatrix = generateMenuEngineeringReport(rawDb, {
      startDateMs,
      endDateMs
    });
  } catch {
    kasavanaMatrix = {
      generatedAtMs: now,
      startDateMs,
      endDateMs,
      daysAnalyzed: 0,
      totalUnitsSold: 0,
      sampleStatus: 'DATOS_INSUFICIENTES',
      missingDays: 0,
      missingUnits: 0,
      hasStatisticalWarning: false,
      categories: [],
      abcSupplies: [],
      primeCost: { foodCostUsdCents: 0, laborCostUsdCents: 0, primeCostUsdCents: 0, netSalesUsdCents: 0, primeCostPercentage: 0 },
      breakEven: { fixedCostsUsdCents: 0, variableCostsUsdCents: 0, netSalesUsdCents: 0, contributionMarginRatio: 0, breakEvenSalesUsdCents: 0 }
    };
  }

  return {
    period: { startDateMs, endDateMs, locationId, locationName },
    summary: {
      grossFoodSalesUsdCents,
      discountsUsdCents,
      netFoodSalesUsdCents,
      costOfGoodsSoldUsdCents,
      cogsConfigured: ft.cogsConfigured,
      foodCostPercentage,
      wasteLossUsdCents,
      operatingExpensesUsdCents,
      netProfitUsdCents,
      netProfitMarginPercentage,
      totalOrders,
      averageTicketUsdCents
    },
    breakdown: { byMethod, byCategory, byHour, byLocation, topProducts, kasavanaMatrix }
  };
}
