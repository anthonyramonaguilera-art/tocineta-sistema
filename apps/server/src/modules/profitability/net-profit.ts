import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { calculateOrderLineRealCost } from './costing.js';

export interface OperatingExpenseInput {
  jornadaId: string;
  category: 'HIELO' | 'VERDURAS' | 'GAS' | 'TRANSPORTE' | 'MANTENIMIENTO' | 'VARIOS' | 'CENA_EMPLEADOS' | 'GAS_OPERATIVO' | 'COMPRA_MATERIA_PRIMA' | string;
  amountUsdCents: number;
  amountBsCents?: number;
  description: string;
  authorizedByUserId: string;
  receiptPhotoPath?: string;
}

export interface OperatingExpenseRecord {
  id: string;
  jornadaId: string;
  category: string;
  amountUsdCents: number;
  amountBsCents: number;
  description: string;
  authorizedByUserId: string;
  authorizedByName?: string;
  receiptPhotoPath: string | null;
  createdAtMs: number;
}

export interface NetProfitReport {
  jornadaId: string;
  dateStr: string;
  currencyRateMicroBs: number;
  accountingMode: 'THIRD_PARTY_PASS_THROUGH' | 'HOUSE_REVENUE';
  // 1. Ingresos
  grossSalesUsdCents: number;
  deliveryPassThroughExcludedUsdCents: number;
  discountsUsdCents: number;
  netFoodSalesUsdCents: number; // Base de cálculo real

  // 2. Costos de Comida (Food Cost)
  baseFoodCostUsdCents: number;
  extraIngredientsCostUsdCents: number;
  barraLibreCostUsdCents: number;
  totalFoodCostUsdCents: number;
  foodCostPercentage: number; // Food Cost / Net Food Sales

  // 3. Marketing y Cortesías
  couponCourtesiesUsdCents: number; // 35¢ por cortesía

  // 4. Mermas Operativas
  registeredFoodLossesUsdCents: number;

  // 5. Costos Financieros Bancarios
  ubiiGrossSalesBsCents: number;
  ubiiFeeBsCents: number; // 0.75%
  ubiiFeeUsdCents: number;

  // 6. Gastos Operativos de Turno (Caja Chica)
  operatingExpensesUsdCents: number;
  expensesByCategory: Record<string, number>;

  // 7. RESULTADO FINAL: UTILIDAD NETA REAL
  netProfitUsdCents: number;
  netMarginPercentage: number;
}

/**
 * 1. Registra un gasto operativo de caja chica en la jornada
 */
