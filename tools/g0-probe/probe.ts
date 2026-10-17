/**
 * SISTEMA OPERATIVO LOCAL TOCINETA SONRÍE (Varons Media)
 * GATE G0 - Herramienta de Diagnóstico en Vivo de Impresoras Térmicas 58mm
 *
 * Soporta:
 * - Listado de impresoras de Windows (Get-Printer)
 * - Envío RAW por Spooler de Windows (USB vía raw-spooler.ps1)
 * - Envío directo TCP 9100 con timeout 3000ms (node:net)
 * - Regla graduada de 42 columnas en Fuente A y Fuente B (validación ancho útil 32 col / 384 dots)
 * - Matriz de páginas de códigos ESC t n [0, 2, 16, 19, 850, 1252] con caracteres en español
 * - Impresión de logo raster 1-bit (GS v 0) a 384 dots
 * - Servidor HTTP 0.0.0.0:3000 con dashboard /health para celulares Android en LAN sin internet
 */

import * as net from 'node:net';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// 1. ENCODING HELPERS (Páginas de códigos para español)
// ============================================================================

const SPANISH_STR = 'TOCINETA SONRÍE - JALAPEÑOS - MAÍZ - ñ Ñ á é í ó ú ¡ ¿ $ Bs';

/**
 * Tabla de mapeo para caracteres españoles en CP437
 */
function encodeCP437(str: string): Buffer {
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
        case 'Á': bytes.push(0x41); break; // A
        case 'É': bytes.push(0x90); break;
        case 'Í': bytes.push(0xa1); break; // í
        case 'Ó': bytes.push(0x4f); break; // O
        case 'Ú': bytes.push(0x55); break; // U
        case 'ü': bytes.push(0x81); break;
        case 'Ü': bytes.push(0x9a); break;
        case '¡': bytes.push(0xad); break;
        case '¿': bytes.push(0xa8); break;
        default: bytes.push(0x3f); break; // ?
      }
    }
  }
  return Buffer.from(bytes);
}

/**
 * Tabla de mapeo para caracteres españoles en CP850 / CP858
 */
function encodeCP850(str: string, is858 = false): Buffer {
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
        case '€': bytes.push(is858 ? 0xd5 : 0x43); break;
        default: bytes.push(0x3f); break;
      }
    }
  }
  return Buffer.from(bytes);
}

/**
 * Tabla de mapeo para caracteres españoles en Windows-1252 (WPC1252)
 */
function encodeCP1252(str: string): Buffer {
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
        case 'ñ': bytes.push(0xf1); break;
        case 'Ñ': bytes.push(0xd1); break;
        case 'Á': bytes.push(0xc1); break;
        case 'É': bytes.push(0xc9); break;
        case 'Í': bytes.push(0xcd); break;
        case 'Ó': bytes.push(0xd3); break;
        case 'Ú': bytes.push(0xda); break;
        case 'ü': bytes.push(0xfc); break;
        case 'Ü': bytes.push(0xdc); break;
        case '¡': bytes.push(0xa1); break;
        case '¿': bytes.push(0xbf); break;
        case '€': bytes.push(0x80); break;
        default: bytes.push(0x3f); break;
      }
    }
  }
  return Buffer.from(bytes);
}

// ============================================================================
// 2. GENERADOR DE LOGO RASTER 1-BIT (GS v 0) - 384x96 PUNTOS (ANCHO 58mm)
// ============================================================================

/**
 * Matriz 5x7 compacta para caracteres ASCII básicos del logotipo
 */
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
  readonly bytesPerRow = 48; // 384 / 8
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

  drawRect(x: number, y: number, w: number, h: number, value: 0 | 1 = 1) {
    this.drawHLine(x, y, w, value);
    this.drawHLine(x, y + h - 1, w, value);
    this.drawVLine(x, y, h, value);
    this.drawVLine(x + w - 1, y, h, value);
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

  toRasterCommand(): Buffer {
    // Comando ESC/POS GS v 0 m xL xH yL yH d1...dk
    const m = 0; // Modo normal
    const xL = this.bytesPerRow & 0xff; // 48
    const xH = (this.bytesPerRow >> 8) & 0xff; // 0
    const yL = this.height & 0xff; // 96
    const yH = (this.height >> 8) & 0xff; // 0
    const header = Buffer.from([0x1d, 0x76, 0x30, m, xL, xH, yL, yH]);
    return Buffer.concat([header, Buffer.from(this.data)]);
  }
}

/**
 * Genera el logo oficial de Tocineta Sonríe para 58mm (384 dots)
 */
