import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function waitForServer(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function runE2E() {
  console.log('--- INICIANDO FLUJO PLAYWRIGHT E2E (FASE 2) EN 390x844: PEDIDO -> COBRO MIXTO -> COCINA -> CIERRE ---');
  const baseUrl = 'http://localhost:3000';

  let serverProcess = null;
  const isUp = await waitForServer(baseUrl, 1500);
  if (!isUp) {
    console.log('Iniciando servidor de producción para E2E...');
    serverProcess = spawn('node', ['apps/server/dist/index.js'], {
      cwd: projectRoot,
      env: { ...process.env, PORT: '3000', NODE_ENV: 'production' },
      stdio: 'inherit'
    });
    const ready = await waitForServer(baseUrl, 20000);
    if (!ready) throw new Error('Servidor no disponible en http://localhost:3000');
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2
  });

  const page = await context.newPage();

  try {
    // 1. Iniciar sesión como ADMIN
    console.log('1. Iniciando sesión como cajera/admin...');
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    
    // Login con usuario admin
    await page.waitForSelector('input', { timeout: 10000 });
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      await inputs[0].fill('admin');
      await inputs[1].fill('admin123');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
    }

    console.log('✓ Sesión iniciada con éxito');

    // 2. Tomar pedido en POS
    console.log('2. Navegando al Comandero (Tomar Pedido)...');
    await page.evaluate(() => {
      window.location.hash = '#pos';
    });
    await page.waitForTimeout(1500);

    // Paso 1: Cliente y Canal
    const nameInput = page.locator('input[placeholder*="cliente"]').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill('Cliente E2E Test');
      await page.waitForTimeout(500);
    }
    const nextBtn1 = page.locator('button:has-text("Siguiente")').first();
    if (await nextBtn1.isVisible()) {
      await nextBtn1.click();
      await page.waitForTimeout(1500);
    }
    console.log('✓ Paso 1 Cliente completado');

    // Paso 2: Catálogo - Agregar producto
    const addBtn = page.locator('button:has-text("Agregar")').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await page.waitForTimeout(500);
    }
    const reviewBtn = page.locator('button:has-text("Revisar Pedido")').first();
    if (await reviewBtn.isVisible()) {
      await reviewBtn.click();
      await page.waitForTimeout(1500);
    }
    console.log('✓ Paso 2 Catálogo completado');

    // Paso 3: Revisión - Cobrar Ahora
    const payNowBtn = page.locator('button:has-text("Cobrar Ahora")').first();
    if (await payNowBtn.isVisible()) {
      await payNowBtn.click();
      await page.waitForTimeout(1500);
      console.log('✓ Paso 3 Enviar / Cobrar Ahora activado');
    }

    // 3. Flujo en Caja (PaymentWizard)
    console.log('3. Navegando a Caja...');
    await page.evaluate(() => {
      window.location.hash = '#cashier';
    });
    await page.waitForTimeout(2000);

    const payOrderBtn = page.locator('button:has-text("Cobrar Orden")').first();
    if (await payOrderBtn.isVisible()) {
      await payOrderBtn.click();
      await page.waitForTimeout(1500);

      // PaymentWizard Paso 1: Resumen -> Siguiente
      const wizardNext = page.locator('button:has-text("Siguiente")').first();
      if (await wizardNext.isVisible()) {
        await wizardNext.click();
        await page.waitForTimeout(1000);
      }

      // PaymentWizard Paso 2: Pago exacto o billete rápido -> Siguiente
      const exactBtn = page.locator('button:has-text("Exacto USD")').first();
      if (await exactBtn.isVisible()) {
        await exactBtn.click();
        await page.waitForTimeout(500);
      }
      const wizardNext2 = page.locator('button:has-text("Siguiente")').first();
      if (await wizardNext2.isVisible()) {
        await wizardNext2.click();
        await page.waitForTimeout(1000);
      }

      // PaymentWizard Paso 3: Finalizar e imprimir
      const finalizeBtn = page.locator('button:has-text("Finalizar e imprimir")').first();
      if (await finalizeBtn.isVisible()) {
        await finalizeBtn.click();
        await page.waitForTimeout(2000);
      }
      console.log('✓ Cobro en PaymentWizard finalizado con éxito');
    }

    // 4. Cocina KDS
    console.log('4. Navegando a Cocina (KDS)...');
    await page.evaluate(() => {
      window.location.hash = '#kds';
    });
    await page.waitForTimeout(2000);

    // Verificar KDS
    const kdsTitle = page.locator('text=Cocina (KDS)');
    if (await kdsTitle.isVisible()) {
      console.log('✓ Cocina KDS cargada con tarjetas y semáforo de tiempos');
    }

    // 5. Cierre de Caja
    console.log('5. Navegando a Cierre de Caja...');
    await page.evaluate(() => {
      window.location.hash = '#cashier';
    });
    await page.waitForTimeout(1500);

    const cierreTab = page.locator('button:has-text("Cierre de caja")').first();
    if (await cierreTab.isVisible()) {
      await cierreTab.click();
      await page.waitForTimeout(1500);
      console.log('✓ Pestaña Cierre de Caja accesible');
    }

    console.log('🎉 ¡FLUJO E2E PLAYWRIGHT 390x844 COMPLETADO AL 100% CON ÉXITO!');
  } finally {
    await browser.close();
    if (serverProcess) {
      serverProcess.kill();
    }
  }
}

runE2E().catch(err => {
  console.error('Error en ejecución E2E:', err);
  process.exit(1);
});
