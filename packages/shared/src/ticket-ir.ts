import { THERMAL_LOGO_RASTER_B64 } from './thermal-logo.js';

/**
 * SISTEMA OPERATIVO LOCAL TOCINETA (Varons Media)
 * Módulo de Representación Intermedia del Ticket (Ticket IR)
 * 
 * Define la estructura agnóstica de un ticket térmico y provee dos renderizadores:
 * 1. renderTicketToHtml: Vista previa idéntica en pantalla para el navegador.
 * 2. renderTicketToEscPos: Arreglo binario ESC/POS para papel de 58mm (32 col Font A, CP850).
 */

export type TicketBlock =
  | { type: 'header_logo' }
  | { type: 'banner_inverted'; text: string }
  | { type: 'title_double'; text: string; align?: 'left' | 'center' | 'right' }
  | { type: 'text'; text: string; align?: 'left' | 'center' | 'right'; bold?: boolean; doubleHeight?: boolean }
  | { type: 'key_value'; key: string; value: string; bold?: boolean }
  | { type: 'separator'; style?: 'single' | 'double' | 'dashed' }
  | { type: 'line_item'; qty: number; name: string; price?: string }
  | { type: 'modifier_item'; text: string; highlighted?: boolean }
  | {
      type: 'totals_block';
      subtotalUsd?: string;
      discountUsd?: string;
      deliveryUsd?: string;
      totalUsd: string;
      totalBs: string;
      bcvRate?: string;
    }
  | { type: 'footer'; lines: string[]; align?: 'left' | 'center' | 'right' }
  | { type: 'cut'; feedLines?: number };

export interface TicketIR {
  id?: string;
  title?: string;
  widthColumns?: number; // 32 columnas para 58mm en Fuente A (por defecto)
  blocks: TicketBlock[];
}

export interface EscPosConfig {
  columns?: number;
  codepage?: number; // por defecto 16 (WPC1252). Si 2 u 850 -> CP850
  feedLinesBeforeCut?: number;
  beep?: boolean;
  hasCutter?: boolean | number;
  hasBuzzer?: boolean | number;
}

// ============================================================================
// HELPERS BINARIOS ISOMÓRFICOS (Uint8Array)
// ============================================================================

export function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (let i = 0; i < arrays.length; i++) {
    totalLength += arrays[i].length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (let i = 0; i < arrays.length; i++) {
    result.set(arrays[i], offset);
    offset += arrays[i].length;
  }
  return result;
}

export function asciiBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
}

// ============================================================================
// ENCODING WPC1252 (Windows-1252 / Latin-1) - Ganadora física en DP58U-03 (ESC t 16)
// ============================================================================

export function encodeWPC1252(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const code = char.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) {
      bytes.push(code);
    } else {
      switch (char) {
        case 'á': bytes.push(0xe1); break;
        case 'é': bytes.push(0xe9); break;
        case 'í': bytes.push(0xed); break;
        case 'ó': bytes.push(0xf3); break;
        case 'ú': bytes.push(0xfa); break;
        case 'Á': bytes.push(0xc1); break;
        case 'É': bytes.push(0xc9); break;
        case 'Í': bytes.push(0xcd); break;
        case 'Ó': bytes.push(0xd3); break;
        case 'Ú': bytes.push(0xda); break;
        case 'ñ': bytes.push(0xf1); break;
        case 'Ñ': bytes.push(0xd1); break;
        case 'ü': bytes.push(0xfc); break;
        case 'Ü': bytes.push(0xdc); break;
        case '¡': bytes.push(0xa1); break;
        case '¿': bytes.push(0xbf); break;
        case '↳': bytes.push(0xaf); break;
        default: bytes.push(0x3f); break; // '?'
      }
    }
  }
  return new Uint8Array(bytes);
}

// ============================================================================
// ENCODING CP850 (PC850 Multilingual) - Retrocompatibilidad (ESC t 2)
// ============================================================================