function generateTocinetaLogo(): Buffer {
  const bmp = new MonochromeBitmap();

  // Borde exterior superior e inferior (evaluación de extremos del cabezal térmico)
  bmp.drawHLine(0, 0, 384, 1);
  bmp.drawHLine(0, 1, 384, 1);
  bmp.drawHLine(0, 94, 384, 1);
  bmp.drawHLine(0, 95, 384, 1);

  // Marcadores de bordes en dot 0 y dot 383
  bmp.drawVLine(0, 0, 96, 1);
  bmp.drawVLine(1, 0, 96, 1);
  bmp.drawVLine(382, 0, 96, 1);
  bmp.drawVLine(383, 0, 96, 1);

  // Marcadores de graduación cada 48 dots (48, 96, 144, 192, 240, 288, 336)
  for (let d = 48; d < 384; d += 48) {
    bmp.drawVLine(d, 0, 5, 1);
    bmp.drawVLine(d, 91, 5, 1);
  }

  // Banda invertida central para el título principal
  // Ancho 350 px centrado (de x=17 a x=367), altura 26 px (de y=10 a y=36)
  bmp.fillRect(16, 8, 352, 28, 1);

  // Texto invertido en grande (scale 3): "TOCINETA SONRIE"
  // Letras: 15 chars * (15px + 3px) = 270px aprox
  // xOffset = (384 - 267) / 2 = 58
  bmp.drawText('TOCINETA SONRIE', 58, 12, 3, true);

  // Mascota: Tira de tocineta ondulada con sonrisa en el centro
  // Ondulación de tocineta: 3 bandas sinuosas entre x=140 y x=244
  for (let x = 135; x <= 249; x++) {
    const wave = Math.round(Math.sin((x - 135) * 0.12) * 4);
    // Franja 1
    bmp.fillRect(x, 48 + wave, 1, 4, 1);
    // Franja 2
    bmp.fillRect(x, 56 + wave, 1, 5, 1);
    // Franja 3
    bmp.fillRect(x, 65 + wave, 1, 4, 1);
  }

  // Ojos y sonrisa en la tocineta central
  // Ojo izquierdo y derecho
  bmp.fillRect(180, 52, 3, 3, 1);
  bmp.fillRect(202, 52, 3, 3, 1);
  // Sonrisa alegre curvada
  bmp.fillRect(183, 60, 2, 2, 1);
  bmp.fillRect(185, 62, 14, 2, 1);
  bmp.fillRect(199, 60, 2, 2, 1);

  // Estrellas decorativas a la izquierda y derecha
  bmp.drawText('* *', 55, 52, 2, false);
  bmp.drawText('* *', 290, 52, 2, false);

  // Subtítulo inferior: "* FOOD TRUCK - SISTEMA LOCAL *"
  bmp.drawText('* FOOD TRUCK - SISTEMA LOCAL *', 50, 78, 1, false);

  return bmp.toRasterCommand();
}

// ============================================================================
// 3. CONSTRUCTOR DEL TICKET DE DIAGNÓSTICO GATE G0
// ============================================================================

export interface TicketOptions {
  targetName: string;
  targetType: 'USB' | 'TCP';
  ipAddress?: string;
}

/**
 * Genera el paquete completo de bytes binarios ESC/POS para Gate G0
 */
