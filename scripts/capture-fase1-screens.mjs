import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const capturesDir = path.join(projectRoot, 'docs/auditoria/capturas/fase1');

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
  console.log('🚀 Iniciando Capturas Oficiales de Fase 1 con Playwright...');
  const baseUrl = 'http://localhost:3000';

  // Verificar si el servidor ya está corriendo
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
      body: JSON.stringify({ username: 'admin', password: 'password123' })
    });
    const loginData = await loginRes.json();
    if (loginData.token) {
      adminToken = loginData.token;
      adminUser = loginData.user;
      console.log('🔑 Token de sesión obtenido para:', adminUser.name);
    }
  } catch (err) {
    console.warn('⚠️ No se pudo autenticar vía API, usando token mock.');
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

      // Función auxiliar para aplicar tema y usuario
      const setupAppState = async (tab = 'home', isLogged = true) => {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.evaluate(
          ({ th, usr, tok, tb, logged }) => {
            localStorage.clear();
            localStorage.setItem('tocineta_theme', th);
            if (th === 'dark') {
              document.documentElement.classList.add('dark');
            } else {
              document.documentElement.classList.remove('dark');
            }
            if (logged && usr) {
              localStorage.setItem('tocineta_user', JSON.stringify(usr));
              localStorage.setItem('tocineta_token', tok);
              localStorage.setItem('tocineta_ui_mode', 'pro');
            }
          },
          { th: theme, usr: adminUser, tok: adminToken, tb: tab, logged: isLogged }
        );
        await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
        await page.waitForTimeout(600);
      };

      // 1. LOGIN
      console.log('  Capturando: Login...');
      await setupAppState('home', false);
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(capturesDir, `01_login_${vp.label}_${theme}.png`)
      });

      // 2. INICIO (ADMIN)
      console.log('  Capturando: Inicio (Admin Dashboard)...');
      await setupAppState('home', true);
      // Asegurarse de que esté en Inicio
      await page.evaluate(() => {
        window.location.hash = '';
      });
      await page.waitForTimeout(600);
      await page.screenshot({
        path: path.join(capturesDir, `02_inicio_${vp.label}_${theme}.png`)
      });

      // 3. CABECERA + MENÚ LATERAL
      console.log('  Capturando: Cabecera y Menú Lateral Abierto...');
      const menuBtn = await page.$('header button[aria-label="Abrir Menú"], header button');
      if (menuBtn) {
        await menuBtn.click();
        await page.waitForTimeout(400);
      }
      await page.screenshot({
        path: path.join(capturesDir, `03_cabecera_menu_${vp.label}_${theme}.png`)
      });

      // 4. TOMAR PEDIDO — PASO 1 (Cliente y Canal)
      console.log('  Capturando: Tomar Pedido — Paso 1 (Cliente y Canal)...');
      await setupAppState('pos', true);
      // Navegar a Tomar Pedido haciendo clic en tarjeta o navegando
      const posBtn = await page.$('button:has-text("Tomar Pedido"), [data-testid="pos-card"]');
      if (posBtn) {
        await posBtn.click().catch(() => {});
        await page.waitForTimeout(500);
      }
      await page.screenshot({
        path: path.join(capturesDir, `04_pos_paso1_${vp.label}_${theme}.png`)
      });

      // 5. TOMAR PEDIDO — PASO 2 (Catálogo Visual 2 Columnas)
      console.log('  Capturando: Tomar Pedido — Paso 2 (Catálogo Visual)...');
      // Llenar nombre de cliente obligatorio para poder avanzar
      const nameInput = await page.$('input[placeholder*="Nombre y Apellido"]');
      if (nameInput) {
        await nameInput.fill('Anthony Aguilera');
      }
      const nextBtn1 = await page.$('footer button:has-text("Ir al Menú"), footer button:has-text("Siguiente")');
      if (nextBtn1) {
        await nextBtn1.click();
        await page.waitForTimeout(600);
      }
      // Agregar un producto para mostrar controles + / -
      const firstProductCard = await page.$('.grid > div');
      if (firstProductCard) {
        await firstProductCard.click();
        await page.waitForTimeout(400);
      }
      await page.screenshot({
        path: path.join(capturesDir, `05_pos_paso2_${vp.label}_${theme}.png`)
      });

      // 6. TOMAR PEDIDO — PASO 3 (Revisión y Totales)
      console.log('  Capturando: Tomar Pedido — Paso 3 (Revisión y Totales)...');
      const nextBtn2 = await page.$('footer button:has-text("Revisar Pedido"), button:has-text("Revisar Pedido")');
      if (nextBtn2) {
        await nextBtn2.click();
        await page.waitForTimeout(600);
      }
      await page.screenshot({
        path: path.join(capturesDir, `06_pos_paso3_${vp.label}_${theme}.png`)
      });

      // 7. UI-KIT
      console.log('  Capturando: UI-Kit de Componentes...');
      await page.goto(`${baseUrl}/#ui-kit`, { waitUntil: 'networkidle' }).catch(() => {});
      await page.evaluate((th) => {
        if (th === 'dark') document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
      }, theme);
      await page.waitForTimeout(700);
      await page.screenshot({
        path: path.join(capturesDir, `07_uikit_${vp.label}_${theme}.png`)
      });

      await context.close();
    }
  }

  await browser.close();

  if (serverProcess) {
    serverProcess.kill();
  }

  console.log('\n🎉 ¡Todas las 28 capturas generadas exitosamente en docs/auditoria/capturas/fase1/!');
}

run().catch((err) => {
  console.error('❌ Error capturando pantallas:', err);
  process.exit(1);
});
