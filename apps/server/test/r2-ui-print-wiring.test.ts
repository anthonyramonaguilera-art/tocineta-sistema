import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('R2 — UI Print Wiring & Source Contracts Test', () => {
  const webSrcDir = path.resolve(__dirname, '../../web/src');

  it('1) PosComandero.tsx and CashierOrdersTab.tsx import PostPaymentPrintModal and pass token', () => {
    const posPath = path.join(webSrcDir, 'features/pos/PosComandero.tsx');
    const cashierOrdersPath = path.join(webSrcDir, 'features/cashier/CashierOrdersTab.tsx');

    const posContent = fs.readFileSync(posPath, 'utf8');
    const cashierContent = fs.readFileSync(cashierOrdersPath, 'utf8');

    expect(posContent).toContain('PostPaymentPrintModal');
    expect(posContent).toContain('token');

    expect(cashierContent).toContain('PostPaymentPrintModal');
    expect(cashierContent).toContain('token');
  });

  it('2) PostPaymentPrintPanel.tsx contains Authorization, no jobs.length === 0 with onClose, and queries without fixed status=pending', () => {
    const panelPath = path.join(webSrcDir, 'features/cashier/PostPaymentPrintPanel.tsx');
    const content = fs.readFileSync(panelPath, 'utf8');

    expect(content).toContain('Authorization');
    expect(content).not.toContain('status=pending');
    // Should not auto-close on jobs.length === 0
    expect(content).not.toMatch(/jobs\.length\s*===\s*0.*onClose/s);
  });

  it('3) usePosCart.ts contains announce option', () => {
    const cartPath = path.join(webSrcDir, 'features/pos/usePosCart.ts');
    const content = fs.readFileSync(cartPath, 'utf8');

    expect(content).toContain('announce');
  });

  it('4) types.ts includes receipt_destination and kitchen_destination', () => {
    const typesPath = path.join(webSrcDir, 'features/settings/types.ts');
    const content = fs.readFileSync(typesPath, 'utf8');

    expect(content).toContain("receipt_destination?: 'payer_device' | 'fixed_printer'");
    expect(content).toContain("kitchen_destination?: 'payer_device' | 'fixed_printer'");
  });

  it('5) PrintFlowSettings.tsx complies with print destinations, flows, status texts and print_mode synchronization', () => {
    const printFlowPath = path.join(webSrcDir, 'features/settings/PrintFlowSettings.tsx');
    const content = fs.readFileSync(printFlowPath, 'utf8');

    // Toggle: Mostrar todas las opciones al cobrar
    expect(content).toContain('Mostrar todas las opciones al cobrar');
    expect(content).toContain('Activado: al cobrar aparece el panel para imprimir la nota y la comanda. Desactivado: se imprime todo automáticamente.');
    expect(content).toContain('print_delivery_note');

    // Selectors: La nota de entrega sale por: and Las comandas salen por:
    expect(content).toContain('La nota de entrega sale por:');
    expect(content).toContain('Las comandas salen por:');
    expect(content).toContain('payer_device');
    expect(content).toContain('fixed_printer');
    expect(content).toContain('receipt_printer_id');
    expect(content).toContain('kitchen_printer_id');

    // Status lines and general support text
    expect(content).toContain('Ahora: cada ticket sale por el dispositivo que cobra');
    expect(content).toContain('Ahora: sale por');
    expect(content).toContain('Si el dispositivo que cobra no puede imprimir, el ticket sale por la impresora fija configurada aquí.');

    // Sincroniza print_mode ('two' si distintos, 'one' si iguales) y retira botones visibles
    expect(content).toContain("nextKitchenId !== nextReceiptId ? 'two' : 'one'");
    expect(content).not.toContain('Una impresora (Caja)');
    expect(content).not.toContain('Dos impresoras (Caja + Cocina)');

    // Formateo de tipos simples
    expect(content).toContain('Bluetooth de');
    expect(content).toContain("'Red'");
    expect(content).toContain("'USB'");

    // Cero nombres de software externo
    expect(content).not.toMatch(/\b(Windows|Spooler|Excel|Word)\b/i);
  });
});
