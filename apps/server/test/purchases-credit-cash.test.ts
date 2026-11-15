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
import { registerPurchase } from '../src/modules/profitability/purchases-service.js';
import { listPayables, addPayablePayment } from '../src/modules/finances/payables-service.js';
import { getFinancialTruth } from '../src/modules/finances/financial-truth-service.js';
import { calculateCashFlow } from '../src/modules/finances/cashflow-service.js';
import { calculateProfitAndLoss } from '../src/modules/finances/profit-service.js';
import { loginAs } from './test-helpers.js';

describe('COMPRAS A CRÉDITO Y CONTADO (Flujo de Caja, Cuentas por Pagar, P&L y Neutralización de Ruta Legada)', () => {
  let app: FastifyInstance;
  let rawDb: Database.Database;
  let adminToken: string;
  let supplyId: string;
  let creditPurchaseId: string;
  let initialPayablesTruth: number;

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

    const auth = await loginAs(app, 'admin', rawDb);
    adminToken = auth.token;

    // Crear un insumo específico para las pruebas de compra
    supplyId = `sup_test_pur_${generateUuidV7().replace(/-/g, '').slice(0, 12)}`;
    const now = Date.now();
    rawDb.prepare(`
      INSERT OR REPLACE INTO supply_items (
        id, name, unit, unit_measure, purchase_unit, usage_unit, conversion_factor,
        category, min_stock, cost_per_unit_usd_cents, weighted_avg_cost_usd_cents,
        last_cost_usd_cents, is_active, current_stock_qty, created_at_ms, updated_at_ms
      ) VALUES (?, 'Carne Molida Especial', 'kg', 'kg', 'kg', 'kg', 1.0, 'carnes', 5, 0, 0, 0, 1, 0, ?, ?)
    `).run(supplyId, now, now);
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Compra a CREDITO exige dueDateMs y crea saldo por pagar (10000 centavos)', () => {
    // Intento a crédito sin dueDateMs debe lanzar error 400
    expect(() => {
      registerPurchase(rawDb, {
        locationId: 'loc_alta_vista',
        paymentCondition: 'CREDITO',
        createdBy: 'usr_admin',
        items: [{ supplyId, purchaseQuantity: 10, unitCostUsdCents: 1000 }] // $100 = 10000 cents
      });
    }).toThrowError(/vencimiento/i);

    const initialPL = calculateProfitAndLoss(rawDb, { locationId: 'ALL' });
    initialPayablesTruth = getFinancialTruth(rawDb, { locationId: 'ALL' }).payables.totalUsdCents;

    const dueDateMs = Date.now() + 15 * 86400000;
    const invNum = `FAC-CRED-${generateUuidV7().slice(0, 8)}`;
    const creditPurchase = registerPurchase(rawDb, {
      locationId: 'loc_alta_vista',
      supplierName: 'Distribuidora Carnes del Sur',
      invoiceNumber: invNum,
      paymentCondition: 'CREDITO',
      dueDateMs,
      createdBy: 'usr_admin',
      items: [{ supplyId, purchaseQuantity: 10, unitCostUsdCents: 1000 }] // 10 * 1000 = 10000 centavos ($100)
    });
    creditPurchaseId = creditPurchase.purchaseId;

    expect(creditPurchase.totalUsdCents).toBe(10000);

    // Verificar en base de datos estado y saldo
    const row = rawDb.prepare('SELECT status, balance_owed_usd_cents, due_date_ms, payment_method FROM purchases WHERE id = ?').get(creditPurchase.purchaseId) as any;
    expect(row.status).toBe('PENDIENTE');
    expect(row.balance_owed_usd_cents).toBe(10000);
    expect(row.due_date_ms).toBe(dueDateMs);
    expect(row.payment_method).toBeNull();

    // listPayables incluye la factura con saldo 10000
    const payables = listPayables(rawDb, { locationId: 'loc_alta_vista' });
    const pRecord = payables.find(p => p.id === creditPurchase.purchaseId);
    expect(pRecord).toBeDefined();
    expect(pRecord?.balanceOwedUsdCents).toBe(10000);
    expect(pRecord?.status).toBe('PENDIENTE');

    // financial truth payables.totalUsdCents aumentó exactamente 10000
    const truth = getFinancialTruth(rawDb, { locationId: 'ALL' });
    expect(truth.payables.totalUsdCents).toBe(initialPayablesTruth + 10000);

    // P&L NO cambia por la compra (los gastos operativos y la utilidad neta permanecen iguales)
    const afterPL = calculateProfitAndLoss(rawDb, { locationId: 'ALL' });
    expect(afterPL.operatingExpensesUsdCents).toBe(initialPL.operatingExpensesUsdCents);
    expect(afterPL.netProfitUsdCents).toBe(initialPL.netProfitUsdCents);
  });

  it('2. Abono $40 a la compra a CREDITO reduce el saldo a $60 (6000 centavos)', () => {
    // Buscar la factura a crédito
    const payables = listPayables(rawDb, { locationId: 'loc_alta_vista' });
    const creditPurchase = payables.find(p => p.id === creditPurchaseId);
    expect(creditPurchase).toBeDefined();
    expect(creditPurchase?.balanceOwedUsdCents).toBe(10000);

    // Abonar $40 (4000 centavos)
    const result = addPayablePayment(rawDb, {
      purchaseId: creditPurchaseId,
      amountUsdCents: 4000,
      paymentMethod: 'TRANSFERENCIA',
      paidBy: 'usr_admin',
      notes: 'Abono inicial 40%'
    });

    expect(result.updatedPayable.balanceOwedUsdCents).toBe(6000);

    // Verificar en listPayables
    const payablesAfter = listPayables(rawDb, { locationId: 'loc_alta_vista' });
    const updatedRecord = payablesAfter.find(p => p.id === creditPurchaseId);
    expect(updatedRecord?.balanceOwedUsdCents).toBe(6000);

    // Verificar en Verdad Financiera
    const truth = getFinancialTruth(rawDb, { locationId: 'ALL' });
    expect(truth.payables.totalUsdCents).toBe(initialPayablesTruth + 6000);
  });

  it('3. Compra CONTADO $50 en ZELLE registra saldo 0 y aparece como egreso en Flujo de Caja sin alterar P&L', () => {
    const initialPL = calculateProfitAndLoss(rawDb, { locationId: 'ALL' });
    const initialCashFlow = calculateCashFlow(rawDb, { locationId: 'ALL' });
    const initialZelleOutflow = initialCashFlow.byMethod.find(m => m.method === 'ZELLE')?.outflowsUsdCents || 0;

    // Compra contado $50 en ZELLE (5 * $10.00 = 5000 centavos)
    const cashPurchase = registerPurchase(rawDb, {
      locationId: 'loc_alta_vista',
      supplierName: 'Distribuidora Carnes del Sur',
      invoiceNumber: 'FAC-CASH-50',
      paymentCondition: 'CONTADO',
      paymentMethod: 'ZELLE',
      createdBy: 'usr_admin',
      items: [{ supplyId, purchaseQuantity: 5, unitCostUsdCents: 1000 }]
    });

    expect(cashPurchase.totalUsdCents).toBe(5000);

    // Verificar en base de datos
    const row = rawDb.prepare('SELECT status, balance_owed_usd_cents, payment_method FROM purchases WHERE id = ?').get(cashPurchase.purchaseId) as any;
    expect(row.status).toBe('PAGADA');
    expect(row.balance_owed_usd_cents).toBe(0);
    expect(row.payment_method).toBe('ZELLE');

    // listPayables no debe mostrarla como cuenta pendiente
    const payables = listPayables(rawDb, { locationId: 'loc_alta_vista' });
    const found = payables.find(p => p.id === cashPurchase.purchaseId);
    expect(found).toBeUndefined();

    // Flujo de Caja debe registrar el egreso en ZELLE
    const afterCashFlow = calculateCashFlow(rawDb, { locationId: 'ALL' });
    const zelleMethod = afterCashFlow.byMethod.find(m => m.method === 'ZELLE');
    expect(zelleMethod).toBeDefined();
    expect(zelleMethod?.outflowsUsdCents).toBe(initialZelleOutflow + 5000);

    // Purchases outflow summary
    expect(afterCashFlow.summary.purchasesOutflowsUsdCents).toBeGreaterThanOrEqual(5000);

    // P&L NO cambia por la compra de contado
    const afterPL = calculateProfitAndLoss(rawDb, { locationId: 'ALL' });
    expect(afterPL.operatingExpensesUsdCents).toBe(initialPL.operatingExpensesUsdCents);
    expect(afterPL.netProfitUsdCents).toBe(initialPL.netProfitUsdCents);
  });

  it('4. POST /api/fase3/purchases valida método en CONTADO y vencimiento en CREDITO', async () => {
    // 4.1 CONTADO sin método de pago -> 400
    const resNoMethod = await app.inject({
      method: 'POST',
      url: '/api/fase3/purchases',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        locationId: 'loc_alta_vista',
        paymentCondition: 'CONTADO',
        items: [{ supplyId, purchaseQuantity: 1, unitCostUsdCents: 500 }]
      }
    });
    expect(resNoMethod.statusCode).toBe(400);
    const bodyNoMethod = JSON.parse(resNoMethod.payload);
    expect(bodyNoMethod.error).toMatch(/método de pago/i);

    // 4.2 CREDITO sin dueDateMs -> 400
    const resNoDueDate = await app.inject({
      method: 'POST',
      url: '/api/fase3/purchases',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        locationId: 'loc_alta_vista',
        paymentCondition: 'CREDITO',
        items: [{ supplyId, purchaseQuantity: 1, unitCostUsdCents: 500 }]
      }
    });
    expect(resNoDueDate.statusCode).toBe(400);
    const bodyNoDueDate = JSON.parse(resNoDueDate.payload);
    expect(bodyNoDueDate.error).toMatch(/vencimiento/i);

    // 4.3 CONTADO válido con método
    const resSuccess = await app.inject({
      method: 'POST',
      url: '/api/fase3/purchases',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        locationId: 'loc_alta_vista',
        paymentCondition: 'CONTADO',
        paymentMethod: 'EFECTIVO_USD',
        items: [{ supplyId, purchaseQuantity: 1, unitCostUsdCents: 500 }]
      }
    });
    expect(resSuccess.statusCode).toBe(201);
    const bodySuccess = JSON.parse(resSuccess.payload);
    expect(bodySuccess.success).toBe(true);
    expect(bodySuccess.totalUsdCents).toBe(500);
  });

  it('5. POST /api/profitability/purchases responde 410 Gone', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/profitability/purchases',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        supplierId: 'sup_test',
        paymentCondition: 'CONTADO',
        items: [{ supplyId, quantity: 1, unitCostUsdCents: 500 }]
      }
    });

    expect(res.statusCode).toBe(410);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Ruta obsoleta: use /api/fase3/purchases');
  });
});
