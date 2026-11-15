import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT_DIR = process.cwd();
const DEFAULT_INPUT = path.join(ROOT_DIR, 'docs', 'branding', 'logo-tocineta-thermal.png');
const DEFAULT_OUTPUT = path.join(ROOT_DIR, 'packages', 'shared', 'src', 'thermal-logo.ts');
const TARGET_WIDTH = 384; // Ancho para papel de 58 mm (384 puntos / 48 bytes por fila)

function parseArgs() {
  const args = process.argv.slice(2);
  let inputPath = DEFAULT_INPUT;
  let outputPath = DEFAULT_OUTPUT;
  let previewPath = null;
  let generatePreview = false;

  for (const arg of args) {
    if (arg === '--preview') {
      generatePreview = true;
      previewPath = path.join(ROOT_DIR, 'docs', 'branding', 'logo-tocineta-thermal-preview.png');
    } else if (arg.startsWith('--preview=')) {
      generatePreview = true;
      previewPath = path.resolve(ROOT_DIR, arg.slice('--preview='.length));
    } else if (arg.startsWith('--out=')) {
      outputPath = path.resolve(ROOT_DIR, arg.slice('--out='.length));
    } else if (!arg.startsWith('--')) {
      inputPath = path.resolve(ROOT_DIR, arg);
    }
  }

  return { inputPath, outputPath, generatePreview, previewPath };
}

