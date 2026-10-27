import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const capturesDir = path.join(projectRoot, 'docs/auditoria/capturas/fase2');

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
  console.log('🚀 Iniciando Capturas Oficiales de Fase 2 con Playwright...');
  const baseUrl = 'http://localhost:3000';

  let serverProcess = null;
  const isUp = await waitForServer(baseUrl, 1500);
  if (!isUp) {
    console.log('Iniciando servidor local para capturas en background...');
    serverProcess = spawn('node', ['apps/server/dist/index.js'], {
      cwd: projectRoot,
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

  // Crear pedidos demo para que Caja, Cobro, Ventas y KDS tengan datos completos
  try {
    // 1. Pedido pendiente por cobrar (para PaymentWizard y pestaña Por Cobrar)
    const order1Res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'usr_admin',
        'x-user-role': 'admin'
      },
      body: JSON.stringify({
        fulfillmentType: 'salon',
        customerName: 'Cliente Mostrador Mesa 4',
        lines: [
          { productId: 'prod_new_york', quantity: 2 },
          { productId: 'prod_street_dog', quantity: 1 }
        ]
      })
    });
    const order1 = await order1Res.json();
    console.log('📦 Pedido 1 (Pendiente por cobrar) creado:', order1.order?.id || order1.id);

    // 2. Pedido cobrado (para pestaña Ventas del Día y Cierre Z)
    const order2Res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'usr_admin',
        'x-user-role': 'admin'
      },
      body: JSON.stringify({
        fulfillmentType: 'salon',
        customerName: 'Cliente Demo Pagado',
        lines: [
          { productId: 'prod_street_dog', quantity: 2 }
        ]
      })
    });
    const order2 = await order2Res.json();
    const order2Id = order2.order?.id || order2.id;
    if (order2Id) {
      const order2Total = order2.order?.totalCents || order2.totalCents || 700;
      await fetch(`${baseUrl}/api/orders/${order2Id}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': 'usr_admin',
          'x-user-role': 'admin'
        },
        body: JSON.stringify({
          payments: [
            { method: 'cash_usd', amountCents: order2Total }
          ]
        })
      });
      console.log('💰 Pedido 2 cobrado con éxito:', order2Id);
    }
  } catch (e) {
    console.warn('⚠️ Nota al crear pedidos demo:', e.message);
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      console.log(`\n======================================================`);
      console.log(`📸 Viewport: ${vp.label} | Tema: ${theme.toUpperCase()}`);
      console.log(`======================================================`);

      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2
      });

      const page = await context.newPage();

      // Configurar estado inicial
      const setupCashier = async (targetTab = 'cashier') => {
        await page.goto(`${baseUrl}/#${targetTab}`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(
          ({ th, usr, tok }) => {
            localStorage.clear();
            localStorage.setItem('tocineta_theme', th);
            if (th === 'dark') {
              document.documentElement.classList.add('dark');
            } else {
              document.documentElement.classList.remove('dark');
            }
            if (usr) {
              localStorage.setItem('tocineta_user', JSON.stringify(usr));
              localStorage.setItem('tocineta_token', tok);
              localStorage.setItem('tocineta_ui_mode', 'pro');
            }
          },
          { th: theme, usr: adminUser, tok: adminToken }
        );
        await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
        await page.waitForTimeout(1000);
      };

      // 4. CAJA: PESTAÑA POR COBRAR
      console.log('  Capturando: 04_caja_por_cobrar...');
      await setupCashier();
      // Asegurarse de que esté en la pestaña Por cobrar
      const pendingTab = page.locator('button:has-text("Por cobrar")').first();
      if (await pendingTab.isVisible()) {
        await pendingTab.click();
        await page.waitForTimeout(600);
      }
      await page.screenshot({
        path: path.join(capturesDir, `04_caja_por_cobrar_${vp.label}_${theme}.png`)
      });

      // 1. COBRO PASO 1: RESUMEN
      console.log('  Capturando: 01_cobro_paso1_resumen...');
      const payBtn = page.locator('button:has-text("Cobrar Orden")').first();
      if (await payBtn.isVisible()) {
        await payBtn.click();
        await page.waitForTimeout(600);
      }
      await page.screenshot({
        path: path.join(capturesDir, `01_cobro_paso1_resumen_${vp.label}_${theme}.png`)
      });

      // 2. COBRO PASO 2: MÉTODOS DE PAGO
      console.log('  Capturando: 02_cobro_paso2_metodos...');
      const wizardNext1 = page.locator('button:has-text("Siguiente")').first();
      if (await wizardNext1.isVisible()) {
        await wizardNext1.click();
        await page.waitForTimeout(600);
      }
      await page.screenshot({
        path: path.join(capturesDir, `02_cobro_paso2_metodos_${vp.label}_${theme}.png`)
      });

      // 3. COBRO PASO 3: VUELTO Y CIERRE
      console.log('  Capturando: 03_cobro_paso3_vuelto...');
      // Agregar un pago con vuelto (por ejemplo un billete mayor o exacto)
      const exactBtn = page.locator('button:has-text("Exacto USD")').first();
      if (await exactBtn.isVisible()) {
        await exactBtn.click();
        await page.waitForTimeout(500);
      }
      const wizardNext2 = page.locator('button:has-text("Siguiente")').first();
      if (await wizardNext2.isVisible()) {
        await wizardNext2.click();
        await page.waitForTimeout(600);
      }
      await page.screenshot({
        path: path.join(capturesDir, `03_cobro_paso3_vuelto_${vp.label}_${theme}.png`)
      });

      // Cerrar wizard (o volver a Caja)
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await page.goto(`${baseUrl}/#cashier`, { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(600);

      // 5. CAJA: PESTAÑA VENTAS DEL DÍA
      console.log('  Capturando: 05_caja_ventas_dia...');
      const salesTab = page.locator('button:has-text("Ventas del día")').first();
      if (await salesTab.isVisible()) {
        await salesTab.click();
        await page.waitForTimeout(600);
      }
      await page.screenshot({
        path: path.join(capturesDir, `05_caja_ventas_dia_${vp.label}_${theme}.png`)
      });

      // 6. CAJA: PESTAÑA CIERRE DE CAJA
      console.log('  Capturando: 06_cierre_caja...');
      const closureTab = page.locator('button:has-text("Cierre de caja")').first();
      if (await closureTab.isVisible()) {
        await closureTab.click();
        await page.waitForTimeout(600);
      }
      await page.screenshot({
        path: path.join(capturesDir, `06_cierre_caja_${vp.label}_${theme}.png`)
      });

      // 7. COCINA (KDS)
      console.log('  Capturando: 07_cocina_kds...');
      await page.goto(`${baseUrl}/#kds`, { waitUntil: 'networkidle' }).catch(() => {});
      await page.evaluate((th) => {
        if (th === 'dark') document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
      }, theme);
      await page.waitForTimeout(800);
      await page.screenshot({
        path: path.join(capturesDir, `07_cocina_kds_${vp.label}_${theme}.png`)
      });

      await context.close();
    }
  }

  await browser.close();

  if (serverProcess) {
    serverProcess.kill();
  }

  console.log('\n🎉 ¡Todas las 28 capturas de Fase 2 generadas exitosamente en docs/auditoria/capturas/fase2/!');
}

run().catch((err) => {
  console.error('❌ Error capturando pantallas de Fase 2:', err);
  process.exit(1);
});