export function buildG0Ticket(opts: TicketOptions): Buffer {
  const chunks: Buffer[] = [];

  // Reset e inicialización de impresora
  chunks.push(Buffer.from([0x1b, 0x40])); // ESC @ (Initialize)

  // 1. LOGO RASTER MONOCROMO 1-BIT (GS v 0) - 384x96 dots
  chunks.push(generateTocinetaLogo());
  chunks.push(Buffer.from('\n\n', 'ascii'));

  // Centrado de texto
  chunks.push(Buffer.from([0x1b, 0x61, 0x01])); // ESC a 1 (Center)

  // Título de diagnóstico
  chunks.push(Buffer.from([0x1b, 0x45, 0x01])); // ESC E 1 (Bold ON)
  chunks.push(Buffer.from('*** GATE G0: HARDWARE PROBE ***\n', 'ascii'));
  chunks.push(Buffer.from([0x1b, 0x45, 0x00])); // ESC E 0 (Bold OFF)

  const timestamp = new Date().toLocaleString('es-VE', { hour12: false });
  chunks.push(Buffer.from(`CANAL: ${opts.targetType} [${opts.targetName}]\n`, 'ascii'));
  chunks.push(Buffer.from(`FECHA: ${timestamp}\n`, 'ascii'));
  chunks.push(Buffer.from('--------------------------------\n', 'ascii')); // 32 caracteres

  // Alinear a la izquierda
  chunks.push(Buffer.from([0x1b, 0x61, 0x00])); // ESC a 0 (Left)

  // --------------------------------------------------------------------------
  // SECCIÓN 1: REGLA GRADUADA DE 42 COLUMNAS (Validar 32 col vs 42 col)
  // --------------------------------------------------------------------------
  chunks.push(Buffer.from([0x1b, 0x45, 0x01]));
  chunks.push(Buffer.from('\n[1] REGLA DE COLUMNAS (58mm)\n', 'ascii'));
  chunks.push(Buffer.from([0x1b, 0x45, 0x00]));
  chunks.push(Buffer.from('Evalua ancho util y corte fisico:\n', 'ascii'));

  // Fuente A (Estándar 12x24 dots -> normalmente 32 columnas en 384 dots)
  chunks.push(Buffer.from([0x1b, 0x4d, 0x00])); // ESC M 0 (Font A)
  chunks.push(Buffer.from('--- FUENTE A (12x24 - Ref 32 col) ---\n', 'ascii'));
  chunks.push(Buffer.from('123456789012345678901234567890123456789012\n', 'ascii'));
  chunks.push(Buffer.from('|---10---|---20---|---30--|2|---40---|\n', 'ascii'));
  chunks.push(Buffer.from('[<- ANCHO UTIL 32 COL ->| DESBORDE >]\n', 'ascii'));

  // Fuente B (Comprimida 9x17/24 dots -> normalmente 42 columnas en 384 dots)
  chunks.push(Buffer.from([0x1b, 0x4d, 0x01])); // ESC M 1 (Font B)
  chunks.push(Buffer.from('--- FUENTE B (9x17/24 - Ref 42 col) ---\n', 'ascii'));
  chunks.push(Buffer.from('123456789012345678901234567890123456789012\n', 'ascii'));
  chunks.push(Buffer.from('|---10---|---20---|---30---|---40---|42|\n', 'ascii'));

  // Restaurar a Fuente A
  chunks.push(Buffer.from([0x1b, 0x4d, 0x00])); // ESC M 0

  // --------------------------------------------------------------------------
  // SECCIÓN 2: MATRIZ DE PÁGINAS DE CÓDIGOS (ESC t n)
  // --------------------------------------------------------------------------
  chunks.push(Buffer.from([0x1b, 0x45, 0x01]));
  chunks.push(Buffer.from('\n[2] MATRIZ CODEPAGES (ESP)\n', 'ascii'));
  chunks.push(Buffer.from([0x1b, 0x45, 0x00]));
  chunks.push(Buffer.from('Cadena de prueba:\n', 'ascii'));
  chunks.push(Buffer.from('"TOCINETA SONRIE - JALAPENOS\n MAIZ - n N a e i o u ! ? $ Bs"\n\n', 'ascii'));

  const codepageTests: Array<{ n: number; name: string; encoder: (s: string) => Buffer }> = [
    { n: 0, name: 'PC437 (Standard Europe/USA)', encoder: encodeCP437 },
    { n: 2, name: 'PC850 (Multilingual Latin I)', encoder: encodeCP850 },
    { n: 16, name: 'WPC1252 (Windows Latin 1)', encoder: encodeCP1252 },
    { n: 19, name: 'PC858 (Euro / Latin I)', encoder: (s) => encodeCP850(s, true) },
    { n: 850, name: 'CP850 Direct (0x52)', encoder: encodeCP850 },
    { n: 1252, name: 'CP1252 Direct (0xE4)', encoder: encodeCP1252 }
  ];

  for (const cp of codepageTests) {
    const byteN = cp.n & 0xff;
    // Comando ESC t n
    chunks.push(Buffer.from([0x1b, 0x74, byteN]));
    chunks.push(Buffer.from(`[ESC t ${cp.n}] -> ${cp.name}:\n`, 'ascii'));

    // Envío con codificación de tabla
    const encodedPayload = cp.encoder(SPANISH_STR);
    chunks.push(encodedPayload);
    chunks.push(Buffer.from('\n', 'ascii'));

    // Envío de la misma línea en UTF-8 para detectar soporte UTF-8 nativo
    chunks.push(Buffer.from(`[UTF-8 raw]: `, 'ascii'));
    chunks.push(Buffer.from(SPANISH_STR, 'utf8'));
    chunks.push(Buffer.from('\n- - - - - - - - - - - - - - - -\n', 'ascii'));
  }

  // --------------------------------------------------------------------------
  // SECCIÓN 3: PRUEBA DE ESTILOS Y DENSIDAD TÉRMICA
  // --------------------------------------------------------------------------
  chunks.push(Buffer.from([0x1b, 0x45, 0x01]));
  chunks.push(Buffer.from('\n[3] PRUEBA DE ESTILOS Y CALOR\n', 'ascii'));
  chunks.push(Buffer.from([0x1b, 0x45, 0x00]));

  // Negrita
  chunks.push(Buffer.from([0x1b, 0x45, 0x01]));
  chunks.push(Buffer.from('TEXTO EN NEGRITA (BOLD)\n', 'ascii'));
  chunks.push(Buffer.from([0x1b, 0x45, 0x00]));

  // Subrayado
  chunks.push(Buffer.from([0x1b, 0x2d, 0x01])); // ESC - 1
  chunks.push(Buffer.from('TEXTO SUBRAYADO (UNDERLINE)\n', 'ascii'));
  chunks.push(Buffer.from([0x1b, 0x2d, 0x00])); // ESC - 0

  // Modo invertido (blanco sobre negro)
  chunks.push(Buffer.from([0x1d, 0x42, 0x01])); // GS B 1
  chunks.push(Buffer.from(' MODO INVERTIDO (DENSIDAD) \n', 'ascii'));
  chunks.push(Buffer.from([0x1d, 0x42, 0x00])); // GS B 0

  // Doble ancho y alto
  chunks.push(Buffer.from([0x1d, 0x21, 0x11])); // GS ! 0x11
  chunks.push(Buffer.from('DOBLE TAMAÑO\n', 'ascii'));
  chunks.push(Buffer.from([0x1d, 0x21, 0x00])); // GS ! 0x00

  // --------------------------------------------------------------------------
  // SECCIÓN 4: PITIDO Y CORTE
  // --------------------------------------------------------------------------
  chunks.push(Buffer.from('\n================================\n', 'ascii'));
  chunks.push(Buffer.from('   FIN DIAGNOSTICO GATE G0\n', 'ascii'));
  chunks.push(Buffer.from('================================\n', 'ascii'));

  // Alimentación previa al corte para despejar cuchilla/dientes
  chunks.push(Buffer.from([0x1b, 0x64, 0x04])); // ESC d 4 (Feed 4 lines)

  // Pitido / Zumbador (Beeper)
  // ESC B 3 2 (3 pitidos de 200ms) + BEL (0x07)
  chunks.push(Buffer.from([0x1b, 0x42, 0x03, 0x02, 0x07]));

  // Corte de papel (GS V 66 0: Corte parcial con alimentación)
  chunks.push(Buffer.from([0x1d, 0x56, 0x42, 0x00]));

  return Buffer.concat(chunks);
}

