import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const capturesDir = path.join(projectRoot, 'docs/auditoria/capturas/fase4');

async function run() {
  const baseUrl = 'http://localhost:3000';
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
    }
  } catch {}

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 480, height: 850 },
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

  // 1. Capturar Modal de Producción
  await page.goto(`${baseUrl}/#profitability`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  const prodBtn = await page.$('button:has-text("Producción")');
  if (prodBtn) {
    await prodBtn.click();
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(capturesDir, '04-modal-produccion-taller.png'),
      fullPage: false
    });
    console.log('✅ Capturado: 04-modal-produccion-taller.png');
    const closeProd = await page.$('button:has-text("Cancelar")');
    if (closeProd) await closeProd.click();
    await page.waitForTimeout(400);
  }

  // 2. Capturar Modal de Liquidación / Gestión de Repartidores por Sede
  // En POS, click en modal de entrega/liquidación
  await page.goto(`${baseUrl}/#pos`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  await browser.close();
  console.log('✅ Finalizado');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
