import type Database from 'better-sqlite3';
import PDFDocument from 'pdfkit';
import { calculateProfitAndLoss } from './profit-service.js';
import { calculateCashFlow } from './cashflow-service.js';

export { generateFinancesExcelReport } from './export-excel.js';

export interface MonthlyClosureRecord {
  id: string;
  year: number;
  month: number;
  locationId: string;
  locationName?: string;
  totalSalesUsdCents: number;
  totalCogsUsdCents: number;
  totalWasteUsdCents: number;
  totalExpensesUsdCents: number;
  netProfitUsdCents: number;
  metricsJson: string;
  closedByUserId: string;
  closedByName?: string;
  closedAtMs: number;
  notes: string | null;
}

/**
 * Exportar Estado Financiero a PDF (.pdf) con fuentes nativas de pdfkit
 */
export function generateFinancesPdfReport(
  rawDb: Database.Database,
  params: { startDateMs?: number; endDateMs?: number; locationId?: string }
): Promise<Buffer> {
  const pnl = calculateProfitAndLoss(rawDb, params);
  const cashflow = calculateCashFlow(rawDb, params);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'LETTER' });
      const chunks: Buffer[] = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.font('Helvetica-Bold').fontSize(18).text('TOCINETA — INFORME FINANCIERO EJECUTIVO', { align: 'center' });
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(10).fillColor('#666666')
        .text(`Período: ${new Date(pnl.period.startDateMs).toLocaleDateString('es-VE')} al ${new Date(pnl.period.endDateMs).toLocaleDateString('es-VE')} | Sede: ${pnl.period.locationName || 'Todas las sedes'}`, { align: 'center' });
      doc.text(`Generado: ${new Date().toLocaleString('es-VE')}`, { align: 'center' });
      doc.moveDown(1);
      doc.fillColor('#000000');

      // 1. Estado de Resultados
      doc.font('Helvetica-Bold').fontSize(13).text('1. ESTADO DE RESULTADOS (P&L)');
      doc.moveDown(0.4);
      doc.font('Helvetica').fontSize(10);

      const drawRow = (concept: string, amount: string, pct: string, isBold = false) => {
        if (isBold) doc.font('Helvetica-Bold');
        else doc.font('Helvetica');
        const y = doc.y;
        doc.text(concept, 40, y, { width: 280 });
        doc.text(amount, 330, y, { width: 100, align: 'right' });
        doc.text(pct, 440, y, { width: 100, align: 'right' });
        doc.moveDown(0.3);
      };

      drawRow('Concepto', 'Monto ($)', '% Ventas', true);
      doc.strokeColor('#cccccc').moveTo(40, doc.y).lineTo(570, doc.y).stroke();
      doc.moveDown(0.3);

      drawRow('Ventas Brutas de Comida', `$${(pnl.summary.grossFoodSalesUsdCents / 100).toFixed(2)}`, '100%');
      drawRow('(-) Descuentos y Promociones', `-$${(pnl.summary.discountsUsdCents / 100).toFixed(2)}`, `${((pnl.summary.discountsUsdCents / Math.max(1, pnl.summary.grossFoodSalesUsdCents)) * 100).toFixed(1)}%`);
      drawRow('(=) VENTAS NETAS DE COMIDA', `$${(pnl.summary.netFoodSalesUsdCents / 100).toFixed(2)}`, '100%', true);
      drawRow('(-) Costo de Ventas (CMV Recetas)', `-$${(pnl.summary.costOfGoodsSoldUsdCents / 100).toFixed(2)}`, `${pnl.summary.foodCostPercentage}%`);
      drawRow('(-) Mermas Operativas', `-$${(pnl.summary.wasteLossUsdCents / 100).toFixed(2)}`, `${((pnl.summary.wasteLossUsdCents / Math.max(1, pnl.summary.netFoodSalesUsdCents)) * 100).toFixed(1)}%`);
      drawRow('(-) Gastos Operativos (Caja)', `-$${(pnl.summary.operatingExpensesUsdCents / 100).toFixed(2)}`, `${((pnl.summary.operatingExpensesUsdCents / Math.max(1, pnl.summary.netFoodSalesUsdCents)) * 100).toFixed(1)}%`);

      doc.strokeColor('#cccccc').moveTo(40, doc.y).lineTo(570, doc.y).stroke();
      doc.moveDown(0.3);
      drawRow('(=) UTILIDAD NETA REAL', `$${(pnl.summary.netProfitUsdCents / 100).toFixed(2)}`, `${pnl.summary.netProfitMarginPercentage}%`, true);

      doc.moveDown(1);

      // Métricas operativas
      doc.font('Helvetica-Bold').fontSize(11).text('Métricas Clave:');
      doc.font('Helvetica').fontSize(10);
      doc.text(`Total Órdenes: ${pnl.summary.totalOrders} | Ticket Promedio: $${(pnl.summary.averageTicketUsdCents / 100).toFixed(2)}`);

      doc.moveDown(1.2);

      // 2. Flujo de Caja
      doc.font('Helvetica-Bold').fontSize(13).text('2. FLUJO DE CAJA CONCILIADO POR MÉTODO');
      doc.moveDown(0.4);

      const drawCashRow = (m: string, inf: string, out: string, net: string, isBold = false) => {
        if (isBold) doc.font('Helvetica-Bold');
        else doc.font('Helvetica');
        const y = doc.y;
        doc.text(m, 40, y, { width: 180 });
        doc.text(inf, 220, y, { width: 100, align: 'right' });
        doc.text(out, 330, y, { width: 100, align: 'right' });
        doc.text(net, 440, y, { width: 100, align: 'right' });
        doc.moveDown(0.3);
      };

      drawCashRow('Método', 'Entradas ($)', 'Salidas ($)', 'Neto ($)', true);
      doc.strokeColor('#cccccc').moveTo(40, doc.y).lineTo(570, doc.y).stroke();
      doc.moveDown(0.3);

      for (const item of cashflow.byMethod) {
        drawCashRow(
          item.method,
          `$${(item.inflowsUsdCents / 100).toFixed(2)}`,
          `$${(item.outflowsUsdCents / 100).toFixed(2)}`,
          `$${(item.netBalanceUsdCents / 100).toFixed(2)}`
        );
      }

      doc.strokeColor('#cccccc').moveTo(40, doc.y).lineTo(570, doc.y).stroke();
      doc.moveDown(0.3);
      drawCashRow(
        'TOTAL GENERAL',
        `$${(cashflow.summary.totalInflowsUsdCents / 100).toFixed(2)}`,
        `$${(cashflow.summary.totalOutflowsUsdCents / 100).toFixed(2)}`,
        `$${(cashflow.summary.netCashFlowUsdCents / 100).toFixed(2)}`,
        true
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Crear Cierre Mensual Inmutable
 */
export function createMonthlyClosure(
  rawDb: Database.Database,
  input: { year: number; month: number; locationId: string; userId: string; notes?: string }
): MonthlyClosureRecord {
  const { year, month, locationId, userId, notes } = input;

  const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);

  const pnl = calculateProfitAndLoss(rawDb, {
    startDateMs: startDate.getTime(),
    endDateMs: endDate.getTime(),
    locationId: locationId === 'all' ? undefined : locationId
  });

  const id = `close_${year}_${month}_${locationId}`;
  const now = Date.now();
  const metricsJson = JSON.stringify(pnl);

  rawDb.prepare(`
    INSERT INTO monthly_closures (
      id, year, month, location_id, total_sales_usd_cents,
      total_cogs_usd_cents, total_waste_usd_cents, total_expenses_usd_cents,
      net_profit_usd_cents, metrics_json, closed_by_user_id, closed_at_ms, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      total_sales_usd_cents = excluded.total_sales_usd_cents,
      total_cogs_usd_cents = excluded.total_cogs_usd_cents,
      total_waste_usd_cents = excluded.total_waste_usd_cents,
      total_expenses_usd_cents = excluded.total_expenses_usd_cents,
      net_profit_usd_cents = excluded.net_profit_usd_cents,
      metrics_json = excluded.metrics_json,
      closed_by_user_id = excluded.closed_by_user_id,
      closed_at_ms = excluded.closed_at_ms,
      notes = excluded.notes
  `).run(
    id,
    year,
    month,
    locationId,
    pnl.summary.netFoodSalesUsdCents,
    pnl.summary.costOfGoodsSoldUsdCents,
    pnl.summary.wasteLossUsdCents,
    pnl.summary.operatingExpensesUsdCents,
    pnl.summary.netProfitUsdCents,
    metricsJson,
    userId,
    now,
    notes ? notes.trim() : null
  );

  return {
    id,
    year,
    month,
    locationId,
    totalSalesUsdCents: pnl.summary.netFoodSalesUsdCents,
    totalCogsUsdCents: pnl.summary.costOfGoodsSoldUsdCents,
    totalWasteUsdCents: pnl.summary.wasteLossUsdCents,
    totalExpensesUsdCents: pnl.summary.operatingExpensesUsdCents,
    netProfitUsdCents: pnl.summary.netProfitUsdCents,
    metricsJson,
    closedByUserId: userId,
    closedAtMs: now,
    notes: notes || null
  };
}

