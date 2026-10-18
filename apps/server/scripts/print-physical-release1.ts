/**
 * SISTEMA OPERATIVO LOCAL TOCINETA SONRÍE (Varons Media)
 * Script de Validación Física Real del Motor M6/M8 (Release 1)
 * 
 * Uso:
 *   pnpm --filter @tocineta/server tsx scripts/print-physical-release1.ts --caja "DP58U-03"
 *   pnpm --filter @tocineta/server tsx scripts/print-physical-release1.ts --printer "POS-58"
 *   pnpm --filter @tocineta/server tsx scripts/print-physical-release1.ts --mock
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderTicketToEscPos, type TicketIR, type EscPosConfig } from '@tocineta/shared';
import {
  buildReceiptTicketIR,
  buildZReportTicketIR,
  type OrderReceiptData,
  type ReceiptLineItem,
  type ZReportData
} from '../src/modules/printing/templates.js';
import { sendWindowsRawEscPos } from '../src/modules/printing/worker.js';

interface CliArgs {
  cajaPrinter: string;
  cocinaPrinter: string;
  mock: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let cajaPrinter = 'DP58U-03';
  let cocinaPrinter = 'MP583';
  let mock = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--caja' || a === '--printer' || a === '-p') {
      cajaPrinter = args[++i];
    } else if (a === '--cocina') {
      cocinaPrinter = args[++i];
    } else if (a === '--mock' || a === '--dry-run') {
      mock = true;
    }
  }

  return { cajaPrinter, cocinaPrinter, mock };
}

async function main() {
  const { cajaPrinter, cocinaPrinter, mock } = parseArgs();

  console.log('\n=================================================================');
  console.log('   TOCINETA SONRÍE - PRUEBA FÍSICA REAL RELEASE 1 (M6/M8)       ');
  console.log('=================================================================');
  console.log(`- Impresora Caja:    ${cajaPrinter} (USB / DP58U-03)`);
  console.log(`- Impresora Cocina:  ${cocinaPrinter} (MP583)`);
  console.log(`- Modo de Impresión: ${mock ? 'MOCK / SIMULACIÓN' : 'HARDWARE REAL (winspool.Drv)'}`);
  console.log('=================================================================\n');

  // Configuración física validada en hardware real:
  // DP58U-03: 32 columnas (384 dots), WPC1252 (codepage 16), sin cutter, sin buzzer
  const hardwareConfig: EscPosConfig = {
    codepage: 16,
    hasCutter: false,
    hasBuzzer: false
  };

  const now = Date.now();
  const outputDir = path.resolve(process.cwd(), './data/print-test');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. TICKET DE CAJA: Nota de Entrega con Combo Clásico ($7.90) y acentos
  // ───────────────────────────────────────────────────────────────────────────
  console.log('1. Generando Nota de Entrega de Caja (Acentos WPC1252: Í, Ñ, Á, Ó)...');
  const receiptOrder: OrderReceiptData = {
    id: 'ord_release1_sample',
    orderNumber: 23,
    fulfillmentType: 'salon',
    tableNumber: '4',
    customerName: 'Sra. Olinelcys Ramírez',
    customerPhone: '0414-1234567',
    deliveryAddress: null,
    grossFoodSubtotalUsdCents: 790,
    discountUsdCents: 0,
    deliveryFeeUsdCents: 0,
    totalToCollectUsdCents: 790,
    rateMicroBs: 40_000_000, // 40.00 Bs/$
    notes: 'Cliente preferencial - Servir bien caliente con jalapeños extra',
    createdAtMs: now
  };

  const receiptLines: ReceiptLineItem[] = [
    {
      lineId: 'line_combo_clasico',
      productName: 'Combo Clásico (Hamburguesa + Papas + Bebida)',
      quantity: 1,
      priceUsdCents: 790,
      flavorChoice: 'Refresco Pepsi',
      modifiers: [
        '+ AGREGAR (Barra Libre): Cebolla Caramelizada',
        '+ AGREGAR (Barra Libre): Maíz Tierno',
        '+ EXTRA PAGO: Jalapeños Extra ($1.00)'
      ]
    }
  ];

  const receiptIR = buildReceiptTicketIR(receiptOrder, receiptLines);
  const receiptBytes = Buffer.from(renderTicketToEscPos(receiptIR, hardwareConfig));
  fs.writeFileSync(path.join(outputDir, '1_nota_entrega_caja.bin'), receiptBytes);

  if (!mock && process.platform === 'win32') {
    try {
      console.log(`   -> Enviando a impresora "${cajaPrinter}" por winspool...`);
      await sendWindowsRawEscPos(cajaPrinter, receiptBytes, 'Release1_NotaEntrega');
      console.log('   ✓ Impresión de Caja completada con éxito.');
    } catch (err: any) {
      console.error(`   ✗ Error imprimiendo en ${cajaPrinter}:`, err.message);
    }
  } else {
    console.log(`   ✓ Simulación exitosa (${receiptBytes.length} bytes generados).`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. COMANDAS DE COCINA: Por estación sin la palabra "COMBO"
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n2. Generando Comandas de Cocina por Estación (Hamburguesas y Hot Dogs)...');

  // Estación 1: Hamburguesas
  const burgerIR: TicketIR = {
    title: 'Comanda Cocina HAMBURGUESAS #CMD-0023',
    widthColumns: 32,
    blocks: [
      { type: 'banner_inverted', text: '=== ESTACIÓN: HAMBURGUESAS ===' },
      { type: 'title_double', text: '#CMD-0023 · TURNO T-023', align: 'center' },
      { type: 'banner_inverted', text: '[ORDEN COMPUESTA: ESPERAR HOT DOGS]' },
      { type: 'key_value', key: 'CANAL:', value: 'Mesa 4', bold: true },
      { type: 'key_value', key: 'CLIENTE:', value: 'Sra. Olinelcys Ramírez' },
      { type: 'key_value', key: 'HORA:', value: new Date(now).toLocaleTimeString('es-VE') },
      { type: 'separator', style: 'double' },
      { type: 'line_item', qty: 1, name: 'Hamburguesa Clásica' },
      { type: 'modifier_item', text: '↳ [ SIN PAN / ENVUELTA EN LECHUGA ]', highlighted: true },
      { type: 'modifier_item', text: '+ AGREGAR (Barra Libre): Cebolla Caramelizada', highlighted: true },
      { type: 'modifier_item', text: '+ AGREGAR (Barra Libre): Chimichurri', highlighted: true },
      { type: 'separator', style: 'single' },
      { type: 'cut', feedLines: 4 }
    ]
  };

  // Estación 2: Hot Dogs
  const hotDogIR: TicketIR = {
    title: 'Comanda Cocina HOT DOGS #CMD-0023',
    widthColumns: 32,
    blocks: [
      { type: 'banner_inverted', text: '=== ESTACIÓN: HOT DOGS ===' },
      { type: 'title_double', text: '#CMD-0023 · TURNO T-023', align: 'center' },
      { type: 'banner_inverted', text: '[ORDEN COMPUESTA: ESPERAR HAMBURGUESAS]' },
      { type: 'key_value', key: 'CANAL:', value: 'Mesa 4', bold: true },
      { type: 'key_value', key: 'CLIENTE:', value: 'Sra. Olinelcys Ramírez' },
      { type: 'key_value', key: 'HORA:', value: new Date(now).toLocaleTimeString('es-VE') },
      { type: 'separator', style: 'double' },
      { type: 'line_item', qty: 1, name: 'Hot Dog Especial' },
      { type: 'modifier_item', text: '+ AGREGAR (Barra Libre): Maíz', highlighted: true },
      { type: 'modifier_item', text: '+ AGREGAR (Barra Libre): Relish', highlighted: true },
      { type: 'separator', style: 'single' },
      { type: 'cut', feedLines: 4 }
    ]
  };

  const burgerBytes = Buffer.from(renderTicketToEscPos(burgerIR, hardwareConfig));
  const hotDogBytes = Buffer.from(renderTicketToEscPos(hotDogIR, hardwareConfig));

  fs.writeFileSync(path.join(outputDir, '2_comanda_hamburguesas.bin'), burgerBytes);
  fs.writeFileSync(path.join(outputDir, '3_comanda_hotdogs.bin'), hotDogBytes);

  if (!mock && process.platform === 'win32') {
    try {
      console.log(`   -> Enviando comanda Hamburguesas a "${cajaPrinter}"...`);
      await sendWindowsRawEscPos(cajaPrinter, burgerBytes, 'Release1_Cocina_Burgers');
      console.log(`   -> Enviando comanda Hot Dogs a "${cajaPrinter}"...`);
      await sendWindowsRawEscPos(cajaPrinter, hotDogBytes, 'Release1_Cocina_HotDogs');
      console.log('   ✓ Comandas de Cocina impresas exitosamente.');
    } catch (err: any) {
      console.error('   ✗ Error imprimiendo comandas:', err.message);
    }
  } else {
    console.log(`   ✓ Simulación exitosa (Hamburguesas: ${burgerBytes.length} bytes, Hot Dogs: ${hotDogBytes.length} bytes).`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. TICKET DE CIERRE Z: Liquidación Ubii 0.75% y Hash SHA-256 de Auditoría
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n3. Generando Ticket Térmico de Cierre Z con Hash SHA-256...');
  const zReportData: ZReportData = {
    jornadaId: 'jor_release1_cert',
    openedAtMs: now - (8 * 3600 * 1000), // 8 horas antes
    closedAtMs: now,
    closedByName: 'Sra. Olinelcys Ramírez (Admin)',
    rateMicroBs: 40_000_000,
    grossSalesUsdCents: 45000, // $450.00
    discountUsdCents: 1500,    // -$15.00
    netSalesUsdCents: 43500,   // $435.00
    deliveryFeesUsdCents: 1200,// $12.00
    totalCollectedUsdCents: 44700,
    cashUsdCents: 20000,       // $200.00
    cashBsCents: 4000,         // $40.00 eq
    pagoMovilBsCents: 8000,    // $80.00 eq
    ubiiGrossBsCents: 460000,  // Bs 4.600,00 bruto
    ubiiFeeBsCents: 3450,      // Bs 34,50 (comisión 0.75%)
    ubiiNetBsCents: 456550,    // Bs 4.565,50 neto banco
    binanceUsdCents: 0,
    zelleUsdCents: 0,
    expensesUsdCents: 2500,    // $25.00
    mermasLossUsdCents: 1200,  // $12.00
    ordersCount: 38,
    auditHeadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  };

  const zTicketIR = buildZReportTicketIR(zReportData);
  const zTicketBytes = Buffer.from(renderTicketToEscPos(zTicketIR, hardwareConfig));
  fs.writeFileSync(path.join(outputDir, '4_cierre_z.bin'), zTicketBytes);

  if (!mock && process.platform === 'win32') {
    try {
      console.log(`   -> Enviando Cierre Z a impresora "${cajaPrinter}" por winspool...`);
      await sendWindowsRawEscPos(cajaPrinter, zTicketBytes, 'Release1_CierreZ');
      console.log('   ✓ Ticket de Cierre Z impreso exitosamente.');
    } catch (err: any) {
      console.error(`   ✗ Error imprimiendo Cierre Z:`, err.message);
    }
  } else {
    console.log(`   ✓ Simulación exitosa (${zTicketBytes.length} bytes generados).`);
  }

  console.log('\n=================================================================');
  console.log('  CERTIFICACIÓN FÍSICA RELEASE 1 FINALIZADA                       ');
  console.log('  Archivos binarios RAW generados en: ./data/print-test/         ');
  console.log('=================================================================\n');
}

main().catch((err) => {
  console.error('\n[ERROR FATAL EN PRUEBA FÍSICA]', err);
  process.exit(1);
});