/**
 * Genera el paquete mínimo solo para Probar Pitido y Corte
 */
export function buildBeepAndCutTicket(): Buffer {
  const chunks: Buffer[] = [];
  chunks.push(Buffer.from([0x1b, 0x40])); // Reset
  chunks.push(Buffer.from('\n--- TEST PITIDO Y CORTE ---\n', 'ascii'));
  chunks.push(Buffer.from(`HORA: ${new Date().toLocaleTimeString('es-VE')}\n`, 'ascii'));
  chunks.push(Buffer.from('TOCINETA SONRIE - GATE G0\n\n', 'ascii'));
  chunks.push(Buffer.from([0x1b, 0x64, 0x04])); // Feed 4 lines
  chunks.push(Buffer.from([0x1b, 0x42, 0x03, 0x02, 0x07])); // Beep
  chunks.push(Buffer.from([0x1d, 0x56, 0x42, 0x00])); // Cut
  return Buffer.concat(chunks);
}

// ============================================================================
// 4. COMUNICACIÓN HARDWARE: WIN32 SPOOLER RAW (USB) Y TCP 9100 (LAN)
// ============================================================================

export interface WindowsPrinter {
  Name: string;
  PortName: string;
  DriverName: string;
  PrinterStatus?: number;
}

/**
 * Lista las impresoras instaladas en Windows mediante Get-Printer
 */
export async function listWindowsPrinters(): Promise<WindowsPrinter[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-Printer | Select-Object Name, PortName, DriverName, PrinterStatus | ConvertTo-Json -Compress'
      ],
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(stderr.trim() || err.message));
        }
        try {
          const raw = stdout.trim();
          if (!raw) return resolve([]);
          const parsed = JSON.parse(raw);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          resolve(list);
        } catch (parseErr: any) {
          reject(new Error(`Error parseando lista de impresoras: ${parseErr.message} (Salida: ${stdout})`));
        }
      }
    );
  });
}

/**
 * Envía bytes binarios en modo RAW al spooler de Windows mediante raw-spooler.ps1
 */
