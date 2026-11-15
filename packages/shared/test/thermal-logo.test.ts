import { describe, it, expect } from 'vitest';
import {
  THERMAL_LOGO_WIDTH,
  THERMAL_LOGO_HEIGHT,
  THERMAL_LOGO_RASTER_B64
} from '../src/thermal-logo.js';

describe('Thermal Logo ESC/POS Raster (@tocineta/shared)', () => {
  it('exporta constantes válidas para ancho y alto de cabecera térmica', () => {
    expect(THERMAL_LOGO_WIDTH).toBe(384);
    expect(THERMAL_LOGO_HEIGHT).toBeGreaterThan(0);
    expect(typeof THERMAL_LOGO_RASTER_B64).toBe('string');
    expect(THERMAL_LOGO_RASTER_B64.length).toBeGreaterThan(0);
  });

  it('decodifica el raster base64 y comprueba la cabecera ESC/POS GS v 0 (1D 76 30 00)', () => {
    const buffer = Buffer.from(THERMAL_LOGO_RASTER_B64, 'base64');

    // Comando ESC/POS GS v 0 m (1D 76 30 00)
    expect(buffer[0]).toBe(0x1d);
    expect(buffer[1]).toBe(0x76);
    expect(buffer[2]).toBe(0x30);
    expect(buffer[3]).toBe(0x00); // Modo normal
  });

  it('configura 48 bytes por fila (384 puntos) y altura coincidente con THERMAL_LOGO_HEIGHT', () => {
    const buffer = Buffer.from(THERMAL_LOGO_RASTER_B64, 'base64');

    // xL xH: bytes horizontales = 48 (48 * 8 = 384 puntos)
    const xL = buffer[4];
    const xH = buffer[5];
    const bytesPerRow = xL + xH * 256;
    expect(bytesPerRow).toBe(48);
    expect(bytesPerRow).toBe(THERMAL_LOGO_WIDTH / 8);

    // yL yH: puntos verticales (alto en puntos)
    const yL = buffer[6];
    const yH = buffer[7];
    const rasterHeight = yL + yH * 256;
    expect(rasterHeight).toBe(THERMAL_LOGO_HEIGHT);
  });

  it('la longitud total del buffer binario cumple exactamente 8 + 48 * alto', () => {
    const buffer = Buffer.from(THERMAL_LOGO_RASTER_B64, 'base64');
    const expectedLength = 8 + 48 * THERMAL_LOGO_HEIGHT;

    expect(buffer.length).toBe(expectedLength);
  });

  it('el cuerpo raster contiene datos gráficos y no es una imagen vacía de ceros', () => {
    const buffer = Buffer.from(THERMAL_LOGO_RASTER_B64, 'base64');
    const dataBytes = buffer.subarray(8);

    // Debe contener píxeles negros impresos (bits en 1 / bytes > 0)
    const nonZeroCount = dataBytes.filter((b) => b !== 0).length;
    expect(nonZeroCount).toBeGreaterThan(0);

    // Tampoco debe ser todo bloques sólidos 0xFF
    const hasWhiteDots = dataBytes.some((b) => b !== 0xff);
    expect(hasWhiteDots).toBe(true);
  });
});
