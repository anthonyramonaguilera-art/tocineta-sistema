import { describe, it, expect } from 'vitest';
import { buildTocinetaLogoEscPos, renderTicketToHtml, renderTicketToEscPos, type TicketIR } from '@tocineta/shared';
import { buildKitchenTicketIRs, type OrderReceiptData, type KitchenBuildableLine } from '../src/modules/printing/templates.js';

describe('R2 - Logo TOCINETA y Pruebas de Impresión', () => {
  it('los bytes del logo empiezan con 1D 76 30 00, bytesPerRow=48 y altura=274', () => {
    const logoBytes = buildTocinetaLogoEscPos();
    expect(logoBytes).toBeInstanceOf(Uint8Array);

    // [0x1d, 0x76, 0x30, m, xL, xH, yL, yH]
    expect(logoBytes[0]).toBe(0x1d);
    expect(logoBytes[1]).toBe(0x76);
    expect(logoBytes[2]).toBe(0x30);
    expect(logoBytes[3]).toBe(0x00); // m = 0

    const xL = logoBytes[4];
    const xH = logoBytes[5];
    const bytesPerRow = xL + (xH << 8);
    expect(bytesPerRow).toBe(48); // 384 dots / 8 = 48

    const yL = logoBytes[6];
    const yH = logoBytes[7];
    const height = yL + (yH << 8);
    expect(height).toBe(274);
  });

  it('ningún render (HTML o ESC/POS) contiene la cadena "SONR"', () => {
    const sampleIR: TicketIR = {
      title: 'Nota de Despacho Tocineta',
      blocks: [
        { type: 'header_logo' },
        { type: 'text', text: 'Prueba sin marcas prohibidas' },
        { type: 'cut' }
      ]
    };

    const html = renderTicketToHtml(sampleIR);
    expect(html).not.toMatch(/SONR/i);

    const escPos = renderTicketToEscPos(sampleIR);
    const textDecoder = new TextDecoder('windows-1252');
    const decodedText = textDecoder.decode(escPos);
    expect(decodedText).not.toMatch(/SONR/i);
  });

  it('la comanda de cocina no incluye header_logo', () => {
    const order: OrderReceiptData = {
      orderNumber: 145,
      createdAtMs: Date.now(),
      fulfillmentType: 'DineIn',
      tableNumber: 4,
      customerName: 'Cliente Test',
      items: [
        { name: 'Hamburguesa Clásica', qty: 1, priceUsd: 6.50 }
      ],
      totals: { subtotalUsd: 6.50, totalUsd: 6.50, totalBs: 237.90 }
    };

    const kitchenLines: KitchenBuildableLine[] = [
      { station: 'hamburguesas', name: 'Hamburguesa Clásica', qty: 1, modifiers: ['Sin cebolla'] }
    ];

    const kitchenIRs = buildKitchenTicketIRs({ order, kitchenLines });
    expect(kitchenIRs.length).toBeGreaterThan(0);

    for (const ir of kitchenIRs) {
      const hasLogo = ir.blocks.some(b => b.type === 'header_logo');
      expect(hasLogo).toBe(false);
    }
  });
});
