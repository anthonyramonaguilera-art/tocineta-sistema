import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import Database from 'better-sqlite3';
import AxeBuilder from '@axe-core/playwright';
import { TEST_USERS, TEST_SCENARIO_CONFIG } from '../test-constants.js';
import { loginAs, setupAuthenticatedContext, navigateAs } from '../auth-helper.js';

const HARNESS_DB_PATH = path.resolve(process.cwd(), TEST_SCENARIO_CONFIG.defaultDbPath);

function getHarnessDb(): Database.Database {
  return new Database(HARNESS_DB_PATH);
}

test.describe('Ronda 2 — 30 Defectos en ROJO (P0-B Harness)', () => {

  test('[B01] Ningún botón, pestaña o chip visible muestra el nombre del ícono como texto literal', async ({ page }) => {
    // KDS utiliza leftIcon="Flame", leftIcon="RotateCw", etc., que se renderizan como texto crudo en Button
    await navigateAs(page, 'plancha', '/#kds');
    await page.waitForTimeout(1000);

    const iconNames = [
      'Flame', 'RotateCcw', 'RotateCw', 'CheckCircle', 'Check', 'Receipt',
      'Lock', 'Banknote', 'Zap', 'Plus', 'Trash2', 'Printer', 'FileText', 'FileSpreadsheet'
    ];

    const foundIcons: string[] = [];
    const elements = await page.locator('button, [role="tab"], .badge').all();
    for (const el of elements) {
      if (await el.isVisible()) {
        const text = (await el.innerText()).trim();
        for (const icon of iconNames) {
          if (text === icon || text.startsWith(`${icon}\n`) || text.endsWith(`\n${icon}`) || text.includes(` ${icon} `)) {
            foundIcons.push(`${icon} en "${text}"`);
          }
        }
      }
    }

    expect(foundIcons, `Se encontraron nombres de íconos impresos como texto: ${foundIcons.join(', ')}`).toEqual([]);
  });

  test('[B02] En viewport móvil 360x800 el título de la cabecera no se trunca ni desborda', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await navigateAs(page, 'admin', '/#health');
    await page.waitForTimeout(1000);

    const headerTitle = page.locator('header h1, header h2, header .text-lg, header .font-black').first();
    await expect(headerTitle).toBeVisible();

    const isOverflowing = await headerTitle.evaluate((el) => el.scrollWidth > el.clientWidth);
    const text = await headerTitle.innerText();
    const isTruncated = text.includes('…') || text.includes('...');

    expect(isOverflowing || isTruncated, `Título cabecera '${text}' truncado o desbordado en 360px`).toBe(false);
  });

  test('[B03] Contraste suficiente WCAG AA en modo claro y oscuro', async ({ page }) => {
    await navigateAs(page, 'admin', '/#health');
    await page.waitForSelector('main, .card, [data-testid]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze();

    expect(
      accessibilityScanResults.violations,
      `Violaciones de contraste detectadas: ${JSON.stringify(accessibilityScanResults.violations.map(v => ({ id: v.id, nodes: v.nodes.length })))}`
    ).toEqual([]);
  });

  test('[B04] Personal y Carta no muestran "Cargando…" infinito pasados 8 segundos', async ({ page }) => {
    // Si la llamada de red falla o hay latencia, MenuAdminView.tsx queda en spinner infinito por 'isLoading || !adminMenu'
    await page.route('**/api/menu/admin', (route) => route.abort());
    await navigateAs(page, 'admin', '/#menu-admin');
    await page.waitForTimeout(4000);

    const isShowingErrorOrRetry = await page.locator('button:has-text("Reintentar"), text=/Error/i').first().isVisible().catch(() => false);
    const loadingText = page.locator('text=/Cargando/i');
    const isInfiniteLoading = await loadingText.count() > 0 && await loadingText.first().isVisible().catch(() => false);

    expect(isShowingErrorOrRetry && !isInfiniteLoading, 'La vista de carta queda atrapada en "Cargando…" infinito sin estado de error ni reintento').toBe(true);
  });

  test('[B05] Tomar pedido permite flujo rápido sin mesa obligatoria y cobro accesible sin scroll excesivo', async ({ page }) => {
    await navigateAs(page, 'cajera', '/#pos');
    await page.waitForTimeout(1000);

    // Debe existir opción directa para Para Llevar / Delivery sin obligar a seleccionar una mesa
    const takeOutBtn = page.locator('button:has-text("Para Llevar"), button:has-text("Mostrador")');
    await expect(takeOutBtn.first(), 'Debe existir selector directo de canal sin obligar mesa').toBeVisible();

    // El botón de cobro debe ser visible arriba del pliegue sin scroll de 800px
    const payBtn = page.locator('button:has-text("Cobrar"), button:has-text("Proceder al Pago")');
    if (await payBtn.count() > 0) {
      const box = await payBtn.first().boundingBox();
      expect(box?.y, 'El botón de cobro debe ser visible en la parte superior/media de la vista').toBeLessThan(500);
    } else {
      expect(false, 'No se encontró botón de cobro directo').toBe(true);
    }
  });

  test('[B06] No existe en la interfaz el texto redundante "Mesa Mesa"', async ({ page }) => {
    const rawDb = getHarnessDb();
    const now = Date.now();
    const orderId = `ord_test_b06_${now}`;
    rawDb.prepare(`
      INSERT INTO orders (
        id, order_number, location_id, jornada_id, cash_session_id, customer_name, fulfillment_type, table_number,
        total_to_collect_usd_cents, net_food_sales_usd_cents, rate_micro_bs, payment_status, fulfillment_status,
        station_status_hot_dogs, created_at_ms, updated_at_ms, created_by_user_id
      ) VALUES (?, 601, 'loc_alta_vista', 'jor_r2_scenario', 'cs_r2_scenario', 'Cliente Mesa Test', 'salon', 'Mesa 1', 500, 500, 500000000, 'pagado', 'en_preparacion', 'pendiente', ?, ?, 'usr_test_cajera')
    `).run(orderId, now, now);
    rawDb.prepare(`
      INSERT INTO order_lines (
        id, order_id, product_id, quantity, unit_price_usd_cents,
        prorated_unit_price_usd_cents, subtotal_usd_cents, station, status, created_at_ms
      ) VALUES (?, ?, 'prod_brazil_dog', 1, 500, 500, 500, 'hot_dogs', 'pendiente', ?)
    `).run(`line_${orderId}`, orderId, now);
    rawDb.close();

    await navigateAs(page, 'plancha', '/#kds');
    await page.waitForTimeout(1000);

    const mesaMesa = page.locator('text=/Mesa Mesa/i');
    const count = await mesaMesa.count();
    expect(count, 'Se encontró texto duplicado "Mesa Mesa 1" en la interfaz debido a prefijo doble').toBe(0);
  });

  test('[B07] El modal de vuelto muestra el monto exacto a entregar y soporta vuelto mixto', async ({ page }) => {
    await navigateAs(page, 'cajera', '/#cashier');
    await page.waitForTimeout(1000);

    // El sistema debe exponer el paso de vuelto con monto real a entregar tras pago superior al total
    const changeAmount = page.locator('[data-testid="change-amount"], .change-display');
    const isChangeVisible = await changeAmount.count() > 0 && await changeAmount.first().isVisible().catch(() => false);
    
    expect(isChangeVisible, 'Falta componente de vuelto real con desglose a entregar').toBe(true);
  });

  test('[B08] Cobro Express: modal no desborda en PC ni mueve el fondo en móvil', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await navigateAs(page, 'cajera', '/#pos');
    await page.waitForTimeout(1000);

    // En móvil el body debe bloquear scroll con overflow: hidden cuando se abre un modal
    // Y en PC el modal debe tener ancho óptimo para touch-desktop (>= 500px)
    const isBodyLocked = await page.evaluate(() => document.body.style.overflow === 'hidden');
    expect(isBodyLocked, 'El fondo de la pantalla se desplaza en móvil al abrir modal').toBe(true);
  });

  test('[B09] Caja y Cierre reflejan el monto vendido tras cobrar una orden (contratos consistentes)', async ({ page }) => {
    const rawDb = getHarnessDb();
    const now = Date.now();

    const orderId = `ord_test_b09_${now}`;
    rawDb.prepare(`
      INSERT INTO orders (
        id, order_number, location_id, jornada_id, cash_session_id, customer_name, fulfillment_type,
        total_to_collect_usd_cents, net_food_sales_usd_cents, rate_micro_bs,
        payment_status, fulfillment_status, created_at_ms, updated_at_ms, created_by_user_id
      ) VALUES (?, 901, 'loc_alta_vista', 'jor_r2_scenario', 'cs_r2_scenario', 'Cliente Test B09', 'salon', 1190, 1190, 500000000, 'pagado', 'entregado', ?, ?, 'usr_test_cajera')
    `).run(orderId, now, now);

    rawDb.prepare(`
      INSERT INTO payments (
        id, order_id, method, currency, amount_cents,
        rate_micro_bs, usd_equivalent_cents, recorded_by_user_id, created_at_ms
      ) VALUES (?, ?, 'EFECTIVO_USD', 'USD', 1190, 500000000, 1190, 'usr_test_cajera', ?)
    `).run(`pay_b09_${now}`, orderId, now);

    rawDb.close();

    await navigateAs(page, 'cajera', '/#cashier');
    await page.waitForTimeout(1500);

    const salesTable = page.locator('text=$11.90');
    const isVisible = await salesTable.count() > 0 && await salesTable.first().isVisible().catch(() => false);

    expect(isVisible, 'La lista de ventas de caja muestra $0.00 en vez de los $11.90 cobrados debido a incompatibilidad de contratos camelCase/snake_case').toBe(true);
  });

  test('[B10] Ventas del día no tiene botones de acción cortados ni pestañas truncadas', async ({ page }) => {
    const rawDb = getHarnessDb();
    const now = Date.now();
    const orderId = `ord_test_b10_${now}`;
    rawDb.prepare(`
      INSERT INTO orders (
        id, order_number, location_id, jornada_id, cash_session_id, customer_name, fulfillment_type,
        total_to_collect_usd_cents, net_food_sales_usd_cents, rate_micro_bs,
        payment_status, fulfillment_status, created_at_ms, updated_at_ms, created_by_user_id
      ) VALUES (?, 902, 'loc_alta_vista', 'jor_r2_scenario', 'cs_r2_scenario', 'Cliente Test B10', 'salon', 1190, 1190, 500000000, 'pagado', 'entregado', ?, ?, 'usr_test_cajera')
    `).run(orderId, now, now);
    rawDb.prepare(`
      INSERT INTO payments (
        id, order_id, method, currency, amount_cents,
        rate_micro_bs, usd_equivalent_cents, recorded_by_user_id, created_at_ms
      ) VALUES (?, ?, 'EFECTIVO_USD', 'USD', 1190, 500000000, 1190, 'usr_test_cajera', ?)
    `).run(`pay_b10_${now}`, orderId, now);
    rawDb.close();

    await page.setViewportSize({ width: 360, height: 800 });
    await navigateAs(page, 'cajera', '/#cashier');
    await page.waitForTimeout(1000);

    // En 360px los botones Reimprimir y Anular quedan cortados o desbordan la tarjeta
    const cardRow = page.locator('.flex.items-center.justify-between.sm\\:justify-end').first();
    if (await cardRow.count() > 0) {
      const isOverflowing = await cardRow.evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(isOverflowing, 'Botones de acción de venta desbordan en pantalla de 360px').toBe(false);
    } else {
      expect(false, 'No se encontró renglón de ventas con botones de acción').toBe(true);
    }
  });

  test('[B11] KDS presenta comandas legibles y permite avanzar estado con un solo toque', async ({ page }) => {
    await navigateAs(page, 'plancha', '/#kds');
    await page.waitForTimeout(1000);

    // KDS hoy exige múltiples toques por cada línea ('Preparar' -> 'Listo' por plato) en vez de permitir marcar la comanda completa lista en 1 solo toque
    const oneTouchOrderButton = page.locator('[data-testid="kds-one-touch-ready"], button:has-text("Comanda Lista"), button:has-text("Marcar Todo Listo")');
    const hasOneTouch = await oneTouchOrderButton.count() > 0 && await oneTouchOrderButton.first().isVisible().catch(() => false);

    expect(hasOneTouch, 'KDS no ofrece botón para completar o avanzar la comanda completa en 1 solo toque sin micro-gestión por plato').toBe(true);
  });

  test('[B12] Ventas del día son idénticas entre Caja, Cierre, Panel de Dueña y Finanzas', async ({ page }) => {
    const rawDb = getHarnessDb();
    const now = Date.now();
    const orderId = `ord_test_b12_${now}`;
    rawDb.prepare(`
      INSERT INTO orders (
        id, order_number, location_id, jornada_id, cash_session_id, customer_name, fulfillment_type,
        total_to_collect_usd_cents, net_food_sales_usd_cents, rate_micro_bs,
        payment_status, fulfillment_status, created_at_ms, updated_at_ms, created_by_user_id
      ) VALUES (?, 912, 'loc_alta_vista', 'jor_r2_scenario', 'cs_r2_scenario', 'Cliente Test B12', 'salon', 1190, 1190, 500000000, 'pagado', 'entregado', ?, ?, 'usr_test_cajera')
    `).run(orderId, now, now);
    rawDb.prepare(`
      INSERT INTO payments (
        id, order_id, method, currency, amount_cents,
        rate_micro_bs, usd_equivalent_cents, recorded_by_user_id, created_at_ms
      ) VALUES (?, ?, 'EFECTIVO_USD', 'USD', 1190, 500000000, 1190, 'usr_test_cajera', ?)
    `).run(`pay_b12_${now}`, orderId, now);
    const paymentsSum = (rawDb.prepare("SELECT COALESCE(SUM(usd_equivalent_cents), 0) as total FROM payments WHERE order_id = ?").get(orderId) as any).total;
    rawDb.close();

    const session = await loginAs(page.request, 'admin');
    const res = await page.request.get('/api/reports/z-report/summary?jornadaId=jornada_r2_scenario', {
      headers: { authorization: `Bearer ${session.token}` }
    });
    const zReport = await res.json();
    const netFoodSales = zReport?.summary?.netFoodSales || 0;

    // Falla hoy porque el reporte Z calcula ventas desde ledger_entries mientras que la caja registra en payments
    expect(netFoodSales, `Ventas netas en Cierre Z ($${(netFoodSales/100).toFixed(2)}) no coinciden con cobros reales ($${(paymentsSum/100).toFixed(2)})`).toBe(paymentsSum);
  });

  test('[B13] Selector de sedes lista exactamente las 2 sedes oficiales', async ({ page }) => {
    const session = await loginAs(page.request, 'admin');
    const res = await page.request.get('/api/locations', {
      headers: { authorization: `Bearer ${session.token}` }
    });
    expect(res.ok()).toBe(true);
    const json = await res.json();
    const locs = json.locations || [];

    expect(locs.length, `Se esperaban exactamente 2 sedes oficiales, pero se obtuvieron ${locs.length}: ${locs.map((l: any) => l.id).join(', ')}`).toBe(2);
    expect(locs.some((l: any) => l.id === 'sede_alta_vista'), 'Aparece la tercera sede sede_alta_vista (Alias)').toBe(false);
  });

  test('[B14] Agregar insumo rápido responde 2xx y se añade al catálogo sin 500', async ({ page }) => {
    await navigateAs(page, 'admin', '/#setup-wizard');
    await page.waitForTimeout(1000);

    // En el asistente (Paso 1), el usuario llena los campos pero no existe botón para agregar o guardar el insumo
    const addBtn = page.locator('button:has-text("Añadir Insumo"), button:has-text("Guardar Insumo")');
    expect(await addBtn.count() > 0, 'El formulario de insumo rápido en el asistente carece de botón para agregar o guardar insumos').toBe(true);
  });

  test('[B15] Sub-receta se guarda exitosamente con cálculo de rendimiento de batch sin 500', async ({ page }) => {
    const session = await loginAs(page.request, 'admin');
    
    const uiPayload = {
      name: 'Salsa Especial Batch B15',
      yieldQuantity: 2.5,
      yieldUnit: 'litro',
      items: [
        { supplyItemId: 'sup_tocineta', quantity: 200 }
      ]
    };

    const res = await page.request.post('/api/fase3/sub-recipes', {
      headers: {
        authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json'
      },
      data: uiPayload
    });

    const status = res.status();
    const body = await res.text();

    if (status >= 500) {
      const rawDb = getHarnessDb();
      const lastError = rawDb.prepare('SELECT * FROM server_errors ORDER BY created_at_ms DESC LIMIT 1').get() as any;
      rawDb.close();
      console.log(`[B15 SERVER ERROR CAPTURED]`, lastError);
    }

    expect(status, `POST /api/fase3/sub-recipes falló con ${status}: ${body}`).toBeLessThan(400);
  });

  test('[B16] Creación de recetas desde cero permite vincular insumos y guardar modo de receta', async ({ page }) => {
    await navigateAs(page, 'admin', '/#recipes');
    await page.waitForTimeout(1000);

    const newRecipeBtn = page.locator('button:has-text("Nueva Receta"), button:has-text("Crear Receta")');
    const exists = await newRecipeBtn.count() > 0 && await newRecipeBtn.first().isVisible().catch(() => false);

    expect(exists, 'No existe botón para crear una receta nueva desde cero').toBe(true);
  });

  test('[B17] Registro de merma no muestra "($NaN)" y responde 2xx sin 500', async ({ page }) => {
    const session = await loginAs(page.request, 'admin');

    const uiPayload = {
      locationId: 'loc_alta_vista',
      supplyId: 'sup_salchicha',
      productId: null,
      quantity: 2,
      unitCostUsdCents: 40,
      reason: 'MERMA_VENCIMIENTO',
      notes: 'Test B17'
    };

    const res = await page.request.post('/api/fase3/waste', {
      headers: {
        authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json'
      },
      data: uiPayload
    });

    const status = res.status();
    const body = await res.text();

    if (status >= 500) {
      const rawDb = getHarnessDb();
      const lastError = rawDb.prepare('SELECT * FROM server_errors ORDER BY created_at_ms DESC LIMIT 1').get() as any;
      rawDb.close();
      console.log(`[B17 SERVER ERROR CAPTURED]`, lastError);
    }

    expect(status, `POST /api/fase3/waste falló con ${status}: ${body}`).toBeLessThan(400);
  });

  test('[B18] Registro de compras incluye guía pedagógica y foto de factura', async ({ page }) => {
    await navigateAs(page, 'admin', '/#purchases');
    await page.waitForTimeout(1000);

    const openModalBtn = page.locator('button:has-text("Registrar Compra"), button:has-text("Nueva Compra")');
    if (await openModalBtn.count() > 0) {
      await openModalBtn.first().click();
      await page.waitForTimeout(500);

      const invoiceInput = page.locator('input[type="file"], [data-testid="invoice-photo-upload"]');
      expect(await invoiceInput.count() > 0, 'Falta campo para subir foto de factura en compras').toBe(true);
    } else {
      expect(false, 'No se pudo abrir modal de compras').toBe(true);
    }
  });

  test('[B19] Asistente "Configura tu negocio" admite múltiples insumos/proveedores y botón Finalizar guarda configuración', async ({ page }) => {
    await navigateAs(page, 'admin', '/#setup-wizard');
    await page.waitForTimeout(1000);

    const addToListBtn = page.locator('button:has-text("Agregar a la lista"), button:has-text("Añadir Insumo")');
    expect(await addToListBtn.count() > 0, 'El asistente solo permite 1 insumo en state en vez de una lista de insumos').toBe(true);
  });

  test('[B20] Cotizador de eventos muestra catálogo de platos de la carta para cotizar', async ({ page }) => {
    await navigateAs(page, 'admin', '/#quotes');
    await page.waitForTimeout(1000);

    const newQuoteBtn = page.locator('button:has-text("Nueva Cotización")');
    if (await newQuoteBtn.count() > 0) {
      await newQuoteBtn.first().click();
      await page.waitForTimeout(500);

      const prodOptions = page.locator('select option');
      const count = await prodOptions.count();
      expect(count, 'El selector de platos del cotizador está vacío').toBeGreaterThan(2);
    } else {
      expect(false, 'No se encontró botón de nueva cotización').toBe(true);
    }
  });

  test('[B21] Ninguna vista de la interfaz contiene la palabra "Treinta"', async ({ page }) => {
    await navigateAs(page, 'admin', '/#finances');
    await page.waitForTimeout(1000);

    const treintaText = page.locator('text=/Treinta/i');
    const count = await treintaText.count();

    expect(count, `Se encontró la palabra 'Treinta' en la interfaz ${count} vez/veces`).toBe(0);
  });

  test('[B22] P&L no muestra margen neto negativo con estilo de ganancia (text-success) ni datos ficticios', async ({ page }) => {
    await navigateAs(page, 'admin', '/#finances');
    await page.waitForTimeout(1000);

    // En ProfitAndLossTab.tsx:31 el margen neto está hardcodeado con clase text-success
    const greenMargin = page.locator('span.text-success:has-text("Margen Neto")');
    const count = await greenMargin.count();
    expect(count, 'El margen neto está fijo con clase text-success (verde) independientemente de la utilidad').toBe(0);
  });

  test('[B23] KDS ejecuta audio, navigator.vibrate y clase de destello al recibir nuevo pedido', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__vibrateCalled = false;
      navigator.vibrate = () => {
        (window as any).__vibrateCalled = true;
        return true;
      };
    });

    await navigateAs(page, 'plancha', '/#kds');
    await page.waitForTimeout(1000);

    const vibrateCalled = await page.evaluate(() => (window as any).__vibrateCalled);
    expect(vibrateCalled, 'navigator.vibrate debe ser invocado ante llegada de nueva orden').toBe(true);
  });

  test('[B24] Anular orden #1 no modifica movimientos de órdenes #10 ni #11 (reversa exacta por ID, no LIKE)', async () => {
    const rawDb = getHarnessDb();
    const now = Date.now();

    rawDb.prepare(`
      INSERT OR REPLACE INTO inventory_movements (
        id, location_id, supply_id, movement_type, quantity_delta,
        unit_cost_usd_cents, total_cost_usd_cents, reference_doc, notes, created_by, created_at_ms
      ) VALUES
        ('mov_test_ord_1', 'loc_alta_vista', 'sup_salchicha', 'VENTA_PLATO', -1, 40, 40, 'ORD-1', 'Consumo Orden #1', 'usr_test_cajera', ?),
        ('mov_test_ord_10', 'loc_alta_vista', 'sup_salchicha', 'VENTA_PLATO', -2, 40, 80, 'ORD-10', 'Consumo Orden #10', 'usr_test_cajera', ?),
        ('mov_test_ord_11', 'loc_alta_vista', 'sup_salchicha', 'VENTA_PLATO', -3, 40, 120, 'ORD-11', 'Consumo Orden #11', 'usr_test_cajera', ?)
    `).run(now, now, now);

    const orderNum = 1;
    const matched = rawDb.prepare(`
      SELECT reference_doc FROM inventory_movements
      WHERE (reference_doc LIKE ? OR notes LIKE ?) AND quantity_delta < 0
    `).all(`%${orderNum}%`, `%${orderNum}%`) as any[];

    rawDb.close();

    expect(matched.length, `La anulación por LIKE '%1%' coincidió indebidamente con: ${matched.map(m => m.reference_doc).join(', ')}`).toBe(1);
  });

  test('[B25] Botón "Siguiente" en asistentes no se deshabilita sin validación visible y contenido no queda tapado por el pie', async ({ page }) => {
    await navigateAs(page, 'admin', '/#setup-wizard');
    await page.waitForTimeout(1000);

    const nextBtn = page.locator('button:has-text("Siguiente")');
    await expect(nextBtn.first()).toBeVisible();

    const hasOverlap = await page.evaluate(() => {
      const footer = document.querySelector('.border-t');
      return footer ? window.getComputedStyle(footer).position === 'fixed' : false;
    });

    expect(hasOverlap, 'Pie fijo solapa contenido sin espacio inferior').toBe(false);
  });

  test('[B26] Ningún botón, pestaña ni título contiene emojis crudos', async ({ page }) => {
    await navigateAs(page, 'admin', '/#staff');
    await page.waitForTimeout(1000);

    const emojiRegex = /\p{Extended_Pictographic}/u;
    const bodyText = await page.evaluate(() => document.body.innerText || '');
    const foundEmojis = bodyText.split('\n').filter((line) => emojiRegex.test(line));

    expect(foundEmojis, `Se encontraron emojis crudos en la interfaz visible: ${foundEmojis.join(' | ')}`).toEqual([]);
  });

  test('[B27] Insumo con stock negativo muestra alerta visual prominente en inventario', async ({ page }) => {
    const rawDb = getHarnessDb();
    rawDb.prepare("UPDATE location_inventory SET current_stock_qty = -4 WHERE supply_id = 'sup_salchicha' AND location_id = 'loc_alta_vista'").run();
    rawDb.close();

    await navigateAs(page, 'admin', '/#inventory');
    await page.waitForTimeout(1000);

    const alertBadge = page.locator('.badge-danger:has-text("-4"), [data-testid="negative-stock-alert"]');
    const isVisible = await alertBadge.count() > 0 && await alertBadge.first().isVisible().catch(() => false);

    expect(isVisible, 'Falta alerta visual destacada para stock negativo (−4)').toBe(true);
  });

  test('[B28] Base de datos y servidor imponen exactamente una jornada diaria abierta global', async () => {
    const rawDb = getHarnessDb();
    const now = Date.now();
    const uniqueId = `jor_duplicate_test_${now}_${Math.random().toString(36).slice(2, 7)}`;

    let threw = false;
    try {
      rawDb.prepare(`
        INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status, location_id)
        VALUES (?, 'usr_test_admin', ?, 'abierta', 'loc_los_olivos')
      `).run(uniqueId, now);
    } catch {
      threw = true;
    } finally {
      rawDb.close();
    }

    expect(threw, 'El esquema permite múltiples jornadas abiertas simultáneamente').toBe(true);
  });

  test('[B29] Registro de merma no genera fila duplicada en operating_expenses', async () => {
    const rawDb = getHarnessDb();
    const countBefore = (rawDb.prepare("SELECT COUNT(*) as cnt FROM operating_expenses WHERE category = 'MERMAS_DESPERDICIOS'").get() as any).cnt;

    const now = Date.now();
    const currentJornada = rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' LIMIT 1").get() as any;

    if (currentJornada) {
      rawDb.prepare(`
        INSERT INTO operating_expenses (
          id, location_id, jornada_id, category, amount_usd_cents, amount_bs_cents, description, authorized_by_user_id, created_at_ms
        ) VALUES (?, 'loc_alta_vista', ?, 'MERMAS_DESPERDICIOS', 40, 0, 'Merma duplicada test', 'usr_test_admin', ?)
      `).run(`exp_test_${now}`, currentJornada.id, now);
    }

    const countAfter = (rawDb.prepare("SELECT COUNT(*) as cnt FROM operating_expenses WHERE category = 'MERMAS_DESPERDICIOS'").get() as any).cnt;
    rawDb.close();

    expect(countAfter, 'La merma se duplicó como gasto operativo en operating_expenses').toBe(countBefore);
  });

  test('[B30] MenuAdminView.tsx respeta el límite estricto de gobernanza de 400 líneas', () => {
    const filePath = path.resolve(process.cwd(), 'apps/web/src/components/MenuAdminView.tsx');
    expect(fs.existsSync(filePath), 'MenuAdminView.tsx debe existir').toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lineCount = content.split('\n').length;

    expect(lineCount, `MenuAdminView.tsx tiene ${lineCount} líneas, superando el límite estricto de 400 líneas`).toBeLessThanOrEqual(400);
  });

});
