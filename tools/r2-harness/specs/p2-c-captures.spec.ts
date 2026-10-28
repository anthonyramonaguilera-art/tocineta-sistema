import { test } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { navigateAs } from '../auth-helper.js';

const EVIDENCIA_DIR = path.resolve(process.cwd(), 'docs/r2/evidencia/P2-C');

test.describe('P2-C Capturas Visuales (360x800 y 1280x800)', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(EVIDENCIA_DIR)) {
      fs.mkdirSync(EVIDENCIA_DIR, { recursive: true });
    }
  });

  test('01-caja-360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await navigateAs(page, 'cajera', '/#cashier');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '01-caja-360px.png'), fullPage: true });
  });

  test('01-caja-1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateAs(page, 'cajera', '/#cashier');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '01-caja-1280px.png'), fullPage: true });
  });

  test('02-cierre-360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await navigateAs(page, 'admin', '/#cashier');
    await page.waitForTimeout(1500);
    const tab = page.locator('button, [role="tab"]').filter({ hasText: /Cierre de caja/i }).first();
    if (await tab.count() > 0) {
      await tab.click();
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '02-cierre-360px.png'), fullPage: true });
  });

  test('02-cierre-1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateAs(page, 'admin', '/#cashier');
    await page.waitForTimeout(1500);
    const tab = page.locator('button, [role="tab"]').filter({ hasText: /Cierre de caja/i }).first();
    if (await tab.count() > 0) {
      await tab.click();
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '02-cierre-1280px.png'), fullPage: true });
  });

  test('03-ventas-dia-360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await navigateAs(page, 'cajera', '/#cashier');
    await page.waitForTimeout(1500);
    const tab = page.locator('button, [role="tab"]').filter({ hasText: /Ventas del d/i }).first();
    if (await tab.count() > 0) {
      await tab.click();
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '03-ventas-dia-360px.png'), fullPage: true });
  });

  test('03-ventas-dia-1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateAs(page, 'cajera', '/#cashier');
    await page.waitForTimeout(1500);
    const tab = page.locator('button, [role="tab"]').filter({ hasText: /Ventas del d/i }).first();
    if (await tab.count() > 0) {
      await tab.click();
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '03-ventas-dia-1280px.png'), fullPage: true });
  });

  test('04-finanzas-pnl-360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await navigateAs(page, 'admin', '/#finances');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '04-finanzas-pnl-360px.png'), fullPage: true });
  });

  test('04-finanzas-pnl-1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateAs(page, 'admin', '/#finances');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '04-finanzas-pnl-1280px.png'), fullPage: true });
  });

  test('05-cobro-express-360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await navigateAs(page, 'cajera', '/#pos');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '05-cobro-express-360px.png'), fullPage: true });
  });

  test('05-cobro-express-1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateAs(page, 'cajera', '/#pos');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '05-cobro-express-1280px.png'), fullPage: true });
  });

  test('06-panel-duena-1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateAs(page, 'admin', '/#owner');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(EVIDENCIA_DIR, '06-panel-duena-1280px.png'), fullPage: true });
  });
});
