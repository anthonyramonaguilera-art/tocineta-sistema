import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const capturesDir = path.join(projectRoot, 'docs/auditoria/capturas');

if (!fs.existsSync(capturesDir)) {
  fs.mkdirSync(capturesDir, { recursive: true });
}

const TABS = [
  { id: 'auth', name: '01_auth_login', isAuthScreen: true },
  { id: 'pos', name: '02_comandero_pos', isAuthScreen: false },
  { id: 'cashier', name: '03_caja_cobros', isAuthScreen: false },
  { id: 'kds', name: '04_cocina_kds', isAuthScreen: false },
  { id: 'menu-admin', name: '05_carta_menu_admin', isAuthScreen: false },
  { id: 'staff', name: '06_personal_staff', isAuthScreen: false },
  { id: 'profitability', name: '07_centro_financiero_rentabilidad', isAuthScreen: false },
  { id: 'health', name: '08_salud_sistema_hardware', isAuthScreen: false },
  { id: 'emergency', name: '09_talonario_contingencia', isAuthScreen: false },
  { id: 'qr-menu', name: '10_menu_digital_qr', isAuthScreen: false }
];

const VIEWPORTS = [
  { width: 390, height: 844, label: '390x844' },
  { width: 768, height: 1024, label: '768x1024' }
];

const THEMES = ['light', 'dark'];

async function getBrowser() {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome' });
  } catch (errChrome) {
    console.log('Chrome launch failed, trying Edge...');
    try {
      return await chromium.launch({ headless: true, channel: 'msedge' });
    } catch (errEdge) {
      console.log('Edge launch failed, trying default chromium...');
      return await chromium.launch({ headless: true });
    }
  }
}

async function run() {
  console.log('🚀 Iniciando generador de capturas Playwright...');
  const browser = await getBrowser();
  const baseUrl = 'http://localhost:3000';

  // Obtener token real del admin
  let adminToken = '';
  let adminUser = null;
  try {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'usr_admin', pin: '123456' })
    });
    const loginData = await loginRes.json();
    if (loginData.token) {
      adminToken = loginData.token;
      adminUser = loginData.user;
      console.log('🔑 Token de sesión obtenido para ADMIN:', adminUser.name);
    }
  } catch (err) {
    console.warn('⚠️ No se pudo obtener sesión por API, usando fallback mock.');
    adminUser = { id: 'usr_admin', name: 'ADMIN', role: 'admin' };
    adminToken = 'mock_jwt_token';
  }

  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      console.log(`\n📸 Capturando resolución ${vp.label} en modo [${theme.toUpperCase()}]...`);
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2
      });

      const page = await context.newPage();

      for (const tab of TABS) {
        const outFileName = `${tab.name}_${vp.label}_${theme}.png`;
        const outPath = path.join(capturesDir, outFileName);

        if (tab.isAuthScreen) {
          // Limpiar storage para ver la pantalla de login
          await page.goto(baseUrl, { waitUntil: 'networkidle' }).catch(() => page.goto(baseUrl));
          await page.evaluate((th) => {
            localStorage.clear();
            localStorage.setItem('tocineta_theme', th);
            if (th === 'dark') document.documentElement.classList.add('dark');
            else document.documentElement.classList.remove('dark');
          }, theme);
          await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
          await page.waitForTimeout(800);
        } else {
          // Simular usuario Admin logueado y modo pro para ver todas las pestañas
          await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
          await page.evaluate(({ th, usr, tok }) => {
            localStorage.setItem('tocineta_user', JSON.stringify(usr));
            localStorage.setItem('tocineta_token', tok);
            localStorage.setItem('tocineta_ui_mode', 'pro');
            localStorage.setItem('tocineta_theme', th);
            if (th === 'dark') document.documentElement.classList.add('dark');
            else document.documentElement.classList.remove('dark');
          }, { th: theme, usr: adminUser, tok: adminToken });

          await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
          await page.waitForTimeout(1000);

          // Si es otra pestaña diferente a pos, hacer clic en ella
          if (tab.id !== 'pos') {
            try {
              // Buscar botón por texto de pestaña o abrir drawer móvil si está en viewport pequeño
              const tabSelector = `button:has-text("${tab.id}")`;
              const isMobile = vp.width <= 500;
              
              // Intentar en el drawer si es móvil
              if (isMobile) {
                const drawerBtn = await page.$('button[aria-label="Menu"], button:has(.lucide-menu), header button');
                if (drawerBtn) {
                  await drawerBtn.click().catch(() => {});
                  await page.waitForTimeout(400);
                }
              }

              // Buscar elemento de pestaña
              const titleMap = {
                cashier: 'Caja',
                kds: 'Plancha',
                'menu-admin': 'Carta',
                staff: 'Personal',
                profitability: 'Financiero',
                health: 'Hardware',
                emergency: 'Talonario',
                'qr-menu': 'QR'
              };

              const searchKeyword = titleMap[tab.id] || tab.id;
              const btn = await page.$(`button:has-text("${searchKeyword}")`);
              if (btn) {
                await btn.click().catch(() => {});
                await page.waitForTimeout(1000);
              }
            } catch (errTab) {
              console.warn(`  ⚠️ No se pudo navegar automáticamente a ${tab.id}:`, errTab.message);
            }
          }
        }

        await page.screenshot({ path: outPath, fullPage: false });
        console.log(`  ✓ Guardada: ${outFileName}`);
      }

      await context.close();
    }
  }

  await browser.close();
  console.log('\n✅ Todas las capturas generadas exitosamente en docs/auditoria/capturas/');
}

run().catch(err => {
  console.error('❌ Error capturando pantallas:', err);
  process.exit(1);
});
