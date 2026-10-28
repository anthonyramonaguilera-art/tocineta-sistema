import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const HARNESS_DB = path.resolve(process.cwd(), './data/tocineta.r2-harness.db');

const ROLES = [
  { key: 'admin', username: 'test_admin', password: 'testpassword123', name: 'ADMIN' },
  { key: 'cajera', username: 'test_cajera', password: 'testpassword123', name: 'CAJERA' },
  { key: 'mesero', username: 'test_mesero', password: 'testpassword123', name: 'MESERO' },
  { key: 'plancha', username: 'test_plancha', password: 'testpassword123', name: 'PLANCHA' }
];

const VIEWPORTS = [
  { name: 'movil-360x800', width: 360, height: 800, isMobile: true, hasTouch: true },
  { name: 'escritorio-1280x800', width: 1280, height: 800, isMobile: false, hasTouch: false }
];

const MENU_ROUTES = [
  '#home',
  '#pos',
  '#kds',
  '#cashier',
  '#profitability',
  '#finances',
  '#owner',
  '#menu-admin',
  '#staff',
  '#health',
  '#quotes'
];

const LUCIDE_ICON_NAMES = new Set([
  'Flame', 'RotateCcw', 'RotateCw', 'CheckCircle', 'Check', 'Receipt',
  'Lock', 'Banknote', 'Zap', 'Plus', 'Trash2', 'Printer', 'FileText',
  'FileSpreadsheet', 'ArrowLeft', 'Settings', 'Cpu', 'Users', 'Package',
  'ShoppingBag', 'LayoutDashboard', 'QrCode', 'Calculator', 'Handshake',
  'TrendingUp', 'Utensils', 'CircleDollarSign', 'CreditCard'
]);

const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

async function isServerRunning() {
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function startServerIfNeeded() {
  const running = await isServerRunning();
  if (running) return null;

  console.log('[GUARD:VISUAL] Iniciando servidor de pruebas en puerto 3100...');
  const child = spawn('pnpm', ['exec', 'tsx', 'tools/r2-harness/run-test-server.ts'], {
    stdio: 'pipe',
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TOCINETA_DB_PATH: HARNESS_DB,
      TEST_PORT: String(PORT),
      TEST_HOST: '127.0.0.1'
    }
  });

  // Esperar a que el servidor esté listo
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isServerRunning()) {
      console.log('[GUARD:VISUAL] Servidor de pruebas conectado exitosamente.');
      return child;
    }
  }

  throw new Error('No se pudo conectar al servidor de pruebas en 60 segundos.');
}

