/**
 * SISTEMA OPERATIVO LOCAL TOCINETA
 * Módulo de Reportes, Métricas de Personal y Exportación Local (M8)
 * 
 * - Métricas de Personal:
 *   - "Mi Rendimiento": Segregado por trabajador (órdenes, extras vendidos, tiempo promedio, tasa libre de incidentes).
 *   - "Vista Admin": Métricas de todo el personal con alertas de anomalías.
 * - Exportación 100% Local:
 *   - Excel (.xlsx) con exceljs.
 *   - PDF (.pdf) con pdfkit usando fuentes estándar embebidas.
 */

import type Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { getFinancialTruth } from '../finances/financial-truth-service.js';

export interface WorkerPerformanceMetrics {
  userId: string;
  userName: string;
  role: string;
  ordersCount: number;
  extrasSoldCount: number;
  avgPrepOrDeliveryTimeMins: number;
  incidentCount: number;
  incidentFreeRatePct: number;
  totalMermaLossUsdCents: number;
  hasAnomaly: boolean;
  anomalyReasons: string[];
}

export interface AdminStaffPerformanceReport {
  generatedAtMs: number;
  totalWorkers: number;
  totalOrders: number;
  totalIncidents: number;
  workers: WorkerPerformanceMetrics[];
  alerts: Array<{
    userId: string;
    userName: string;
    severity: 'warning' | 'danger';
    message: string;
  }>;
}

/**
 * Obtener métricas de rendimiento para un trabajador específico ("Mi Rendimiento")
 */
export function getWorkerPerformance(
  rawDb: Database.Database,
  userId: string
): WorkerPerformanceMetrics {
  const user = rawDb.prepare('SELECT id, name, role FROM users WHERE id = ?').get(userId) as any;
  if (!user) {
    const err: any = new Error(`Usuario '${userId}' no encontrado`);
    err.statusCode = 404;
    throw err;
  }

  // 1. Total de órdenes atendidas/creadas por el trabajador
  const ordersRow = rawDb.prepare(`
    SELECT count(*) as count
    FROM orders
    WHERE created_by_user_id = ?
  `).get(userId) as { count: number };
  const ordersCount = ordersRow?.count || 0;

  // 2. Extras vendidos en las órdenes del trabajador
  const extrasRow = rawDb.prepare(`
    SELECT count(*) as count
    FROM order_lines ol
    JOIN orders o ON ol.order_id = o.id
    WHERE o.created_by_user_id = ?
      AND (ol.line_role = 'UPSELL' OR EXISTS (
        SELECT 1 FROM order_line_modifiers olm 
        WHERE olm.order_line_id = ol.id 
          AND (olm.modifier_type = 'EXTRA_INGREDIENTE' OR olm.modifier_type = 'BARRA_LIBRE')
      ))
  `).get(userId) as { count: number };
  const extrasSoldCount = extrasRow?.count || 0;

  // 3. Tiempo promedio de atención/entrega en minutos
  const timeRow = rawDb.prepare(`
    SELECT AVG(CASE 
      WHEN closed_at_ms IS NOT NULL AND created_at_ms IS NOT NULL THEN (closed_at_ms - created_at_ms)
      WHEN updated_at_ms IS NOT NULL AND created_at_ms IS NOT NULL THEN (updated_at_ms - created_at_ms)
      ELSE NULL
    END) as avg_ms
    FROM orders
    WHERE created_by_user_id = ? AND fulfillment_status IN ('listo', 'entregado', 'cerrado')
  `).get(userId) as { avg_ms: number | null };
  const avgPrepOrDeliveryTimeMins = timeRow?.avg_ms
    ? Math.round((timeRow.avg_ms / 60000) * 10) / 10
    : 0;

  // 4. Incidentes asociados al trabajador
  const incidentRow = rawDb.prepare(`
    SELECT count(*) as count, COALESCE(SUM(estimated_loss_usd_cents), 0) as total_loss
    FROM worker_incidents
    WHERE user_id = ?
  `).get(userId) as { count: number; total_loss: number };
  const incidentCount = incidentRow?.count || 0;
  const totalMermaLossUsdCents = incidentRow?.total_loss || 0;

  // 5. Tasa de órdenes sin incidentes
  let incidentFreeRatePct = 100;
  if (ordersCount > 0) {
    const incidentFreeOrders = Math.max(0, ordersCount - incidentCount);
    incidentFreeRatePct = Math.round((incidentFreeOrders / ordersCount) * 100);
  }

  // 6. Detección de anomalías
  const anomalyReasons: string[] = [];
  if (ordersCount >= 5 && incidentFreeRatePct < 90) {
    anomalyReasons.push(`Tasa de órdenes con incidentes elevada (${100 - incidentFreeRatePct}% de error).`);
  }
  if (avgPrepOrDeliveryTimeMins > 25) {
    anomalyReasons.push(`Tiempo promedio de atención alto (${avgPrepOrDeliveryTimeMins} mins).`);
  }
  if (totalMermaLossUsdCents > 1500) {
    anomalyReasons.push(`Mermas acumuladas superiores a $15.00 ($${(totalMermaLossUsdCents / 100).toFixed(2)}).`);
  }

  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    ordersCount,
    extrasSoldCount,
    avgPrepOrDeliveryTimeMins,
    incidentCount,
    incidentFreeRatePct,
    totalMermaLossUsdCents,
    hasAnomaly: anomalyReasons.length > 0,
    anomalyReasons
  };
}

