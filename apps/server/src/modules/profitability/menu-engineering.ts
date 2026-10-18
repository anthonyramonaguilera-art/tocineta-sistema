import type Database from 'better-sqlite3';
import { calculateOrderLineRealCost } from './costing.js';

export type KasavanaQuadrant = 'ESTRELLA' | 'CABALLO_DE_BATALLA' | 'PUZZLE' | 'PERRO';

export interface KasavanaDishItem {
  productId: string;
  productName: string;
  categoryId: string;
  categoryName: string;
  unitsSold: number;
  salePriceUsdCents: number;
  recipeCostUsdCents: number;
  unitContributionMarginUsdCents: number; // SalePrice - RecipeCost
  totalSalesUsdCents: number;
  totalCostUsdCents: number;
  totalContributionMarginUsdCents: number;
  popularityIndex: number; // units / categoryTotalUnits
  isHighPopularity: boolean; // popularityIndex >= (0.70 / N)
  isHighMargin: boolean; // unitMargin >= categoryWeightedAvgMargin
  quadrant: KasavanaQuadrant;
  recommendation: string;
}

export interface KasavanaCategoryAnalysis {
  categoryId: string;
  categoryName: string;
  totalUnitsSold: number;
  totalSalesUsdCents: number;
  totalMarginUsdCents: number;
  dishCount: number; // N
  popularityThreshold: number; // 0.70 / N
  weightedAverageMarginUsdCents: number;
  dishes: KasavanaDishItem[];
}

export interface AbcSupplyItem {
  supplyId: string;
  supplyName: string;
  unit: string;
  unitCostUsdCents: number;
  unitsConsumed: number;
  totalValueUsdCents: number;
  sharePercentage: number;
  cumulativePercentage: number;
  classification: 'A' | 'B' | 'C';
}

export interface MenuEngineeringReport {
  generatedAtMs: number;
  startDateMs?: number;
  endDateMs?: number;
  daysAnalyzed: number;
  totalUnitsSold: number;
  hasStatisticalWarning: boolean;
  statisticalWarningMessage?: string;
  categories: KasavanaCategoryAnalysis[];
  abcSupplies: AbcSupplyItem[];
  primeCost: {
    foodCostUsdCents: number;
    laborCostUsdCents: number;
    primeCostUsdCents: number;
    netSalesUsdCents: number;
    primeCostPercentage: number;
  };
  breakEven: {
    fixedCostsUsdCents: number;
    variableCostsUsdCents: number;
    netSalesUsdCents: number;
    contributionMarginRatio: number;
    breakEvenSalesUsdCents: number;
  };
}

/**
 * Realiza el análisis completo de Ingeniería de Menú de Kasavana & Smith,
 * Análisis ABC de Insumos, Costo Primo y Punto de Equilibrio.
 */
