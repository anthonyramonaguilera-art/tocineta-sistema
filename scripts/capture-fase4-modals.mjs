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
    }
  } catch (err) {
    console.warn('⚠️ Usando credenciales de prueba.');
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 480, height: 900 },
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

  console.log('📸 Navegando a Inventario para Asistente de Envíos...');
  await page.goto(`${baseUrl}/#profitability`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  // 1. Abrir Modal de Envío
  const transferBtn = await page.$('button:has-text("Transferir")');
  if (transferBtn) {
    await transferBtn.click();
    await page.waitForTimeout(600);

    // Seleccionar Modo 2: Por Platos
    const dishModeBtn = await page.$('button:has-text("Por Platos")');
    if (dishModeBtn) {
      await dishModeBtn.click();
      await page.waitForTimeout(400);

      // Clic en Calcular Insumos Requeridos
      const calcBtn = await page.$('button:has-text("Calcular Insumos Requeridos")');
      if (calcBtn) {
        await calcBtn.click();
        await page.waitForTimeout(800);
      }

      await page.screenshot({
        path: path.join(capturesDir, '02-asistente-platos-30burgers-50dogs.png'),
        fullPage: false
      });
      console.log('✅ Capturado: 02-asistente-platos-30burgers-50dogs.png');

      // Aplicar insumos
      const applyBtn = await page.$('button:has-text("Cargar Insumos al Despacho")');
      if (applyBtn) {
        await applyBtn.click();
        await page.waitForTimeout(600);
      }

      // Si hay advertencia de stock insuficiente, forzar con PIN de supervisor
      const forceCheckbox = await page.$('input[type="checkbox"]');
      // Scroll down en modal
      const modalBody = await page.$('div[role="dialog"]');
      if (modalBody) {
        await modalBody.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await page.waitForTimeout(300);
      }

      // Confirmar Despacho
      const confirmBtn = await page.$('button:has-text("Confirmar y Crear Nota de Despacho")');
      if (confirmBtn) {
        await confirmBtn.click();
        await page.waitForTimeout(1200);

        // Si aparece popup o advertencia de PIN, ingresar motivo y PIN
        const pinInput = await page.$('input[type="password"]');
        if (pinInput) {
          const reasonInput = await page.$('input[placeholder*="recién recibidos"]');
          if (reasonInput) await reasonInput.fill('Envío de refuerzo 30 hamburguesas y 50 perros');
          await pinInput.fill('654321');
          await page.waitForTimeout(300);
          const confirmAgainBtn = await page.$('button:has-text("Confirmar y Crear Nota de Despacho")');
          if (confirmAgainBtn) await confirmAgainBtn.click();
          await page.waitForTimeout(1200);
        }

        // Capturar Modal de Nota de Despacho Exitosa con Ticket IR
        await page.screenshot({
          path: path.join(capturesDir, '03-nota-despacho-ticket-ir-pdf.png'),
          fullPage: false
        });
        console.log('✅ Capturado: 03-nota-despacho-ticket-ir-pdf.png');

        // Cerrar modal de éxito
        const closeSuccess = await page.$('button:has-text("Entendido")');
        if (closeSuccess) await closeSuccess.click();
        await page.waitForTimeout(400);
      }
    }
  }

  // 2. Modal de Producción en Sede A
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
  }

  await browser.close();
  console.log('🎉 Todas las capturas de modales completadas con éxito.');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error capturando modales:', err);
  process.exit(1);
});
