import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT_DIR = process.cwd();
const REF_DIR = path.join(ROOT_DIR, 'docs', 'referencia');
const BRAND_DIR = path.join(ROOT_DIR, 'apps', 'web', 'public', 'brand');
const PUBLIC_DIR = path.join(ROOT_DIR, 'apps', 'web', 'public');

if (!fs.existsSync(BRAND_DIR)) {
  fs.mkdirSync(BRAND_DIR, { recursive: true });
}

async function processAssets() {
  console.log('Iniciando procesamiento de logos e iconos con Playwright...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true
  }).catch(() => chromium.launch({ headless: true }));

  const page = await browser.newPage();

  // Helper to flood-fill black background to transparent
  const floodFillScript = `
    window.floodFillTransparent = function(imgSrc, isCaritaOnly = false) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;
          const w = canvas.width;
          const h = canvas.height;
          const visited = new Uint8Array(w * h);

          // Queue for BFS flood fill
          const queue = [];

          function isBlack(idx) {
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            // Threshold for black background
            return r < 40 && g < 40 && b < 40;
          }

          function addPixel(x, y) {
            if (x < 0 || x >= w || y < 0 || y >= h) return;
            const pIdx = y * w + x;
            if (visited[pIdx]) return;
            visited[pIdx] = 1;
            const idx = pIdx * 4;
            if (isBlack(idx)) {
              queue.push(x, y);
              data[idx + 3] = 0; // Set transparent
            }
          }

          // Seed flood fill from the 4 edges
          for (let x = 0; x < w; x++) {
            addPixel(x, 0);
            addPixel(x, h - 1);
          }
          for (let y = 0; y < h; y++) {
            addPixel(0, y);
            addPixel(w - 1, y);
          }

          // Run BFS
          let qIdx = 0;
          while (qIdx < queue.length) {
            const cx = queue[qIdx++];
            const cy = queue[qIdx++];

            // 4-connectivity
            addPixel(cx + 1, cy);
            addPixel(cx - 1, cy);
            addPixel(cx, cy + 1);
            addPixel(cx, cy - 1);
          }

          // In the lower half (text region y > h * 0.48), also clear any enclosed black holes (like in 'O', 'A', 'R')
          // The carita is completely in the upper half, so eyes/mouth are 100% safe.
          for (let y = Math.floor(h * 0.48); y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * 4;
              if (isBlack(idx)) {
                data[idx + 3] = 0; // set transparent
              }
            }
          }

          ctx.putImageData(imgData, 0, 0);

          resolve({
            fullDataUrl: canvas.toDataURL('image/png'),
            width: w,
            height: h
          });
        };
        img.onerror = reject;
        img.src = imgSrc;
      });
    };

    window.resizeImage = function(imgSrc, targetW, targetH) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, targetW, targetH);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = imgSrc;
      });
    };
  `;

  await page.setContent(`<!DOCTYPE html><html><body><script>${floodFillScript}</script></body></html>`);

  // 1. Process Logo Light (photo_2026-10-16_20-32-32.jpg)
  const lightPath = path.join(REF_DIR, 'photo_2026-10-16_20-32-32.jpg');
  if (fs.existsSync(lightPath)) {
    const b64 = 'data:image/jpeg;base64,' + fs.readFileSync(lightPath).toString('base64');
    const result = await page.evaluate(src => window.floodFillTransparent(src), b64);
    const pngBuf = Buffer.from(result.fullDataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(BRAND_DIR, 'logo-light.png'), pngBuf);
    console.log('✓ Creado apps/web/public/brand/logo-light.png');
  }

  // 2. Process Logo Dark (photo_2026-10-16_20-32-32 (2).jpg)
  const darkPath = path.join(REF_DIR, 'photo_2026-10-16_20-32-32 (2).jpg');
  if (fs.existsSync(darkPath)) {
    const b64 = 'data:image/jpeg;base64,' + fs.readFileSync(darkPath).toString('base64');
    const result = await page.evaluate(src => window.floodFillTransparent(src), b64);
    const pngBuf = Buffer.from(result.fullDataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(BRAND_DIR, 'logo-dark.png'), pngBuf);
    console.log('✓ Creado apps/web/public/brand/logo-dark.png');
  }

  // 3. Process Carita only (photo_2026-10-16_20-32-32 (3).jpg)
  const caritaPath = path.join(REF_DIR, 'photo_2026-10-16_20-32-32 (3).jpg');
  if (fs.existsSync(caritaPath)) {
    const b64 = 'data:image/jpeg;base64,' + fs.readFileSync(caritaPath).toString('base64');
    const result = await page.evaluate(src => window.floodFillTransparent(src, true), b64);
    const pngBuf = Buffer.from(result.fullDataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(BRAND_DIR, 'carita.png'), pngBuf);
    console.log('✓ Creado apps/web/public/brand/carita.png');

    // Create icon-192.png and icon-512.png
    const icon192 = await page.evaluate(src => window.resizeImage(src, 192, 192), result.fullDataUrl);
    fs.writeFileSync(path.join(PUBLIC_DIR, 'icon-192.png'), Buffer.from(icon192.split(',')[1], 'base64'));
    console.log('✓ Creado apps/web/public/icon-192.png');

    const icon512 = await page.evaluate(src => window.resizeImage(src, 512, 512), result.fullDataUrl);
    fs.writeFileSync(path.join(PUBLIC_DIR, 'icon-512.png'), Buffer.from(icon512.split(',')[1], 'base64'));
    console.log('✓ Creado apps/web/public/icon-512.png');
  }

  await browser.close();
  console.log('Procesamiento de marcas e iconos completado exitosamente.');
}

processAssets().catch(err => {
  console.error('Error procesando logos:', err);
  process.exit(1);
});