export function encodeCP850(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const code = char.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) {
      bytes.push(code);
    } else {
      switch (char) {
        case 'á': bytes.push(0xa0); break;
        case 'é': bytes.push(0x82); break;
        case 'í': bytes.push(0xa1); break;
        case 'ó': bytes.push(0xa2); break;
        case 'ú': bytes.push(0xa3); break;
        case 'ñ': bytes.push(0xa4); break;
        case 'Ñ': bytes.push(0xa5); break;
        case 'Á': bytes.push(0xb5); break;
        case 'É': bytes.push(0x90); break;
        case 'Í': bytes.push(0xd6); break;
        case 'Ó': bytes.push(0xe0); break;
        case 'Ú': bytes.push(0xe9); break;
        case 'ü': bytes.push(0x81); break;
        case 'Ü': bytes.push(0x9a); break;
        case '¡': bytes.push(0xad); break;
        case '¿': bytes.push(0xa8); break;
        case '↳': bytes.push(0xaf); break;
        default: bytes.push(0x3f); break; // '?'
      }
    }
  }
  return new Uint8Array(bytes);
}

// ============================================================================
// GENERACIÓN DE LOGO RASTER 1-BIT (GS v 0) A 384x96 PUNTOS (58mm)
// ============================================================================

const FONT_5X7: Record<string, number[]> = {
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
  '!': [0x00, 0x00, 0x5f, 0x00, 0x00],
  '*': [0x14, 0x08, 0x3e, 0x08, 0x14],
  '+': [0x08, 0x08, 0x3e, 0x08, 0x08],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08],
  '.': [0x00, 0x60, 0x60, 0x00, 0x00],
  '/': [0x20, 0x10, 0x08, 0x04, 0x02],
  ':': [0x00, 0x36, 0x36, 0x00, 0x00],
  '=': [0x14, 0x14, 0x14, 0x14, 0x14],
  '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],
  '1': [0x00, 0x42, 0x7f, 0x40, 0x00],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46],
  '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7f, 0x10],
  '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
  '7': [0x01, 0x71, 0x09, 0x05, 0x03],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36],
  '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
  'A': [0x7e, 0x11, 0x11, 0x11, 0x7e],
  'B': [0x7f, 0x49, 0x49, 0x49, 0x36],
  'C': [0x3e, 0x41, 0x41, 0x41, 0x22],
  'D': [0x7f, 0x41, 0x41, 0x22, 0x1c],
  'E': [0x7f, 0x49, 0x49, 0x49, 0x41],
  'F': [0x7f, 0x09, 0x09, 0x09, 0x01],
  'G': [0x3e, 0x41, 0x49, 0x49, 0x7a],
  'H': [0x7f, 0x08, 0x08, 0x08, 0x7f],
  'I': [0x00, 0x41, 0x7f, 0x41, 0x00],
  'J': [0x20, 0x40, 0x41, 0x3f, 0x01],
  'K': [0x7f, 0x08, 0x14, 0x22, 0x41],
  'L': [0x7f, 0x40, 0x40, 0x40, 0x40],
  'M': [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  'N': [0x7f, 0x04, 0x08, 0x10, 0x7f],
  'O': [0x3e, 0x41, 0x41, 0x41, 0x3e],
  'P': [0x7f, 0x09, 0x09, 0x09, 0x06],
  'Q': [0x3e, 0x41, 0x51, 0x21, 0x5e],
  'R': [0x7f, 0x09, 0x19, 0x29, 0x46],
  'S': [0x46, 0x49, 0x49, 0x49, 0x31],
  'T': [0x01, 0x01, 0x7f, 0x01, 0x01],
  'U': [0x3f, 0x40, 0x40, 0x40, 0x3f],
  'V': [0x1f, 0x20, 0x40, 0x20, 0x1f],
  'W': [0x7f, 0x20, 0x18, 0x20, 0x7f],
  'X': [0x63, 0x14, 0x08, 0x14, 0x63],
  'Y': [0x07, 0x08, 0x70, 0x08, 0x07],
  'Z': [0x61, 0x51, 0x49, 0x45, 0x43]
};