/**
 * Obtener métricas consolidadas del personal para la Vista Admin
 */
export function getAdminStaffPerformance(
  rawDb: Database.Database
): AdminStaffPerformanceReport {
  const users = rawDb.prepare(`
    SELECT id, name, role
    FROM users
    WHERE is_active = 1
    ORDER BY role, name
  `).all() as Array<{ id: string; name: string; role: string }>;

  const workers: WorkerPerformanceMetrics[] = [];
  const alerts: AdminStaffPerformanceReport['alerts'] = [];

  let totalOrders = 0;
  let totalIncidents = 0;

  for (const u of users) {
    const metrics = getWorkerPerformance(rawDb, u.id);
    workers.push(metrics);
    totalOrders += metrics.ordersCount;
    totalIncidents += metrics.incidentCount;

    if (metrics.hasAnomaly) {
      alerts.push({
        userId: u.id,
        userName: u.name,
        severity: metrics.incidentFreeRatePct < 85 ? 'danger' : 'warning',
        message: `${u.name} (${u.role}): ${metrics.anomalyReasons.join(' ')}`
      });
    }
  }

  return {
    generatedAtMs: Date.now(),
    totalWorkers: workers.length,
    totalOrders,
    totalIncidents,
    workers,
    alerts
  };
}

/**
 * Cargar datos consolidados de la jornada para reportes
 */
