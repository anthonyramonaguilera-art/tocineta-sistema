import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const capturesDir = path.join(projectRoot, 'docs/auditoria/capturas/fase5');

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
  console.log('🚀 Iniciando Capturas Oficiales de Fase 5 con Playwright...');
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
        localStorage.setItem('tocineta_active_location', 'loc_alta_vista');
        localStorage.setItem('tocineta_token', tok);
        localStorage.setItem('tocineta_user', JSON.stringify(u));
      },
      { tok: adminToken, u: adminUser }
    );

    console.log(`📸 Capturando suite Fase 5: ${vp.label}...`);

    // 1. HUB PRINCIPAL FINANZAS (5 NÚMEROS + ACCIONES TREINTA + P&L)
    await page.goto(`${baseUrl}/#finances`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(capturesDir, `01-finanzas-treinta-hub-${vp.label}.png`),
      fullPage: false
    });

    // 2. FLUJO DE CAJA (CONCILIADO POR MÉTODO Y SEDE)
    const cashFlowBtn = page.locator('button[data-subtab="cashflow"]');
    if (await cashFlowBtn.count()) {
      await cashFlowBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({
        path: path.join(capturesDir, `02-flujo-caja-conciliado-${vp.label}.png`),
        fullPage: false
      });
    }

    // 3. GASTOS (REGISTRO RÁPIDO Y LISTADO)
    const expensesBtn = page.locator('button[data-subtab="expenses"]');
    if (await expensesBtn.count()) {
      await expensesBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({
        path: path.join(capturesDir, `03-gastos-lista-${vp.label}.png`),
        fullPage: false
      });
    }

    // 4. POR COBRAR (CRÉDITO, SOCIOS, WHATSAPP)
    const receivablesBtn = page.locator('button[data-subtab="receivables"]');
    if (await receivablesBtn.count()) {
      await receivablesBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({
        path: path.join(capturesDir, `04-por-cobrar-credito-${vp.label}.png`),
        fullPage: false
      });
    }

    // 5. POR PAGAR (FACTURAS PROVEEDOR Y ALERTAS)
    const payablesBtn = page.locator('button[data-subtab="payables"]');
    if (await payablesBtn.count()) {
      await payablesBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({
        path: path.join(capturesDir, `05-por-pagar-proveedores-${vp.label}.png`),
        fullPage: false
      });
    }

    // 6. CIERRE MENSUAL
    const closuresBtn = page.locator('button[data-subtab="closures"]');
    if (await closuresBtn.count()) {
      await closuresBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({
        path: path.join(capturesDir, `06-cierre-mensual-${vp.label}.png`),
        fullPage: false
      });
    }

    await context.close();
  }

  // Capturar Modal de Gasto Rápido en desktop
  const modalContext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    colorScheme: 'light'
  });
  const modalPage = await modalContext.newPage();
  await modalPage.addInitScript(
    ({ tok, u }) => {
      localStorage.setItem('tocineta_theme', 'light');
      localStorage.setItem('tocineta_ui_mode', 'pro');
      localStorage.setItem('tocineta_active_location', 'loc_alta_vista');
      localStorage.setItem('tocineta_token', tok);
      localStorage.setItem('tocineta_user', JSON.stringify(u));
    },
    { tok: adminToken, u: adminUser }
  );
  await modalPage.goto(`${baseUrl}/#finances`, { waitUntil: 'domcontentloaded' });
  await modalPage.waitForTimeout(1000);
  const registrarGastoBtn = modalPage.getByRole('button', { name: /Registrar Gasto/i });
  if (await registrarGastoBtn.count()) {
    await registrarGastoBtn.first().click();
    await modalPage.waitForTimeout(600);
    await modalPage.screenshot({
      path: path.join(capturesDir, `07-modal-registrar-gasto.png`),
      fullPage: false
    });
  }
  await modalContext.close();

  await browser.close();

  if (serverProcess) {
    console.log('Finalizando servidor background...');
    serverProcess.kill('SIGINT');
  }

  console.log('✅ Capturas de Fase 5 completadas exitosamente en docs/auditoria/capturas/fase5');
}

run().catch((err) => {
  console.error('❌ Error capturando pantallas:', err);
  process.exit(1);
});
