/**
 * SISTEMA OPERATIVO TOCINETA — MÓDULO PANEL DE LA DUEÑA (FASE 4)
 * Agregación en tiempo real de ventas por sede, caja, stock crítico,
 * transferencias recientes y cuentas por cobrar.
 */

import type Database from 'better-sqlite3';
import { getFinancialTruth } from '../finances/financial-truth-service.js';
import { ensureBusinessSettingsDefensive } from '../../db/business-settings.js';

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
  isJornadaOpen?: boolean;
  jornadaOpenedAtMs?: number | null;
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

  const ft = getFinancialTruth(rawDb, { from: startOfDayMs, to: now });
  const rate = ft.rateMicroBs / 1_000_000;

  // 1. Ventas de Hoy por Sede
  const salesByLocation: LocationSalesSummary[] = [];
  for (const loc of locations) {
    const sedeTruth = ft.bySede.find(s => s.locationId === loc.id) || {
      totalOrders: 0,
      netSalesUsdCents: 0
    };

    // Contadores por tipo de entrega
    const counts = rawDb.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN fulfillment_type = 'delivery' THEN 1 ELSE 0 END), 0) as deliv,
        COALESCE(SUM(CASE WHEN fulfillment_type = 'para_llevar' THEN 1 ELSE 0 END), 0) as take,
        COALESCE(SUM(CASE WHEN fulfillment_type NOT IN ('delivery', 'para_llevar') THEN 1 ELSE 0 END), 0) as salon
      FROM orders
      WHERE (location_id = ? OR (location_id IS NULL AND ? = 'loc_alta_vista'))
        AND created_at_ms >= ? AND payment_status != 'anulado'
    `).get(loc.id, loc.id, startOfDayMs) as any;

    const netSalesBsCents = Math.round(((sedeTruth.netSalesUsdCents || 0) / 100) * rate * 100);

    salesByLocation.push({
      locationId: loc.id,
      locationName: loc.name,
      totalOrders: sedeTruth.totalOrders,
      netSalesUsdCents: sedeTruth.netSalesUsdCents,
      netSalesBsCents,
      deliveryOrdersCount: counts?.deliv || 0,
      salonOrdersCount: counts?.salon || 0,
      takeoutOrdersCount: counts?.take || 0
    });
  }

  // 2. Caja por Sede
  const cashByLocation: LocationCashSummary[] = [];
  for (const loc of locations) {
    const session = rawDb.prepare(`
      SELECT id, opening_cash_usd_cents, opening_cash_bs_cents
      FROM cash_sessions
      WHERE (location_id = ? OR (location_id IS NULL AND ? = 'loc_alta_vista')) AND status = 'abierta'
      ORDER BY opened_at_ms DESC LIMIT 1
    `).get(loc.id, loc.id) as any;

    const sedeTruth = ft.bySede.find(s => s.locationId === loc.id);

    // Medios electrónicos para esta sede
    const elecRow = rawDb.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN p.currency = 'USD' AND p.method NOT IN ('EFECTIVO_USD', 'CASH_USD', 'cash') THEN p.amount_cents ELSE 0 END), 0) as elec_usd,
        COALESCE(SUM(CASE WHEN p.currency != 'USD' AND p.method NOT IN ('EFECTIVO_BS', 'CASH_BS', 'cash') THEN p.amount_cents ELSE 0 END), 0) as elec_bs
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE (o.location_id = ? OR (o.location_id IS NULL AND ? = 'loc_alta_vista'))
        AND o.created_at_ms >= ? AND o.fulfillment_status != 'anulado'
    `).get(loc.id, loc.id, startOfDayMs) as any;

    cashByLocation.push({
      locationId: loc.id,
      locationName: loc.name,
      hasOpenSession: !!session,
      sessionId: session?.id,
      cashUsdCents: sedeTruth ? sedeTruth.expectedCashUsdCents : 0,
      cashBsCents: sedeTruth ? sedeTruth.expectedCashBsCents : 0,
      electronicUsdCents: elecRow?.elec_usd || 0,
      electronicBsCents: elecRow?.elec_bs || 0
    });
  }

  // 3. Stock Bajo por Sede
  const settings = ensureBusinessSettingsDefensive(rawDb);
  let lowStockAlerts: LowStockAlert[] = [];
  if (settings.inventory_operation_mode !== 'free') {
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

    lowStockAlerts = lowStockRows.map(r => ({
      locationId: r.location_id,
      locationName: r.location_name,
      supplyId: r.supply_id,
      supplyName: r.supply_name,
      currentStock: r.current_stock_qty,
      minimumStock: r.minimum_stock_qty,
      unit: r.usage_unit || r.unit || 'und'
    }));
  }

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

  const openJornada = rawDb.prepare(`
    SELECT opened_at_ms FROM jornadas WHERE status = 'abierta' ORDER BY opened_at_ms DESC LIMIT 1
  `).get() as { opened_at_ms: number } | undefined;

  return {
    generatedAtMs: now,
    isJornadaOpen: Boolean(openJornada),
    jornadaOpenedAtMs: openJornada?.opened_at_ms || null,
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
