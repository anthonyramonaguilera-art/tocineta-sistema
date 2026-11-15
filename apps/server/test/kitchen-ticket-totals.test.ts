import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  buildKitchenTicketIRs,
  buildKitchenTicketJobs,
  type KitchenTicketParams,
  type OrderReceiptData
} from '../src/modules/printing/templates.js';
import type { KitchenBuildableLine } from '../src/modules/orders/kitchen-queries.js';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { ensureBusinessSettingsDefensive } from '../src/db/business-settings.js';
import { loginAs } from './test-helpers.js';

describe('C3 — Comandas: total por estación, bebidas y despacho solo-bebida', () => {
  const baseOrder: OrderReceiptData = {
    id: 'ord_test_01',
    orderNumber: 145,
    fulfillmentType: 'salon',
    tableNumber: '4',
    customerName: 'Cliente Prueba',
    discountUsdCents: 0,
    deliveryFeeUsdCents: 0,
    totalToCollectUsdCents: 1500,
    rateMicroBs: 40_000_000,
    createdAtMs: 1700000000000
  };

  describe('Pruebas Unitarias de Plantillas de Comanda', () => {
    it('(a) 2 hot dogs + 2 refrescos → "TOTAL HOT DOGS: 2" y sección bebidas con "TOTAL BEBIDAS: 2"', () => {
      const hotDogLines: KitchenBuildableLine[] = [
        {
          lineId: 'line_hd_1',
          productId: 'prod_street_dog',
          productName: 'Street Dog Especial',
          displayName: 'Street Dog Especial',
          quantity: 2,
          station: 'hot_dogs',
          status: 'pendiente',
          modifiers: ['SIN CEBOLLA'],
          barraLibreModifiers: [],
          ingredientExclusions: ['CEBOLLA'],
          ingredientExtras: [],
          criticalModifiers: []
        }
      ];

      const drinkLines: KitchenBuildableLine[] = [
        {
          lineId: 'line_dr_1',
          productId: 'prod_refresco_1lt',
          productName: 'Refresco 1 Lt',
          displayName: 'Refresco 1 Lt',
          quantity: 2,
          station: 'caja_bebidas',
          status: 'pendiente',
          flavorChoice: 'Pepsi',
          modifiers: [],
          barraLibreModifiers: [],
          ingredientExclusions: [],
          ingredientExtras: [],
          criticalModifiers: []
        }
      ];

      const jobs = buildKitchenTicketJobs({
        order: baseOrder,
        kitchenLines: hotDogLines,
        drinkLines
      });

      expect(jobs).toHaveLength(1);
      const [hdJob] = jobs;
      expect(hdJob.station).toBe('hot_dogs');

      const blocks = hdJob.ir.blocks;

      // 1. Total de estación antes de las líneas NUNCA suma bebidas
      const totalStationBlock = blocks.find(
        b => 'text' in b && b.text === 'TOTAL HOT DOGS: 2'
      );
      expect(totalStationBlock).toBeDefined();
      expect(totalStationBlock?.type).toBe('title_double');

      // 2. Banner de bebidas al pie
      const drinkBanner = blocks.find(
        b => b.type === 'banner_inverted' && (b as any).text === '=== BEBIDAS DEL PEDIDO ==='
      );
      expect(drinkBanner).toBeDefined();

      // 3. Línea de bebida y modificador de sabor
      const drinkItem = blocks.find(
        b => b.type === 'line_item' && (b as any).name === 'Refresco 1 Lt'
      );
      expect(drinkItem).toBeDefined();
      expect((drinkItem as any).qty).toBe(2);

      const flavorMod = blocks.find(
        b => b.type === 'modifier_item' && (b as any).text === 'Sabor: Pepsi'
      );
      expect(flavorMod).toBeDefined();

      // 4. Total de bebidas
      const totalDrinksBlock = blocks.find(
        b => 'text' in b && b.text === 'TOTAL BEBIDAS: 2'
      );
      expect(totalDrinksBlock).toBeDefined();
    });

    it('(b) combo hamburguesa + refresco elegido → refresco con su sabor', () => {
      const burgerLines: KitchenBuildableLine[] = [
        {
          lineId: 'line_bg_1',
          productId: 'prod_texas_mex',
          productName: 'Texas Mex Clásica',
          displayName: 'Texas Mex Clásica',
          quantity: 1,
          station: 'hamburguesas',
          status: 'pendiente',
          modifiers: [],
          barraLibreModifiers: [],
          ingredientExclusions: [],
          ingredientExtras: [],
          criticalModifiers: []
        }
      ];

      const drinkLines: KitchenBuildableLine[] = [
        {
          lineId: 'line_dr_combo',
          productId: 'prod_refresco_1lt',
          productName: 'Refresco 1 Lt',
          displayName: 'Refresco 1 Lt',
          quantity: 1,
          station: 'caja_bebidas',
          flavorChoice: '7Up',
          status: 'pendiente',
          modifiers: [],
          barraLibreModifiers: [],
          ingredientExclusions: [],
          ingredientExtras: [],
          criticalModifiers: []
        }
      ];

      const jobs = buildKitchenTicketJobs({
        order: baseOrder,
        kitchenLines: burgerLines,
        drinkLines
      });

      expect(jobs).toHaveLength(1);
      const [bgJob] = jobs;
      expect(bgJob.station).toBe('hamburguesas');

      const blocks = bgJob.ir.blocks;

      const totalBurgerBlock = blocks.find(
        b => 'text' in b && b.text === 'TOTAL HAMBURGUESAS: 1'
      );
      expect(totalBurgerBlock).toBeDefined();

      const flavorMod = blocks.find(
        b => b.type === 'modifier_item' && (b as any).text === 'Sabor: 7Up'
      );
      expect(flavorMod).toBeDefined();

      const totalDrinks = blocks.find(
        b => 'text' in b && b.text === 'TOTAL BEBIDAS: 1'
      );
      expect(totalDrinks).toBeDefined();
    });

    it('(c) solo bebidas → 1 ticket "DESPACHO BEBIDAS" con total y líneas', () => {
      const drinkLines: KitchenBuildableLine[] = [
        {
          lineId: 'line_dr_1',
          productId: 'prod_refresco_1lt',
          productName: 'Refresco 1 Lt',
          displayName: 'Refresco 1 Lt',
          quantity: 2,
          station: 'caja_bebidas',
          flavorChoice: 'Pepsi Black',
          status: 'pendiente',
          modifiers: [],
          barraLibreModifiers: [],
          ingredientExclusions: [],
          ingredientExtras: [],
          criticalModifiers: []
        },
        {
          lineId: 'line_dr_2',
          productId: 'prod_refresco_1lt',
          productName: 'Agua Mineral',
          displayName: 'Agua Mineral',
          quantity: 1,
          station: 'caja_bebidas',
          status: 'pendiente',
          modifiers: [],
          barraLibreModifiers: [],
          ingredientExclusions: [],
          ingredientExtras: [],
          criticalModifiers: []
        }
      ];

      const jobs = buildKitchenTicketJobs({
        order: baseOrder,
        kitchenLines: [],
        drinkLines
      });

      expect(jobs).toHaveLength(1);
      const [drinkJob] = jobs;
      expect(drinkJob.station).toBe('caja_bebidas');

      const blocks = drinkJob.ir.blocks;

      // Banner de Despacho Bebidas
      const banner = blocks.find(
        b => b.type === 'banner_inverted' && (b as any).text.includes('DESPACHO BEBIDAS')
      );
      expect(banner).toBeDefined();

      // Cliente
      const clientKv = blocks.find(
        b => b.type === 'key_value' && (b as any).key === 'CLIENTE:'
      );
      expect(clientKv).toBeDefined();
      expect((clientKv as any).value).toBe('Cliente Prueba');

      // Líneas de bebidas
      const items = blocks.filter(b => b.type === 'line_item');
      expect(items).toHaveLength(2);

      // Sabor
      const flavorMod = blocks.find(
        b => b.type === 'modifier_item' && (b as any).text === 'Sabor: Pepsi Black'
      );
      expect(flavorMod).toBeDefined();

      // Total de bebidas = 2 + 1 = 3
      const totalDrinks = blocks.find(
        b => 'text' in b && b.text === 'TOTAL BEBIDAS: 3'
      );
      expect(totalDrinks).toBeDefined();

      // buildKitchenTicketIRs wrapper también devuelve 1 ticket idéntico
      const irs = buildKitchenTicketIRs({
        order: baseOrder,
        kitchenLines: [],
        drinkLines
      });
      expect(irs).toHaveLength(1);
      expect(irs[0].title).toContain('Despacho Bebidas');
    });

    it('(d) orden compuesta → 2 tickets con totales por estación y bebidas una sola vez en el último ticket', () => {
      const burgerLines: KitchenBuildableLine[] = [
        {
          lineId: 'bg_1',
          productId: 'p_bg',
          productName: 'Hamburguesa Doble',
          displayName: 'Hamburguesa Doble',
          quantity: 3,
          station: 'hamburguesas',
          status: 'pendiente',
          modifiers: [],
          barraLibreModifiers: [],
          ingredientExclusions: [],
          ingredientExtras: [],
          criticalModifiers: []
        }
      ];

      const hotDogLines: KitchenBuildableLine[] = [
        {
          lineId: 'hd_1',
          productId: 'p_hd',
          productName: 'Street Dog',
          displayName: 'Street Dog',
          quantity: 2,
          station: 'hot_dogs',
          status: 'pendiente',
          modifiers: [],
          barraLibreModifiers: [],
          ingredientExclusions: [],
          ingredientExtras: [],
          criticalModifiers: []
        }
      ];

      const drinkLines: KitchenBuildableLine[] = [
        {
          lineId: 'dr_1',
          productId: 'p_dr',
          productName: 'Refresco 1 Lt',
          displayName: 'Refresco 1 Lt',
          quantity: 4,
          station: 'caja_bebidas',
          flavorChoice: 'Kolita',
          status: 'pendiente',
          modifiers: [],
          barraLibreModifiers: [],
          ingredientExclusions: [],
          ingredientExtras: [],
          criticalModifiers: []
        }
      ];

      const jobs = buildKitchenTicketJobs({
        order: baseOrder,
        kitchenLines: [...burgerLines, ...hotDogLines],
        drinkLines
      });

      expect(jobs).toHaveLength(2);

      const [burgerJob, hotDogJob] = jobs;
      expect(burgerJob.station).toBe('hamburguesas');
      expect(hotDogJob.station).toBe('hot_dogs');

      // Ticket 1 (Hamburguesas): total hamburguesas = 3, SIN bebidas
      const bgTotal = burgerJob.ir.blocks.find(
        b => 'text' in b && b.text === 'TOTAL HAMBURGUESAS: 3'
      );
      expect(bgTotal).toBeDefined();

      const bgDrinksBanner = burgerJob.ir.blocks.find(
        b => b.type === 'banner_inverted' && (b as any).text === '=== BEBIDAS DEL PEDIDO ==='
      );
      expect(bgDrinksBanner).toBeUndefined();

      const bgDrinksTotal = burgerJob.ir.blocks.find(
        b => 'text' in b && b.text.includes('TOTAL BEBIDAS')
      );
      expect(bgDrinksTotal).toBeUndefined();

      // Ticket 2 (Hot Dogs - último/despacho): total hot dogs = 2, CON bebidas una sola vez
      const hdTotal = hotDogJob.ir.blocks.find(
        b => 'text' in b && b.text === 'TOTAL HOT DOGS: 2'
      );
      expect(hdTotal).toBeDefined();

      const hdDrinksBanner = hotDogJob.ir.blocks.find(
        b => b.type === 'banner_inverted' && (b as any).text === '=== BEBIDAS DEL PEDIDO ==='
      );
      expect(hdDrinksBanner).toBeDefined();

      const hdDrinksTotal = hotDogJob.ir.blocks.find(
        b => 'text' in b && b.text === 'TOTAL BEBIDAS: 4'
      );
      expect(hdDrinksTotal).toBeDefined();

      const hdFlavor = hotDogJob.ir.blocks.find(
        b => b.type === 'modifier_item' && (b as any).text === 'Sabor: Kolita'
      );
      expect(hdFlavor).toBeDefined();
    });
  });

  describe('Pruebas de Integración E2E en Base de Datos (enqueueOrderPrintJobs)', () => {
    const tempDir = path.join(os.tmpdir(), `tocineta_kitchen_totals_${Date.now()}`);
    const tempDb = path.join(tempDir, 'test_kitchen_totals.db');
    let rawDb: Database.Database;
    let app: FastifyInstance;
    let cajeraToken: string;
    let sessionId: string;

    beforeAll(async () => {
      process.env.PRINTER_DEV_SIMULATION = 'true';
      fs.mkdirSync(tempDir, { recursive: true });
      const dbCtx = initSqlite(tempDb);
      rawDb = dbCtx.rawDb;

      await runMigrations(rawDb);
      seedInitialUsers(rawDb);
      seedCatalog(rawDb);
      ensureBusinessSettingsDefensive(rawDb);

      app = await buildServer({ disableStatic: true, logger: false });
      await app.ready();

      cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;

      // Abrir jornada y sesión de caja
      const resJornada = await app.inject({
        method: 'POST',
        url: '/api/jornadas/open',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          rateMicroBs: 40_000_000,
          rateStr: '40.00',
          initialCashUsdCents: 5000,
          initialCashBsCents: 100000
        }
      });
      const jornadaId = resJornada.json().jornada.id;

      const resSession = await app.inject({
        method: 'POST',
        url: '/api/cash-sessions/open',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          jornadaId,
          openingCashUsdCents: 5000,
          openingCashBsCents: 100000
        }
      });
      sessionId = resSession.json().cashSession.id;
    });

    afterAll(async () => {
      if (app) await app.close();
      delete process.env.PRINTER_DEV_SIMULATION;
      try {
        const dbCtx = getDatabaseContext();
        if (dbCtx && dbCtx.db) {
          dbCtx.db.close();
        }
      } catch {}
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    });

    it('Pedido solo con bebidas: genera y encola ticket de cocina con station "caja_bebidas"', async () => {
      const resCreate = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tableNumber: 'Mesa Solo Bebidas',
          fulfillmentType: 'salon',
          lines: [
            { productId: 'prod_refresco_1lt', quantity: 2, flavorChoice: 'Pepsi' }
          ]
        }
      });
      expect(resCreate.statusCode).toBe(201);
      const order = resCreate.json().order;
      rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, order.id);

      const resPay = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }]
        }
      });
      expect(resPay.statusCode).toBe(200);

      // Verificar que se encoló trabajo de cocina para bebidas (antes se quedaba en silencio)
      const kitchenJobs = rawDb.prepare(
        "SELECT * FROM print_jobs WHERE order_id = ? AND job_type = 'TICKET_COCINA'"
      ).all(order.id) as any[];

      expect(kitchenJobs).toHaveLength(1);
      expect(kitchenJobs[0].station).toBe('caja_bebidas');

      const parsedIr = JSON.parse(kitchenJobs[0].ticket_ir_json);
      expect(parsedIr.title).toContain('Despacho Bebidas');
      expect(parsedIr.blocks.some((b: any) => b.text === 'TOTAL BEBIDAS: 2')).toBe(true);
      expect(parsedIr.blocks.some((b: any) => b.text === 'Sabor: Pepsi')).toBe(true);
    });

    it('Pedido compuesto en DB: genera 2 comandas y las bebidas solo se imprimen en el ticket de hot dogs', async () => {
      const resCreate = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tableNumber: 'Mesa Compuesta',
          fulfillmentType: 'salon',
          lines: [
            { productId: 'prod_texas_mex', quantity: 1 },
            { productId: 'prod_street_dog', quantity: 2 },
            { productId: 'prod_refresco_1lt', quantity: 3, flavorChoice: 'Chinotto' }
          ]
        }
      });
      expect(resCreate.statusCode).toBe(201);
      const order = resCreate.json().order;
      rawDb.prepare('UPDATE orders SET cash_session_id = ? WHERE id = ?').run(sessionId, order.id);

      const resPay = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/pay`,
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }]
        }
      });
      expect(resPay.statusCode).toBe(200);

      const kitchenJobs = rawDb.prepare(
        "SELECT * FROM print_jobs WHERE order_id = ? AND job_type = 'TICKET_COCINA' ORDER BY created_at_ms ASC"
      ).all(order.id) as any[];

      expect(kitchenJobs).toHaveLength(2);

      const burgerJob = kitchenJobs.find(j => j.station === 'hamburguesas');
      const hotDogJob = kitchenJobs.find(j => j.station === 'hot_dogs');
      expect(burgerJob).toBeDefined();
      expect(hotDogJob).toBeDefined();

      const bgIr = JSON.parse(burgerJob.ticket_ir_json);
      const hdIr = JSON.parse(hotDogJob.ticket_ir_json);

      // Hamburguesas: total hamburguesas = 1, sin bebidas
      expect(bgIr.blocks.some((b: any) => b.text === 'TOTAL HAMBURGUESAS: 1')).toBe(true);
      expect(bgIr.blocks.some((b: any) => b.text === '=== BEBIDAS DEL PEDIDO ===')).toBe(false);

      // Hot Dogs: total hot dogs = 2, con bebidas (total 3) y sabor Chinotto
      expect(hdIr.blocks.some((b: any) => b.text === 'TOTAL HOT DOGS: 2')).toBe(true);
      expect(hdIr.blocks.some((b: any) => b.text === '=== BEBIDAS DEL PEDIDO ===')).toBe(true);
      expect(hdIr.blocks.some((b: any) => b.text === 'TOTAL BEBIDAS: 3')).toBe(true);
      expect(hdIr.blocks.some((b: any) => b.text === 'Sabor: Chinotto')).toBe(true);
    });
  });
});
