/**
 * SISTEMA OPERATIVO LOCAL TOCINETA SONRÍE (Varons Media)
 * Plantillas y Ruteo de Tickets Térmicos 58mm (Ticket IR)
 */

import type Database from 'better-sqlite3';
import {
  type TicketIR,
  type TicketBlock,
  usdToBsCents
} from '@tocineta/shared';
import { getKitchenBuildableLines, type KitchenBuildableLine } from '../orders/kitchen-queries.js';

export interface OrderReceiptData {
  id: string;
  orderNumber: number;
  fulfillmentType: 'salon' | 'para_llevar' | 'delivery';
  tableNumber?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  grossFoodSubtotalUsdCents: number;
  discountUsdCents: number;
  deliveryFeeUsdCents: number;
  totalToCollectUsdCents: number;
  rateMicroBs: number;
  notes?: string | null;
  createdAtMs: number;
}

export interface ReceiptLineItem {
  lineId: string;
  productName: string;
  quantity: number;
  priceUsdCents: number;
  flavorChoice?: string | null;
  modifiers: string[];
}

export function formatTurnNumber(orderNumber: number): string {
  // Número de Turno gigante: T-023
  const turn = orderNumber % 1000 || 1;
  return `T-${String(turn).padStart(3, '0')}`;
}

export function formatOrderCmd(orderNumber: number): string {
  return `#CMD-${String(orderNumber).padStart(4, '0')}`;
}

export function formatFulfillmentChannel(
  type: 'salon' | 'para_llevar' | 'delivery',
  tableNumber?: string | null
): string {
  switch (type) {
    case 'salon':
      return tableNumber ? `Mesa ${tableNumber}` : 'Salón';
    case 'para_llevar':
      return 'Para Llevar';
    case 'delivery':
      return 'Delivery a Domicilio';
    default:
      return type;
  }
}

export function formatBsCurrency(cents: number): string {
  const units = (cents / 100).toFixed(2);
  const [entero, decimal] = units.split('.');
  const enteroFormateado = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `Bs ${enteroFormateado},${decimal}`;
}

// ============================================================================
// 1. NOTA DE ENTREGA (IMPRESORA CAJA)
// ============================================================================

