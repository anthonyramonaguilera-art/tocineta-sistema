/**
 * SISTEMA OPERATIVO TOCINETA — MÓDULO PANEL DE LA DUEÑA (FASE 4)
 * Agregación en tiempo real de ventas por sede, caja, stock crítico,
 * transferencias recientes y cuentas por cobrar.
 */

import type Database from 'better-sqlite3';

export interface LocationSalesSummary {
  locationId: string;
  locationName: string;
  totalOrders: number;
  netSalesUsdCents: number;
  netSalesBsCents: number;
  deliveryOrdersCount: number;
  salonOrdersCount: number;
  takeoutOrdersCount: number;
}

export interface LocationCashSummary {
  locationId: string;
  locationName: string;
  hasOpenSession: boolean;
  sessionId?: string;
  cashUsdCents: number;
  cashBsCents: number;
  electronicUsdCents: number;
  electronicBsCents: number;
}

export interface LowStockAlert {
  locationId: string;
  locationName: string;
  supplyId: string;
  supplyName: string;
  currentStock: number;
  minimumStock: number;
  unit: string;
}

export interface OwnerDashboardData {
  generatedAtMs: number;
  salesByLocation: LocationSalesSummary[];
  cashByLocation: LocationCashSummary[];
  lowStockAlerts: LowStockAlert[];
  recentTransfers: any[];
  pendingReceivables: {
    totalPendingUsdCents: number;
    pendingOrdersCount: number;
    ordersByLocation: Record<string, number>;
  };
}

