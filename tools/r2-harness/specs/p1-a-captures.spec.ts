import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { navigateAs } from '../auth-helper.js';

const EVIDENCIA_DIR = path.resolve(process.cwd(), 'docs/r2/evidencia/P1-A');

test.describe('P1-A Capturas Visuales a 360px', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(EVIDENCIA_DIR)) {
      fs.mkdirSync(EVIDENCIA_DIR, { recursive: true });
    }
  });

  test('01 KDS 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await navigateAs(page, 'plancha', '/#kds');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '01-kds-360px.png'), fullPage: true });
  });

  test('02 Caja Cobro 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await navigateAs(page, 'admin', '/#cashier');
    await page.waitForTimeout(1500);
    const tab = page.locator('button, [role="tab"]').filter({ hasText: /Por cobrar/i }).first();
    if (await tab.count() > 0) {
      await tab.click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '02-caja-cobro-360px.png'), fullPage: true });
  });

  test('03 Caja Ventas del dia 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await navigateAs(page, 'admin', '/#cashier');
    await page.waitForTimeout(1500);
    const tab = page.locator('button, [role="tab"]').filter({ hasText: /Ventas del d/i }).first();
    if (await tab.count() > 0) {
      await tab.click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '03-caja-ventas-360px.png'), fullPage: true });
  });

  test('04 Caja Cierre 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await navigateAs(page, 'admin', '/#cashier');
    await page.waitForTimeout(1500);
    const tab = page.locator('button, [role="tab"]').filter({ hasText: /Cierre de caja/i }).first();
    if (await tab.count() > 0) {
      await tab.click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '04-caja-cierre-360px.png'), fullPage: true });
  });

  test('05 Inventario 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await navigateAs(page, 'admin', '/#profitability');
    await page.waitForTimeout(1500);
    const tab = page.locator('button, [role="tab"]').filter({ hasText: /Inventario/i }).first();
    if (await tab.count() > 0) {
      await tab.click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '05-inventario-360px.png'), fullPage: true });
  });

  test('06 Finanzas 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await navigateAs(page, 'admin', '/#finances');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '06-finanzas-360px.png'), fullPage: true });
  });

  test('07 Sidebar Menu 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await navigateAs(page, 'admin', '/#pos');
    await page.waitForTimeout(1500);
    const menuBtn = page.locator('header button').first();
    if (await menuBtn.count() > 0) {
      await menuBtn.click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '07-sidebar-360px.png'), fullPage: true });
  });
});
