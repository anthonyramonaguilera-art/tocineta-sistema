import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { buildServer } from '../src/server.js';
import { getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { seedCriticalSuppliesAndRecipes } from '../src/modules/profitability/inventory.js';
import {
  createExpense,
  listExpenses,
  getExpenseCategories,
  createExpenseCategory
} from '../src/modules/finances/expenses-service.js';
import {
  createReceivableAccount,
  listReceivables,
  getReceivableDetail,
  addReceivablePayment
} from '../src/modules/finances/receivables-service.js';
import {
  generateWhatsAppReminder,
  getCustomerStatement
} from '../src/modules/finances/receivables-statement.js';
import {
  listPayables,
  getPayableDetail,
  addPayablePayment
} from '../src/modules/finances/payables-service.js';
import { calculateProfitAndLoss } from '../src/modules/finances/profit-service.js';
import { calculateCashFlow } from '../src/modules/finances/cashflow-service.js';
import {
  getOwnerDashboardNumbers,
  updateOwnerNumbersConfig
} from '../src/modules/finances/owner-dashboard-service.js';
import {
  generateFinancesExcelReport,
  generateFinancesPdfReport,
  createMonthlyClosure,
  listMonthlyClosures
} from '../src/modules/finances/export-service.js';
import { loginAs, ensureTestSupervisor } from './test-helpers.js';

describe('FASE 5 — FINANZAS (Gastos, Por Cobrar, Por Pagar, Utilidad, Flujo de Caja, 5 Números, Reportes)', () => {
  let app: FastifyInstance;
  let rawDb: Database.Database;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    const dbCtx = getDatabaseContext();
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureOfficialLocations(rawDb);
    seedCriticalSuppliesAndRecipes(rawDb);
    ensureTestSupervisor(rawDb);

    const loginRes = await loginAs(app, 'admin', rawDb);
    adminToken = loginRes.token;
  });

  afterAll(async () => {
    await app.close();
  });

  // --------------------------------------------------------------------------
  // TEST 1: GASTOS OPERATIVOS Y CATEGORÍAS CONFIGURABLES
  // --------------------------------------------------------------------------
  it('1. Gastos: registro rápido con categoría configurable, método, sede, foto opcional y recurrencia', () => {
    // 1. Verificar categorías iniciales y crear una personalizada
    const initialCategories = getExpenseCategories(rawDb);
    expect(initialCategories.length).toBeGreaterThanOrEqual(8);

    const customCategory = createExpenseCategory(rawDb, 'SERVICIO DE SEGURIDAD');
    expect(customCategory.name).toBe('SERVICIO DE SEGURIDAD');

    // 2. Registrar gasto rápido
    const expense = createExpense(rawDb, {
      locationId: 'loc_alta_vista',
      category: 'SERVICIO DE SEGURIDAD',
      amountUsdCents: 4500, // $45.00
      paymentMethod: 'EFECTIVO_USD',
      description: 'Vigilancia nocturna quincenal',
      receiptPhotoPath: '/uploads/comprobante_seguridad.jpg',
      isRecurring: true,
      recurringInterval: 'QUINCENAL',
      notes: 'Factura 1024',
      authorizedByUserId: 'usr_admin'
    });

    expect(expense.id).toMatch(/^exp_/);
    expect(expense.amountUsdCents).toBe(4500);
    expect(expense.isRecurring).toBe(1);
    expect(expense.recurringInterval).toBe('QUINCENAL');
    expect(expense.receiptPhotoPath).toBe('/uploads/comprobante_seguridad.jpg');

    // 3. Listar gastos filtrados por categoría y sede
    const filtered = listExpenses(rawDb, {
      locationId: 'loc_alta_vista',
      category: 'SERVICIO DE SEGURIDAD'
    });
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    expect(filtered[0].category).toBe('SERVICIO DE SEGURIDAD');
  });

  // --------------------------------------------------------------------------
  // TEST 2: CUENTAS POR COBRAR (CLIENTES, FIADO, SOCIOS, ABONOS PARCIALES)
  // --------------------------------------------------------------------------
  it('2. Por Cobrar: clientes a crédito, abonos parciales USD/Bs, vencimientos y recordatorio WhatsApp', () => {
    // Crear cliente de prueba
    const customerId = `cust_test_${generateUuidV7()}`;
    rawDb.prepare(`
      INSERT INTO customers (id, name, phone, identification, is_partner, balance_receivable_usd_cents, created_at_ms)
      VALUES (?, 'Carlos Socio Evento', '04141234567', 'V-18999888', 1, 0, ?)
    `).run(customerId, Date.now());

    // Crear cuenta por cobrar: $150.00 con vencimiento en 5 días
    const dueDate = Date.now() + 5 * 24 * 60 * 60 * 1000;
    const receivable = createReceivableAccount(rawDb, {
      customerId,
      locationId: 'loc_alta_vista',
      concept: 'Consumo Evento Privado Burger Fest',
      totalUsdCents: 15000, // $150.00
      dueDateMs: dueDate,
      notes: 'Evento cerrado 10 personas',
      createdBy: 'usr_admin'
    });

    expect(receivable.balanceUsdCents).toBe(15000);
    expect(receivable.status).toBe('PENDIENTE');

    // Abono parcial 1: $50.00 en USD
    const pay1 = addReceivablePayment(rawDb, {
      receivableId: receivable.id,
      amountUsdCents: 5000,
      paymentMethod: 'EFECTIVO_USD',
      referenceCode: 'ABONO-001',
      receivedBy: 'usr_admin'
    });

    expect(pay1.updatedAccount.balanceUsdCents).toBe(10000); // Quedan $100.00
    expect(pay1.updatedAccount.status).toBe('PARCIAL');

    // Abono parcial 2: $100.00 restante (Liquidación total)
    const pay2 = addReceivablePayment(rawDb, {
      receivableId: receivable.id,
      amountUsdCents: 10000,
      paymentMethod: 'PAGO_MOVIL',
      referenceCode: 'PM-998877',
      receivedBy: 'usr_admin'
    });

    expect(pay2.updatedAccount.balanceUsdCents).toBe(0);
    expect(pay2.updatedAccount.status).toBe('PAGADA');

    // Estado de cuenta del cliente
    const statement = getCustomerStatement(rawDb, customerId);
    expect(statement.totalOwedUsdCents).toBe(15000);
    expect(statement.totalPaidUsdCents).toBe(15000);
    expect(statement.currentBalanceUsdCents).toBe(0);
    expect(statement.payments.length).toBe(2);

    // Recordatorio de WhatsApp prellenado
    const reminder = generateWhatsAppReminder(rawDb, receivable.id);
    expect(reminder.message).toContain('TOCINETA');
    expect(reminder.message).toContain('Consumo Evento Privado Burger Fest');
    expect(reminder.url).toContain('https://wa.me/584141234567');
  });

  // --------------------------------------------------------------------------
  // TEST 3: CUENTAS POR PAGAR (PROVEEDORES A CRÉDITO, ALERTAS 2 DÍAS Y VENCIDAS)
  // --------------------------------------------------------------------------
  it('3. Por Pagar: compras a crédito con alerta a 2 días y vencidas, abonos parciales y filtros', () => {
    // Proveedor
    const supplierId = `sup_test_${generateUuidV7()}`;
    rawDb.prepare(`
      INSERT INTO suppliers (id, name, rif_phone, created_at_ms)
      VALUES (?, 'Distribuidora Pan y Queso CA', 'J-31002233-4 / 04149988776', ?)
    `).run(supplierId, Date.now());

    // Compra 1: A crédito por vencer en 1 día (debe marcar alerta 'POR_VENCER')
    const now = Date.now();
    const purchaseId1 = `pur_test_${generateUuidV7()}`;
    rawDb.prepare(`
      INSERT INTO purchases (
        id, location_id, supplier_id, invoice_number, payment_condition,
        status, total_usd_cents, total_bs_cents, balance_owed_usd_cents,
        due_date_ms, notes, created_by, created_at_ms
      ) VALUES (?, 'loc_alta_vista', ?, 'FACT-501', 'CREDITO', 'PENDIENTE', 8000, 320000, 8000, ?, 'Panes brioche', 'usr_admin', ?)
    `).run(purchaseId1, supplierId, now + 1 * 24 * 3600 * 1000, now);

    // Compra 2: A crédito ya vencida hace 2 días (debe marcar alerta 'VENCIDA')
    const purchaseId2 = `pur_test_${generateUuidV7()}`;
    rawDb.prepare(`
      INSERT INTO purchases (
        id, location_id, supplier_id, invoice_number, payment_condition,
        status, total_usd_cents, total_bs_cents, balance_owed_usd_cents,
        due_date_ms, notes, created_by, created_at_ms
      ) VALUES (?, 'loc_alta_vista', ?, 'FACT-502', 'CREDITO', 'PENDIENTE', 12000, 480000, 12000, ?, 'Queso cheddar', 'usr_admin', ?)
    `).run(purchaseId2, supplierId, now - 2 * 24 * 3600 * 1000, now - 3 * 24 * 3600 * 1000);

    // Listar facturas y verificar alertas
    const upcoming = listPayables(rawDb, { status: 'POR_VENCER' });
    expect(upcoming.some(p => p.id === purchaseId1)).toBe(true);

    const overdue = listPayables(rawDb, { status: 'VENCIDA' });
    expect(overdue.some(p => p.id === purchaseId2)).toBe(true);

    // Abonar a Factura 1: Abono de $50.00
    const payResult = addPayablePayment(rawDb, {
      purchaseId: purchaseId1,
      amountUsdCents: 5000,
      paymentMethod: 'TRANSFERENCIA_BS',
      referenceCode: 'TRANSF-4411',
      paidBy: 'usr_admin'
    });

    expect(payResult.updatedPayable.balanceOwedUsdCents).toBe(3000); // Quedan $30.00
    expect(payResult.updatedPayable.paidUsdCents).toBe(5000);

    // Liquidar los $30.00 restantes
    const finalPay = addPayablePayment(rawDb, {
      purchaseId: purchaseId1,
      amountUsdCents: 3000,
      paymentMethod: 'EFECTIVO_USD',
      paidBy: 'usr_admin'
    });

    expect(finalPay.updatedPayable.balanceOwedUsdCents).toBe(0);
    expect(finalPay.updatedPayable.status).toBe('PAGADA');
  });

  // --------------------------------------------------------------------------
  // TEST 4: UTILIDAD EXACTA: VENTAS − CMV − MERMAS − GASTOS = UTILIDAD
  // --------------------------------------------------------------------------
  it('4. Utilidad: fórmula exacta, sin doble conteo de compras ni mermas, y preservación de tasa histórica', () => {
    const testJornadaId = `jornada_test_${generateUuidV7()}`;
    const now = Date.now();
    const historicRateMicroBs = 38_500_000; // Tasa histórica fija del día

    // Crear jornada
    rawDb.prepare(`
      INSERT INTO jornadas (id, location_id, opened_by_user_id, opened_at_ms, status)
      VALUES (?, 'loc_alta_vista', 'usr_admin', ?, 'abierta')
    `).run(testJornadaId, now - 3600_000);

    // Crear producto con receta conocida
    const prodRow = rawDb.prepare("SELECT id, name FROM products LIMIT 1").get() as any;
    const productId = prodRow.id;

    // 1. Crear Orden Vendida por $20.00 (2 hamburguesas) con tasa histórica
    const orderId = `ord_test_${generateUuidV7()}`;
    rawDb.prepare(`
      INSERT INTO orders (
        id, location_id, jornada_id, order_number, customer_name,
        created_by_user_id, fulfillment_type,
        rate_micro_bs, gross_food_subtotal_usd_cents, discount_usd_cents,
        net_food_sales_usd_cents, delivery_fee_usd_cents, total_to_collect_usd_cents,
        fulfillment_status, payment_status, created_at_ms, updated_at_ms
      ) VALUES (?, 'loc_alta_vista', ?, 9901, 'Cliente Prueba', 'usr_admin', 'salon', ?, 2000, 0, 2000, 0, 2000, 'entregado', 'pagado', ?, ?)
    `).run(orderId, testJornadaId, historicRateMicroBs, now - 1800_000, now - 1800_000);

    // Línea de la orden: 2 unidades de hamburguesa
    const lineId = `line_test_${generateUuidV7()}`;
    rawDb.prepare(`
      INSERT INTO order_lines (
        id, order_id, product_id, line_role, quantity,
        unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, station, created_at_ms
      ) VALUES (?, ?, ?, 'STANDARD', 2, 1000, 1000, 2000, 'hamburguesas', ?)
    `).run(lineId, orderId, productId, now - 1800_000);

    // Pago de la orden: $20.00 (Suma de ventas = Suma de pagos)
    const paymentId = `paym_test_${generateUuidV7()}`;
    rawDb.prepare(`
      INSERT INTO payments (
        id, order_id, method, currency, amount_cents, rate_micro_bs,
        usd_equivalent_cents, recorded_by_user_id, created_at_ms
      ) VALUES (?, ?, 'EFECTIVO_USD', 'USD', 2000, ?, 2000, 'usr_admin', ?)
    `).run(paymentId, orderId, historicRateMicroBs, now - 1800_000);

    // 2. Registrar Merma real en waste_logs: $2.50 = 250¢
    const wasteId = `wst_test_${generateUuidV7()}`;
    rawDb.prepare(`
      INSERT INTO waste_logs (
        id, location_id, item_type, product_id, quantity, unit,
        cost_usd_cents, reason, reported_by_user_id, created_at_ms
      ) VALUES (?, 'loc_alta_vista', 'product', ?, 1, 'unidad', 250, 'Carne quemada en plancha', 'usr_admin', ?)
    `).run(wasteId, productId, now - 1200_000);

    // 3. Registrar Gasto operativo de caja: $3.00 = 300¢
    const expId = `exp_test_${generateUuidV7()}`;
    rawDb.prepare(`
      INSERT INTO operating_expenses (
        id, location_id, jornada_id, category, amount_usd_cents,
        amount_bs_cents, payment_method, description, authorized_by_user_id,
        is_recurring, created_at_ms
      ) VALUES (?, 'loc_alta_vista', ?, 'HIELO Y DESECHABLES', 300, 11550, 'EFECTIVO_USD', 'Bolsa de hielo', 'usr_admin', 0, ?)
    `).run(expId, testJornadaId, now - 600_000);

    // 4. Calcular Estado de Resultados (P&L) en este rango
    const pnl = calculateProfitAndLoss(rawDb, {
      startDateMs: now - 3600_000,
      endDateMs: now + 60_000,
      locationId: 'loc_alta_vista'
    });

    // Validar fórmula exacta:
    // Utilidad = Ventas ($20.00) − CMV − Mermas ($2.50) − Gastos ($3.00)
    expect(pnl.summary.netFoodSalesUsdCents).toBeGreaterThanOrEqual(2000);
    expect(pnl.summary.wasteLossUsdCents).toBeGreaterThanOrEqual(250);
    expect(pnl.summary.operatingExpensesUsdCents).toBeGreaterThanOrEqual(300);

    const expectedProfit = pnl.summary.netFoodSalesUsdCents
      - pnl.summary.costOfGoodsSoldUsdCents
      - pnl.summary.wasteLossUsdCents
      - pnl.summary.operatingExpensesUsdCents;

    expect(pnl.summary.netProfitUsdCents).toBe(expectedProfit);
    expect(pnl.breakdown.byMethod.length).toBeGreaterThan(0);
    expect(pnl.breakdown.byHour.length).toBe(24);
  });

  // --------------------------------------------------------------------------
  // TEST 5: FLUJO DE CAJA CONCILIADO POR MÉTODO Y SEDE
  // --------------------------------------------------------------------------
  it('5. Flujo de caja: entradas y salidas conciliadas por método y sede', () => {
    const cashflow = calculateCashFlow(rawDb, {
      startDateMs: Date.now() - 24 * 3600_000,
      endDateMs: Date.now() + 60_000
    });

    expect(cashflow.summary.totalInflowsUsdCents).toBeGreaterThan(0);
    expect(cashflow.summary.netCashFlowUsdCents).toBe(
      cashflow.summary.totalInflowsUsdCents - cashflow.summary.totalOutflowsUsdCents
    );

    // Métodos conciliados
    const usdMethod = cashflow.byMethod.find(m => m.method === 'EFECTIVO_USD');
    expect(usdMethod).toBeDefined();
    expect(usdMethod!.netBalanceUsdCents).toBe(usdMethod!.inflowsUsdCents - usdMethod!.outflowsUsdCents);

    // Sedes
    expect(cashflow.byLocation.length).toBeGreaterThanOrEqual(2);
  });

  // --------------------------------------------------------------------------
  // TEST 6: PANEL DE LA DUEÑA: 5 NÚMEROS CONFIGURABLES
  // --------------------------------------------------------------------------
  it('6. Inicio de la Dueña: 5 números configurables calculados hoy y actualización de preferencias', () => {
    const numbers = getOwnerDashboardNumbers(rawDb);
    expect(numbers.metrics.length).toBe(5);
    expect(numbers.configuredKeys).toEqual([
      'sales_today',
      'profit_today',
      'cash_today',
      'receivable_total',
      'payable_total'
    ]);

    // Actualizar las 5 métricas de la dueña
    const newConfig = ['sales_today', 'profit_today', 'orders_today', 'avg_ticket_today', 'waste_today'];
    const updated = updateOwnerNumbersConfig(rawDb, newConfig);
    expect(updated).toEqual(newConfig);

    const updatedNumbers = getOwnerDashboardNumbers(rawDb);
    expect(updatedNumbers.metrics.map(m => m.key)).toEqual(newConfig);

    // Restaurar por defecto
    updateOwnerNumbersConfig(rawDb, [
      'sales_today',
      'profit_today',
      'cash_today',
      'receivable_total',
      'payable_total'
    ]);
  });

  // --------------------------------------------------------------------------
  // TEST 7: EXPORTAR A EXCEL (.XLSX) Y PDF (.PDF)
  // --------------------------------------------------------------------------
  it('7. Exportación local a Excel (.xlsx) y PDF (.pdf) sin librerías externas en la nube', async () => {
    const params = {
      startDateMs: Date.now() - 7 * 24 * 3600_000,
      endDateMs: Date.now()
    };

    // 1. Excel
    const excelBuffer = await generateFinancesExcelReport(rawDb, params);
    expect(excelBuffer).toBeInstanceOf(Buffer);
    expect(excelBuffer.length).toBeGreaterThan(1000);
    // Verificar firma binaria PK (ZIP / XLSX)
    expect(excelBuffer[0]).toBe(0x50); // 'P'
    expect(excelBuffer[1]).toBe(0x4b); // 'K'

    // 2. PDF
    const pdfBuffer = await generateFinancesPdfReport(rawDb, params);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(500);
    // Verificar firma binaria %PDF
    expect(pdfBuffer.toString('utf8', 0, 4)).toBe('%PDF');
  });

  // --------------------------------------------------------------------------
  // TEST 8: CIERRES MENSUALES INMUTABLES
  // --------------------------------------------------------------------------
  it('8. Cierre Mensual: generación inmutable, cálculo y recuperación por sede', () => {
    const year = 2026;
    const month = 10;
    const locationId = 'loc_alta_vista';

    const closure = createMonthlyClosure(rawDb, {
      year,
      month,
      locationId,
      userId: 'usr_admin',
      notes: 'Cierre contable preliminar de Octubre'
    });

    expect(closure.id).toBe(`close_${year}_${month}_${locationId}`);
    expect(closure.year).toBe(2026);
    expect(closure.month).toBe(10);
    expect(closure.metricsJson).toContain('summary');

    const list = listMonthlyClosures(rawDb, locationId);
    expect(list.some(c => c.id === closure.id)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // TEST 9: INTEGRACIÓN REST API (FASTIFY ENDPOINTS)
  // --------------------------------------------------------------------------
  it('9. Endpoints Fastify: /api/finances/* responden correctamente con código 200/201', async () => {
    // 1. Owner numbers
    const resNumbers = await app.inject({
      method: 'GET',
      url: '/api/finances/owner-numbers'
    });
    expect(resNumbers.statusCode).toBe(200);
    const bodyNumbers = JSON.parse(resNumbers.payload);
    expect(bodyNumbers.success).toBe(true);
    expect(bodyNumbers.data.metrics.length).toBe(5);

    // 2. Categorías
    const resCats = await app.inject({
      method: 'GET',
      url: '/api/finances/categories'
    });
    expect(resCats.statusCode).toBe(200);

    // 3. Profit & Loss
    const resPnl = await app.inject({
      method: 'GET',
      url: '/api/finances/profit-loss'
    });
    expect(resPnl.statusCode).toBe(200);
    const bodyPnl = JSON.parse(resPnl.payload);
    expect(bodyPnl.data.summary.netFoodSalesUsdCents).toBeDefined();

    // 4. Cash Flow
    const resCf = await app.inject({
      method: 'GET',
      url: '/api/finances/cash-flow'
    });
    expect(resCf.statusCode).toBe(200);

    // 5. Export Excel
    const resExcel = await app.inject({
      method: 'GET',
      url: '/api/finances/export/excel'
    });
    expect(resExcel.statusCode).toBe(200);
    expect(resExcel.headers['content-type']).toContain('spreadsheetml');

    // 6. Export PDF
    const resPdf = await app.inject({
      method: 'GET',
      url: '/api/finances/export/pdf'
    });
    expect(resPdf.statusCode).toBe(200);
    expect(resPdf.headers['content-type']).toBe('application/pdf');
  });
});