export function createOperatingExpense(
  rawDb: Database.Database,
  input: OperatingExpenseInput
): OperatingExpenseRecord {
  const id = `exp_${generateUuidV7()}`;
  const now = Date.now();

  const rateRow = rawDb.prepare('SELECT rate_micro_bs FROM exchange_rates WHERE is_current = 1 ORDER BY created_at_ms DESC LIMIT 1').get() as any;
  const rateMicroBs = rateRow?.rate_micro_bs ?? 40_000_000;
  const amountBsCents = input.amountBsCents ?? Math.round((input.amountUsdCents * rateMicroBs) / 1_000_000);

  rawDb.prepare(`
    INSERT INTO operating_expenses (
      id, jornada_id, category, amount_usd_cents, amount_bs_cents,
      description, authorized_by_user_id, receipt_photo_path, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.jornadaId,
    input.category,
    input.amountUsdCents,
    amountBsCents,
    input.description.trim(),
    input.authorizedByUserId,
    input.receiptPhotoPath || null,
    now
  );

  return {
    id,
    jornadaId: input.jornadaId,
    category: input.category,
    amountUsdCents: input.amountUsdCents,
    amountBsCents,
    description: input.description,
    authorizedByUserId: input.authorizedByUserId,
    receiptPhotoPath: input.receiptPhotoPath || null,
    createdAtMs: now
  };
}

/**
 * 2. Obtiene los gastos operativos registrados en una jornada
 */
export function getOperatingExpenses(
  rawDb: Database.Database,
  jornadaId: string
): OperatingExpenseRecord[] {
  return rawDb.prepare(`
    SELECT oe.*, u.full_name as authorizedByName
    FROM operating_expenses oe
    LEFT JOIN users u ON oe.authorized_by_user_id = u.id
    WHERE oe.jornada_id = ?
    ORDER BY oe.created_at_ms DESC
  `).all(jornadaId) as OperatingExpenseRecord[];
}

/**
 * 3. Cálculo de Utilidad Neta Real de la Jornada
 * Fórmula Estricta de Negocio:
 * Utilidad Neta = Ventas Netas de Comida (sin Delivery Modo A)
 *               - Costo de Insumos Vendidos (incl. Barra Libre)
 *               - Costo de Obsequios de Cupones (35¢ c/u)
 *               - Mermas Registradas
 *               - Comisión Bancaria Ubii (0.75%)
 *               - Gastos Operativos
 */
export function calculateJornadaNetProfit(
  rawDb: Database.Database,
  jornadaId: string
): NetProfitReport {
  // 1. Tasa y Modo Contable de Delivery
  const rateRow = rawDb.prepare('SELECT rate_micro_bs FROM exchange_rates WHERE is_current = 1 ORDER BY created_at_ms DESC LIMIT 1').get() as any;
  const rateMicroBs = rateRow?.rate_micro_bs ?? 40_000_000;

  const settings = rawDb.prepare('SELECT delivery_accounting_mode, pos_fee_bps FROM business_settings WHERE id = \'default\'').get() as any;
  const accountingMode = settings?.delivery_accounting_mode || 'THIRD_PARTY_PASS_THROUGH';
  const posFeeBps = settings?.pos_fee_bps ?? 75; // 75 bps = 0.75%

  // 2. Ventas Netas de Comida y Exclusión de Delivery Modo A
  const salesRow = rawDb.prepare(`
    SELECT 
      COALESCE(SUM(o.gross_food_subtotal_usd_cents), 0) as gross_food,
      COALESCE(SUM(o.discount_usd_cents), 0) as discounts,
      COALESCE(SUM(o.net_food_sales_usd_cents), 0) as net_food,
      COALESCE(SUM(o.delivery_fee_usd_cents), 0) as delivery_fees,
      COALESCE(SUM(o.total_to_collect_usd_cents), 0) as total_collected
    FROM orders o
    WHERE o.jornada_id = ?
      AND o.fulfillment_status != 'anulado'
  `).get(jornadaId) as any;

  const grossFood = salesRow?.gross_food || 0;
  const discounts = salesRow?.discounts || 0;
  const netFood = salesRow?.net_food || 0;
  const deliveryFees = salesRow?.delivery_fees || 0;

  // En Modo A (THIRD_PARTY_PASS_THROUGH), la tarifa de delivery se excluye al 100% de las ventas del restaurante
  const deliveryPassThroughExcluded = accountingMode === 'THIRD_PARTY_PASS_THROUGH' ? deliveryFees : 0;
  const netFoodSales = netFood;

  // 3. Costos de Comida (Food Cost) y Barra Libre
  const lines = rawDb.prepare(`
    SELECT ol.id, ol.product_id, ol.line_role, ol.quantity
    FROM order_lines ol
    JOIN orders o ON ol.order_id = o.id
    WHERE o.jornada_id = ?
      AND o.fulfillment_status != 'anulado'
      AND ol.line_role IN ('STANDARD', 'COMBO_CHILD', 'COURTESY_ITEM')
  `).all(jornadaId) as Array<{
    id: string;
    product_id: string;
    line_role: string;
    quantity: number;
  }>;

  const getModsStmt = rawDb.prepare(`
    SELECT modifier_type, ingredient_id, ingredient_name, extra_price_usd_cents, internal_cost_usd_cents
    FROM order_line_modifiers
    WHERE order_line_id = ?
  `);

  let baseFoodCost = 0;
  let extraIngredientsCost = 0;
  let barraLibreCost = 0;
  let couponCourtesiesCost = 0;

  for (const l of lines) {
    const mods = getModsStmt.all(l.id) as any[];
    const costRes = calculateOrderLineRealCost(rawDb, {
      productId: l.product_id,
      quantity: l.quantity,
      lineRole: l.line_role,
      modifiers: mods.map(m => ({
        modifierType: m.modifier_type,
        ingredientId: m.ingredient_id,
        ingredientName: m.ingredient_name,
        extraPriceUsdCents: m.extra_price_usd_cents,
        internalCostUsdCents: m.internal_cost_usd_cents
      }))
    });

    baseFoodCost += costRes.baseRecipeCostUsdCents;
    extraIngredientsCost += costRes.extraIngredientsCostUsdCents;
    barraLibreCost += costRes.barraLibreCostUsdCents;
    couponCourtesiesCost += costRes.courtesyMarketingCostUsdCents;
  }

  const totalFoodCost = baseFoodCost + extraIngredientsCost + barraLibreCost;
  const foodCostPercentage = netFoodSales > 0 ? Number(((totalFoodCost / netFoodSales) * 100).toFixed(2)) : 0;

  // 4. Mermas Registradas (worker_incidents)
  const lossesRow = rawDb.prepare(`
    SELECT COALESCE(SUM(estimated_loss_usd_cents), 0) as total_losses
    FROM worker_incidents
    WHERE jornada_id = ? AND incident_type = 'MERMA_ALIMENTO'
  `).get(jornadaId) as any;
  const registeredLosses = lossesRow?.total_losses || 0;

  // 5. Comisión Bancaria Ubii (0.75%)
  const paymentsRows = rawDb.prepare(`
    SELECT p.method, p.amount_cents
    FROM payments p
    JOIN orders o ON p.order_id = o.id
    WHERE o.jornada_id = ? AND o.fulfillment_status != 'anulado'
  `).all(jornadaId) as Array<{ method: string; amount_cents: number }>;

  let ubiiGrossBsCents = 0;
  for (const p of paymentsRows) {
    const m = (p.method || '').toUpperCase();
    if (m === 'UBII' || m === 'PUNTO_DE_VENTA') {
      ubiiGrossBsCents += p.amount_cents;
    }
  }

  const ubiiFeeBsCents = Math.round((ubiiGrossBsCents * posFeeBps) / 10000);
  const ubiiFeeUsdCents = rateMicroBs > 0 ? Math.round((ubiiFeeBsCents * 1_000_000) / rateMicroBs) : 0;

  // 6. Gastos Operativos de Turno (operating_expenses)
  const expensesRows = rawDb.prepare(`
    SELECT category, COALESCE(SUM(amount_usd_cents), 0) as cat_total
    FROM operating_expenses
    WHERE jornada_id = ?
    GROUP BY category
  `).all(jornadaId) as Array<{ category: string; cat_total: number }>;

  const expensesByCategory: Record<string, number> = {};
  let totalOperatingExpenses = 0;
  for (const exp of expensesRows) {
    expensesByCategory[exp.category] = exp.cat_total;
    totalOperatingExpenses += exp.cat_total;
  }

  // 7. UTILIDAD NETA REAL
  const netProfit = netFoodSales
    - totalFoodCost
    - couponCourtesiesCost
    - registeredLosses
    - ubiiFeeUsdCents
    - totalOperatingExpenses;

  const netMarginPercentage = netFoodSales > 0 ? Number(((netProfit / netFoodSales) * 100).toFixed(2)) : 0;

  return {
    jornadaId,
    dateStr: new Date().toLocaleDateString('es-VE'),
    currencyRateMicroBs: rateMicroBs,
    accountingMode,
    grossSalesUsdCents: grossFood,
    deliveryPassThroughExcludedUsdCents: deliveryPassThroughExcluded,
    discountsUsdCents: discounts,
    netFoodSalesUsdCents: netFoodSales,
    baseFoodCostUsdCents: baseFoodCost,
    extraIngredientsCostUsdCents: extraIngredientsCost,
    barraLibreCostUsdCents: barraLibreCost,
    totalFoodCostUsdCents: totalFoodCost,
    foodCostPercentage,
    couponCourtesiesUsdCents: couponCourtesiesCost,
    registeredFoodLossesUsdCents: registeredLosses,
    ubiiGrossSalesBsCents: ubiiGrossBsCents,
    ubiiFeeBsCents,
    ubiiFeeUsdCents,
    operatingExpensesUsdCents: totalOperatingExpenses,
    expensesByCategory,
    netProfitUsdCents: netProfit,
    netMarginPercentage
  };
}