class MonochromeBitmap {
  readonly width = 384;
  readonly height = 96;
  readonly bytesPerRow = 48;
  readonly data: Uint8Array;

  constructor() {
    this.data = new Uint8Array(this.bytesPerRow * this.height);
  }

  setPixel(x: number, y: number, value: 0 | 1 = 1) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const byteIndex = y * this.bytesPerRow + (x >> 3);
    const bitMask = 0x80 >> (x & 7);
    if (value === 1) {
      this.data[byteIndex] |= bitMask;
    } else {
      this.data[byteIndex] &= ~bitMask;
    }
  }

  fillRect(x0: number, y0: number, w: number, h: number, value: 0 | 1 = 1) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        this.setPixel(x, y, value);
      }
    }
  }

  drawHLine(x0: number, y: number, length: number, value: 0 | 1 = 1) {
    for (let x = x0; x < x0 + length; x++) {
      this.setPixel(x, y, value);
    }
  }

  drawVLine(x: number, y0: number, length: number, value: 0 | 1 = 1) {
    for (let y = y0; y < y0 + length; y++) {
      this.setPixel(x, y, value);
    }
  }

  drawChar5x7(char: string, x0: number, y0: number, scale = 1, invert = false) {
    const glyph = FONT_5X7[char.toUpperCase()] || FONT_5X7[' '];
    for (let col = 0; col < 5; col++) {
      const colByte = glyph[col];
      for (let row = 0; row < 7; row++) {
        const bit = (colByte >> row) & 1;
        const pixelVal = invert ? (bit ? 0 : 1) : (bit ? 1 : 0);
        if (pixelVal === 1) {
          this.fillRect(x0 + col * scale, y0 + row * scale, scale, scale, 1);
        }
      }
    }
  }

  drawText(text: string, x0: number, y0: number, scale = 1, invert = false) {
    let cursorX = x0;
    const charSpacing = 1 * scale;
    const charWidth = 5 * scale;
    for (let i = 0; i < text.length; i++) {
      this.drawChar5x7(text[i], cursorX, y0, scale, invert);
      cursorX += charWidth + charSpacing;
    }
  }

  toRasterCommand(): Uint8Array {
    const m = 0;
    const xL = this.bytesPerRow & 0xff; // 48
    const xH = (this.bytesPerRow >> 8) & 0xff; // 0
    const yL = this.height & 0xff; // 96
    const yH = (this.height >> 8) & 0xff; // 0
    const header = new Uint8Array([0x1d, 0x76, 0x30, m, xL, xH, yL, yH]);
    return concatUint8Arrays([header, this.data]);
  }
}

export function buildTocinetaLogoEscPos(): Uint8Array {
  void MonochromeBitmap;
  // @ts-ignore
  return new Uint8Array((globalThis as any).Buffer.from(THERMAL_LOGO_RASTER_B64, 'base64'));
}

/** @deprecated Use buildTocinetaLogoEscPos */
export const buildOfficialBaconLogoEscPos = buildTocinetaLogoEscPos;