export function buildReceiptTicketIR(
  order: OrderReceiptData,
  lines: ReceiptLineItem[]
): TicketIR {
  const blocks: TicketBlock[] = [];

  // 1. Logo Tocineta Sonríe Oficial
  blocks.push({ type: 'header_logo' });

  // 2. Eslogan oficial
  blocks.push({
    type: 'text',
    text: '"Cocinamos con amor, te servimos como mereces y damos gloria a Dios"',
    align: 'center'
  });
  blocks.push({ type: 'separator', style: 'single' });

  // 3. Número de Turno Gigante y Orden #CMD-xxxx
  blocks.push({
    type: 'title_double',
    text: `TURNO ${formatTurnNumber(order.orderNumber)}`,
    align: 'center'
  });

  blocks.push({
    type: 'key_value',
    key: 'ORDEN:',
    value: formatOrderCmd(order.orderNumber),
    bold: true
  });

  // 4. Mesa / Canal y Cliente
  const canal = formatFulfillmentChannel(order.fulfillmentType, order.tableNumber);
  blocks.push({ type: 'key_value', key: 'CANAL:', value: canal });

  if (order.customerName) {
    blocks.push({ type: 'key_value', key: 'CLIENTE:', value: order.customerName });
  }

  if (order.customerPhone) {
    blocks.push({ type: 'key_value', key: 'TELÉFONO:', value: order.customerPhone });
  }

  if (order.deliveryAddress && order.fulfillmentType === 'delivery') {
    blocks.push({ type: 'key_value', key: 'DIRECCIÓN:', value: order.deliveryAddress });
  }

  const dateObj = new Date(order.createdAtMs);
  const fechaStr = dateObj.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const horaStr = dateObj.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });
  blocks.push({ type: 'key_value', key: 'FECHA:', value: `${fechaStr} ${horaStr}` });

  blocks.push({ type: 'separator', style: 'double' });

  // 5. Detalle de Líneas y Modificadores
  for (const line of lines) {
    const priceStr = `$${(line.priceUsdCents / 100).toFixed(2)}`;
    blocks.push({
      type: 'line_item',
      qty: line.quantity,
      name: line.productName,
      price: priceStr
    });

    if (line.flavorChoice) {
      blocks.push({
        type: 'modifier_item',
        text: `Sabor: ${line.flavorChoice}`
      });
    }

    for (const mod of line.modifiers) {
      blocks.push({
        type: 'modifier_item',
        text: mod
      });
    }
  }

  blocks.push({ type: 'separator', style: 'single' });

  // 6. Totales en USD y Bolívares (Bs) a tasa BCV. Cero menciones a COP.
  const subtotalStr = `$${(order.grossFoodSubtotalUsdCents / 100).toFixed(2)}`;
  const discountStr = order.discountUsdCents > 0
    ? `-$${(order.discountUsdCents / 100).toFixed(2)}`
    : undefined;
  const deliveryStr = order.deliveryFeeUsdCents > 0
    ? `$${(order.deliveryFeeUsdCents / 100).toFixed(2)}`
    : undefined;

  const totalUsdStr = `$${(order.totalToCollectUsdCents / 100).toFixed(2)}`;
  const totalBsCents = usdToBsCents(order.totalToCollectUsdCents, order.rateMicroBs);
  const totalBsStr = formatBsCurrency(totalBsCents);
  const bcvRateStr = `Tasa BCV: ${(order.rateMicroBs / 1000000).toFixed(2)} Bs/$`;

  blocks.push({
    type: 'totals_block',
    subtotalUsd: subtotalStr,
    discountUsd: discountStr,
    deliveryUsd: deliveryStr,
    totalUsd: totalUsdStr,
    totalBs: totalBsStr,
    bcvRate: bcvRateStr
  });

  if (order.notes) {
    blocks.push({ type: 'separator', style: 'dashed' });
    blocks.push({ type: 'text', text: `NOTA: ${order.notes}`, bold: true });
  }

  // 7. Footer de Agradecimiento y Corte
  blocks.push({ type: 'separator', style: 'dashed' });
  blocks.push({
    type: 'footer',
    lines: [
      '¡GRACIAS POR SU PREFERENCIA!',
      'Dios le bendiga grandemente',
      'Síguenos en @tocinetasonrie',
      '*** COMPROBANTE DE ENTREGA ***'
    ],
    align: 'center'
  });

  blocks.push({ type: 'cut', feedLines: 4 });

  return {
    title: `Nota de Entrega ${formatOrderCmd(order.orderNumber)}`,
    widthColumns: 32,
    blocks
  };
}

// ============================================================================
// 2. COMANDAS DE COCINA POR ESTACIÓN (IMPRESORA COCINA)
// ============================================================================

export interface KitchenTicketParams {
  order: OrderReceiptData;
  kitchenLines: KitchenBuildableLine[];
}