async function main() {
  const { inputPath, outputPath, generatePreview, previewPath } = parseArgs();

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Imagen de entrada no encontrada en: ${inputPath}`);
    process.exit(1);
  }

  console.log(`[brand:thermal] Procesando imagen fuente: ${path.relative(ROOT_DIR, inputPath)}`);

  const imgBuffer = fs.readFileSync(inputPath);
  const dataUrl = `data:image/png;base64,${imgBuffer.toString('base64')}`;

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true
  }).catch(() => chromium.launch({ headless: true }));

  try {
    const page = await browser.newPage();

    const result = await page.evaluate(async ({ dataUrl, targetWidth, generatePreview }) => {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('No se pudo decodificar la imagen en el canvas'));
        img.src = dataUrl;
      });

      const scale = targetWidth / img.width;
      const targetHeight = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('No se pudo obtener contexto 2D de canvas');
      }

      // 1. Composición obligatoria sobre fondo blanco (para transparencias y contraste)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetWidth, targetHeight);

      // 2. Escalar a ancho 384 manteniendo proporción
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const data = imgData.data;
      const w = targetWidth;
      const h = targetHeight;

      // 3. Convertir a escala de grises (luminancia ITU-R BT.601)
      const gray = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      }

      // 4. Tramado Floyd-Steinberg: bit 1 = negro, 0 = blanco
      // Matriz de difusión de error hacia adelante y abajo:
      //         X   7/16
      //  3/16  5/16 1/16
      const binary = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          const oldVal = gray[idx];
          const newVal = oldVal < 128 ? 0 : 255;
          binary[idx] = newVal === 0 ? 1 : 0;
          const err = oldVal - newVal;

          if (x + 1 < w) {
            gray[idx + 1] += err * (7 / 16);
          }
          if (y + 1 < h) {
            if (x > 0) {
              gray[idx + w - 1] += err * (3 / 16);
            }
            gray[idx + w] += err * (5 / 16);
            if (x + 1 < w) {
              gray[idx + w + 1] += err * (1 / 16);
            }
          }
        }
      }

      // 5. Empaquetar 1 bit por punto (MSB primero) en filas de 48 bytes
      const bytesPerRow = Math.ceil(w / 8); // 48 bytes
      const raster = new Uint8Array(8 + h * bytesPerRow);

      // Cabecera GS v 0 (1D 76 30 00 xL xH yL yH)
      raster[0] = 0x1d;
      raster[1] = 0x76;
      raster[2] = 0x30;
      raster[3] = 0x00; // modo normal
      raster[4] = bytesPerRow & 0xff;        // xL = 48 (0x30)
      raster[5] = (bytesPerRow >> 8) & 0xff; // xH = 0
      raster[6] = h & 0xff;                  // yL
      raster[7] = (h >> 8) & 0xff;           // yH

      let offset = 8;
      for (let y = 0; y < h; y++) {
        for (let b = 0; b < bytesPerRow; b++) {
          let byteVal = 0;
          for (let bit = 0; bit < 8; bit++) {
            const x = b * 8 + bit;
            if (x < w) {
              const idx = y * w + x;
              if (binary[idx] === 1) {
                byteVal |= (1 << (7 - bit));
              }
            }
          }
          raster[offset++] = byteVal;
        }
      }

      // 6. Generación opcional de imagen de vista previa
      let previewDataUrl = null;
      if (generatePreview) {
        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = w;
        previewCanvas.height = h;
        const pCtx = previewCanvas.getContext('2d');
        if (pCtx) {
          const pImgData = pCtx.createImageData(w, h);
          for (let i = 0; i < w * h; i++) {
            const pIdx = i * 4;
            const val = binary[i] === 1 ? 0 : 255;
            pImgData.data[pIdx] = val;
            pImgData.data[pIdx + 1] = val;
            pImgData.data[pIdx + 2] = val;
            pImgData.data[pIdx + 3] = 255;
          }
          pCtx.putImageData(pImgData, 0, 0);
          previewDataUrl = previewCanvas.toDataURL('image/png');
        }
      }

      return {
        width: w,
        height: h,
        raster: Array.from(raster),
        previewDataUrl
      };
    }, { dataUrl, targetWidth: TARGET_WIDTH, generatePreview });

    const rasterBuffer = Buffer.from(result.raster);
    const rasterB64 = rasterBuffer.toString('base64');

    // Comparar con el tamaño previo si el archivo ya existe
    let prevByteSize = 0;
    if (fs.existsSync(outputPath)) {
      const prevContent = fs.readFileSync(outputPath, 'utf8');
      const match = prevContent.match(/THERMAL_LOGO_RASTER_B64\s*=\s*'([^']+)'/);
      if (match) {
        prevByteSize = Buffer.from(match[1], 'base64').length;
      }
    }

    const newByteSize = rasterBuffer.length;
    console.log(`[brand:thermal] Dimensiones: ${result.width}x${result.height} px (${result.width / 8} bytes/fila)`);
    console.log(`[brand:thermal] Total bytes binarios ESC/POS: ${newByteSize} bytes (cabecera: 8, datos: ${newByteSize - 8})`);

    if (prevByteSize > 0) {
      const growth = (newByteSize - prevByteSize) / prevByteSize;
      if (growth > 0.2) {
        console.warn(`[brand:thermal] ADVERTENCIA: El resultado es más grande en bytes por ${(growth * 100).toFixed(1)}% (anterior: ${prevByteSize}B, nuevo: ${newByteSize}B)`);
      } else {
        console.log(`[brand:thermal] Comparación de tamaño: anterior=${prevByteSize}B, nuevo=${newByteSize}B (variación: ${(growth * 100).toFixed(1)}%)`);
      }
    }

    // Escribir archivo TypeScript de destino
    const tsContent = [
      '// Generado por scripts/generate-thermal-logo.mjs. Logo TOCINETA para impresora térmica de 58 mm (384 puntos).',
      '// Comando ESC/POS raster completo (GS v 0), listo para enviar tal cual.',
      `export const THERMAL_LOGO_WIDTH = ${result.width};`,
      `export const THERMAL_LOGO_HEIGHT = ${result.height};`,
      `export const THERMAL_LOGO_RASTER_B64 = '${rasterB64}';`,
      ''
    ].join('\n');

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, tsContent, 'utf8');
    console.log(`[brand:thermal] Archivo generado con éxito en: ${path.relative(ROOT_DIR, outputPath)}`);

    if (generatePreview && result.previewDataUrl && previewPath) {
      const base64Data = result.previewDataUrl.replace(/^data:image\/png;base64,/, '');
      fs.mkdirSync(path.dirname(previewPath), { recursive: true });
      fs.writeFileSync(previewPath, Buffer.from(base64Data, 'base64'));
      console.log(`[brand:thermal] Preview guardado en: ${path.relative(ROOT_DIR, previewPath)}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[brand:thermal] Error fatal:', err);
  process.exit(1);
});