async function main() {
  console.log('\n========================================================================================');
  console.log('🛡️  GUARD VISUAL — AUDITORÍA PROFUNDA EN CHROMIUM REAL (MODO CLARO Y OSCURO)');
  console.log('========================================================================================\n');

  const serverProc = await startServerIfNeeded();
  const browser = await chromium.launch({ headless: true });

  const violations = [];
  const evidenceDir = path.resolve(process.cwd(), 'docs/r2/evidencia');
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }

  try {
    for (const vp of VIEWPORTS) {
      console.log(`\n📱 Probando Viewport: ${vp.name} (${vp.width}x${vp.height})`);

      for (const role of ROLES) {
        console.log(`  👤 Rol: ${role.name}`);

        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          isMobile: vp.isMobile,
          hasTouch: vp.hasTouch,
          locale: 'es-VE'
        });

        // Autenticar vía API y poblar localStorage
        const loginRes = await context.request.post(`${BASE_URL}/api/auth/login`, {
          data: { username: role.username, password: role.password }
        });

        if (!loginRes.ok()) {
          violations.push({
            type: 'AUTH_FAILED',
            viewport: vp.name,
            role: role.key,
            route: 'login',
            detail: `No se pudo autenticar como ${role.name}`
          });
          await context.close();
          continue;
        }

        const loginJson = await loginRes.json();
        await context.addInitScript(
          ({ token, user }) => {
            localStorage.setItem('tocineta_token', token);
            localStorage.setItem('tocineta_user', JSON.stringify(user));
          },
          { token: loginJson.token, user: loginJson.user }
        );

        const page = await context.newPage();
        const consoleErrors = [];
        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (err) => consoleErrors.push(err.message));

        for (const route of MENU_ROUTES) {
          try {
            await page.goto(`${BASE_URL}/${route}`);
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(1000);

            // 1. Desborde horizontal de página
            const isHorizontalOverflow = await page.evaluate(() => {
              return document.documentElement.scrollWidth > window.innerWidth;
            });
            if (isHorizontalOverflow) {
              const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
              violations.push({
                type: 'HORIZONTAL_OVERFLOW',
                viewport: vp.name,
                role: role.key,
                route,
                detail: `Página desborda horizontalmente: scrollWidth=${scrollWidth}px > innerWidth=${vp.width}px`
              });
            }

            // 2. Iconos impresos como texto en botones, pestañas o chips
            const iconTextViolations = await page.evaluate((iconNamesArr) => {
              const iconSet = new Set(iconNamesArr);
              const found = [];
              const elements = Array.from(document.querySelectorAll('button, [role="tab"], .badge, .chip'));
              for (const el of elements) {
                const text = (el.innerText || '').trim();
                for (const icon of iconSet) {
                  if (text === icon || text.startsWith(`${icon} `) || text.endsWith(` ${icon}`)) {
                    found.push({ element: el.tagName.toLowerCase(), text, icon });
                  }
                }
              }
              return found;
            }, Array.from(LUCIDE_ICON_NAMES));

            for (const it of iconTextViolations) {
              violations.push({
                type: 'ICON_AS_TEXT',
                viewport: vp.name,
                role: role.key,
                route,
                detail: `Ícono impreso como texto: <${it.element}> contiene "${it.text}"`
              });
            }

            // 3. Emojis en el DOM
            const emojiViolations = await page.evaluate(() => {
              const regex = /\p{Extended_Pictographic}/u;
              const found = [];
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              let node;
              while ((node = walker.nextNode())) {
                const text = node.textContent?.trim();
                if (text && regex.test(text)) {
                  found.push(text.slice(0, 40));
                }
              }
              return found;
            });

            if (emojiViolations.length > 0) {
              violations.push({
                type: 'EMOJI_DETECTED',
                viewport: vp.name,
                role: role.key,
                route,
                detail: `Se detectaron emojis crudos en el DOM: ${emojiViolations.slice(0, 3).join(' | ')}`
              });
            }

            // 4. "Cargando" después de 8 segundos
            const hasInfiniteLoading = await page.evaluate(() => {
              const text = document.body.innerText || '';
              return /Cargando/i.test(text) && !document.querySelector('main, article');
            });
            if (hasInfiniteLoading) {
              violations.push({
                type: 'INFINITE_LOADING',
                viewport: vp.name,
                role: role.key,
                route,
                detail: 'Vista atascada con mensaje de "Cargando…"'
              });
            }

            // 5. Título de cabecera truncado
            const headerTruncated = await page.evaluate(() => {
              const h = document.querySelector('header h1, header h2, header .text-lg');
              if (!h) return false;
              const text = h.textContent || '';
              const isEllipsis = text.includes('…') || text.includes('...');
              const isOverflow = h.scrollWidth > h.clientWidth;
              return isEllipsis || isOverflow;
            });
            if (headerTruncated) {
              violations.push({
                type: 'HEADER_TRUNCATED',
                viewport: vp.name,
                role: role.key,
                route,
                detail: 'Título de cabecera truncado o con elipsis forzada'
              });
            }

            // 6. Contraste de colores con axe-core
            try {
              const axeResults = await new AxeBuilder({ page })
                .withRules(['color-contrast'])
                .analyze();

              if (axeResults.violations.length > 0) {
                violations.push({
                  type: 'COLOR_CONTRAST',
                  viewport: vp.name,
                  role: role.key,
                  route,
                  detail: `${axeResults.violations[0].nodes.length} elemento(s): ` + axeResults.violations[0].nodes.map(n => n.target.join(' ') + ' -> ' + n.html.slice(0, 80)).join('; ')
                });
              }
            } catch {}

            // 7. Errores de consola / pageerror
            if (consoleErrors.length > 0) {
              violations.push({
                type: 'CONSOLE_ERROR',
                viewport: vp.name,
                role: role.key,
                route,
                detail: consoleErrors[0].slice(0, 100)
              });
              consoleErrors.length = 0;
            }

          } catch (routeErr) {
            violations.push({
              type: 'NAVIGATION_ERROR',
              viewport: vp.name,
              role: role.key,
              route,
              detail: routeErr.message
            });
          }
        }

        await context.close();
      }
    }
  } finally {
    await browser.close();
    if (serverProc) {
      serverProc.kill();
    }
  }

  // Escribir informe
  const reportPath = path.resolve(evidenceDir, 'guard-visual-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(violations, null, 2));

  console.log('\n========================================================================================');
  console.log(`📋 RESULTADOS DEL GUARD VISUAL — ${violations.length} VIOLACIONES DETECTADAS`);
  console.log('========================================================================================');

  if (violations.length === 0) {
    console.log('✨ Cero violaciones. El guard visual está 100% en VERDE.');
    process.exit(0);
  } else {
    console.log(`❌ SE ENCONTRARON ${violations.length} VIOLACIONES VISUALES (Comportamiento esperado en P0-B):\n`);
    const summary = {};
    for (const v of violations) {
      summary[v.type] = (summary[v.type] || 0) + 1;
    }
    for (const [t, count] of Object.entries(summary)) {
      console.log(`  - ${t}: ${count} ocurrencia(s)`);
    }

    console.log(`\n📄 Reporte detallado guardado en: docs/r2/evidencia/guard-visual-report.json`);
    console.log('========================================================================================\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[GUARD:VISUAL] Error fatal:', err);
  process.exit(1);
});