export async function sendUsbSpooler(printerName: string, payload: Buffer): Promise<{ success: boolean; bytesWritten: number; message: string }> {
  const tempFile = path.join(os.tmpdir(), `g0_probe_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.bin`);
  const psScript = path.resolve(__dirname, 'raw-spooler.ps1');

  try {
    await fsp.writeFile(tempFile, payload);

    return await new Promise((resolve, reject) => {
      execFile(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy', 'Bypass',
          '-File', psScript,
          '-PrinterName', printerName,
          '-FilePath', tempFile,
          '-DocName', 'TocinetaSonrie_G0_Probe'
        ],
        (err, stdout, stderr) => {
          if (err) {
            try {
              const match = (stderr + ' ' + stdout).match(/\{.*?"Success"\s*:\s*false.*?\}/s);
              if (match) {
                const parsed = JSON.parse(match[0]);
                return reject(new Error(parsed.ErrorMessage || err.message));
              }
            } catch {
              // fallback
            }
            return reject(new Error(stderr.trim() || stdout.trim() || err.message));
          }
          try {
            const parsed = JSON.parse(stdout.trim());
            resolve({
              success: true,
              bytesWritten: parsed.BytesWritten ?? payload.length,
              message: `Impresión RAW completada: ${parsed.BytesWritten ?? payload.length} bytes enviados a '${printerName}'.`
            });
          } catch {
            resolve({
              success: true,
              bytesWritten: payload.length,
              message: stdout.trim() || 'Bytes enviados correctamente al spooler de Windows.'
            });
          }
        }
      );
    });
  } finally {
    await fsp.unlink(tempFile).catch(() => {});
  }
}

/**
 * Envía bytes binarios directamente a una impresora térmica por TCP 9100 con timeout de 3000ms
 */
export async function sendTcpSocket(host: string, port = 9100, payload: Buffer, timeoutMs = 3000): Promise<{ success: boolean; bytesSent: number; latencyMs: number }> {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let finished = false;

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      socket.write(payload, () => {
        // Breve pausa para asegurar vaciado del buffer de salida TCP
        setTimeout(() => {
          socket.end();
          if (!finished) {
            finished = true;
            resolve({
              success: true,
              bytesSent: payload.length,
              latencyMs: Date.now() - startTime
            });
          }
        }, 150);
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      if (!finished) {
        finished = true;
        reject(new Error(`Timeout de conexión TCP a ${host}:${port} (${timeoutMs} ms)`));
      }
    });

    socket.on('error', (err) => {
      if (!finished) {
        finished = true;
        reject(new Error(`Error TCP en ${host}:${port}: ${err.message}`));
      }
    });

    socket.on('close', () => {
      if (!finished) {
        finished = true;
        resolve({
          success: true,
          bytesSent: payload.length,
          latencyMs: Date.now() - startTime
        });
      }
    });

    socket.connect(port, host);
  });
}

// ============================================================================
// 5. SERVIDOR HTTP 0.0.0.0:3000 CON DASHBOARD /health Y PROBING MOVIL
// ============================================================================

/**
 * Obtiene todas las direcciones IPv4 locales de la máquina
 */