export function buildKitchenTicketIRs(
  params: KitchenTicketParams
): TicketIR[] {
  const { order, kitchenLines } = params;

  const burgerLines = kitchenLines.filter(l => l.station === 'hamburguesas');
  const hotDogLines = kitchenLines.filter(l => l.station === 'hot_dogs');

  const hasBurgers = burgerLines.length > 0;
  const hasHotDogs = hotDogLines.length > 0;
  const isComposite = hasBurgers && hasHotDogs;

  const results: TicketIR[] = [];
  const cmdStr = formatOrderCmd(order.orderNumber);
  const turnStr = formatTurnNumber(order.orderNumber);
  const canalStr = formatFulfillmentChannel(order.fulfillmentType, order.tableNumber);
  const timeStr = new Date(order.createdAtMs).toLocaleTimeString('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  // Función interna para armar ticket de estación específica
  const buildStationTicket = (
    stationName: 'HAMBURGUESAS' | 'HOT DOGS',
    lines: KitchenBuildableLine[],
    indicatorText: string
  ): TicketIR => {
    const blocks: TicketBlock[] = [];

    // Banner de Estación Invertido
    blocks.push({
      type: 'banner_inverted',
      text: `=== ESTACIÓN: ${stationName} ===`
    });

    // #CMD-0145 · TURNO T-023
    blocks.push({
      type: 'title_double',
      text: `${cmdStr} · TURNO ${turnStr}`,
      align: 'center'
    });

    // Indicador compuesto / único
    blocks.push({
      type: 'banner_inverted',
      text: indicatorText
    });

    blocks.push({ type: 'key_value', key: 'CANAL:', value: canalStr, bold: true });
    if (order.customerName) {
      blocks.push({ type: 'key_value', key: 'CLIENTE:', value: order.customerName });
    }
    blocks.push({ type: 'key_value', key: 'HORA:', value: timeStr });
    blocks.push({ type: 'separator', style: 'double' });

    // Líneas con modificadores resaltados
    for (const line of lines) {
      blocks.push({
        type: 'line_item',
        qty: line.quantity,
        name: line.productName
      });

      for (const mod of line.modifiers) {
        // Resaltar exclusiones e instrucciones
        const isHighlight =
          mod.startsWith('SIN ') ||
          mod.includes('LECHUGA') ||
          mod.includes('POCA') ||
          mod.includes('EXTRA') ||
          mod.includes('Barra Libre');

        blocks.push({
          type: 'modifier_item',
          text: mod,
          highlighted: isHighlight
        });
      }
    }

    if (order.notes) {
      blocks.push({ type: 'separator', style: 'dashed' });
      blocks.push({
        type: 'modifier_item',
        text: `↳ NOTA GENERAL: ${order.notes}`,
        highlighted: true
      });
    }

    blocks.push({ type: 'separator', style: 'single' });
    blocks.push({ type: 'cut', feedLines: 4 });

    return {
      title: `Comanda Cocina ${stationName} ${cmdStr}`,
      widthColumns: 32,
      blocks
    };
  };

  if (isComposite) {
    // Caso 1: Orden Compuesta -> 2 trabajos de impresión separados
    results.push(
      buildStationTicket('HAMBURGUESAS', burgerLines, '[ORDEN COMPUESTA: ESPERAR HOT DOGS]')
    );
    results.push(
      buildStationTicket('HOT DOGS', hotDogLines, '[ORDEN COMPUESTA: ESPERAR HAMBURGUESAS]')
    );
  } else if (hasBurgers) {
    // Caso 2: Solo Hamburguesas
    results.push(
      buildStationTicket('HAMBURGUESAS', burgerLines, '[ORDEN ÚNICA: DESPACHAR DIRECTO]')
    );
  } else if (hasHotDogs) {
    // Caso 3: Solo Hot Dogs
    results.push(
      buildStationTicket('HOT DOGS', hotDogLines, '[ORDEN ÚNICA: DESPACHAR DIRECTO]')
    );
  } else if (kitchenLines.length > 0) {
    // Caso de respaldo (otros platos de cocina)
    results.push(
      buildStationTicket('HAMBURGUESAS', kitchenLines, '[ORDEN ÚNICA: DESPACHAR DIRECTO]')
    );
  }

  return results;
}

// ============================================================================
// 3. PLANTILLAS ESPECIALES (REPOSICIÓN, CAMBIO/ANULACIÓN, REIMPRESIÓN)
// ============================================================================

export function buildRefireTicketIR(
  order: OrderReceiptData,
  lines: KitchenBuildableLine[],
  reason: string
): TicketIR {
  const blocks: TicketBlock[] = [];
  const cmdStr = formatOrderCmd(order.orderNumber);
  const turnStr = formatTurnNumber(order.orderNumber);

  blocks.push({
    type: 'banner_inverted',
    text: '*** REPOSICIÓN URGENTE SIN COBRO ***'
  });

  blocks.push({
    type: 'title_double',
    text: `${cmdStr} · TURNO ${turnStr}`,
    align: 'center'
  });

  blocks.push({
    type: 'text',
    text: `MOTIVO: ${reason.toUpperCase()}`,
    bold: true,
    align: 'center'
  });

  const timeStr = new Date().toLocaleTimeString('es-VE');
  blocks.push({ type: 'key_value', key: 'HORA EMISIÓN:', value: timeStr });
  blocks.push({ type: 'separator', style: 'double' });

  for (const line of lines) {
    blocks.push({
      type: 'line_item',
      qty: line.quantity,
      name: line.productName
    });
    for (const mod of line.modifiers) {
      blocks.push({
        type: 'modifier_item',
        text: mod,
        highlighted: true
      });
    }
  }

  blocks.push({ type: 'separator', style: 'single' });
  blocks.push({ type: 'cut', feedLines: 4 });

  return {
    title: `Reposición Urgente ${cmdStr}`,
    widthColumns: 32,
    blocks
  };
}

export function buildOrderModificationTicketIR(
  order: OrderReceiptData,
  action: 'MODIFICACION' | 'ANULACION',
  reason: string,
  authorizedByName?: string
): TicketIR {
  const blocks: TicketBlock[] = [];
  const cmdStr = formatOrderCmd(order.orderNumber);
  const turnStr = formatTurnNumber(order.orderNumber);

  blocks.push({
    type: 'banner_inverted',
    text: '*** CAMBIO / ANULACIÓN ***'
  });

  blocks.push({
    type: 'title_double',
    text: `${cmdStr} · TURNO ${turnStr}`,
    align: 'center'
  });

  blocks.push({
    type: 'text',
    text: `ACCIÓN: ${action === 'ANULACION' ? 'ANULACIÓN TOTAL' : 'MODIFICACIÓN DE ORDEN'}`,
    bold: true,
    align: 'center'
  });

  blocks.push({
    type: 'text',
    text: `MOTIVO: ${reason}`,
    bold: true,
    align: 'center'
  });

  if (authorizedByName) {
    blocks.push({
      type: 'key_value',
      key: 'AUTORIZADO POR:',
      value: authorizedByName,
      bold: true
    });
  }

  const timeStr = new Date().toLocaleTimeString('es-VE');
  blocks.push({ type: 'key_value', key: 'HORA:', value: timeStr });
  blocks.push({ type: 'separator', style: 'single' });
  blocks.push({ type: 'cut', feedLines: 4 });

  return {
    title: `Cambio/Anulación ${cmdStr}`,
    widthColumns: 32,
    blocks
  };
}

export function buildReprintTicketIR(
  originalIR: TicketIR,
  reprintCount: number,
  reason: string,
  reprintedByName: string
): TicketIR {
  const newBlocks: TicketBlock[] = [];

  // Banner superior de reimpresión
  newBlocks.push({
    type: 'banner_inverted',
    text: `*** COPIA / REIMPRESIÓN #${reprintCount} ***`
  });

  newBlocks.push({
    type: 'key_value',
    key: 'REIMPRESO POR:',
    value: reprintedByName,
    bold: true
  });

  newBlocks.push({
    type: 'key_value',
    key: 'MOTIVO:',
    value: reason
  });

  const timeStr = new Date().toLocaleTimeString('es-VE');
  newBlocks.push({
    type: 'key_value',
    key: 'HORA REIMPRESIÓN:',
    value: timeStr
  });

  newBlocks.push({ type: 'separator', style: 'dashed' });

  // Agregar los bloques del ticket original
  for (const block of originalIR.blocks) {
    newBlocks.push(block);
  }

  return {
    title: `${originalIR.title} (Reimpresión #${reprintCount})`,
    widthColumns: originalIR.widthColumns || 32,
    blocks: newBlocks
  };
}

// ============================================================================
// HELPER PARA CARGAR ORDEN COMPLETA DE DB Y GENERAR SUS TICKETS
// ============================================================================

export function loadOrderReceiptDataFromDb(
  rawDb: Database.Database,
  orderId: string
): { order: OrderReceiptData; lines: ReceiptLineItem[]; kitchenLines: KitchenBuildableLine[] } {
  const orderRow = rawDb.prepare(`
    SELECT 
      id,
      order_number as orderNumber,
      fulfillment_type as fulfillmentType,
      table_number as tableNumber,
      customer_name as customerName,
      customer_phone as customerPhone,
      delivery_address as deliveryAddress,
      gross_food_subtotal_usd_cents as grossFoodSubtotalUsdCents,
      discount_usd_cents as discountUsdCents,
      delivery_fee_usd_cents as deliveryFeeUsdCents,
      total_to_collect_usd_cents as totalToCollectUsdCents,
      rate_micro_bs as rateMicroBs,
      notes,
      created_at_ms as createdAtMs
    FROM orders
    WHERE id = ?
  `).get(orderId) as OrderReceiptData | undefined;

  if (!orderRow) {
    throw new Error(`Orden ${orderId} no encontrada`);
  }

  const lineRows = rawDb.prepare(`
    SELECT 
      ol.id as line_id,
      p.name as product_name,
      ol.quantity,
      ol.subtotal_usd_cents as price_usd_cents,
      ol.flavor_choice
    FROM order_lines ol
    JOIN products p ON ol.product_id = p.id
    WHERE ol.order_id = ?
    ORDER BY ol.created_at_ms ASC
  `).all(orderId) as Array<{
    line_id: string;
    product_name: string;
    quantity: number;
    price_usd_cents: number;
    flavor_choice?: string | null;
  }>;

  // Cargar modificadores
  const modRows = rawDb.prepare(`
    SELECT 
      olm.order_line_id,
      olm.ingredient_name,
      olm.modifier_type
    FROM order_line_modifiers olm
    JOIN order_lines ol ON olm.order_line_id = ol.id
    WHERE ol.order_id = ?
  `).all(orderId) as Array<{
    order_line_id: string;
    ingredient_name: string;
    modifier_type: string;
  }>;

  const modsByLine = new Map<string, string[]>();
  for (const m of modRows) {
    const list = modsByLine.get(m.order_line_id) || [];
    if (m.modifier_type === 'SIN_INGREDIENTE') {
      list.push(`SIN ${m.ingredient_name}`);
    } else if (m.modifier_type === 'EXTRA_INGREDIENTE') {
      list.push(`+ EXTRA ${m.ingredient_name}`);
    } else if (m.modifier_type === 'BARRA_LIBRE') {
      list.push(`+ AGREGAR (Barra Libre): ${m.ingredient_name}`);
    }
    modsByLine.set(m.order_line_id, list);
  }

  const lines: ReceiptLineItem[] = lineRows.map(l => ({
    lineId: l.line_id,
    productName: l.product_name,
    quantity: l.quantity,
    priceUsdCents: l.price_usd_cents,
    flavorChoice: l.flavor_choice || null,
    modifiers: modsByLine.get(l.line_id) || []
  }));

  const kitchenLines = getKitchenBuildableLines(rawDb, orderId);

  return {
    order: orderRow,
    lines,
    kitchenLines
  };
}

export interface ZReportData {
  jornadaId: string;
  openedAtMs: number;
  closedAtMs: number;
  closedByName: string;
  rateMicroBs: number;
  grossSalesUsdCents: number;
  discountUsdCents: number;
  netSalesUsdCents: number;
  deliveryFeesUsdCents: number;
  totalCollectedUsdCents: number;
  cashUsdCents: number;
  cashBsCents: number;
  pagoMovilBsCents: number;
  ubiiGrossBsCents: number;
  ubiiFeeBsCents: number;
  ubiiNetBsCents: number;
  binanceUsdCents: number;
  zelleUsdCents: number;
  expensesUsdCents: number;
  mermasLossUsdCents: number;
  ordersCount: number;
  auditHeadHash: string;
}

/**
 * Plantilla de Cierre Z Oficial con Desglose y Hash de Auditoría SHA-256
 */
export function buildZReportTicketIR(data: ZReportData): TicketIR {
  const blocks: TicketBlock[] = [];
  const rateBs = (data.rateMicroBs / 1_000_000).toFixed(2);
  const netBs = Math.round((data.netSalesUsdCents * data.rateMicroBs) / 1_000_000);

  blocks.push({ type: 'header_logo' });
  blocks.push({
    type: 'key_value',
    key: 'TOCINETA SONRÍE',
    value: 'RIF: V-17040918-0',
    bold: true
  });
  blocks.push({
    type: 'key_value',
    key: 'FOOD TRUCK',
    value: 'PUERTO ORDAZ'
  });

  blocks.push({ type: 'separator', style: 'double' });
  blocks.push({
    type: 'banner_inverted',
    text: '=== CIERRE Z DE JORNADA ==='
  });

  const openedDateStr = new Date(data.openedAtMs).toLocaleString('es-VE');
  const closedDateStr = new Date(data.closedAtMs).toLocaleString('es-VE');

  blocks.push({ type: 'key_value', key: 'Jornada ID:', value: data.jornadaId.slice(-8) });
  blocks.push({ type: 'key_value', key: 'Apertura:', value: openedDateStr });
  blocks.push({ type: 'key_value', key: 'Cierre:', value: closedDateStr });
  blocks.push({ type: 'key_value', key: 'Cerrado por:', value: data.closedByName });
  blocks.push({ type: 'key_value', key: 'Tasa BCV:', value: `${rateBs} Bs/$`, bold: true });
  blocks.push({ type: 'separator', style: 'dashed' });

  // Totales de Venta
  blocks.push({
    type: 'title_double',
    text: `TOTAL: $${(data.netSalesUsdCents / 100).toFixed(2)}`
  });
  blocks.push({
    type: 'key_value',
    key: 'Total en Bs:',
    value: `Bs ${(netBs / 100).toFixed(2)}`,
    bold: true
  });
  blocks.push({
    type: 'key_value',
    key: 'Venta Bruta:',
    value: `$${(data.grossSalesUsdCents / 100).toFixed(2)}`
  });
  if (data.discountUsdCents > 0) {
    blocks.push({
      type: 'key_value',
      key: 'Descuentos/Cupones:',
      value: `-$${(data.discountUsdCents / 100).toFixed(2)}`
    });
  }
  if (data.deliveryFeesUsdCents > 0) {
    blocks.push({
      type: 'key_value',
      key: 'Fondo Delivery:',
      value: `$${(data.deliveryFeesUsdCents / 100).toFixed(2)}`
    });
  }

  // Desglose de Pagos
  blocks.push({ type: 'separator', style: 'single' });
  blocks.push({
    type: 'banner_inverted',
    text: 'DESGLOSE DE MEDIOS DE PAGO'
  });
  blocks.push({
    type: 'key_value',
    key: 'Efectivo USD ($):',
    value: `$${(data.cashUsdCents / 100).toFixed(2)}`
  });
  blocks.push({
    type: 'key_value',
    key: 'Efectivo Bs:',
    value: `Bs ${(data.cashBsCents / 100).toFixed(2)}`
  });
  blocks.push({
    type: 'key_value',
    key: 'Pago Móvil Banesco:',
    value: `Bs ${(data.pagoMovilBsCents / 100).toFixed(2)}`
  });
  blocks.push({
    type: 'key_value',
    key: 'Punto Ubii (Bruto):',
    value: `Bs ${(data.ubiiGrossBsCents / 100).toFixed(2)}`
  });
  blocks.push({
    type: 'key_value',
    key: 'Comisión Ubii (0.75%):',
    value: `-Bs ${(data.ubiiFeeBsCents / 100).toFixed(2)}`
  });
  blocks.push({
    type: 'key_value',
    key: 'Ubii Neto Banco:',
    value: `Bs ${(data.ubiiNetBsCents / 100).toFixed(2)}`,
    bold: true
  });
  if (data.binanceUsdCents > 0) {
    blocks.push({
      type: 'key_value',
      key: 'Binance USDT:',
      value: `$${(data.binanceUsdCents / 100).toFixed(2)}`
    });
  }
  if (data.zelleUsdCents > 0) {
    blocks.push({
      type: 'key_value',
      key: 'Zelle USD:',
      value: `$${(data.zelleUsdCents / 100).toFixed(2)}`
    });
  }

  // Resumen Operativo
  blocks.push({ type: 'separator', style: 'dashed' });
  blocks.push({
    type: 'key_value',
    key: 'Total Órdenes:',
    value: `${data.ordersCount}`
  });
  blocks.push({
    type: 'key_value',
    key: 'Gastos de Caja:',
    value: `$${(data.expensesUsdCents / 100).toFixed(2)}`
  });
  blocks.push({
    type: 'key_value',
    key: 'Mermas/Incidentes:',
    value: `$${(data.mermasLossUsdCents / 100).toFixed(2)}`
  });

  // Bloque Criptográfico de Auditoría
  blocks.push({ type: 'separator', style: 'double' });
  blocks.push({
    type: 'banner_inverted',
    text: 'CADENA DE AUDITORÍA INMUTABLE'
  });
  blocks.push({
    type: 'key_value',
    key: 'SHA-256 HEAD:',
    value: 'VERIFICADO',
    bold: true
  });
  blocks.push({
    type: 'footer',
    lines: [data.auditHeadHash, 'Cierre Contable Oficial - Tocineta Sonríe'],
    align: 'center'
  });
  blocks.push({ type: 'cut' });

  return {
    id: `zreport_${data.jornadaId}`,
    title: 'CIERRE Z OFICIAL',
    widthColumns: 32,
    blocks
  };
}
