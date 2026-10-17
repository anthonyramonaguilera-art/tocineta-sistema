import type Database from 'better-sqlite3';
import type { Station, LineRole } from '../../db/schema.js';

export interface KitchenBuildableLine {
  lineId: string;
  productId: string;
  productName: string;
  displayName: string;
  quantity: number;
  station: Station;
  flavorChoice?: string | null;
  customInstructions?: string | null;
  modifiers: string[];
  barraLibreModifiers: string[];
  ingredientExclusions: string[];
  ingredientExtras: string[];
}

export interface KitchenQueryOptions {
  includeDrinks?: boolean;
  station?: Station;
}

/**
 * Consulta de líneas de cocina para KDS e impresora térmica 58mm.
 * Regla de oro de cocina:
 * - Filtra exclusivamente line_role IN ('STANDARD', 'COMBO_CHILD', 'COURTESY_ITEM').
 * - NUNCA expone el COMBO_PARENT ni la palabra "COMBO".
 * - Por defecto filtra las estaciones de cocina ('hot_dogs', 'hamburguesas'),
 *   excluyendo 'caja_bebidas' que se despacha en mostrador/caja.
 * - Incluye modificadores de ingrediente ("SIN ..."), Barra Libre ("+ AGREGAR (Barra Libre): ...")
 *   y etiqueta "[OBSEQUIO CUPÓN - $0.00]" para cortesías.
 */
export function getKitchenBuildableLines(
  rawDb: Database.Database,
  orderId: string,
  options?: KitchenQueryOptions
): KitchenBuildableLine[] {
  let stationCondition = "AND ol.station != 'caja_bebidas'";
  const params: unknown[] = [orderId];

  if (options?.station) {
    stationCondition = 'AND ol.station = ?';
    params.push(options.station);
  } else if (options?.includeDrinks) {
    stationCondition = '';
  }

  const lineRows = rawDb.prepare(`
    SELECT 
      ol.id as line_id,
      ol.product_id,
      p.name as product_name,
      ol.line_role,
      ol.quantity,
      ol.station,
      ol.flavor_choice,
      ol.custom_instructions
    FROM order_lines ol
    JOIN products p ON ol.product_id = p.id
    WHERE ol.order_id = ? 
      AND ol.line_role IN ('STANDARD', 'COMBO_CHILD', 'COURTESY_ITEM')
      ${stationCondition}
    ORDER BY 
      CASE ol.station
        WHEN 'hot_dogs' THEN 1
        WHEN 'hamburguesas' THEN 2
        ELSE 3
      END,
      ol.created_at_ms ASC
  `).all(...params) as Array<{
    line_id: string;
    product_id: string;
    product_name: string;
    line_role: LineRole;
    quantity: number;
    station: Station;
    flavor_choice?: string | null;
    custom_instructions?: string | null;
  }>;

  if (lineRows.length === 0) {
    return [];
  }

  // Cargar modificadores asociados a las líneas de esta orden
  const modRows = rawDb.prepare(`
    SELECT 
      olm.order_line_id,
      olm.ingredient_name,
      olm.modifier_type
    FROM order_line_modifiers olm
    JOIN order_lines ol ON olm.order_line_id = ol.id
    WHERE ol.order_id = ?
    ORDER BY olm.id ASC
  `).all(orderId) as Array<{
    order_line_id: string;
    ingredient_name: string;
    modifier_type: 'SIN_INGREDIENTE' | 'EXTRA_INGREDIENTE' | 'BARRA_LIBRE';
  }>;

  const modsByLine = new Map<string, typeof modRows>();
  for (const m of modRows) {
    const list = modsByLine.get(m.order_line_id) || [];
    list.push(m);
    modsByLine.set(m.order_line_id, list);
  }

  return lineRows.map(line => {
    let cleanProductName = line.product_name;

    // Etiqueta oficial de cortesía para cocina
    if (line.line_role === 'COURTESY_ITEM') {
      if (!cleanProductName.includes('[OBSEQUIO CUPÓN - $0.00]')) {
        cleanProductName = `${cleanProductName} [OBSEQUIO CUPÓN - $0.00]`;
      }
    }

    // Asegurar que nunca se filtre la palabra "Combo" si viniera en un nombre compuesto
    cleanProductName = cleanProductName.replace(/combo\s*/gi, '').trim();

    const lineMods = modsByLine.get(line.line_id) || [];
    const exclusions: string[] = [];
    const extras: string[] = [];
    const barraLibreList: string[] = [];
    const allFormattedModifiers: string[] = [];

    for (const mod of lineMods) {
      if (mod.modifier_type === 'SIN_INGREDIENTE') {
        const text = `SIN ${mod.ingredient_name}`;
        exclusions.push(text);
        allFormattedModifiers.push(text);
      } else if (mod.modifier_type === 'EXTRA_INGREDIENTE') {
        const text = `+ EXTRA ${mod.ingredient_name}`;
        extras.push(text);
        allFormattedModifiers.push(text);
      } else if (mod.modifier_type === 'BARRA_LIBRE') {
        barraLibreList.push(mod.ingredient_name);
      }
    }

    if (barraLibreList.length > 0) {
      const barraLibreFormatted = `+ AGREGAR (Barra Libre): ${barraLibreList.join(', ')}`;
      allFormattedModifiers.push(barraLibreFormatted);
    }

    if (line.flavor_choice) {
      allFormattedModifiers.push(`Sabor: ${line.flavor_choice}`);
    }

    if (line.custom_instructions) {
      allFormattedModifiers.push(`Nota: ${line.custom_instructions}`);
    }

    const displayName = `${line.quantity}x ${cleanProductName}`;

    return {
      lineId: line.line_id,
      productId: line.product_id,
      productName: cleanProductName,
      displayName,
      quantity: line.quantity,
      station: line.station,
      flavorChoice: line.flavor_choice || null,
      customInstructions: line.custom_instructions || null,
      modifiers: allFormattedModifiers,
      barraLibreModifiers: barraLibreList,
      ingredientExclusions: exclusions,
      ingredientExtras: extras
    };
  });
}