export function getOwnerDashboardData(rawDb: Database.Database): OwnerDashboardData {
  const now = Date.now();
  // Inicio del día local (00:00:00 UTC-4 Venezuela)
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const startOfDayMs = d.getTime();

  // Obtener sedes
  const locations = rawDb.prepare('SELECT id, name FROM locations WHERE is_active = 1 ORDER BY id ASC').all() as Array<{ id: string; name: string }>;

  // 1. Ventas de Hoy por Sede
  const salesByLocation: LocationSalesSummary[] = [];
  for (const loc of locations) {
    const orders = rawDb.prepare(`
      SELECT fulfillment_type, net_food_sales_usd_cents, rate_micro_bs
      FROM orders
      WHERE location_id = ? AND created_at_ms >= ? AND payment_status != 'anulado'
    `).all(loc.id, startOfDayMs) as Array<{ fulfillment_type: string; net_food_sales_usd_cents: number; rate_micro_bs: number }>;

    let totalOrders = orders.length;
    let netSalesUsdCents = 0;
    let netSalesBsCents = 0;
    let deliveryCount = 0;
    let salonCount = 0;
    let takeoutCount = 0;

    for (const o of orders) {
      netSalesUsdCents += o.net_food_sales_usd_cents || 0;
      const rate = (o.rate_micro_bs || 0) / 1_000_000;
      netSalesBsCents += Math.round(((o.net_food_sales_usd_cents || 0) / 100) * rate * 100);

      if (o.fulfillment_type === 'delivery') deliveryCount++;
      else if (o.fulfillment_type === 'para_llevar') takeoutCount++;
      else salonCount++;
    }

    salesByLocation.push({
      locationId: loc.id,
      locationName: loc.name,
      totalOrders,
      netSalesUsdCents,
      netSalesBsCents,
      deliveryOrdersCount: deliveryCount,
      salonOrdersCount: salonCount,
      takeoutOrdersCount: takeoutCount
    });
  }

  // 2. Caja por Sede
  const cashByLocation: LocationCashSummary[] = [];
  for (const loc of locations) {
    const session = rawDb.prepare(`
      SELECT id, opening_cash_usd_cents, opening_cash_bs_cents
      FROM cash_sessions
      WHERE location_id = ? AND status = 'abierta'
      ORDER BY opened_at_ms DESC LIMIT 1
    `).get(loc.id) as any;

    if (!session) {
      cashByLocation.push({
        locationId: loc.id,
        locationName: loc.name,
        hasOpenSession: false,
        cashUsdCents: 0,
        cashBsCents: 0,
        electronicUsdCents: 0,
        electronicBsCents: 0
      });
      continue;
    }

    // Calcular pagos en esta sesión
    const payments = rawDb.prepare(`
      SELECT p.method, p.amount_cents, p.currency
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE o.cash_session_id = ?
    `).all(session.id) as Array<{ method: string; amount_cents: number; currency: string }>;

    let cashUsd = session.opening_cash_usd_cents || 0;
    let cashBs = session.opening_cash_bs_cents || 0;
    let elecUsd = 0;
    let elecBs = 0;

    for (const p of payments) {
      if (p.method === 'EFECTIVO_USD' || (p.currency === 'USD' && p.method === 'cash')) {
        cashUsd += p.amount_cents;
      } else if (p.method === 'EFECTIVO_BS' || (p.currency === 'BS' && p.method === 'cash')) {
        cashBs += p.amount_cents;
      } else if (p.currency === 'USD') {
        elecUsd += p.amount_cents;
      } else {
        elecBs += p.amount_cents;
      }
    }

    cashByLocation.push({
      locationId: loc.id,
      locationName: loc.name,
      hasOpenSession: true,
      sessionId: session.id,
      cashUsdCents: cashUsd,
      cashBsCents: cashBs,
      electronicUsdCents: elecUsd,
      electronicBsCents: elecBs
    });
  }

  // 3. Stock Bajo por Sede
  const lowStockRows = rawDb.prepare(`
    SELECT li.location_id, l.name as location_name, li.supply_id, si.name as supply_name,
           li.current_stock_qty, li.minimum_stock_qty, si.usage_unit, si.unit
    FROM location_inventory li
    JOIN locations l ON li.location_id = l.id
    JOIN supply_items si ON li.supply_id = si.id
    WHERE li.current_stock_qty <= li.minimum_stock_qty
       OR (li.minimum_stock_qty = 0 AND li.current_stock_qty <= 10)
    ORDER BY li.current_stock_qty ASC
    LIMIT 20
  `).all() as any[];

  const lowStockAlerts: LowStockAlert[] = lowStockRows.map(r => ({
    locationId: r.location_id,
    locationName: r.location_name,
    supplyId: r.supply_id,
    supplyName: r.supply_name,
    currentStock: r.current_stock_qty,
    minimumStock: r.minimum_stock_qty,
    unit: r.usage_unit || r.unit || 'und'
  }));

  // 4. Envíos Recientes
  const transferRows = rawDb.prepare(`
    SELECT t.id, t.dispatch_note_code, t.from_location_id, lf.name as from_name,
           t.to_location_id, lt.name as to_name, t.status, t.mode, t.total_cost_usd_cents,
           t.created_at_ms, t.items_json
    FROM inter_location_transfers t
    LEFT JOIN locations lf ON t.from_location_id = lf.id
    LEFT JOIN locations lt ON t.to_location_id = lt.id
    ORDER BY t.created_at_ms DESC
    LIMIT 6
  `).all() as any[];

  const recentTransfers = transferRows.map(r => {
    let itemsCount = 0;
    try {
      itemsCount = JSON.parse(r.items_json).length;
    } catch {}
    return {
      id: r.id,
      dispatchNoteCode: r.dispatch_note_code,
      fromLocationName: r.from_name || r.from_location_id,
      toLocationName: r.to_name || r.to_location_id,
      status: r.status,
      itemsCount,
      totalCostUsdCents: r.total_cost_usd_cents,
      createdAtMs: r.created_at_ms
    };
  });

  // 5. Cuentas por Cobrar (Órdenes pendientes de pago)
  const pendingOrders = rawDb.prepare(`
    SELECT location_id, total_to_collect_usd_cents
    FROM orders
    WHERE payment_status = 'sin_pago' AND fulfillment_status != 'cancelado'
  `).all() as Array<{ location_id: string; total_to_collect_usd_cents: number }>;

  let totalPendingUsdCents = 0;
  const ordersByLocation: Record<string, number> = {};
  for (const o of pendingOrders) {
    totalPendingUsdCents += o.total_to_collect_usd_cents || 0;
    ordersByLocation[o.location_id] = (ordersByLocation[o.location_id] || 0) + 1;
  }

  return {
    generatedAtMs: now,
    salesByLocation,
    cashByLocation,
    lowStockAlerts,
    recentTransfers,
    pendingReceivables: {
      totalPendingUsdCents,
      pendingOrdersCount: pendingOrders.length,
      ordersByLocation
    }
  };
}