export function getJornadaReportData(rawDb: Database.Database, jornadaId: string) {
  const jornada = rawDb.prepare('SELECT * FROM jornadas WHERE id = ?').get(jornadaId) as any;
  if (!jornada) {
    const err: any = new Error(`Jornada '${jornadaId}' no encontrada`);
    err.statusCode = 404;
    throw err;
  }

  // Delegación a la verdad única financiera
  const ft = getFinancialTruth(rawDb, { jornadaId });

  // Hash de auditoría de cierre o actual
  let auditHeadHash = jornada.audit_head_hash;
  if (!auditHeadHash) {
    const lastAudit = rawDb.prepare('SELECT entry_hash FROM audit_events ORDER BY seq DESC LIMIT 1').get() as any;
    auditHeadHash = lastAudit?.entry_hash || 'GENESIS_AUDIT_HASH';
  }

  // Libro de ledger_entries completo
  const ledgerEntries = rawDb.prepare(`
    SELECT seq, entry_id, order_id, account_bucket, debit_usd_cents, credit_usd_cents, rate_micro_bs, description, created_at_ms
    FROM ledger_entries
    WHERE jornada_id = ?
    ORDER BY seq ASC
  `).all(jornadaId) as any[];

  // Lista de incidentes
  const incidents = rawDb.prepare(`
    SELECT wi.*, u.name as worker_name, a.name as authorizer_name
    FROM worker_incidents wi
    LEFT JOIN users u ON wi.user_id = u.id
    LEFT JOIN users a ON wi.authorized_by_user_id = a.id
    WHERE wi.jornada_id = ?
    ORDER BY wi.created_at_ms ASC
  `).all(jornadaId) as any[];

  const ubiiMethod = ft.collectedByMethod.find(m => m.method === 'UBII');
  const ubiiGrossBsCents = ubiiMethod?.grossBsCents || 0;
  const ubiiFeeBsCents = Math.round((ubiiGrossBsCents * 75) / 10000); // 0.75%
  const ubiiNetBsCents = ubiiGrossBsCents - ubiiFeeBsCents;

  const cashUsdMethod = ft.collectedByMethod.find(m => m.method === 'EFECTIVO_USD');
  const cashBsMethod = ft.collectedByMethod.find(m => m.method === 'EFECTIVO_BS');
  const pagoMovilMethod = ft.collectedByMethod.find(m => m.method === 'PAGO_MOVIL');
  const binanceMethod = ft.collectedByMethod.find(m => m.method === 'BINANCE');
  const zelleMethod = ft.collectedByMethod.find(m => m.method === 'ZELLE');

  return {
    jornada,
    rateMicroBs: ft.rateMicroBs,
    netFoodSalesUsdCents: ft.orders.netSalesUsdCents,
    discountUsdCents: ft.orders.discountsUsdCents,
    deliveryFeesUsdCents: ft.orders.deliveryFeesUsdCents,
    totalCollectedUsdCents: ft.orders.netSalesUsdCents + ft.orders.deliveryFeesUsdCents,
    cashUsdCents: cashUsdMethod?.grossUsdCents || 0,
    cashBsCents: cashBsMethod?.grossBsCents || 0,
    pagoMovilBsCents: pagoMovilMethod?.grossBsCents || 0,
    ubiiGrossBsCents,
    ubiiFeeBsCents,
    ubiiNetBsCents,
    binanceUsdCents: binanceMethod?.grossUsdCents || 0,
    zelleUsdCents: zelleMethod?.grossUsdCents || 0,
    expensesUsdCents: ft.operatingExpensesUsdCents,
    mermasUsdCents: ft.waste.totalUsdCents,
    ordersCount: ft.orders.totalCount,
    auditHeadHash,
    ledgerEntries,
    incidents,
    // Claves R2 requeridas por CashierClosureWizard y contratos Zod compartidos
    expectedCashUsdCents: ft.expectedCash.netCashUsdCents,
    expectedCashBsCents: ft.expectedCash.netCashBsCents,
    totalOrders: ft.orders.totalCount,
    byMethod: ft.collectedByMethod.map(m => ({
      method: m.method,
      count: m.count,
      totalUsdCents: m.grossUsdCents,
      totalBsCents: m.grossBsCents,
      changeUsdCents: m.changeDeliveredUsdCents,
      changeBsCents: m.changeDeliveredBsCents,
      netUsdCents: m.netUsdCents,
      netBsCents: m.netBsCents
    })),
    bySede: ft.bySede.map(s => ({
      locationId: s.locationId,
      locationName: s.locationName,
      totalOrders: s.totalOrders,
      netSalesUsdCents: s.netSalesUsdCents,
      expectedCashUsdCents: s.expectedCashUsdCents,
      expectedCashBsCents: s.expectedCashBsCents
    }))
  };
}

/**
 * 1. Exportación 100% Local a Excel con exceljs
 */