// ============================================================================
// RENDERIZADOR 1: VISTA PREVIA HTML EN PANTALLA
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderTicketToHtml(ir: TicketIR): string {
  const parts: string[] = [];

  parts.push(`
<div class="ticket-preview-container" style="
  width: 280px;
  background: #ffffff;
  color: #0b0d11;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  line-height: 1.25;
  padding: 14px 10px;
  box-shadow: 0 4px 18px rgba(0,0,0,0.3);
  border-radius: 4px;
  margin: 0 auto;
  box-sizing: border-box;
">
`);

  for (const block of ir.blocks) {
    switch (block.type) {
      case 'header_logo': {
        parts.push(`
  <div style="text-align: center; margin-bottom: 8px;">
    <img src="/brand/logo-light.png" alt="TOCINETA" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />
  </div>
`);
        break;
      }

      case 'banner_inverted': {
        parts.push(`
  <div style="background: #0b0d11; color: #ffffff; font-weight: bold; text-align: center; padding: 4px 2px; margin: 6px 0; font-size: 12px; letter-spacing: 0.5px;">
    ${escapeHtml(block.text)}
  </div>
`);
        break;
      }

      case 'title_double': {
        const align = block.align || 'center';
        parts.push(`
  <div style="font-size: 19px; font-weight: 900; text-align: ${align}; margin: 5px 0; letter-spacing: 1px;">
    ${escapeHtml(block.text)}
  </div>
`);
        break;
      }

      case 'text': {
        const align = block.align || 'left';
        const weight = block.bold ? 'bold' : 'normal';
        const fontSize = block.doubleHeight ? '14px' : '12px';
        parts.push(`
  <div style="text-align: ${align}; font-weight: ${weight}; font-size: ${fontSize}; margin: 2px 0;">
    ${escapeHtml(block.text)}
  </div>
`);
        break;
      }

      case 'key_value': {
        const weight = block.bold ? 'bold' : 'normal';
        parts.push(`
  <div style="display: flex; justify-content: space-between; font-weight: ${weight}; margin: 2px 0;">
    <span>${escapeHtml(block.key)}</span>
    <span>${escapeHtml(block.value)}</span>
  </div>
`);
        break;
      }

      case 'separator': {
        const borderStyle = block.style === 'double' ? 'double 3px #0b0d11' : block.style === 'dashed' ? 'dashed 1px #555' : 'solid 1px #0b0d11';
        parts.push(`
  <div style="border-bottom: ${borderStyle}; margin: 6px 0;"></div>
`);
        break;
      }

      case 'line_item': {
        parts.push(`
  <div style="display: flex; justify-content: space-between; font-weight: bold; margin-top: 4px;">
    <span>${block.qty}x ${escapeHtml(block.name)}</span>
    ${block.price ? `<span>${escapeHtml(block.price)}</span>` : ''}
  </div>
`);
        break;
      }

      case 'modifier_item': {
        const isHighlight = block.highlighted;
        const color = isHighlight ? '#000000' : '#444444';
        const weight = isHighlight ? 'bold' : 'normal';
        parts.push(`
  <div style="padding-left: 14px; font-size: 11px; font-weight: ${weight}; color: ${color}; margin: 1px 0;">
    ${escapeHtml(block.text)}
  </div>
`);
        break;
      }

      case 'totals_block': {
        parts.push(`
  <div style="margin: 6px 0;">
    ${block.subtotalUsd ? `
    <div style="display: flex; justify-content: space-between;">
      <span>SUBTOTAL:</span>
      <span>${escapeHtml(block.subtotalUsd)}</span>
    </div>` : ''}
    ${block.discountUsd ? `
    <div style="display: flex; justify-content: space-between; color: #b00020;">
      <span>DESCUENTO:</span>
      <span>${escapeHtml(block.discountUsd)}</span>
    </div>` : ''}
    ${block.deliveryUsd ? `
    <div style="display: flex; justify-content: space-between;">
      <span>DELIVERY:</span>
      <span>${escapeHtml(block.deliveryUsd)}</span>
    </div>` : ''}
    <div style="border-bottom: double 3px #0b0d11; margin: 4px 0;"></div>
    <div style="display: flex; justify-content: space-between; font-size: 15px; font-weight: 900;">
      <span>TOTAL USD:</span>
      <span>${escapeHtml(block.totalUsd)}</span>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 15px; font-weight: 900; margin-top: 2px;">
      <span>TOTAL BS:</span>
      <span>${escapeHtml(block.totalBs)}</span>
    </div>
    ${block.bcvRate ? `
    <div style="text-align: right; font-size: 10px; color: #555; margin-top: 2px;">
      (${escapeHtml(block.bcvRate)})
    </div>` : ''}
  </div>
`);
        break;
      }

      case 'footer': {
        const align = block.align || 'center';
        parts.push(`
  <div style="text-align: ${align}; font-size: 11px; margin-top: 8px; color: #444;">
    ${block.lines.map(l => `<div>${escapeHtml(l)}</div>`).join('')}
  </div>
`);
        break;
      }

      case 'cut': {
        parts.push(`
  <div style="border-bottom: dashed 1px #999; margin: 12px 0 6px 0; text-align: center; position: relative;">
    <span style="background: #ffffff; padding: 0 4px; font-size: 10px; color: #888; position: relative; top: -6px;">
      - - - - - &#9986; CORTE - - - - -
    </span>
  </div>
`);
        break;
      }
    }
  }

  parts.push(`</div>`);
  return parts.join('');
}

