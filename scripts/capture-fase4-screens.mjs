import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const capturesDir = path.join(projectRoot, 'docs/auditoria/capturas/fase4');

if (!fs.existsSync(capturesDir)) {
  fs.mkdirSync(capturesDir, { recursive: true });
}

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
  console.log('🚀 Iniciando Capturas Oficiales de Fase 4 con Playwright...');
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
    console.warn('⚠️ No se pudo autenticar vía API, usando token predeterminado.');
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  const viewports = [
    { width: 390, height: 844, label: '390x844' },
    { width: 1024, height: 768, label: '1024x768' }
  ];

  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: 'light'
    });

    const page = await context.newPage();

    await page.addInitScript(
      ({ tok, u }) => {
        localStorage.setItem('tocineta_theme', 'light');
        localStorage.setItem('tocineta_ui_mode', 'pro');
        localStorage.setItem('tocineta_active_sede', 'sede_a');
        localStorage.setItem('tocineta_active_location', 'loc_los_olivos');
        localStorage.setItem('tocineta_token', tok);
        localStorage.setItem('tocineta_user', JSON.stringify(u));
      },
      { tok: adminToken, u: adminUser }
    );

    console.log(`📸 Capturando suite Fase 4: ${vp.label}...`);

    // 1. PANEL DE LA DUEÑA (MÓVIL / DESKTOP)
    await page.goto(`${baseUrl}/#owner`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(capturesDir, `01-panel-duena-${vp.label}.png`),
      fullPage: false
    });

    // 2. MODULO DE RENTABILIDAD & ENVIOS ENTRE SEDES
    await page.goto(`${baseUrl}/#profitability`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    // Abrir Modal de Envío
    const transferBtn = await page.$('button:has-text("Transferir")');
    if (transferBtn) {
      await transferBtn.click();
      await page.waitForTimeout(700);

      // Si está en modo platos, hacer clic en "Calcular Insumos"
      const calcBtn = await page.$('button:has-text("Calcular Insumos")');
      if (calcBtn) {
        await calcBtn.click();
        await page.waitForTimeout(500);
      }

      await page.screenshot({
        path: path.join(capturesDir, `02-asistente-envios-calculo-${vp.label}.png`),
        fullPage: false
      });

      // Clic en pestaña En Tránsito si existe
      const inTransitTab = await page.$('button:has-text("En Tránsito")');
      if (inTransitTab) {
        await inTransitTab.click();
        await page.waitForTimeout(500);
        await page.screenshot({
          path: path.join(capturesDir, `03-envios-en-transito-${vp.label}.png`),
          fullPage: false
        });
      }

      // Cerrar modal
      const closeBtn = await page.$('button:has-text("Cancelar")');
      if (closeBtn) await closeBtn.click();
      await page.waitForTimeout(300);
    }

    // Modal de Producción
    const prodBtn = await page.$('button:has-text("Producción")');
    if (prodBtn) {
      await prodBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({
        path: path.join(capturesDir, `04-modal-produccion-${vp.label}.png`),
        fullPage: false
      });
      const closeProdBtn = await page.$('button:has-text("Cancelar")');
      if (closeProdBtn) await closeProdBtn.click();
      await page.waitForTimeout(300);
    }

    // Pestaña Delivery
    const deliveryBtn = await page.$('button:has-text("Delivery")');
    if (deliveryBtn) {
      await deliveryBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(capturesDir, `05-delivery-por-sede-${vp.label}.png`),
        fullPage: false
      });
    }

    await context.close();
  }

  await browser.close();

  if (serverProcess) {
    serverProcess.kill();
  }

  console.log('✅ Capturas de Fase 4 generadas exitosamente en docs/auditoria/capturas/fase4/');
}

run().catch((err) => {
  console.error('❌ Error capturando pantallas:', err);
  process.exit(1);
});