/**
 * Listar Cierres Mensuales
 */
export function listMonthlyClosures(
  rawDb: Database.Database,
  locationId?: string
): MonthlyClosureRecord[] {
  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (locationId) {
    where.push('mc.location_id = ?');
    params.push(locationId);
  }

  const query = `
    SELECT 
      mc.id,
      mc.year,
      mc.month,
      mc.location_id as locationId,
      COALESCE(l.name, 'TODAS') as locationName,
      mc.total_sales_usd_cents as totalSalesUsdCents,
      mc.total_cogs_usd_cents as totalCogsUsdCents,
      mc.total_waste_usd_cents as totalWasteUsdCents,
      mc.total_expenses_usd_cents as totalExpensesUsdCents,
      mc.net_profit_usd_cents as netProfitUsdCents,
      mc.metrics_json as metricsJson,
      mc.closed_by_user_id as closedByUserId,
      u.name as closedByName,
      mc.closed_at_ms as closedAtMs,
      mc.notes
    FROM monthly_closures mc
    LEFT JOIN locations l ON mc.location_id = l.id
    LEFT JOIN users u ON mc.closed_by_user_id = u.id
    WHERE ${where.join(' AND ')}
    ORDER BY mc.year DESC, mc.month DESC, mc.closed_at_ms DESC
  `;

  return rawDb.prepare(query).all(...params) as MonthlyClosureRecord[];
}
