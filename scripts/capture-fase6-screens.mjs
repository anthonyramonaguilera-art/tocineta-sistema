import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const capturesDir = path.join(projectRoot, 'docs/auditoria/capturas/fase6');

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
  console.log('🚀 Iniciando Capturas Oficiales de Fase 6 (Playwright)...');
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
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const loginData = await loginRes.json();
    if (loginData.token) {
      adminToken = loginData.token;
      adminUser = { ...loginData.user, mustChangePin: false };
      console.log('🔑 Sesión autenticada como:', adminUser.name);
    }
  } catch (err) {
    console.warn('⚠️ No se pudo autenticar vía login:', err.message);
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`
  };

  // 2. Sembrar datos para auditoría visual si no existen
  try {
    console.log('🌱 Sembrando perfiles reales y nómina para auditoría...');
    await fetch(`${baseUrl}/api/staff/payroll/settings`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        payrollEnabled: true,
        fixedDinnerEnabled: true,
        fixedDinnerCostUsdCents: 250
      })
    });

    const usersRes = await fetch(`${baseUrl}/api/admin/users`, { headers: authHeaders });
    const usersData = await usersRes.json();
    const existingUsers = usersData.users || [];

    let lucia = existingUsers.find((u) => u.username === 'lmendez');
    if (!lucia) {
      const createRes = await fetch(`${baseUrl}/api/admin/users`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'Lucía Méndez',
          username: 'lmendez',
          role: 'mesonero',
          pin: '2244',
          salaryScheme: 'SEMANAL',
          baseSalaryUsdCents: 5000
        })
      });
      const created = await createRes.json();
      lucia = created.user;
    }

    let pedro = existingUsers.find((u) => u.username === 'pgomez');
    if (!pedro) {
      await fetch(`${baseUrl}/api/admin/users`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'Pedro Gómez',
          username: 'pgomez',
          role: 'cocinero',
          pin: '3355',
          salaryScheme: 'QUINCENAL',
          baseSalaryUsdCents: 12000
        })
      });
    }

    let sofia = existingUsers.find((u) => u.username === 'srivas');
    if (!sofia) {
      await fetch(`${baseUrl}/api/admin/users`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'Sofía Rivas',
          username: 'srivas',
          role: 'cajera',
          pin: '4466',
          salaryScheme: 'SEMANAL',
          baseSalaryUsdCents: 6000
        })
      });
    }

    let juan = existingUsers.find((u) => u.username === 'jdespacho');
    if (!juan) {
      await fetch(`${baseUrl}/api/admin/users`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'Juan Despacho',
          username: 'jdespacho',
          role: 'despachador',
          pin: '5577',
          salaryScheme: 'DIARIO',
          baseSalaryUsdCents: 1500
        })
      });
    }

    // Si tenemos a Lucía, sembrar ajustes y consumos
    if (lucia) {
      await fetch(`${baseUrl}/api/staff/payroll/adjustments`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          userId: lucia.id,
          type: 'bono',
          amountUsdCents: 1500,
          notes: 'Bono por puntualidad y excelente atención al cliente'
        })
      });

      await fetch(`${baseUrl}/api/staff/payroll/adjustments`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          userId: lucia.id,
          type: 'adelanto',
          amountUsdCents: 1000,
          notes: 'Adelanto de quincena solicitado'
        })
      });

      await fetch(`${baseUrl}/api/staff/consumptions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          userId: lucia.id,
          itemDescription: 'Hamburguesa Doble Especial',
          amountUsdCents: 400,
          isFixedDinner: false
        })
      });

      await fetch(`${baseUrl}/api/staff/consumptions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          userId: lucia.id,
          itemDescription: 'Refresco Familiar 1.5L',
          amountUsdCents: 300,
          isFixedDinner: false
        })
      });

      await fetch(`${baseUrl}/api/staff/consumptions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          userId: lucia.id,
          itemDescription: 'Cena de Personal (Turno Noche)',
          amountUsdCents: 250,
          isFixedDinner: true
        })
      });
    }

    console.log('✅ Datos de prueba sembrados exitosamente.');
  } catch (seedErr) {
    console.warn('⚠️ Advertencia sembrando datos:', seedErr.message);
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  // CAPTURA 0: Semilla de Instalación con Cambio Obligatorio de Clave
  console.log('📸 0. Capturando Modal Cambio Obligatorio de Clave (Semilla)...');
  const seedContext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    colorScheme: 'light'
  });
  const seedPage = await seedContext.newPage();
  await seedPage.addInitScript(
    ({ tok, u }) => {
      localStorage.setItem('tocineta_theme', 'light');
      localStorage.setItem('tocineta_ui_mode', 'pro');
      localStorage.setItem('tocineta_token', tok);
      localStorage.setItem('tocineta_user', JSON.stringify({ ...u, mustChangePin: true }));
    },
    { tok: adminToken, u: adminUser }
  );
  await seedPage.goto(`${baseUrl}/#staff`, { waitUntil: 'networkidle' });
  await seedPage.waitForTimeout(800);
  await seedPage.screenshot({
    path: path.join(capturesDir, '00_semilla_cambio_obligatorio_pin.png'),
    fullPage: false
  });
  await seedContext.close();

  // CONTEXTO PRINCIPAL (Modo Operativo Normal con PIN Actualizado)
  console.log('📸 1. Capturando Personal y Permisos (Desktop)...');
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    colorScheme: 'light'
  });
  const page = await context.newPage();
  await page.addInitScript(
    ({ tok, u }) => {
      localStorage.setItem('tocineta_theme', 'light');
      localStorage.setItem('tocineta_ui_mode', 'pro');
      localStorage.setItem('tocineta_token', tok);
      localStorage.setItem('tocineta_user', JSON.stringify({ ...u, mustChangePin: false }));
    },
    { tok: adminToken, u: adminUser }
  );

  await page.goto(`${baseUrl}/#staff`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(capturesDir, '01_personal_permisos_view.png'),
    fullPage: false
  });

  // CAPTURA 1-MÓVIL
  console.log('📸 1-Móvil. Capturando Personal y Permisos (390x844)...');
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'light'
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.addInitScript(
    ({ tok, u }) => {
      localStorage.setItem('tocineta_theme', 'light');
      localStorage.setItem('tocineta_ui_mode', 'pro');
      localStorage.setItem('tocineta_token', tok);
      localStorage.setItem('tocineta_user', JSON.stringify({ ...u, mustChangePin: false }));
    },
    { tok: adminToken, u: adminUser }
  );
  await mobilePage.goto(`${baseUrl}/#staff`, { waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(1000);
  await mobilePage.screenshot({
    path: path.join(capturesDir, '01_personal_permisos_view-mobile.png'),
    fullPage: false
  });
  await mobileContext.close();

  // CAPTURA 2: MODAL NUEVO EMPLEADO
  console.log('📸 2. Capturando Modal Nuevo Empleado...');
  const newEmpBtn = page.getByRole('button', { name: /Nuevo Empleado/i });
  await newEmpBtn.click();
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(capturesDir, '02_nuevo_empleado_modal.png'),
    fullPage: false
  });
  const cancelEmpBtn = page.getByRole('button', { name: /Cancelar/i });
  if (await cancelEmpBtn.count()) {
    await cancelEmpBtn.click();
    await page.waitForTimeout(400);
  }

  // CAPTURA 3: MODAL PERMISOS GRANULARES
  console.log('📸 3. Capturando Modal Permisos Granulares...');
  const permisosBtns = page.getByRole('button', { name: /Permisos/i });
  const countPerm = await permisosBtns.count();
  if (countPerm > 0) {
    const idx = countPerm > 1 ? 1 : 0;
    await permisosBtns.nth(idx).click();
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(capturesDir, '03_permisos_granulares_modal.png'),
      fullPage: false
    });
    const cancelPermBtn = page.getByRole('button', { name: /Cancelar/i });
    if (await cancelPermBtn.count()) {
      await cancelPermBtn.click();
      await page.waitForTimeout(400);
    }
  }

  // CAPTURA 4: PESTAÑA NÓMINA Y LIQUIDACIÓN
  console.log('📸 4. Capturando Nómina y Liquidación...');
  const payrollTabBtn = page.getByRole('button', { name: /Nómina y Liquidación/i });
  await payrollTabBtn.click();
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(capturesDir, '04_nomina_ajustes_view.png'),
    fullPage: false
  });

  // CAPTURA 5: MODAL LIQUIDACIÓN INTERACTIVA
  console.log('📸 5. Capturando Modal Liquidación Interactiva (Lucía Méndez)...');
  const settleBtn = page.getByRole('button', { name: /Liquidar Período y Emitir Recibo/i });
  if (await settleBtn.count()) {
    await settleBtn.click();
    await page.waitForTimeout(800);

    // Seleccionar a Lucía Méndez en el select
    const selectEmp = page.locator('select').first();
    const luciaOption = page.locator('select option:has-text("Lucía")');
    if (await luciaOption.count()) {
      const val = await luciaOption.getAttribute('value');
      if (val) {
        await selectEmp.selectOption(val);
        await page.waitForTimeout(1000);
      }
    }

    // Desmarcar el segundo consumo para demostrar que la dueña perdona/cortesía
    const checkBoxes = page.locator('input[type="checkbox"]');
    const boxCount = await checkBoxes.count();
    if (boxCount >= 2) {
      await checkBoxes.nth(1).uncheck();
      await page.waitForTimeout(500);
    }

    await page.screenshot({
      path: path.join(capturesDir, '05_liquidacion_modal_seleccion.png'),
      fullPage: false
    });

    const cancelSettleBtn = page.getByRole('button', { name: /Cancelar/i });
    if (await cancelSettleBtn.count()) {
      await cancelSettleBtn.click();
      await page.waitForTimeout(400);
    }
  }

  // CAPTURA 6: PESTAÑA POOL DE PROPINAS
  console.log('📸 6. Capturando Pool de Propinas...');
  const tipsTabBtn = page.getByRole('button', { name: /Pool de Propinas/i });
  await tipsTabBtn.click();
  await page.waitForTimeout(800);

  // Llenar monto de propina y presionar "+ Sumar"
  const usdInput = page.locator('input[placeholder="0.00"]').first();
  if (await usdInput.count()) {
    await usdInput.fill('40.00');
    const sumarBtn = page.getByRole('button', { name: /\+ Sumar/i });
    if (await sumarBtn.count()) {
      await sumarBtn.click();
      await page.waitForTimeout(800);
    }
  }

  // Cambiar a modo ponderado por horas
  const hoursModeBtn = page.getByRole('button', { name: /Por Horas Trabajadas/i });
  if (await hoursModeBtn.count()) {
    await hoursModeBtn.click();
    await page.waitForTimeout(400);
  }

  // Seleccionar meseros del turno
  const waiterCheckboxes = page.locator('input[type="checkbox"]');
  const waiterCount = await waiterCheckboxes.count();
  for (let i = 0; i < waiterCount; i++) {
    await waiterCheckboxes.nth(i).check();
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(capturesDir, '06_pool_propinas_view.png'),
    fullPage: false
  });

  await context.close();
  await browser.close();

  if (serverProcess) {
    console.log('Deteniendo servidor background...');
    serverProcess.kill('SIGINT');
  }

  console.log('🎉 Todas las capturas oficiales de Fase 6 se completaron exitosamente en docs/auditoria/capturas/fase6');
}

run().catch((err) => {
  console.error('❌ Error capturando pantallas:', err);
  process.exit(1);
});
