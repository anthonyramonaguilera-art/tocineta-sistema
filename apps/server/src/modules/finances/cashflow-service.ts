import type Database from 'better-sqlite3';
import { getFinancialTruth } from './financial-truth-service.js';

export interface CashFlowMethodItem {
  method: string;
  inflowsUsdCents: number;
  outflowsUsdCents: number;
  netBalanceUsdCents: number;
  inflowTransactionsCount: number;
  outflowTransactionsCount: number;
}

export interface CashFlowLocationItem {
  locationId: string;
  locationName: string;
  inflowsUsdCents: number;
  outflowsUsdCents: number;
  netBalanceUsdCents: number;
}

export interface CashFlowStatement {
  period: {
    startDateMs: number;
    endDateMs: number;
    locationId: string | null;
  };
  summary: {
    totalInflowsUsdCents: number;
    totalOutflowsUsdCents: number;
    netCashFlowUsdCents: number;
    salesInflowsUsdCents: number;
    receivableInflowsUsdCents: number;
    expensesOutflowsUsdCents: number;
    payableOutflowsUsdCents: number;
  };
  byMethod: CashFlowMethodItem[];
  byLocation: CashFlowLocationItem[];
}

/**
 * Normalizar nombres de métodos de pago para agrupación limpia
 */
function normalizePaymentMethod(method: string | null | undefined): string {
  const m = (method || 'OTROS').toUpperCase().trim();
  if (m.includes('EFECTIVO_USD') || m === 'USD' || m === 'EFECTIVO DOLARES') return 'EFECTIVO_USD';
  if (m.includes('EFECTIVO_BS') || m === 'BS' || m === 'EFECTIVO BOLIVARES') return 'EFECTIVO_BS';
  if (m.includes('PAGO_MOVIL') || m === 'PAGOMOVIL') return 'PAGO_MOVIL';
  if (m.includes('ZELLE')) return 'ZELLE';
  if (m.includes('PUNTO') || m.includes('UBII') || m.includes('TARJETA') || m.includes('POS')) return 'PUNTO_VENTA';
  if (m.includes('BINANCE') || m.includes('USDT')) return 'BINANCE';
  return m;
}

/**
 * Cálculo integral de Flujo de Caja por método y por sede
 */