function getLocalIpv4Addresses(): string[] {
  const ifaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

/**
 * Genera el HTML autocontenido (sin CDNs, apto para LAN sin internet)
 */
function renderDashboardHtml(ips: string[], serverTime: string, printers: WindowsPrinter[]): string {
  const ipListBadges = ips.length > 0
    ? ips.map(ip => `<span class="badge ip-badge">http://${ip}:3000/health</span>`).join(' ')
    : '<span class="badge warning-badge">No se detectó IP LAN externa</span>';

  const printerOptions = printers.length > 0
    ? printers.map(p => `<option value="${p.Name}">${p.Name} (${p.PortName})</option>`).join('')
    : '<option value="">(No se detectaron impresoras instaladas)</option>';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Tocineta Sonríe | Gate G0 Probe</title>
  <style>
    :root {
      --bg: #0f1115;
      --card-bg: #181b22;
      --card-border: #262c38;
      --accent-red: #ff3b30;
      --accent-amber: #ff9500;
      --accent-green: #34c759;
      --accent-blue: #0a84ff;
      --text-main: #f5f5f7;
      --text-muted: #8e8e93;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      padding: 16px;
      line-height: 1.4;
      min-height: 100vh;
    }
    .container { max-width: 600px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 20px; }
    .logo-badge {
      display: inline-block;
      background: linear-gradient(135deg, #ff3b30, #ff9500);
      color: white;
      font-weight: 900;
      font-size: 14px;
      letter-spacing: 1px;
      padding: 6px 14px;
      border-radius: 20px;
      margin-bottom: 8px;
      text-transform: uppercase;
      box-shadow: 0 4px 12px rgba(255, 59, 48, 0.3);
    }
    h1 { font-size: 24px; font-weight: 800; margin-bottom: 4px; }
    p.subtitle { color: var(--text-muted); font-size: 14px; }
    
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 18px;
      margin-bottom: 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    }
    .card-title {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--accent-amber);
      font-weight: 700;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      font-size: 14px;
    }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: var(--text-muted); }
    .info-val { font-weight: 600; text-align: right; }

    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      font-family: monospace;
    }
    .ip-badge { background: #1c2b3d; color: var(--accent-blue); border: 1px solid #23456b; }
    .warning-badge { background: #3d2b1c; color: var(--accent-amber); }
    .status-ok { color: var(--accent-green); }

    .form-group { margin-bottom: 14px; }
    label { display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 6px; font-weight: 600; }
    select, input[type="text"] {
      width: 100%;
      background: #0f1115;
      border: 1px solid var(--card-border);
      color: var(--text-main);
      padding: 12px;
      border-radius: 8px;
      font-size: 15px;
      outline: none;
      transition: border-color 0.2s;
    }
    select:focus, input[type="text"]:focus { border-color: var(--accent-amber); }

    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      background: #0f1115;
      padding: 4px;
      border-radius: 10px;
    }
    .tab-btn {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 10px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab-btn.active {
      background: var(--card-bg);
      color: var(--text-main);
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }

    /* BOTONES GIGANTES TOUCH */
    .btn-action {
      display: block;
      width: 100%;
      border: none;
      border-radius: 12px;
      padding: 18px 20px;
      font-size: 17px;
      font-weight: 800;
      text-align: center;
      cursor: pointer;
      margin-bottom: 12px;
      transition: transform 0.1s, filter 0.2s, box-shadow 0.2s;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    .btn-action:active { transform: scale(0.97); }
    .btn-beep {
      background: linear-gradient(135deg, #ff3b30, #ff9500);
      color: white;
      box-shadow: 0 6px 18px rgba(255, 59, 48, 0.4);
    }
    .btn-ticket {
      background: #262c38;
      color: var(--text-main);
      border: 1px solid rgba(255,255,255,0.1);
    }
    .btn-ticket:hover { background: #323948; }

    /* FEEDBACK STATUS */
    #statusBox {
      display: none;
      padding: 14px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      margin-top: 14px;
      animation: fadeIn 0.3s ease;
    }
    #statusBox.success { background: rgba(52, 199, 89, 0.15); border: 1px solid var(--accent-green); color: #72e88f; }
    #statusBox.error { background: rgba(255, 59, 48, 0.15); border: 1px solid var(--accent-red); color: #ff8580; }
    #statusBox.loading { background: rgba(10, 132, 255, 0.15); border: 1px solid var(--accent-blue); color: #82b9ff; }

    @keyframes fadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }

    footer {
      text-align: center;
      margin-top: 24px;
      font-size: 12px;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo-badge">Varons Media • Hardware Gate</div>
      <h1>Tocineta Sonríe</h1>
      <p class="subtitle">Gate G0: Diagnóstico en Vivo de Impresoras Térmicas</p>
    </header>

    <!-- ESTADO DEL SERVIDOR -->
    <div class="card">
      <div class="card-title">📡 Estado del Servidor Local</div>
      <div class="info-row">
        <span class="info-label">Estado de Red</span>
        <span class="info-val status-ok">● ACTIVO (0.0.0.0:3000)</span>
      </div>
      <div class="info-row">
        <span class="info-label">IPs Disponibles (LAN)</span>
        <span class="info-val">${ipListBadges}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Hora del Servidor</span>
        <span class="info-val" id="srvTime">${serverTime}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Impresoras Detectadas</span>
        <span class="info-val">${printers.length} en Spooler</span>
      </div>
    </div>

    <!-- SELECTOR DE CANAL (USB vs TCP) -->
    <div class="card">
      <div class="card-title">🎛️ Destino de Impresión</div>
      
      <div class="tabs">
        <button type="button" class="tab-btn active" id="tabUsb" onclick="switchChannel('usb')">USB (Spooler RAW)</button>
        <button type="button" class="tab-btn" id="tabTcp" onclick="switchChannel('tcp')">TCP / LAN (Port 9100)</button>
      </div>

      <!-- Configuración USB -->
      <div id="cfgUsb">
        <div class="form-group">
          <label for="printerSelect">Seleccionar Impresora Windows:</label>
          <select id="printerSelect">
            ${printerOptions}
          </select>
        </div>
      </div>

      <!-- Configuración TCP -->
      <div id="cfgTcp" style="display: none;">
        <div class="form-group">
          <label for="tcpHost">Dirección IP de la Impresora (LAN):</label>
          <input type="text" id="tcpHost" value="192.168.31.200" placeholder="Ej: 192.168.31.200">
        </div>
        <div class="form-group">
          <label for="tcpPort">Puerto RAW ESC/POS:</label>
          <input type="text" id="tcpPort" value="9100" placeholder="9100">
        </div>
      </div>
    </div>

    <!-- BOTONES DE ACCIÓN GIGANTES -->
    <div>
      <button type="button" class="btn-action btn-beep" id="btnBeep" onclick="triggerAction('beep-cut')">
        🔔 PROBAR PITIDO Y CORTE
      </button>

      <button type="button" class="btn-action btn-ticket" id="btnTicket" onclick="triggerAction('full-ticket')">
        📄 IMPRIMIR TICKET COMPLETO G0 (Logo + Regla + Codepages)
      </button>

      <div id="statusBox"></div>
    </div>

    <footer>
      Tocineta Sonríe • Sistema Operativo Local • Modo 100% Offline
    </footer>
  </div>

  <script>
    let activeChannel = 'usb';

    function switchChannel(channel) {
      activeChannel = channel;
      document.getElementById('tabUsb').classList.toggle('active', channel === 'usb');
      document.getElementById('tabTcp').classList.toggle('active', channel === 'tcp');
      document.getElementById('cfgUsb').style.display = channel === 'usb' ? 'block' : 'none';
      document.getElementById('cfgTcp').style.display = channel === 'tcp' ? 'block' : 'none';
    }

    async function triggerAction(action) {
      const statusBox = document.getElementById('statusBox');
      const btnBeep = document.getElementById('btnBeep');
      const btnTicket = document.getElementById('btnTicket');

      statusBox.style.display = 'block';
      statusBox.className = 'loading';
      statusBox.innerText = '⏳ Enviando comando a la impresora...';
      btnBeep.disabled = true;
      btnTicket.disabled = true;

      const payload = {
        action: action,
        channel: activeChannel,
        printer: document.getElementById('printerSelect').value,
        host: document.getElementById('tcpHost').value.trim(),
        port: parseInt(document.getElementById('tcpPort').value.trim() || '9100', 10)
      };

      try {
        const res = await fetch('/api/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok && data.success) {
          statusBox.className = 'success';
          statusBox.innerHTML = '✅ <b>Comando ejecutado:</b> ' + (data.message || 'Señal recibida en impresora') + ' (' + (data.latencyMs || 0) + ' ms)';
        } else {
          statusBox.className = 'error';
          statusBox.innerHTML = '❌ <b>Error:</b> ' + (data.error || 'Fallo desconocido al imprimir');
        }
      } catch (err) {
        statusBox.className = 'error';
        statusBox.innerHTML = '❌ <b>Error de red:</b> ' + err.message;
      } finally {
        btnBeep.disabled = false;
        btnTicket.disabled = false;
      }
    }
  </script>
</body>
</html>`;
}

/**
 * Inicia el servidor HTTP de diagnóstico en 0.0.0.0:3000
 */
export function startHealthServer(port = 3000): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // Endpoint GET /health y GET /
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      const acceptsJson = req.headers.accept?.includes('application/json') || url.searchParams.get('format') === 'json';
      const ips = getLocalIpv4Addresses();
      const serverTime = new Date().toLocaleString('es-VE', { hour12: false });
      let printers: WindowsPrinter[] = [];

      try {
        printers = await listWindowsPrinters();
      } catch {
        // En caso de error o entorno no windows
      }

      if (acceptsJson) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          status: 'ok',
          service: 'Tocineta Sonrie - Gate G0 Probe',
          serverTime,
          ips,
          printers,
          uptimeSec: Math.floor(process.uptime()),
          nodeVersion: process.version
        }, null, 2));
      } else {
        const html = renderDashboardHtml(ips, serverTime, printers);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      }
      return;
    }

    // Endpoint POST /api/test
    if (req.method === 'POST' && url.pathname === '/api/test') {
      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk; });
      req.on('end', async () => {
        try {
          const body = JSON.parse(bodyStr || '{}');
          const isFullTicket = body.action === 'full-ticket';
          const channel = body.channel === 'tcp' ? 'TCP' : 'USB';
          const printer = body.printer || '';
          const host = body.host || '192.168.31.200';
          const portNum = Number(body.port) || 9100;

          const payload = isFullTicket
            ? buildG0Ticket({ targetType: channel, targetName: channel === 'USB' ? printer : `${host}:${portNum}` })
            : buildBeepAndCutTicket();

          const startTime = Date.now();

          if (channel === 'USB') {
            if (!printer) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ success: false, error: 'Debe especificar el nombre de la impresora Windows.' }));
            }
            const usbResult = await sendUsbSpooler(printer, payload);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              success: true,
              message: usbResult.message,
              latencyMs: Date.now() - startTime,
              bytesSent: usbResult.bytesWritten
            }));
          } else {
            const tcpResult = await sendTcpSocket(host, portNum, payload);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              success: true,
              message: `Enviados ${tcpResult.bytesSent} bytes a ${host}:${portNum} por TCP 9100.`,
              latencyMs: tcpResult.latencyMs,
              bytesSent: tcpResult.bytesSent
            }));
          }
        } catch (execErr: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            error: execErr.message || 'Error desconocido al procesar comando.'
          }));
        }
      });
      return;
    }

    // Endpoint GET /api/printers
    if (req.method === 'GET' && url.pathname === '/api/printers') {
      try {
        const list = await listWindowsPrinters();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, printers: list }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // 404 por defecto
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Ruta no encontrada');
  });

  server.listen(port, '0.0.0.0', () => {
    const ips = getLocalIpv4Addresses();
    console.log(`\n========================================================`);
    console.log(`🚀 SERVIDOR GATE G0 ACTIVO EN 0.0.0.0:${port}`);
    console.log(`========================================================`);
    console.log(`Dashboard Web para Celulares Android (sin internet):`);
    for (const ip of ips) {
      console.log(`   👉 http://${ip}:${port}/health`);
    }
    console.log(`   👉 http://localhost:${port}/health`);
    console.log(`========================================================\n`);
  });

  return server;
}