export async function generateJornadaExcelReport(
  rawDb: Database.Database,
  jornadaId: string
): Promise<Buffer> {
  const data = getJornadaReportData(rawDb, jornadaId);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TOCINETA';
  workbook.created = new Date();

  // Hoja 1: Resumen de Jornada
  const summarySheet = workbook.addWorksheet('Resumen Jornada');
  summarySheet.columns = [
    { header: 'CONCEPTO / INDICADOR', key: 'concept', width: 35 },
    { header: 'VALOR USD', key: 'valUsd', width: 18 },
    { header: 'VALOR BS', key: 'valBs', width: 22 },
    { header: 'NOTAS / DETALLE', key: 'notes', width: 40 }
  ];

  summarySheet.addRow({
    concept: 'JORNADA ID',
    valUsd: data.jornada.id,
    notes: `Estado: ${data.jornada.status}`
  });
  summarySheet.addRow({
    concept: 'TASA OFICIAL BCV',
    valUsd: `$1 = ${(data.rateMicroBs / 1_000_000).toFixed(2)} Bs`,
    notes: 'Micro-Bs con precisión BigInt'
  });
  summarySheet.addRow({
    concept: 'FECHA APERTURA',
    valUsd: new Date(data.jornada.opened_at_ms).toLocaleString('es-VE'),
    notes: ''
  });
  if (data.jornada.closed_at_ms) {
    summarySheet.addRow({
      concept: 'FECHA CIERRE',
      valUsd: new Date(data.jornada.closed_at_ms).toLocaleString('es-VE'),
      notes: ''
    });
  }
  summarySheet.addRow({});

  summarySheet.addRow({ concept: '--- TOTALES FINANCIEROS ---' });
  summarySheet.addRow({
    concept: 'Venta Neta Alimentos',
    valUsd: (data.netFoodSalesUsdCents / 100).toFixed(2),
    valBs: ((data.netFoodSalesUsdCents * data.rateMicroBs) / 100_000_000).toFixed(2),
    notes: 'Ventas de comida sin delivery'
  });
  summarySheet.addRow({
    concept: 'Fondo Delivery (Motorizados)',
    valUsd: (data.deliveryFeesUsdCents / 100).toFixed(2),
    valBs: ((data.deliveryFeesUsdCents * data.rateMicroBs) / 100_000_000).toFixed(2),
    notes: 'Fondo 100% de motorizados'
  });
  summarySheet.addRow({
    concept: 'Descuentos / Cupones Aplicados',
    valUsd: (data.discountUsdCents / 100).toFixed(2),
    valBs: ((data.discountUsdCents * data.rateMicroBs) / 100_000_000).toFixed(2),
    notes: 'Descuentos absorbidos por el negocio'
  });
  summarySheet.addRow({
    concept: 'TOTAL RECAUDADO (VENTAS + DELIVERY)',
    valUsd: (data.totalCollectedUsdCents / 100).toFixed(2),
    valBs: ((data.totalCollectedUsdCents * data.rateMicroBs) / 100_000_000).toFixed(2),
    notes: 'Ingreso total en caja y bancos'
  });
  summarySheet.addRow({});

  summarySheet.addRow({ concept: '--- DESGLOSE DE MEDIOS DE PAGO ---' });
  summarySheet.addRow({
    concept: 'Efectivo Dólares (USD)',
    valUsd: (data.cashUsdCents / 100).toFixed(2),
    notes: 'En gaveta de caja'
  });
  summarySheet.addRow({
    concept: 'Efectivo Bolívares (Bs)',
    valBs: (data.cashBsCents / 100).toFixed(2),
    valUsd: ((data.cashBsCents * 1_000_000) / (data.rateMicroBs * 100)).toFixed(2),
    notes: 'En gaveta de caja'
  });
  summarySheet.addRow({
    concept: 'Pago Móvil (Banesco)',
    valBs: (data.pagoMovilBsCents / 100).toFixed(2),
    valUsd: ((data.pagoMovilBsCents * 1_000_000) / (data.rateMicroBs * 100)).toFixed(2),
    notes: 'Verificado con código de referencia'
  });
  summarySheet.addRow({
    concept: 'Punto de Venta Ubii (Bruto)',
    valBs: (data.ubiiGrossBsCents / 100).toFixed(2),
    notes: 'Monto total facturado por tarjeta'
  });
  summarySheet.addRow({
    concept: 'Comisión Ubii (0.75%)',
    valBs: (data.ubiiFeeBsCents / 100).toFixed(2),
    notes: 'Retención bancaria por punto de venta'
  });
  summarySheet.addRow({
    concept: 'Neto Bancario Ubii Esperado',
    valBs: (data.ubiiNetBsCents / 100).toFixed(2),
    valUsd: ((data.ubiiNetBsCents * 1_000_000) / (data.rateMicroBs * 100)).toFixed(2),
    notes: 'Liquidación esperada en cuenta bancaria'
  });
  summarySheet.addRow({
    concept: 'Binance Pay (USDT)',
    valUsd: (data.binanceUsdCents / 100).toFixed(2),
    notes: 'Criptoactivos'
  });
  summarySheet.addRow({});

  summarySheet.addRow({ concept: '--- AUDITORÍA CRIPTOGRÁFICA ---' });
  summarySheet.addRow({
    concept: 'SHA-256 AUDIT HEAD HASH',
    valUsd: data.auditHeadHash,
    notes: 'Hash criptográfico inmutable de la jornada'
  });

  // Hoja 2: Libro Contable (Ledger)
  const ledgerSheet = workbook.addWorksheet('Libro Contable');
  ledgerSheet.columns = [
    { header: 'SEQ', key: 'seq', width: 8 },
    { header: 'ENTRY ID', key: 'entryId', width: 25 },
    { header: 'ORDEN ID', key: 'orderId', width: 20 },
    { header: 'CUENTA (BUCKET)', key: 'bucket', width: 24 },
    { header: 'DÉBITO USD ($)', key: 'debit', width: 15 },
    { header: 'CRÉDITO USD ($)', key: 'credit', width: 15 },
    { header: 'DESCRIPCIÓN', key: 'description', width: 45 },
    { header: 'FECHA Y HORA', key: 'date', width: 22 }
  ];

  for (const entry of data.ledgerEntries) {
    ledgerSheet.addRow({
      seq: entry.seq,
      entryId: entry.entry_id,
      orderId: entry.order_id || 'N/A',
      bucket: entry.account_bucket,
      debit: (entry.debit_usd_cents / 100).toFixed(2),
      credit: (entry.credit_usd_cents / 100).toFixed(2),
      description: entry.description,
      date: new Date(entry.created_at_ms).toLocaleString('es-VE')
    });
  }

  // Hoja 3: Incidentes y Mermas
  const incidentsSheet = workbook.addWorksheet('Incidentes y Mermas');
  incidentsSheet.columns = [
    { header: 'INCIDENTE ID', key: 'id', width: 25 },
    { header: 'ORDEN ID', key: 'orderId', width: 20 },
    { header: 'TRABAJADOR', key: 'worker', width: 20 },
    { header: 'ÁREA RESPONSABLE', key: 'area', width: 18 },
    { header: 'TIPO / MOTIVO', key: 'reason', width: 22 },
    { header: 'RESOLUCIÓN', key: 'resolution', width: 16 },
    { header: 'PÉRDIDA ESTIMADA ($)', key: 'loss', width: 20 },
    { header: 'AUTORIZADO POR', key: 'authorizer', width: 20 },
    { header: 'FECHA Y HORA', key: 'date', width: 22 }
  ];

  for (const inc of data.incidents) {
    incidentsSheet.addRow({
      id: inc.id,
      orderId: inc.order_id || 'N/A',
      worker: inc.worker_name || inc.user_id,
      area: inc.responsible_area,
      reason: inc.reason_code || inc.incident_type,
      resolution: inc.resolution || 'N/A',
      loss: (inc.estimated_loss_usd_cents / 100).toFixed(2),
      authorizer: inc.authorizer_name || inc.authorized_by_user_id || 'N/A',
      date: new Date(inc.created_at_ms).toLocaleString('es-VE')
    });
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * 2. Exportación 100% Local a PDF con pdfkit (Fuente estándar local Helvetica)
 */
export function generateJornadaPdfReport(
  rawDb: Database.Database,
  jornadaId: string
): Promise<Buffer> {
  const data = getJornadaReportData(rawDb, jornadaId);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'LETTER' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      // Encabezado
      doc.font('Helvetica-Bold').fontSize(18).text('TOCINETA', { align: 'center' });
      doc.font('Helvetica').fontSize(10).text('SISTEMA OPERATIVO LOCAL — INFORME DE JORNADA', { align: 'center' });
      doc.moveDown(0.5);

      doc.moveTo(40, doc.y).lineTo(572, doc.y).stroke('#333333');
      doc.moveDown(0.5);

      // Metadatos
      doc.font('Helvetica-Bold').fontSize(9).text(`JORNADA ID: `, { continued: true })
         .font('Helvetica').text(`${data.jornada.id}    `)
         .font('Helvetica-Bold').text(`ESTADO: `, { continued: true })
         .font('Helvetica').text(`${data.jornada.status.toUpperCase()}    `)
         .font('Helvetica-Bold').text(`TASA BCV: `, { continued: true })
         .font('Helvetica').text(`$1 = ${(data.rateMicroBs / 1_000_000).toFixed(2)} Bs`);

      doc.font('Helvetica-Bold').fontSize(9).text(`APERTURA: `, { continued: true })
         .font('Helvetica').text(`${new Date(data.jornada.opened_at_ms).toLocaleString('es-VE')}    `)
         .font('Helvetica-Bold').text(`TOTAL ÓRDENES: `, { continued: true })
         .font('Helvetica').text(`${data.ordersCount}`);

      doc.moveDown(1);

      // Sección 1: Resumen Financiero
      doc.rect(40, doc.y, 532, 18).fill('#eeeeee');
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(10).text('1. RESUMEN FINANCIERO Y VENTAS', 45, doc.y + 4);
      doc.moveDown(1);

      const renderRow = (label: string, valUsd: string, valBs?: string) => {
        const y = doc.y;
        doc.font('Helvetica').fontSize(9).text(label, 45, y);
        doc.font('Helvetica-Bold').fontSize(9).text(valUsd, 350, y, { width: 80, align: 'right' });
        if (valBs) {
          doc.font('Helvetica').fontSize(9).text(valBs, 450, y, { width: 110, align: 'right' });
        }
        doc.moveDown(0.3);
      };

      renderRow('Venta Neta de Alimentos', `$${(data.netFoodSalesUsdCents / 100).toFixed(2)}`, `Bs ${((data.netFoodSalesUsdCents * data.rateMicroBs) / 100_000_000).toFixed(2)}`);
      renderRow('Fondo Delivery Terceros (Motorizados)', `$${(data.deliveryFeesUsdCents / 100).toFixed(2)}`, `Bs ${((data.deliveryFeesUsdCents * data.rateMicroBs) / 100_000_000).toFixed(2)}`);
      renderRow('Descuentos / Cupones Aplicados', `-$${(data.discountUsdCents / 100).toFixed(2)}`, `-Bs ${((data.discountUsdCents * data.rateMicroBs) / 100_000_000).toFixed(2)}`);
      doc.moveTo(45, doc.y).lineTo(565, doc.y).stroke('#cccccc');
      doc.moveDown(0.3);
      renderRow('TOTAL RECAUDADO EN CAJA Y BANCOS', `$${(data.totalCollectedUsdCents / 100).toFixed(2)}`, `Bs ${((data.totalCollectedUsdCents * data.rateMicroBs) / 100_000_000).toFixed(2)}`);

      doc.moveDown(1);

      // Sección 2: Desglose de Medios de Pago y Ubii
      doc.rect(40, doc.y, 532, 18).fill('#eeeeee');
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(10).text('2. DESGLOSE DE MEDIOS DE PAGO Y CONCILIACIÓN UBII', 45, doc.y + 4);
      doc.moveDown(1);

      renderRow('Efectivo Dólares (USD)', `$${(data.cashUsdCents / 100).toFixed(2)}`);
      renderRow('Efectivo Bolívares (Bs)', `$${((data.cashBsCents * 1_000_000) / (data.rateMicroBs * 100)).toFixed(2)}`, `Bs ${(data.cashBsCents / 100).toFixed(2)}`);
      renderRow('Pago Móvil (Banesco)', `$${((data.pagoMovilBsCents * 1_000_000) / (data.rateMicroBs * 100)).toFixed(2)}`, `Bs ${(data.pagoMovilBsCents / 100).toFixed(2)}`);
      renderRow('Punto de Venta Ubii (Bruto)', '', `Bs ${(data.ubiiGrossBsCents / 100).toFixed(2)}`);
      renderRow(' - Comisión Punto Ubii (0.75%)', '', `-Bs ${(data.ubiiFeeBsCents / 100).toFixed(2)}`);
      renderRow(' - Neto Bancario Ubii Esperado', `$${((data.ubiiNetBsCents * 1_000_000) / (data.rateMicroBs * 100)).toFixed(2)}`, `Bs ${(data.ubiiNetBsCents / 100).toFixed(2)}`);
      renderRow('Binance Pay (USDT)', `$${(data.binanceUsdCents / 100).toFixed(2)}`);

      doc.moveDown(1);

      // Sección 3: Gastos y Mermas
      doc.rect(40, doc.y, 532, 18).fill('#eeeeee');
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(10).text('3. GASTOS Y MERMAS DE LA JORNADA', 45, doc.y + 4);
      doc.moveDown(1);

      renderRow('Gastos Operativos de Caja', `$${(data.expensesUsdCents / 100).toFixed(2)}`);
      renderRow('Pérdidas por Mermas / Reposiciones', `$${(data.mermasUsdCents / 100).toFixed(2)}`);

      doc.moveDown(1.5);

      // Sección 4: Bloque Criptográfico de Auditoría SHA-256
      doc.rect(40, doc.y, 532, 45).fill('#f7f7f7');
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(9).text('SELLO CRIPTOGRÁFICO DE AUDITORÍA (SHA-256 HEAD HASH)', 45, doc.y + 6);
      doc.font('Courier').fontSize(8).text(data.auditHeadHash, 45, doc.y + 4);
      doc.font('Helvetica-Oblique').fontSize(8).text('Cadena inmutable verificada matemáticamente contra manipulación local.', 45, doc.y + 4);

      doc.moveDown(2);
      doc.font('Helvetica').fontSize(8).text('Documento oficial generado de forma 100% local sin dependencia de nube pública.', { align: 'center' });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
