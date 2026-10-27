import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT_DIR = process.cwd();
const REF_DIR = path.join(ROOT_DIR, 'docs', 'referencia');
const MENU_DIR = path.join(ROOT_DIR, 'apps', 'web', 'public', 'menu');

if (!fs.existsSync(MENU_DIR)) {
  fs.mkdirSync(MENU_DIR, { recursive: true });
}

// Bounding boxes in relative percentages or coordinates [x, y, width, height] for 990x1279
const BURGERS_POSTER = path.join(REF_DIR, 'WhatsApp Image 2026-10-16 at 10.05.38 1.jpeg');
const HOTDOGS_POSTER = path.join(REF_DIR, 'WhatsApp Image 2026-10-16 at 10.05.38 AM.jpeg');

const CROPS = [
  // --- HAMBURGUESAS & COMBOS (From BURGERS_POSTER) ---
  {
    poster: BURGERS_POSTER,
    slug: 'americana-deluxe',
    crop: { x: 35, y: 35, w: 260, h: 200 }
  },
  {
    poster: BURGERS_POSTER,
    slug: 'combo-para-ti',
    crop: { x: 390, y: 45, w: 260, h: 195 }
  },
  {
    poster: BURGERS_POSTER,
    slug: 'texas-mex',
    crop: { x: 730, y: 0, w: 210, h: 160 }
  },
  {
    poster: BURGERS_POSTER,
    slug: 'pechuga-cesar',
    crop: { x: 40, y: 245, w: 250, h: 190 }
  },
  {
    poster: BURGERS_POSTER,
    slug: 'grill',
    crop: { x: 425, y: 240, w: 220, h: 175 }
  },
  {
    poster: BURGERS_POSTER,
    slug: 'nuggets-meat',
    crop: { x: 735, y: 240, w: 220, h: 175 }
  },
  {
    poster: BURGERS_POSTER,
    slug: 'miami',
    crop: { x: 80, y: 475, w: 210, h: 175 }
  },
  {
    poster: BURGERS_POSTER,
    slug: 'new-york',
    crop: { x: 420, y: 470, w: 215, h: 175 }
  },
  {
    poster: BURGERS_POSTER,
    slug: 'mozarrella',
    crop: { x: 725, y: 470, w: 225, h: 175 }
  },
  {
    poster: BURGERS_POSTER,
    slug: 'papas-fritas-extra-150',
    crop: { x: 40, y: 885, w: 140, h: 105 }
  },
  {
    poster: BURGERS_POSTER,
    slug: 'carne-extra',
    crop: { x: 205, y: 895, w: 140, h: 90 }
  },
  {
    poster: BURGERS_POSTER,
    slug: 'tocineta-extra',
    crop: { x: 375, y: 890, w: 140, h: 95 }
  },
  {
    poster: BURGERS_POSTER,
    slug: 'pepinillo-extra',
    crop: { x: 535, y: 885, w: 140, h: 100 }
  },
  {
    poster: BURGERS_POSTER,
    slug: 'jalapenos-extra',
    crop: { x: 695, y: 885, w: 135, h: 100 }
  },
  {
    poster: BURGERS_POSTER,
    slug: 'papas-fritas-racion-250',
    crop: { x: 865, y: 885, w: 115, h: 95 }
  },

  // --- HOT DOGS, COMBOS & BEBIDAS (From HOTDOGS_POSTER) ---
  {
    poster: HOTDOGS_POSTER,
    slug: 'combo-street',
    crop: { x: 35, y: 80, w: 275, h: 165 }
  },
  {
    poster: HOTDOGS_POSTER,
    slug: 'combo-clasico',
    crop: { x: 365, y: 75, w: 275, h: 165 }
  },
  {
    poster: HOTDOGS_POSTER,
    slug: 'street-dog',
    crop: { x: 685, y: 55, w: 285, h: 195 }
  },
  {
    poster: HOTDOGS_POSTER,
    slug: 'tocineta-dog-parmesano',
    crop: { x: 15, y: 280, w: 310, h: 190 }
  },
  {
    poster: HOTDOGS_POSTER,
    slug: 'doritos-dog-snacks',
    crop: { x: 345, y: 285, w: 310, h: 195 }
  },
  {
    poster: HOTDOGS_POSTER,
    slug: 'jalapenos-dog',
    crop: { x: 675, y: 280, w: 295, h: 200 }
  },
  {
    poster: HOTDOGS_POSTER,
    slug: 'brazil-dog',
    crop: { x: 5, y: 535, w: 325, h: 200 }
  },
  {
    poster: HOTDOGS_POSTER,
    slug: 'chicago-dog',
    crop: { x: 345, y: 515, w: 315, h: 245 }
  },
  {
    poster: HOTDOGS_POSTER,
    slug: 'seattle-dog',
    crop: { x: 675, y: 535, w: 305, h: 215 }
  },
  {
    poster: HOTDOGS_POSTER,
    slug: 'malta-lata-250',
    crop: { x: 65, y: 805, w: 125, h: 150 }
  },
  {
    poster: HOTDOGS_POSTER,
    slug: 'refresco-1lt',
    crop: { x: 335, y: 795, w: 80, h: 160 }
  },
  {
    poster: HOTDOGS_POSTER,
    slug: 'vaso-nestea-22oz',
    crop: { x: 570, y: 810, w: 120, h: 150 }
  }
];

async function cropPhotos() {
  console.log('Iniciando extracción y recorte de fotos oficiales del menú (4:3)...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true
  }).catch(() => chromium.launch({ channel: 'msedge', headless: true }));

  const page = await browser.newPage();

  const script = `
    window.cropItem = function(src, crop, outW = 400, outH = 300) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = outW;
          canvas.height = outH;
          const ctx = canvas.getContext('2d');

          // Target 4:3
          ctx.drawImage(
            img,
            crop.x, crop.y, crop.w, crop.h,
            0, 0, outW, outH
          );

          resolve(canvas.toDataURL('image/jpeg', 0.90));
        };
        img.onerror = reject;
        img.src = src;
      });
    };
  `;

  await page.setContent(`<!DOCTYPE html><html><body><script>${script}</script></body></html>`);

  // Cache base64 posters
  const posterCache = {};

  for (const item of CROPS) {
    if (!posterCache[item.poster]) {
      if (fs.existsSync(item.poster)) {
        posterCache[item.poster] = 'data:image/jpeg;base64,' + fs.readFileSync(item.poster).toString('base64');
      } else {
        console.warn('Afiche no encontrado:', item.poster);
        continue;
      }
    }

    const b64 = posterCache[item.poster];
    const outDataUrl = await page.evaluate(({ src, crop }) => window.cropItem(src, crop), {
      src: b64,
      crop: item.crop
    });

    const outBuf = Buffer.from(outDataUrl.split(',')[1], 'base64');
    const outFile = path.join(MENU_DIR, `${item.slug}.jpg`);
    fs.writeFileSync(outFile, outBuf);
    console.log(`✓ Foto recortada: ${item.slug}.jpg`);
  }

  await browser.close();
  console.log(`Extracción finalizada. ${CROPS.length} fotos guardadas en apps/web/public/menu/`);
}

cropPhotos().catch(err => {
  console.error('Error recortando fotos del menú:', err);
  process.exit(1);
});