// ============================================================================
// RENDERIZADOR 2: ARREGLO BINARIO ESC/POS PARA PAPEL DE 58mm (32 COLUMNAS)
// ============================================================================

export function renderTicketToEscPos(
  irOrConfig?: TicketIR | EscPosConfig,
  maybeConfig?: EscPosConfig
): Uint8Array {
  let ir: TicketIR;
  let config: EscPosConfig | undefined;

  if (irOrConfig && 'blocks' in irOrConfig && Array.isArray((irOrConfig as TicketIR).blocks)) {
    ir = irOrConfig as TicketIR;
    config = maybeConfig;
  } else {
    config = irOrConfig as EscPosConfig | undefined;
    ir = {
      widthColumns: config?.columns || 32,
      blocks: [
        { type: 'text', text: 'TOCINETA - JALAPEÑOS - MAÍZ - HAMBURGUESA CLÁSICA' },
        { type: 'cut' }
      ]
    };
  }

  const cols = config?.columns || ir.widthColumns || 32;
  const rawCodepage = config?.codepage ?? 16;
  const isCp850 = rawCodepage === 2 || rawCodepage === 850;
  const codepageByte = isCp850 ? 0x02 : 0x10;
  const encode = isCp850 ? encodeCP850 : encodeWPC1252;
  const hasCutter = Boolean(config?.hasCutter);
  const hasBuzzer = Boolean(config?.hasBuzzer);

  const chunks: Uint8Array[] = [];

  // Reset e inicialización de impresora: ESC @
  chunks.push(new Uint8Array([0x1b, 0x40]));

  // Selección de página de códigos: ESC t N (0x10 para WPC1252, 0x02 para CP850)
  chunks.push(new Uint8Array([0x1b, 0x74, codepageByte]));

  // Fuente A (estándar 12x24 dots -> 32 columnas): ESC M 0
  chunks.push(new Uint8Array([0x1b, 0x4d, 0x00]));

  for (const block of ir.blocks) {
    switch (block.type) {
      case 'header_logo': {
        chunks.push(buildOfficialBaconLogoEscPos());
        chunks.push(asciiBytes('\n'));
        break;
      }

      case 'banner_inverted': {
        chunks.push(new Uint8Array([0x1b, 0x61, 0x01])); // Centrado
        chunks.push(new Uint8Array([0x1d, 0x42, 0x01])); // Invertido ON
        chunks.push(new Uint8Array([0x1b, 0x45, 0x01])); // Negrita ON

        const rawText = block.text.trim();
        const paddedText = ` ${rawText} `;
        chunks.push(encode(paddedText));
        chunks.push(asciiBytes('\n'));

        chunks.push(new Uint8Array([0x1b, 0x45, 0x00])); // Negrita OFF
        chunks.push(new Uint8Array([0x1d, 0x42, 0x00])); // Invertido OFF
        chunks.push(new Uint8Array([0x1b, 0x61, 0x00])); // Izquierda
        break;
      }

      case 'title_double': {
        const alignByte = block.align === 'center' ? 1 : block.align === 'right' ? 2 : 0;
        chunks.push(new Uint8Array([0x1b, 0x61, alignByte]));
        chunks.push(new Uint8Array([0x1d, 0x21, 0x11])); // Doble Ancho y Alto
        chunks.push(new Uint8Array([0x1b, 0x45, 0x01])); // Negrita ON
        chunks.push(encode(block.text));
        chunks.push(asciiBytes('\n'));
        chunks.push(new Uint8Array([0x1b, 0x45, 0x00])); // Negrita OFF
        chunks.push(new Uint8Array([0x1d, 0x21, 0x00])); // Tamaño normal
        chunks.push(new Uint8Array([0x1b, 0x61, 0x00])); // Restaurar izquierda
        break;
      }

      case 'text': {
        const alignByte = block.align === 'center' ? 1 : block.align === 'right' ? 2 : 0;
        chunks.push(new Uint8Array([0x1b, 0x61, alignByte]));
        if (block.bold) chunks.push(new Uint8Array([0x1b, 0x45, 0x01]));
        if (block.doubleHeight) chunks.push(new Uint8Array([0x1d, 0x21, 0x01]));

        chunks.push(encode(block.text));
        chunks.push(asciiBytes('\n'));

        if (block.doubleHeight) chunks.push(new Uint8Array([0x1d, 0x21, 0x00]));
        if (block.bold) chunks.push(new Uint8Array([0x1b, 0x45, 0x00]));
        chunks.push(new Uint8Array([0x1b, 0x61, 0x00]));
        break;
      }

      case 'key_value': {
        chunks.push(new Uint8Array([0x1b, 0x61, 0x00])); // Izquierda
        if (block.bold) chunks.push(new Uint8Array([0x1b, 0x45, 0x01]));

        const k = block.key;
        const v = block.value;
        const totalLen = k.length + v.length;
        if (totalLen < cols) {
          const spaces = ' '.repeat(cols - totalLen);
          chunks.push(encode(k + spaces + v));
        } else {
          chunks.push(encode(`${k}: ${v}`));
        }
        chunks.push(asciiBytes('\n'));

        if (block.bold) chunks.push(new Uint8Array([0x1b, 0x45, 0x00]));
        break;
      }

      case 'separator': {
        chunks.push(new Uint8Array([0x1b, 0x61, 0x00]));
        let sepChar = '-';
        if (block.style === 'double') sepChar = '=';
        else if (block.style === 'dashed') sepChar = '- ';

        let sepLine = '';
        if (block.style === 'dashed') {
          sepLine = sepChar.repeat(Math.floor(cols / 2)).slice(0, cols);
        } else {
          sepLine = sepChar.repeat(cols);
        }
        chunks.push(encode(sepLine));
        chunks.push(asciiBytes('\n'));
        break;
      }

      case 'line_item': {
        chunks.push(new Uint8Array([0x1b, 0x61, 0x00]));
        chunks.push(new Uint8Array([0x1b, 0x45, 0x01])); // Negrita ON

        const left = `${block.qty}x ${block.name}`;
        const right = block.price || '';
        if (right) {
          const totalLen = left.length + right.length;
          if (totalLen < cols) {
            const spaces = ' '.repeat(cols - totalLen);
            chunks.push(encode(left + spaces + right));
          } else {
            const availableLeft = cols - right.length - 1;
            if (availableLeft > 5) {
              const shortLeft = left.slice(0, availableLeft);
              const spaces = ' '.repeat(cols - shortLeft.length - right.length);
              chunks.push(encode(shortLeft + spaces + right));
            } else {
              chunks.push(encode(left));
              chunks.push(asciiBytes('\n'));
              chunks.push(encode(' '.repeat(cols - right.length) + right));
            }
          }
        } else {
          chunks.push(encode(left));
        }
        chunks.push(asciiBytes('\n'));
        chunks.push(new Uint8Array([0x1b, 0x45, 0x00])); // Negrita OFF
        break;
      }

      case 'modifier_item': {
        chunks.push(new Uint8Array([0x1b, 0x61, 0x00]));
        if (block.highlighted) {
          chunks.push(new Uint8Array([0x1b, 0x45, 0x01])); // Negrita ON
        }
        const indent = '  ↳ ';
        chunks.push(encode(indent + block.text));
        chunks.push(asciiBytes('\n'));
        if (block.highlighted) {
          chunks.push(new Uint8Array([0x1b, 0x45, 0x00]));
        }
        break;
      }

      case 'totals_block': {
        chunks.push(new Uint8Array([0x1b, 0x61, 0x00]));
        if (block.subtotalUsd) {
          const s = block.subtotalUsd;
          const k = 'SUBTOTAL:';
          chunks.push(encode(k + ' '.repeat(Math.max(1, cols - k.length - s.length)) + s));
          chunks.push(asciiBytes('\n'));
        }
        if (block.discountUsd) {
          const d = block.discountUsd;
          const k = 'DESCUENTO:';
          chunks.push(encode(k + ' '.repeat(Math.max(1, cols - k.length - d.length)) + d));
          chunks.push(asciiBytes('\n'));
        }
        if (block.deliveryUsd) {
          const del = block.deliveryUsd;
          const k = 'DELIVERY:';
          chunks.push(encode(k + ' '.repeat(Math.max(1, cols - k.length - del.length)) + del));
          chunks.push(asciiBytes('\n'));
        }

        chunks.push(encode('='.repeat(cols)));
        chunks.push(asciiBytes('\n'));

        // TOTAL USD en Negrita
        chunks.push(new Uint8Array([0x1b, 0x45, 0x01]));
        const usdKey = 'TOTAL USD:';
        const usdV = block.totalUsd;
        chunks.push(encode(usdKey + ' '.repeat(Math.max(1, cols - usdKey.length - usdV.length)) + usdV));
        chunks.push(asciiBytes('\n'));

        // TOTAL BS en Negrita
        const bsKey = 'TOTAL BS:';
        const bsV = block.totalBs;
        chunks.push(encode(bsKey + ' '.repeat(Math.max(1, cols - bsKey.length - bsV.length)) + bsV));
        chunks.push(asciiBytes('\n'));
        chunks.push(new Uint8Array([0x1b, 0x45, 0x00]));

        if (block.bcvRate) {
          const rateStr = `(${block.bcvRate})`;
          chunks.push(new Uint8Array([0x1b, 0x61, 0x02])); // Derecha
          chunks.push(encode(rateStr));
          chunks.push(asciiBytes('\n'));
          chunks.push(new Uint8Array([0x1b, 0x61, 0x00])); // Izquierda
        }
        break;
      }

      case 'footer': {
        const alignByte = block.align === 'left' ? 0 : block.align === 'right' ? 2 : 1;
        chunks.push(new Uint8Array([0x1b, 0x61, alignByte]));
        for (const line of block.lines) {
          chunks.push(encode(line));
          chunks.push(asciiBytes('\n'));
        }
        chunks.push(new Uint8Array([0x1b, 0x61, 0x00]));
        break;
      }

      case 'cut': {
        if (hasBuzzer) {
          chunks.push(new Uint8Array([0x1b, 0x42, 0x03, 0x03]));
        }

        if (hasCutter) {
          const feed = block.feedLines ?? config?.feedLinesBeforeCut ?? 4;
          chunks.push(new Uint8Array([0x1b, 0x64, feed & 0xff]));
          // GS V 66 0 (Corte parcial con alimentación)
          chunks.push(new Uint8Array([0x1d, 0x56, 0x42, 0x00]));
        } else {
          // Si hasCutter === false (o 0, valor por defecto): PROHIBIDO emitir GS V (0x1D 0x56)
          // Al final del ticket emite únicamente 5 saltos de línea (0x0A x 5)
          chunks.push(new Uint8Array([0x0a, 0x0a, 0x0a, 0x0a, 0x0a]));
        }
        break;
      }
    }
  }

  return concatUint8Arrays(chunks);
}
