/**
 * SISTEMA OPERATIVO TOCINETA — CLAVES CENTRALIZADAS DE CONSULTA Y SINCRONIZACIÓN DE DINERO (R2 P2-C)
 *
 * Fuente única de claves de React Query para todas las pantallas que consumen cifras financieras.
 * El helper invalidateMoney garantiza que tras cualquier cobro, anulación, gasto o cierre,
 * todas las vistas (Caja, Cierre, Inicio, Panel de la Dueña y Finanzas) reflejen la misma verdad.
 */

import type { QueryClient } from '@tanstack/react-query';

export const MONEY_QUERY_KEYS = {
  cashierOrders: ['cashier-orders'] as const,
  cashierSales: ['cashier-sales'] as const,
  cashierSession: ['cashier-session-active'] as const,
  posOrders: ['pos-orders'] as const,
  zReportSummary: ['z-report-summary'] as const,
  homeSummary: ['homeSummary'] as const,
  homeOrders: ['homeOrders'] as const,
  ownerDashboard: ['fase4OwnerDashboard'] as const,
  finances: ['finances'] as const
};

/**
 * Invalida inmediatamente todas las consultas financieras en memoria para forzar su sincronización.
 */
export async function invalidateMoney(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: MONEY_QUERY_KEYS.cashierOrders }),
    queryClient.invalidateQueries({ queryKey: MONEY_QUERY_KEYS.cashierSales }),
    queryClient.invalidateQueries({ queryKey: MONEY_QUERY_KEYS.cashierSession }),
    queryClient.invalidateQueries({ queryKey: MONEY_QUERY_KEYS.posOrders }),
    queryClient.invalidateQueries({ queryKey: MONEY_QUERY_KEYS.zReportSummary }),
    queryClient.invalidateQueries({ queryKey: MONEY_QUERY_KEYS.homeSummary }),
    queryClient.invalidateQueries({ queryKey: MONEY_QUERY_KEYS.homeOrders }),
    queryClient.invalidateQueries({ queryKey: MONEY_QUERY_KEYS.ownerDashboard }),
    queryClient.invalidateQueries({ queryKey: MONEY_QUERY_KEYS.finances })
  ]);
}
