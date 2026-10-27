import type Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { calculateProfitAndLoss } from './profit-service.js';
import { calculateCashFlow } from './cashflow-service.js';
import { listReceivables } from './receivables-service.js';
import { listPayables } from './payables-service.js';

/**
 * Exportar Estado Financiero Integral a Excel (.xlsx) con exceljs
 */
export async function generateFinancesExcelReport(
  rawDb: Database.Database,
  params: { startDateMs?: number; endDateMs?: number; locationId?: string }
): Promise<Buffer> {
  const pnl = calculateProfitAndLoss(rawDb, params);
  const cashflow = calculateCashFlow(rawDb, params);
  const receivables = listReceivables(rawDb, { locationId: params.locationId });
  const payables = listPayables(rawDb, { locationId: params.locationId });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SISTEMA TOCINETA';
  workbook.created = new Date();

  // Hoja 1: Estado de Resultados (P&L)
  const pnlSheet = workbook.addWorksheet('Estado de Resultados');
  pnlSheet.columns = [
    { header: 'CONCEPTO FINANCIERO', key: 'concept', width: 35 },
    { header: 'MONTO (USD $)', key: 'amount', width: 18 },
    { header: '% SOBRE VENTAS', key: 'percentage', width: 18 },
    { header: 'NOTAS / DETALLE', key: 'notes', width: 40 }
  ];

  pnlSheet.addRow({
    concept: 'VENTAS BRUTAS DE COMIDA',
    amount: (pnl.summary.grossFoodSalesUsdCents / 100).toFixed(2),
    percentage: '100.0%',
    notes: 'Subtotal antes de descuentos'
  });
  pnlSheet.addRow({
    concept: 'DESCUENTOS Y PROMOCIONES',
    amount: `-${(pnl.summary.discountsUsdCents / 100).toFixed(2)}`,
    percentage: pnl.summary.grossFoodSalesUsdCents > 0
      ? `${((pnl.summary.discountsUsdCents / pnl.summary.grossFoodSalesUsdCents) * 100).toFixed(1)}%`
      : '0%',
    notes: 'Cupones y promociones aplicadas'
  });
  pnlSheet.addRow({
    concept: '(=) VENTAS NETAS DE COMIDA',
    amount: (pnl.summary.netFoodSalesUsdCents / 100).toFixed(2),
    percentage: '100.0%',
    notes: 'Base real de facturación del restaurante'
  });
  pnlSheet.addRow({
    concept: '(-) COSTO DE VENTAS (CMV RECETAS)',
    amount: `-${(pnl.summary.costOfGoodsSoldUsdCents / 100).toFixed(2)}`,
    percentage: `${pnl.summary.foodCostPercentage}%`,
    notes: 'Insumos reales consumidos según recetas'
  });
  pnlSheet.addRow({
    concept: '(-) MERMAS OPERATIVAS',
    amount: `-${(pnl.summary.wasteLossUsdCents / 100).toFixed(2)}`,
    percentage: pnl.summary.netFoodSalesUsdCents > 0
      ? `${((pnl.summary.wasteLossUsdCents / pnl.summary.netFoodSalesUsdCents) * 100).toFixed(1)}%`
      : '0%',
    notes: 'Mermas y desperdicios registrados'
  });
  pnlSheet.addRow({
    concept: '(-) GASTOS OPERATIVOS (CAJA)',
    amount: `-${(pnl.summary.operatingExpensesUsdCents / 100).toFixed(2)}`,
    percentage: pnl.summary.netFoodSalesUsdCents > 0
      ? `${((pnl.summary.operatingExpensesUsdCents / pnl.summary.netFoodSalesUsdCents) * 100).toFixed(1)}%`
      : '0%',
    notes: 'Gastos operativos del período'
  });
  pnlSheet.addRow({
    concept: '(=) UTILIDAD NETA REAL',
    amount: (pnl.summary.netProfitUsdCents / 100).toFixed(2),
    percentage: `${pnl.summary.netProfitMarginPercentage}%`,
    notes: 'Resultado final del período'
  });

  pnlSheet.addRow({});
  pnlSheet.addRow({ concept: 'TOTAL PEDIDOS ATENDIDOS', amount: pnl.summary.totalOrders });
  pnlSheet.addRow({ concept: 'TICKET PROMEDIO', amount: `$${(pnl.summary.averageTicketUsdCents / 100).toFixed(2)}` });

  // Hoja 2: Flujo de Caja
  const cashSheet = workbook.addWorksheet('Flujo de Caja');
  cashSheet.columns = [
    { header: 'MÉTODO DE PAGO', key: 'method', width: 25 },
    { header: 'ENTRADAS (USD $)', key: 'inflows', width: 18 },
    { header: 'SALIDAS (USD $)', key: 'outflows', width: 18 },
    { header: 'SALDO NETO (USD $)', key: 'net', width: 18 },
    { header: 'TX ENTRADAS', key: 'txIn', width: 14 },
    { header: 'TX SALIDAS', key: 'txOut', width: 14 }
  ];

  for (const item of cashflow.byMethod) {
    cashSheet.addRow({
      method: item.method,
      inflows: (item.inflowsUsdCents / 100).toFixed(2),
      outflows: (item.outflowsUsdCents / 100).toFixed(2),
      net: (item.netBalanceUsdCents / 100).toFixed(2),
      txIn: item.inflowTransactionsCount,
      txOut: item.outflowTransactionsCount
    });
  }

  cashSheet.addRow({});
  cashSheet.addRow({
    method: 'TOTAL GENERAL',
    inflows: (cashflow.summary.totalInflowsUsdCents / 100).toFixed(2),
    outflows: (cashflow.summary.totalOutflowsUsdCents / 100).toFixed(2),
    net: (cashflow.summary.netCashFlowUsdCents / 100).toFixed(2)
  });

  // Hoja 3: Cuentas por Cobrar
  const recSheet = workbook.addWorksheet('Cuentas por Cobrar');
  recSheet.columns = [
    { header: 'CLIENTE', key: 'customer', width: 28 },
    { header: 'TELÉFONO', key: 'phone', width: 16 },
    { header: 'CONCEPTO', key: 'concept', width: 30 },
    { header: 'TOTAL ($)', key: 'total', width: 14 },
    { header: 'ABONADO ($)', key: 'paid', width: 14 },
    { header: 'SALDO PENDIENTE ($)', key: 'balance', width: 20 },
    { header: 'VENCIMIENTO', key: 'due', width: 16 },
    { header: 'ESTADO', key: 'status', width: 14 }
  ];

  for (const r of receivables) {
    recSheet.addRow({
      customer: r.customerName,
      phone: r.customerPhone || 'N/A',
      concept: r.concept,
      total: (r.totalUsdCents / 100).toFixed(2),
      paid: (r.paidUsdCents / 100).toFixed(2),
      balance: (r.balanceUsdCents / 100).toFixed(2),
      due: new Date(r.dueDateMs).toLocaleDateString('es-VE'),
      status: r.status
    });
  }

  // Hoja 4: Cuentas por Pagar
  const paySheet = workbook.addWorksheet('Cuentas por Pagar');
  paySheet.columns = [
    { header: 'PROVEEDOR', key: 'supplier', width: 28 },
    { header: 'N° FACTURA', key: 'invoice', width: 18 },
    { header: 'TOTAL ($)', key: 'total', width: 14 },
    { header: 'ABONADO ($)', key: 'paid', width: 14 },
    { header: 'SALDO PENDIENTE ($)', key: 'balance', width: 20 },
    { header: 'VENCIMIENTO', key: 'due', width: 16 },
    { header: 'ESTADO', key: 'status', width: 14 },
    { header: 'ALERTA', key: 'alert', width: 16 }
  ];

  for (const p of payables) {
    let alertStr = 'NORMAL';
    if (p.isOverdue) alertStr = 'VENCIDA';
    else if (p.isUpcomingDue) alertStr = 'POR VENCER (2D)';

    paySheet.addRow({
      supplier: p.supplierName,
      invoice: p.invoiceNumber || 'S/N',
      total: (p.totalUsdCents / 100).toFixed(2),
      paid: (p.paidUsdCents / 100).toFixed(2),
      balance: (p.balanceOwedUsdCents / 100).toFixed(2),
      due: p.dueDateMs ? new Date(p.dueDateMs).toLocaleDateString('es-VE') : 'N/A',
      status: p.status,
      alert: alertStr
    });
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
