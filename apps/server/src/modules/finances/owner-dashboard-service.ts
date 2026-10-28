import type Database from 'better-sqlite3';
import { getFinancialTruth } from './financial-truth-service.js';

export interface MetricDefinition {
  key: string;
  label: string;
  format: 'currency_usd' | 'integer';
  description: string;
}

export interface MetricValueResult {
  key: string;
  label: string;
  value: number; // En USD cents o unidades
  formattedValue: string;
  format: 'currency_usd' | 'integer';
}

export interface OwnerDashboardNumbers {
  timestampMs: number;
  configuredKeys: string[];
  metrics: MetricValueResult[];
}

export const AVAILABLE_OWNER_METRICS: MetricDefinition[] = [
  { key: 'sales_today', label: 'Ventas de Hoy', format: 'currency_usd', description: 'Total facturado en comida neta hoy' },
  { key: 'profit_today', label: 'Utilidad Estimada Hoy', format: 'currency_usd', description: 'Ventas − Costo recetas − Mermas − Gastos' },
  { key: 'cash_today', label: 'Efectivo en Caja', format: 'currency_usd', description: 'Efectivo USD y Bs neto cobrado hoy' },
  { key: 'receivable_total', label: 'Total por Cobrar', format: 'currency_usd', description: 'Saldo pendiente de clientes a crédito' },
  { key: 'payable_total', label: 'Total por Pagar', format: 'currency_usd', description: 'Saldo pendiente a proveedores' },
  { key: 'avg_ticket_today', label: 'Ticket Promedio Hoy', format: 'currency_usd', description: 'Venta promedio por orden hoy' },
  { key: 'orders_today', label: 'Órdenes de Hoy', format: 'integer', description: 'Cantidad de pedidos atendidos hoy' },
  { key: 'waste_today', label: 'Mermas de Hoy', format: 'currency_usd', description: 'Pérdidas registradas por merma hoy' },
  { key: 'expenses_today', label: 'Gastos de Hoy', format: 'currency_usd', description: 'Gastos operativos pagados hoy' }
];

const DEFAULT_METRIC_KEYS = [
  'sales_today',
  'profit_today',
  'cash_today',
  'receivable_total',
  'payable_total'
];

/**
 * Obtener las 5 métricas configuradas de la dueña con sus valores de hoy
 */
export function getOwnerDashboardNumbers(
  rawDb: Database.Database,
  locationId?: string
): OwnerDashboardNumbers {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfDay = now.getTime();

  // 1. Cargar configuración de los 5 números
  const settingRow = rawDb.prepare("SELECT owner_5_numbers_config FROM business_settings WHERE id = 'default'").get() as any;
  let configuredKeys: string[] = DEFAULT_METRIC_KEYS;
  if (settingRow?.owner_5_numbers_config) {
    try {
      const parsed = JSON.parse(settingRow.owner_5_numbers_config);
      if (Array.isArray(parsed) && parsed.length > 0) {
        configuredKeys = parsed.slice(0, 5);
      }
    } catch {}
  }

  // 2. Delegar a la Verdad Financiera única
  const ft = getFinancialTruth(rawDb, {
    from: startOfDay,
    to: endOfDay,
    locationId: locationId || 'ALL'
  });

  const avgTicket = ft.orders.totalCount > 0 ? Math.round(ft.orders.netSalesUsdCents / ft.orders.totalCount) : 0;

  // Mapa de todas las métricas calculadas
  const valuesMap: Record<string, number> = {
    sales_today: ft.orders.netSalesUsdCents,
    profit_today: ft.netProfitUsdCents,
    cash_today: Math.max(0, ft.expectedCash.netCashUsdCents),
    receivable_total: ft.receivables.totalUsdCents,
    payable_total: ft.payables.totalUsdCents,
    avg_ticket_today: avgTicket,
    orders_today: ft.orders.totalCount,
    waste_today: ft.waste.totalUsdCents,
    expenses_today: ft.operatingExpensesUsdCents
  };

  const metrics: MetricValueResult[] = configuredKeys.map(key => {
    const def = AVAILABLE_OWNER_METRICS.find(m => m.key === key) || {
      key,
      label: key,
      format: 'currency_usd' as const,
      description: ''
    };
    const val = valuesMap[key] ?? 0;
    const formattedValue = def.format === 'currency_usd'
      ? `$${(val / 100).toFixed(2)}`
      : val.toString();

    return {
      key,
      label: def.label,
      value: val,
      formattedValue,
      format: def.format
    };
  });

  return {
    timestampMs: endOfDay,
    configuredKeys,
    metrics
  };
}

/**
 * Actualizar las métricas configuradas por la dueña (exactamente 5)
 */
export function updateOwnerNumbersConfig(rawDb: Database.Database, keys: string[]): string[] {
  if (!Array.isArray(keys) || keys.length !== 5) {
    throw new Error('Debe configurar exactamente 5 métricas para el panel de inicio');
  }

  const validKeys = AVAILABLE_OWNER_METRICS.map(m => m.key);
  for (const k of keys) {
    if (!validKeys.includes(k)) {
      throw new Error(`Métrica inválida: "${k}". Opciones válidas: ${validKeys.join(', ')}`);
    }
  }

  const jsonStr = JSON.stringify(keys);
  const now = Date.now();

  rawDb.prepare(`
    UPDATE business_settings
    SET owner_5_numbers_config = ?, updated_at_ms = ?
    WHERE id = 'default'
  `).run(jsonStr, now);

  return keys;
}