export function generateMenuEngineeringReport(
  rawDb: Database.Database,
  options: {
    startDateMs?: number;
    endDateMs?: number;
    jornadaId?: string;
  } = {}
): MenuEngineeringReport {
  const now = Date.now();
  let timeFilter = '';
  const timeParams: any[] = [];

  if (options.jornadaId) {
    timeFilter = 'AND o.jornada_id = ?';
    timeParams.push(options.jornadaId);
  } else if (options.startDateMs && options.endDateMs) {
    timeFilter = 'AND o.created_at_ms >= ? AND o.created_at_ms <= ?';
    timeParams.push(options.startDateMs, options.endDateMs);
  }

  // 1. Obtener todas las líneas de productos vendidos en el rango (excluyendo anulados y COMBO_PARENT)
  const soldLines = rawDb.prepare(`
    SELECT 
      ol.id, ol.product_id, ol.line_role, ol.quantity, ol.unit_price_usd_cents,
      p.name as product_name, p.category_id, c.name as category_name,
      o.created_at_ms
    FROM order_lines ol
    JOIN orders o ON ol.order_id = o.id
    JOIN products p ON ol.product_id = p.id
    JOIN categories c ON p.category_id = c.id
    WHERE o.fulfillment_status != 'anulado'
      AND ol.line_role IN ('STANDARD', 'COMBO_CHILD')
      ${timeFilter}
    ORDER BY o.created_at_ms ASC
  `).all(...timeParams) as Array<{
    id: string;
    product_id: string;
    line_role: string;
    quantity: number;
    unit_price_usd_cents: number;
    product_name: string;
    category_id: string;
    category_name: string;
    created_at_ms: number;
  }>;

  // Determinar rango en días
  let daysAnalyzed = 1;
  let totalUnitsOverall = 0;
  if (soldLines.length > 0) {
    const firstMs = soldLines[0].created_at_ms;
    const lastMs = soldLines[soldLines.length - 1].created_at_ms;
    daysAnalyzed = Math.max(1, Math.ceil((lastMs - firstMs) / (24 * 60 * 60 * 1000)));
  }

  // Agrupar por producto
  interface AggDish {
    productId: string;
    productName: string;
    categoryId: string;
    categoryName: string;
    unitsSold: number;
    totalSalesUsdCents: number;
    unitPriceUsdCents: number;
    totalCostUsdCents: number;
  }

  const dishesMap = new Map<string, AggDish>();

  for (const line of soldLines) {
    totalUnitsOverall += line.quantity;
    const existing = dishesMap.get(line.product_id);

    // Calcular costo unitario real
    const costRes = calculateOrderLineRealCost(rawDb, {
      productId: line.product_id,
      quantity: 1,
      lineRole: line.line_role
    });
    const lineCost = costRes.totalFoodCostUsdCents * line.quantity;
    const lineSale = line.unit_price_usd_cents * line.quantity;

    if (existing) {
      existing.unitsSold += line.quantity;
      existing.totalSalesUsdCents += lineSale;
      existing.totalCostUsdCents += lineCost;
    } else {
      dishesMap.set(line.product_id, {
        productId: line.product_id,
        productName: line.product_name,
        categoryId: line.category_id,
        categoryName: line.category_name,
        unitsSold: line.quantity,
        totalSalesUsdCents: lineSale,
        unitPriceUsdCents: line.unit_price_usd_cents,
        totalCostUsdCents: lineCost
      });
    }
  }

  // 2. Agrupar por categoría y calcular la matriz formal de Kasavana & Smith
  const categoriesMap = new Map<string, {
    categoryId: string;
    categoryName: string;
    dishes: AggDish[];
  }>();

  for (const dish of dishesMap.values()) {
    const cat = categoriesMap.get(dish.categoryId) || {
      categoryId: dish.categoryId,
      categoryName: dish.categoryName,
      dishes: []
    };
    cat.dishes.push(dish);
    categoriesMap.set(dish.categoryId, cat);
  }

  const categoryAnalyses: KasavanaCategoryAnalysis[] = [];

  for (const cat of categoriesMap.values()) {
    const totalCatUnits = cat.dishes.reduce((sum, d) => sum + d.unitsSold, 0);
    const totalCatSales = cat.dishes.reduce((sum, d) => sum + d.totalSalesUsdCents, 0);
    const totalCatCost = cat.dishes.reduce((sum, d) => sum + d.totalCostUsdCents, 0);
    const totalCatMargin = totalCatSales - totalCatCost;

    const N = cat.dishes.length;
    // Umbral de popularidad alta formal: 0.70 * (1 / N)
    const popularityThreshold = N > 0 ? (0.70 * (1 / N)) : 0;
    // Umbral de margen alto formal: Margen promedio ponderado de la categoría
    const weightedAvgMargin = totalCatUnits > 0 ? Math.round(totalCatMargin / totalCatUnits) : 0;

    const classifiedDishes: KasavanaDishItem[] = cat.dishes.map(d => {
      const avgUnitCost = d.unitsSold > 0 ? Math.round(d.totalCostUsdCents / d.unitsSold) : 0;
      const avgUnitPrice = d.unitsSold > 0 ? Math.round(d.totalSalesUsdCents / d.unitsSold) : d.unitPriceUsdCents;
      const unitMargin = avgUnitPrice - avgUnitCost;
      const totalMargin = d.totalSalesUsdCents - d.totalCostUsdCents;

      const popIndex = totalCatUnits > 0 ? (d.unitsSold / totalCatUnits) : 0;
      const isHighPopularity = popIndex >= popularityThreshold;
      const isHighMargin = unitMargin >= weightedAvgMargin;

      let quadrant: KasavanaQuadrant = 'PERRO';
      let recommendation = '';

      if (isHighPopularity && isHighMargin) {
        quadrant = 'ESTRELLA';
        recommendation = 'Plato insignia: Mantener receta estricta, alta visibilidad y capacitar al equipo para mantener la calidad.';
      } else if (isHighPopularity && !isHighMargin) {
        quadrant = 'CABALLO_DE_BATALLA';
        recommendation = 'Alta demanda pero margen apretado: Evaluar ajuste ligero de precio (+25¢ a +50¢) o renegociar costo de insumos clave.';
      } else if (!isHighPopularity && isHighMargin) {
        quadrant = 'PUZZLE';
        recommendation = 'Excelente rentabilidad pero baja rotación: Reubicar en el menú, sugerir activamente en comanda y destacar en fotos.';
      } else {
        quadrant = 'PERRO';
        recommendation = 'Baja demanda y bajo margen: Evaluar reformulación, sustitución por novedad o retiro del menú activo.';
      }

      return {
        productId: d.productId,
        productName: d.productName,
        categoryId: d.categoryId,
        categoryName: d.categoryName,
        unitsSold: d.unitsSold,
        salePriceUsdCents: avgUnitPrice,
        recipeCostUsdCents: avgUnitCost,
        unitContributionMarginUsdCents: unitMargin,
        totalSalesUsdCents: d.totalSalesUsdCents,
        totalCostUsdCents: d.totalCostUsdCents,
        totalContributionMarginUsdCents: totalMargin,
        popularityIndex: Number(popIndex.toFixed(4)),
        isHighPopularity,
        isHighMargin,
        quadrant,
        recommendation
      };
    });

    categoryAnalyses.push({
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      totalUnitsSold: totalCatUnits,
      totalSalesUsdCents: totalCatSales,
      totalMarginUsdCents: totalCatMargin,
      dishCount: N,
      popularityThreshold: Number(popularityThreshold.toFixed(4)),
      weightedAverageMarginUsdCents: weightedAvgMargin,
      dishes: classifiedDishes.sort((a, b) => b.totalContributionMarginUsdCents - a.totalContributionMarginUsdCents)
    });
  }

  // 3. Alerta Estadística si < 14 días o < 30 unidades
  const hasStatisticalWarning = daysAnalyzed < 14 || totalUnitsOverall < 30;
  const statisticalWarningMessage = hasStatisticalWarning
    ? `Muestra estadística preliminar (${daysAnalyzed} día(s), ${totalUnitsOverall} platos vendidos). Se recomienda acumular un mínimo de 14 días operativos y 30 unidades para estabilizar los cuadrantes de Kasavana & Smith.`
    : undefined;

  // 4. Análisis ABC de Insumos
  const allSupplies = rawDb.prepare(`
    SELECT id, name, unit, cost_per_unit_usd_cents
    FROM supply_items
    ORDER BY name ASC
  `).all() as Array<{
    id: string;
    name: string;
    unit: string;
    cost_per_unit_usd_cents: number;
  }>;

  // Calcular consumo por recetas en el rango
  const consumedMap = new Map<string, number>();
  for (const dish of dishesMap.values()) {
    const rItems = rawDb.prepare(`
      SELECT ri.supply_item_id, ri.quantity_required
      FROM recipes r
      JOIN recipe_items ri ON r.id = ri.recipe_id
      WHERE r.product_id = ?
    `).all(dish.productId) as Array<{ supply_item_id: string; quantity_required: number }>;

    for (const ri of rItems) {
      consumedMap.set(ri.supply_item_id, (consumedMap.get(ri.supply_item_id) || 0) + (ri.quantity_required * dish.unitsSold));
    }
  }

  const abcRaw: Array<{
    supplyId: string;
    supplyName: string;
    unit: string;
    unitCostUsdCents: number;
    unitsConsumed: number;
    totalValueUsdCents: number;
  }> = [];

  let totalSupplyValueUsdCents = 0;
  for (const s of allSupplies) {
    const consumed = consumedMap.get(s.id) || 0;
    const value = Math.round(consumed * s.cost_per_unit_usd_cents);
    totalSupplyValueUsdCents += value;
    abcRaw.push({
      supplyId: s.id,
      supplyName: s.name,
      unit: s.unit,
      unitCostUsdCents: s.cost_per_unit_usd_cents,
      unitsConsumed: consumed,
      totalValueUsdCents: value
    });
  }

  // Ordenar de mayor a menor valor consumido
  abcRaw.sort((a, b) => b.totalValueUsdCents - a.totalValueUsdCents);

  let cumulativeSum = 0;
  const abcSupplies: AbcSupplyItem[] = abcRaw.map(item => {
    cumulativeSum += item.totalValueUsdCents;
    const share = totalSupplyValueUsdCents > 0 ? (item.totalValueUsdCents / totalSupplyValueUsdCents) * 100 : 0;
    const cumulative = totalSupplyValueUsdCents > 0 ? (cumulativeSum / totalSupplyValueUsdCents) * 100 : 0;

    let classification: 'A' | 'B' | 'C' = 'C';
    if (cumulative <= 80 || share >= 20) {
      classification = 'A';
    } else if (cumulative <= 95) {
      classification = 'B';
    } else {
      classification = 'C';
    }

    return {
      supplyId: item.supplyId,
      supplyName: item.supplyName,
      unit: item.unit,
      unitCostUsdCents: item.unitCostUsdCents,
      unitsConsumed: item.unitsConsumed,
      totalValueUsdCents: item.totalValueUsdCents,
      sharePercentage: Number(share.toFixed(2)),
      cumulativePercentage: Number(cumulative.toFixed(2)),
      classification
    };
  });

  // 5. Costo Primo (Insumos + Nómina)
  const totalFoodCostUsdCents = categoryAnalyses.reduce((sum, c) => sum + (c.totalSalesUsdCents - c.totalMarginUsdCents), 0);
  const totalNetSalesUsdCents = categoryAnalyses.reduce((sum, c) => sum + c.totalSalesUsdCents, 0);

  // Gastos de nómina / personal desde operating_expenses
  const laborRow = rawDb.prepare(`
    SELECT COALESCE(SUM(amount_usd_cents), 0) as labor_total
    FROM operating_expenses
    WHERE category IN ('PERSONAL', 'TRANSPORTE', 'VARIOS')
      ${options.jornadaId ? 'AND jornada_id = ?' : ''}
  `).get(...(options.jornadaId ? [options.jornadaId] : [])) as any;
  const laborCostUsdCents = laborRow?.labor_total || 0;

  const primeCostUsdCents = totalFoodCostUsdCents + laborCostUsdCents;
  const primeCostPercentage = totalNetSalesUsdCents > 0
    ? Number(((primeCostUsdCents / totalNetSalesUsdCents) * 100).toFixed(2))
    : 0;

  // 6. Punto de Equilibrio (Break-Even Point)
  // Costos fijos (alquiler, gas, mantenimiento fijo de turno)
  const fixedExpensesRow = rawDb.prepare(`
    SELECT COALESCE(SUM(amount_usd_cents), 0) as fixed_total
    FROM operating_expenses
    WHERE category IN ('GAS', 'MANTENIMIENTO', 'VARIOS')
      ${options.jornadaId ? 'AND jornada_id = ?' : ''}
  `).get(...(options.jornadaId ? [options.jornadaId] : [])) as any;
  const fixedCostsUsdCents = Math.max(1000, fixedExpensesRow?.fixed_total || 1000); // Mínimo referencial de $10.00
  const variableCostsUsdCents = totalFoodCostUsdCents;

  const cmRatio = totalNetSalesUsdCents > 0
    ? Math.max(0.1, (totalNetSalesUsdCents - variableCostsUsdCents) / totalNetSalesUsdCents)
    : 0.5;

  const breakEvenSalesUsdCents = Math.round(fixedCostsUsdCents / cmRatio);

  return {
    generatedAtMs: now,
    startDateMs: options.startDateMs,
    endDateMs: options.endDateMs,
    daysAnalyzed,
    totalUnitsSold: totalUnitsOverall,
    hasStatisticalWarning,
    statisticalWarningMessage,
    categories: categoryAnalyses,
    abcSupplies,
    primeCost: {
      foodCostUsdCents: totalFoodCostUsdCents,
      laborCostUsdCents,
      primeCostUsdCents,
      netSalesUsdCents: totalNetSalesUsdCents,
      primeCostPercentage
    },
    breakEven: {
      fixedCostsUsdCents,
      variableCostsUsdCents,
      netSalesUsdCents: totalNetSalesUsdCents,
      contributionMarginRatio: Number(cmRatio.toFixed(4)),
      breakEvenSalesUsdCents
    }
  };
}
