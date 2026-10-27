import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const capturesDir = path.join(projectRoot, 'docs/auditoria/capturas/fase7');
const artifactCapturesDir = 'C:/Users/Shell/.gemini/antigravity-ide/brain/a559eaf1-5d82-46f6-93c0-dbaba2438971/capturas_fase7';

if (!fs.existsSync(capturesDir)) {
  fs.mkdirSync(capturesDir, { recursive: true });
}
if (!fs.existsSync(artifactCapturesDir)) {
  fs.mkdirSync(artifactCapturesDir, { recursive: true });
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

function saveDual(filename, buffer) {
  fs.writeFileSync(path.join(capturesDir, filename), buffer);
  fs.writeFileSync(path.join(artifactCapturesDir, filename), buffer);
  console.log(`📸 Guardada captura: ${filename}`);
}

async function run() {
  console.log('🚀 Iniciando Capturas Oficiales de Fase 7 (Playwright)...');
  const baseUrl = 'http://localhost:3000';

  let serverProcess = null;
  const isUp = await waitForServer(baseUrl, 1500);
  if (!isUp) {
    console.log('Iniciando servidor local en background...');
    serverProcess = spawn('node', ['apps/server/dist/index.js'], {
      cwd: projectRoot,
      env: { ...process.env, PORT: '3000', NODE_ENV: 'production' },
      stdio: 'inherit'
    });
    const ready = await waitForServer(baseUrl, 20000);
    if (!ready) {
      throw new Error('El servidor no respondió en http://localhost:3000 a tiempo.');
    }
  }

  // 1. Autenticar como Admin
  let adminToken = '';
  let adminUser = { id: 'usr_admin', name: 'ADMIN', role: 'admin', mustChangePin: false };
  try {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', pin: '123456' })
    });
    const loginData = await loginRes.json();
    if (loginData.token) {
      adminToken = loginData.token;
      adminUser = { ...loginData.user, mustChangePin: false };
      console.log('🔑 Sesión autenticada como:', adminUser.name);
    }
  } catch (err) {
    console.warn('Advertencia al autenticar:', err.message);
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`
  };

  // 2. Sembrar datos representativos de Fase 7 para la captura
  try {
    // Activar módulo de socios
    await fetch(`${baseUrl}/api/partners/toggle-module`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ enabled: true })
    });

    // Sembrar 2 socios si no existen
    const partnersRes = await fetch(`${baseUrl}/api/partners`, { headers: authHeaders });
    const partnersData = await partnersRes.json();
    if (!partnersData.partners || partnersData.partners.length === 0) {
      const p1 = await fetch(`${baseUrl}/api/partners`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'Socio Director A',
          dni: 'V-10200300',
          phone: '0414-1112233',
          sharePercentage: 60
        })
      });
      const p1Data = await p1.json();

      await fetch(`${baseUrl}/api/partners`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'Socio Inversionista B',
          dni: 'V-20300400',
          phone: '0414-4445566',
          sharePercentage: 40
        })
      });

      if (p1Data.partner?.id) {
        await fetch(`${baseUrl}/api/partners/transactions`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            partnerId: p1Data.partner.id,
            type: 'APORTE',
            amountUsdCents: 150000,
            paymentMethod: 'TRANSFERENCIA_USD',
            notes: 'Aporte para nueva freidora industrial'
          })
        });
      }
    }

    // Sembrar una cotización si no existe
    const quotesRes = await fetch(`${baseUrl}/api/quotes`, { headers: authHeaders });
    const quotesData = await quotesRes.json();
    if (!quotesData.quotes || quotesData.quotes.length === 0) {
      await fetch(`${baseUrl}/api/quotes`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          customerName: 'Corporación Guayana C.A.',
          customerPhone: '0414-8889900',
          eventDate: '2026-11-20',
          guestCount: 60,
          notes: 'Evento Corporativo Fin de Año - Jardines Alta Vista',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          items: [
            { productId: 'prod_combo_clasico', quantity: 30, unitPriceUsdCents: 790 },
            { productId: 'prod_new_york', quantity: 30, unitPriceUsdCents: 690 }
          ],
          extras: [
            { concept: 'Logística de traslado y trailers', category: 'LOGISTICA', priceUsdCents: 5000, costUsdCents: 3000 },
            { concept: 'Personal de atención en mesa (2 personas)', category: 'PERSONAL', priceUsdCents: 6000, costUsdCents: 5000 }
          ]
        })
      });
    }
  } catch (err) {
    console.warn('⚠️ Nota sobre datos demo:', err.message);
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1
  });

  const page = await context.newPage();

  // Inyectar sesión canónica de TOCINETA
  await page.addInitScript(
    ({ tok, u }) => {
      localStorage.setItem('tocineta_theme', 'light');
      localStorage.setItem('tocineta_ui_mode', 'pro');
      localStorage.setItem('tocineta_token', tok);
      localStorage.setItem('tocineta_user', JSON.stringify({ ...u, mustChangePin: false }));
    },
    { tok: adminToken, u: adminUser }
  );

  // ---------------------------------------------------------------------------
  // 1. Cotizador de Eventos (View)
  // ---------------------------------------------------------------------------
  console.log('📸 1. Capturando Cotizador de Eventos (View)...');
  await page.goto(`${baseUrl}/#quotes`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const buf1 = await page.screenshot({ fullPage: true });
  saveDual('01_cotizador_eventos_view.png', buf1);

  // ---------------------------------------------------------------------------
  // 2. Modal Nueva Cotización con Simulador Privado de Utilidad
  // ---------------------------------------------------------------------------
  console.log('📸 2. Capturando Modal Nueva Cotización...');
  const newQuoteBtn = page.locator('button:has-text("Nueva Cotización")').first();
  if (await newQuoteBtn.count() > 0) {
    await newQuoteBtn.click();
    await page.waitForTimeout(800);
    const buf2 = await page.screenshot();
    saveDual('02_nueva_cotizacion_modal.png', buf2);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
  }

  // ---------------------------------------------------------------------------
  // 3. Modal Convertir en Reserva y Lista Consolidada de Compras
  // ---------------------------------------------------------------------------
  console.log('📸 3. Capturando Modal Convertir en Reserva / Lista de Compras...');
  await page.goto(`${baseUrl}/#quotes`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const shoppingBtn = page.locator('button:has-text("Lista de Compras")').first();
  if (await shoppingBtn.count() > 0) {
    await shoppingBtn.click();
    await page.waitForTimeout(800);
    const buf3 = await page.screenshot();
    saveDual('03_convertir_reserva_compras_modal.png', buf3);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
  }

  // ---------------------------------------------------------------------------
  // 4. Socios y Participación (View)
  // ---------------------------------------------------------------------------
  console.log('📸 4. Capturando Módulo de Socios (View)...');
  await page.goto(`${baseUrl}/#partners`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const buf4 = await page.screenshot({ fullPage: true });
  saveDual('04_socios_utilidades_view.png', buf4);

  // ---------------------------------------------------------------------------
  // 5. Modal Reparto de Dividendos
  // ---------------------------------------------------------------------------
  console.log('📸 5. Capturando Modal Reparto de Dividendos...');
  const distributeBtn = page.locator('button:has-text("Repartir Utilidades del Mes")').first();
  if (await distributeBtn.count() > 0) {
    await distributeBtn.click();
    await page.waitForTimeout(800);
    const buf5 = await page.screenshot();
    saveDual('05_reparto_dividendos_modal.png', buf5);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
  }

  // ---------------------------------------------------------------------------
  // 6. Menú Digital QR / Web (View)
  // ---------------------------------------------------------------------------
  console.log('📸 6. Capturando Menú Digital QR Web (View)...');
  await page.goto(`${baseUrl}/#qr-menu`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const buf6 = await page.screenshot({ fullPage: true });
  saveDual('06_menu_digital_qr_view.png', buf6);

  // ---------------------------------------------------------------------------
  // 7. Configuración del Negocio Multi-Restaurante (View)
  // ---------------------------------------------------------------------------
  console.log('📸 7. Capturando Configuración del Negocio (View)...');
  await page.goto(`${baseUrl}/#settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const buf7 = await page.screenshot({ fullPage: true });
  saveDual('07_configuracion_negocio_view.png', buf7);

  // ---------------------------------------------------------------------------
  // 8. Asistente de Primera Instalación (Onboarding Modal)
  // ---------------------------------------------------------------------------
  console.log('📸 8. Capturando Asistente de Instalación...');
  const wizardBtn = page.locator('button:has-text("Asistente Inicial")').first();
  if (await wizardBtn.count() > 0) {
    await wizardBtn.click();
    await page.waitForTimeout(800);
    const buf8 = await page.screenshot();
    saveDual('08_asistente_onboarding_modal.png', buf8);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
  }

  // ---------------------------------------------------------------------------
  // 9. Manuales Operativos de 1 Página (Modal)
  // ---------------------------------------------------------------------------
  console.log('📸 9. Capturando Manuales Operativos...');
  await page.goto(`${baseUrl}/#settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const manualsBtn = page.locator('button:has-text("Manuales")').first();
  if (await manualsBtn.count() > 0) {
    await manualsBtn.click();
    await page.waitForTimeout(800);
    const buf9 = await page.screenshot();
    saveDual('09_manuales_operativos_modal.png', buf9);
    await page.reload({ waitUntil: 'networkidle' });
  }

  await browser.close();
  if (serverProcess) {
    serverProcess.kill();
  }

  console.log('✅ Todas las capturas oficiales de Fase 7 se completaron exitosamente.');
}

run().catch((err) => {
  console.error('❌ Error capturando pantallas:', err);
  process.exit(1);
});