// ============================================================================
// 6. ENTRADA PRINCIPAL (CLI RUNNER)
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Modo --list: listar impresoras Windows
  if (args.includes('--list')) {
    console.log('\n🔍 Consultando impresoras instaladas en Windows (Get-Printer)...');
    try {
      const printers = await listWindowsPrinters();
      if (printers.length === 0) {
        console.log('⚠️ No se detectaron impresoras registradas en este equipo.');
        return;
      }
      console.log(`\nSe encontraron ${printers.length} impresora(s):\n`);
      console.log('-------------------------------------------------------------------------------------');
      console.log(`${'NOMBRE'.padEnd(35)} | ${'PUERTO'.padEnd(20)} | DRIVER`);
      console.log('-------------------------------------------------------------------------------------');
      for (const p of printers) {
        console.log(`${p.Name.padEnd(35)} | ${p.PortName.padEnd(20)} | ${p.DriverName}`);
      }
      console.log('-------------------------------------------------------------------------------------\n');
      console.log('💡 Para probar una impresora USB por Spooler RAW ejecuta:');
      console.log(`   pnpm tsx tools/g0-probe/probe.ts --usb "${printers[0].Name}"\n`);
    } catch (err: any) {
      console.error(`❌ Error al obtener impresoras: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // Modo --usb <NombreImpresora>
  const usbIdx = args.indexOf('--usb');
  if (usbIdx !== -1) {
    const printerName = args[usbIdx + 1];
    if (!printerName) {
      console.error('❌ Debe indicar el nombre de la impresora. Ejemplo: --usb "DP58U-03"');
      process.exit(1);
    }
    console.log(`\n📦 Generando ticket de prueba Gate G0 para USB [${printerName}]...`);
    const payload = buildG0Ticket({ targetType: 'USB', targetName: printerName });
    console.log(`📤 Enviando ${payload.length} bytes binarios ESC/POS vía winspool.Drv (modo RAW)...`);
    try {
      const res = await sendUsbSpooler(printerName, payload);
      console.log(`✅ ${res.message}`);
    } catch (err: any) {
      console.error(`❌ Error en envío USB Spooler: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // Modo --tcp <host:port> o <host>
  const tcpIdx = args.indexOf('--tcp');
  if (tcpIdx !== -1) {
    const rawTarget = args[tcpIdx + 1];
    if (!rawTarget) {
      console.error('❌ Debe indicar la dirección IP. Ejemplo: --tcp "192.168.31.200:9100"');
      process.exit(1);
    }
    const parts = rawTarget.split(':');
    const host = parts[0];
    const port = parts[1] ? parseInt(parts[1], 10) : 9100;

    console.log(`\n📦 Generando ticket de prueba Gate G0 para TCP [${host}:${port}]...`);
    const payload = buildG0Ticket({ targetType: 'TCP', targetName: `${host}:${port}`, ipAddress: host });
    console.log(`🌐 Conectando por socket TCP a ${host}:${port} (Timeout: 3000ms)...`);
    try {
      const res = await sendTcpSocket(host, port, payload, 3000);
      console.log(`✅ Envío TCP completado: ${res.bytesSent} bytes transmitidos en ${res.latencyMs} ms.`);
    } catch (err: any) {
      console.error(`❌ Fallo en conexión TCP: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // Si se solicita --server o ningún argumento, iniciar el servidor HTTP
  const portIdx = args.indexOf('--port');
  const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3000;
  startHealthServer(port);
}

// Ejecutar main si se invoca directamente
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
  });
}
