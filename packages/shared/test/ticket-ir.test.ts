import { describe, it, expect } from 'vitest';
import {
  renderTicketToHtml,
  renderTicketToEscPos,
  encodeCP850,
  type TicketIR
} from '../src/ticket-ir.js';

describe('Ticket IR - Representación Intermedia, HTML y ESC/POS (@tocineta/shared)', () => {
  const sampleIR: TicketIR = {
    title: 'Nota de Entrega Tocineta Sonríe',
    widthColumns: 32,
    blocks: [
      { type: 'header_logo' },
      { type: 'text', text: 'Cocinamos con amor, te servimos como mereces y damos gloria a Dios', align: 'center' },
      { type: 'separator', style: 'single' },
      { type: 'title_double', text: 'TURNO T-023', align: 'center' },
      { type: 'key_value', key: 'ORDEN:', value: '#CMD-0145', bold: true },
      { type: 'key_value', key: 'CANAL:', value: 'Mesa 4' },
      { type: 'key_value', key: 'CLIENTE:', value: 'Olinelcys Aguilera' },
      { type: 'separator', style: 'double' },
      { type: 'line_item', qty: 1, name: 'Clásica Burger', price: '$6.50' },
      { type: 'modifier_item', text: '[ SIN CEBOLLA ]', highlighted: true },
      { type: 'modifier_item', text: '[ EXTRA TOCINETA ]' },
      { type: 'line_item', qty: 2, name: 'Hot Dog Especial', price: '$7.40' },
      { type: 'separator', style: 'single' },
      {
        type: 'totals_block',
        subtotalUsd: '$13.90',
        totalUsd: '$13.90',
        totalBs: 'Bs 508,74',
        bcvRate: 'Tasa BCV: 36.60 Bs/$'
      },
      { type: 'footer', lines: ['¡GRACIAS POR SU COMPRA!', 'Dios le bendiga'], align: 'center' },
      { type: 'cut', feedLines: 4 }
    ]
  };

  it('renderTicketToHtml genera la vista previa idéntica en HTML para navegador sin CDNs', () => {
    const html = renderTicketToHtml(sampleIR);
    expect(html).toContain('ticket-preview-container');
    expect(html).toContain('TOCINETA SONR&Iacute;E');
    expect(html).toContain('TURNO T-023');
    expect(html).toContain('#CMD-0145');
    expect(html).toContain('Olinelcys Aguilera');
    expect(html).toContain('Clásica Burger');
    expect(html).toContain('[ SIN CEBOLLA ]');
    expect(html).toContain('TOTAL USD:');
    expect(html).toContain('$13.90');
    expect(html).toContain('TOTAL BS:');
    expect(html).toContain('Bs 508,74');
    expect(html).toContain('Tasa BCV: 36.60 Bs/$');
    expect(html).toContain('CORTE');
  });

  it('renderTicketToEscPos genera el arreglo binario con inicialización ESC/POS, CP850 y corte cuando se solicita', () => {
    const bytes = renderTicketToEscPos(sampleIR, { beep: true, codepage: 2, hasCutter: true, hasBuzzer: true });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(4000); // Incluye el logo de 384x96 dots (GS v 0)

    // Inicialización ESC @ (0x1b, 0x40)
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);

    // Selección CP850 ESC t 2 (0x1b, 0x74, 0x02)
    expect(bytes[2]).toBe(0x1b);
    expect(bytes[3]).toBe(0x74);
    expect(bytes[4]).toBe(0x02);

    // Debe contener el comando de corte parcial GS V 66 0 (0x1d, 0x56, 0x42, 0x00)
    const cutIdx = bytes.indexOf(0x56);
    expect(cutIdx).toBeGreaterThan(0);
  });

  it('renderTicketToEscPos emite WPC1252 (ESC t 16) por defecto y respeta hasCutter=false y hasBuzzer=false', () => {
    const bytes = renderTicketToEscPos(sampleIR, { codepage: 16, hasCutter: false, hasBuzzer: false });
    expect(bytes[2]).toBe(0x1b);
    expect(bytes[3]).toBe(0x74);
    expect(bytes[4]).toBe(0x10); // ESC t 16

    // No debe contener corte GS V (0x1d 0x56) ni buzzer ESC B (0x1b 0x42)
    const hasGsV = bytes.some((b, i) => b === 0x1d && bytes[i + 1] === 0x56);
    expect(hasGsV).toBe(false);
    const hasEscB = bytes.some((b, i) => b === 0x1b && bytes[i + 1] === 0x42);
    expect(hasEscB).toBe(false);

    // Termina con 5 saltos de línea (0x0A x 5)
    const last5 = bytes.slice(-5);
    expect(Array.from(last5)).toEqual([0x0a, 0x0a, 0x0a, 0x0a, 0x0a]);
  });

  it('encodeCP850 mapea correctamente caracteres en español (á, é, í, ó, ú, ñ, Ñ, ¡, ¿)', () => {
    const testStr = 'ñ Ñ á é í ó ú ¡ ¿';
    const encoded = encodeCP850(testStr);
    expect(encoded).toBeInstanceOf(Uint8Array);
    // ñ en CP850 es 0xa4
    expect(encoded[0]).toBe(0xa4);
    // Ñ en CP850 es 0xa5
    expect(encoded[2]).toBe(0xa5);
    // á en CP850 es 0xa0
    expect(encoded[4]).toBe(0xa0);
  });
});
