import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const capturesDir = path.join(projectRoot, 'docs/auditoria/capturas/fase3');

if (!fs.existsSync(capturesDir)) {
  fs.mkdirSync(capturesDir, { recursive: true });
}

const VIEWPORTS = [
  { width: 390, height: 844, label: '390x844' },
  { width: 768, height: 1024, label: '768x1024' }
];

const THEMES = ['light', 'dark'];

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function run() {
  console.log('🚀 Iniciando Capturas Oficiales de Fase 3 con Playwright...');
  const baseUrl = 'http://localhost:3000';

  let serverProcess = null;
  const isUp = await waitForServer(baseUrl, 1500);
  if (!isUp) {
    console.log('Iniciando servidor local para capturas en background...');
    serverProcess = spawn('node', ['dist/index.js'], {
      cwd: path.join(projectRoot, 'apps/server'),
      env: { ...process.env, PORT: '3000', NODE_ENV: 'production' },
      stdio: 'inherit'
    });
    const ready = await waitForServer(baseUrl, 20000);
    if (!ready) {
      throw new Error('El servidor no respondió en http://localhost:3000 en el tiempo esperado.');
    }
  }

  // Obtener token real del admin
  let adminToken = '';
  let adminUser = { id: 'usr_admin', name: 'ADMIN', role: 'admin' };
  try {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const loginData = await loginRes.json();
    if (loginData.token) {
      adminToken = loginData.token;
      adminUser = loginData.user;
      console.log('🔑 Token de sesión obtenido para:', adminUser.name);
    }
  } catch (err) {
    console.warn('⚠️ No se pudo autenticar vía API, usando token local.');
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: theme
      });

      const page = await context.newPage();

      // Inyectar estado inicial en localStorage
      await page.addInitScript(
        ({ t, tok, u }) => {
          localStorage.setItem('tocineta_theme', t);
          localStorage.setItem('tocineta_ui_mode', 'pro');
          localStorage.setItem('tocineta_active_sede', 'sede_b');
          localStorage.setItem('tocineta_active_location', 'loc_alta_vista');
          localStorage.setItem('tocineta_token', tok);
          localStorage.setItem('tocineta_user', JSON.stringify(u));
        },
        { t: theme, tok: adminToken, u: adminUser }
      );

      console.log(`📸 Capturando suite Fase 3: ${vp.label} - ${theme.toUpperCase()}...`);

      // 1. INVENTARIO DE INSUMOS
      await page.goto(`${baseUrl}/#profitability`, { waitUntil: 'networkidle' });
      await page.evaluate(({ t }) => {
        if (t === 'dark') document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
      }, { t: theme });
      const invBtn = await page.$('button:has-text("Inventario")');
      if (invBtn) await invBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({
        path: path.join(capturesDir, `01-inventario-insumos-${vp.label}-${theme}.png`),
        fullPage: false
      });

      // 2. ASISTENTE DE COMPRAS Y COSTEO PONDERADO
      const purchasesBtn = await page.$('button:has-text("Compras")');
      if (purchasesBtn) await purchasesBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({
        path: path.join(capturesDir, `02-asistente-compras-${vp.label}-${theme}.png`),
        fullPage: false
      });

      // 3. RECETAS, SUB-RECETAS Y ESCANDALLO EN VIVO
      const recipesBtn = await page.$('button:has-text("Recetas")');
      if (recipesBtn) await recipesBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({
        path: path.join(capturesDir, `03-recetas-escandallo-${vp.label}-${theme}.png`),
        fullPage: false
      });

      // 4. MERMAS Y CONTEO FÍSICO
      const wasteBtn = await page.$('button:has-text("Mermas")');
      if (wasteBtn) await wasteBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({
        path: path.join(capturesDir, `05-mermas-conteo-${vp.label}-${theme}.png`),
        fullPage: false
      });

      // 5. ASISTENTE CONFIGURA TU NEGOCIO (5 PASOS + CSV)
      const wizardBtn = await page.$('button:has-text("Configurar Negocio")');
      if (wizardBtn) await wizardBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({
        path: path.join(capturesDir, `06-asistente-configurar-${vp.label}-${theme}.png`),
        fullPage: false
      });

      // 6. MODAL DE FICHA TÉCNICA Y ESCANDALLO (3 MODOS, MERMA Y PRECIO SUGERIDO)
      if (recipesBtn) await recipesBtn.click();
      await page.waitForTimeout(500);
      const firstRecipeCard = await page.$('.cursor-pointer');
      if (firstRecipeCard) {
        await firstRecipeCard.click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({
        path: path.join(capturesDir, `07-alerta-variacion-costo-${vp.label}-${theme}.png`),
        fullPage: false
      });

      // 7. SELECTOR DE SEDES EN MENÚ + BADGE DEMO EN HEADER
      const closeDialog = await page.$('button[aria-label="Cerrar modal"], button:has-text("Cancelar")');
      if (closeDialog) await closeDialog.click();
      await page.waitForTimeout(300);
      const menuBtn = await page.$('button[aria-label="Abrir Menú"]');
      if (menuBtn) {
        await menuBtn.click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({
        path: path.join(capturesDir, `08-sedes-selector-demo-badge-${vp.label}-${theme}.png`),
        fullPage: false
      });

      await context.close();
    }
  }

  await browser.close();
  console.log('🎉 28 capturas de pantalla de Fase 3 generadas exitosamente en docs/auditoria/capturas/fase3/ !');

  if (serverProcess) {
    serverProcess.kill();
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error capturando pantallas:', err);
  process.exit(1);
});