export function calculateCashFlow(
  rawDb: Database.Database,
  params: { startDateMs?: number; endDateMs?: number; locationId?: string } = {}
): CashFlowStatement {
  const now = Date.now();
  const startDateMs = params.startDateMs ?? (now - 30 * 24 * 60 * 60 * 1000);
  const endDateMs = params.endDateMs ?? now;
  const locationId = params.locationId || null;

  const methodMap: Record<string, CashFlowMethodItem> = {};
  const ensureMethod = (m: string) => {
    if (!methodMap[m]) {
      methodMap[m] = {
        method: m,
        inflowsUsdCents: 0,
        outflowsUsdCents: 0,
        netBalanceUsdCents: 0,
        inflowTransactionsCount: 0,
        outflowTransactionsCount: 0
      };
    }
  };

  const locMap: Record<string, { name: string; inflows: number; outflows: number }> = {};
  const ensureLoc = (id: string, name?: string) => {
    if (!locMap[id]) {
      locMap[id] = { name: name || id, inflows: 0, outflows: 0 };
    }
  };

  // Cargar sedes
  const locations = rawDb.prepare('SELECT id, name FROM locations').all() as Array<{ id: string; name: string }>;
  for (const l of locations) {
    ensureLoc(l.id, l.name);
  }

  // 1. ENTRADAS: Pagos de Pedidos (Ventas) delegados a la Verdad Financiera
  const ft = getFinancialTruth(rawDb, {
    from: startDateMs,
    to: endDateMs,
    locationId: locationId || 'ALL'
  });

  let salesInflowsUsdCents = 0;
  for (const m of ft.collectedByMethod) {
    const norm = normalizePaymentMethod(m.method);
    ensureMethod(norm);
    methodMap[norm].inflowsUsdCents += m.grossUsdCents;
    methodMap[norm].inflowTransactionsCount += m.count;
    salesInflowsUsdCents += m.grossUsdCents;
  }

  for (const s of ft.bySede) {
    ensureLoc(s.locationId, s.locationName);
    locMap[s.locationId].inflows += s.netSalesUsdCents;
  }

  // 2. ENTRADAS: Abonos de Cuentas por Cobrar (Clientes)
  const recWhere = ['rp.created_at_ms >= ?', 'rp.created_at_ms <= ?'];
  const recParams: any[] = [startDateMs, endDateMs];
  if (locationId) {
    recWhere.push('rp.location_id = ?');
    recParams.push(locationId);
  }

  const recPayRows = rawDb.prepare(`
    SELECT 
      rp.payment_method,
      COALESCE(SUM(rp.amount_usd_cents), 0) as total_usd,
      COUNT(rp.id) as count,
      rp.location_id as loc_id
    FROM receivable_payments rp
    WHERE ${recWhere.join(' AND ')}
    GROUP BY rp.payment_method, rp.location_id
  `).all(...recParams) as any[];

  let receivableInflowsUsdCents = 0;
  for (const row of recPayRows) {
    const m = normalizePaymentMethod(row.payment_method);
    ensureMethod(m);
    methodMap[m].inflowsUsdCents += row.total_usd;
    methodMap[m].inflowTransactionsCount += row.count;
    receivableInflowsUsdCents += row.total_usd;

    ensureLoc(row.loc_id);
    locMap[row.loc_id].inflows += row.total_usd;
  }

  // 3. SALIDAS: Gastos Operativos (excluyendo MERMAS_DESPERDICIOS)
  const expWhere = ['oe.created_at_ms >= ?', 'oe.created_at_ms <= ?', "oe.category != 'MERMAS_DESPERDICIOS'"];
  const expParams: any[] = [startDateMs, endDateMs];
  if (locationId) {
    expWhere.push('(oe.location_id = ? OR (oe.location_id IS NULL AND ? = ?))');
    expParams.push(locationId, locationId, 'loc_alta_vista');
  }

  const expRows = rawDb.prepare(`
    SELECT 
      oe.payment_method,
      COALESCE(SUM(oe.amount_usd_cents), 0) as total_usd,
      COUNT(oe.id) as count,
      COALESCE(oe.location_id, 'loc_alta_vista') as loc_id
    FROM operating_expenses oe
    WHERE ${expWhere.join(' AND ')}
    GROUP BY oe.payment_method, oe.location_id
  `).all(...expParams) as any[];

  let expensesOutflowsUsdCents = 0;
  for (const row of expRows) {
    const m = normalizePaymentMethod(row.payment_method);
    ensureMethod(m);
    methodMap[m].outflowsUsdCents += row.total_usd;
    methodMap[m].outflowTransactionsCount += row.count;
    expensesOutflowsUsdCents += row.total_usd;

    ensureLoc(row.loc_id);
    locMap[row.loc_id].outflows += row.total_usd;
  }

  // 4. SALIDAS: Abonos a Cuentas por Pagar (Proveedores)
  const payWhere = ['pp.created_at_ms >= ?', 'pp.created_at_ms <= ?'];
  const payParams: any[] = [startDateMs, endDateMs];
  if (locationId) {
    payWhere.push('pp.location_id = ?');
    payParams.push(locationId);
  }

  const payRows = rawDb.prepare(`
    SELECT 
      pp.payment_method,
      COALESCE(SUM(pp.amount_usd_cents), 0) as total_usd,
      COUNT(pp.id) as count,
      pp.location_id as loc_id
    FROM payable_payments pp
    WHERE ${payWhere.join(' AND ')}
    GROUP BY pp.payment_method, pp.location_id
  `).all(...payParams) as any[];

  let payableOutflowsUsdCents = 0;
  for (const row of payRows) {
    const m = normalizePaymentMethod(row.payment_method);
    ensureMethod(m);
    methodMap[m].outflowsUsdCents += row.total_usd;
    methodMap[m].outflowTransactionsCount += row.count;
    payableOutflowsUsdCents += row.total_usd;

    ensureLoc(row.loc_id);
    locMap[row.loc_id].outflows += row.total_usd;
  }

  // Calcular balances netos por método
  const byMethod: CashFlowMethodItem[] = Object.values(methodMap).map(item => ({
    ...item,
    netBalanceUsdCents: item.inflowsUsdCents - item.outflowsUsdCents
  })).sort((a, b) => b.inflowsUsdCents - a.inflowsUsdCents);

  // Calcular balances netos por sede
  const byLocation: CashFlowLocationItem[] = Object.entries(locMap).map(([locId, data]) => ({
    locationId: locId,
    locationName: data.name,
    inflowsUsdCents: data.inflows,
    outflowsUsdCents: data.outflows,
    netBalanceUsdCents: data.inflows - data.outflows
  }));

  const totalInflowsUsdCents = salesInflowsUsdCents + receivableInflowsUsdCents;
  const totalOutflowsUsdCents = expensesOutflowsUsdCents + payableOutflowsUsdCents;
  const netCashFlowUsdCents = totalInflowsUsdCents - totalOutflowsUsdCents;

  return {
    period: {
      startDateMs,
      endDateMs,
      locationId
    },
    summary: {
      totalInflowsUsdCents,
      totalOutflowsUsdCents,
      netCashFlowUsdCents,
      salesInflowsUsdCents,
      receivableInflowsUsdCents,
      expensesOutflowsUsdCents,
      payableOutflowsUsdCents
    },
    byMethod,
    byLocation
  };
}
