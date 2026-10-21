/**
 * SISTEMA OPERATIVO LOCAL TOCINETA SONRÍE (Varons Media)
 * Pruebas de Aceptación del Hito M7: Pantalla de Cocina (KDS),
 * Estado de Líneas, Ensamblado Automático, Despacho y Filtros.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { buildServer } from '../src/server.js';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { createRefirePrintJob } from '../src/modules/printing/worker.js';

describe('Hito M7 - Pantalla de Cocina (KDS) y Ensamble Automático (@tocineta/server)', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_m7_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_m7.db');
  let rawDb: Database.Database;

  let cajeraToken: string;
  let mesoneroToken: string;
  let cocineroToken: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { migrationsDir: path.join(__dirname, '../src/db/migrations') });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    // Iniciar jornada de prueba
    rawDb.prepare(`
      INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status, initial_cash_usd_cents)
      VALUES ('jor_m7_test', 'usr_cajera_principal', ?, 'abierta', 5000)
    `).run(Date.now());

    rawDb.prepare(`
      INSERT INTO cash_sessions (id, jornada_id, user_id, opened_at_ms, status)
      VALUES ('cs_m7_test', 'jor_m7_test', 'usr_cajera_principal', ?, 'abierta')
    `).run(Date.now());

    // Tokens
    const resCajera = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_cajera_principal', pin: '1111' }
    });
    cajeraToken = JSON.parse(resCajera.payload).token;

    const resMesonero = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_mesonero_carlos', pin: '2222' }
    });
    mesoneroToken = JSON.parse(resMesonero.payload).token;

    const resCocinero = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId: 'usr_cocina_perros', pin: '5555' }
    });
    cocineroToken = JSON.parse(resCocinero.payload).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('GET /api/kds/orders devuelve sólo órdenes pagadas o autorizadas sin precios ni montos de dinero', async () => {
    // 1. Crear una orden regular sin pagar
    const resCreateUnpaid = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        idempotencyKey: `idemp_unpaid_${Date.now()}`,
        fulfillmentType: 'salon',
        tableNumber: 'MESA-1',
        lines: [
          {
            productId: 'prod_smash_clasica', // Hamburguesa Clásica
            quantity: 1
          }
        ]
      }
    });
    expect(resCreateUnpaid.statusCode).toBe(201);
    const unpaidOrder = JSON.parse(resCreateUnpaid.payload).order;

    // 2. Crear y cobrar una orden
    const resCreatePaid = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        idempotencyKey: `idemp_paid_${Date.now()}`,
        fulfillmentType: 'para_llevar',
        customerName: 'Manuel Silva',
        lines: [
          {
            productId: 'prod_smash_clasica',
            quantity: 1,
            customInstructions: 'SIN CEBOLLA, POCA SALSA'
          }
        ]
      }
    });
    expect(resCreatePaid.statusCode).toBe(201);
    const paidOrder = JSON.parse(resCreatePaid.payload).order;

    // Cobrar la orden en Caja
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/orders/${paidOrder.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'cash_usd', amountCents: paidOrder.total_to_collect_usd_cents }
        ]
      }
    });
    expect(resPay.statusCode).toBe(200);

    // 3. Consultar KDS
    const resKds = await app.inject({
      method: 'GET',
      url: '/api/kds/orders',
      headers: { authorization: `Bearer ${cocineroToken}` }
    });
    expect(resKds.statusCode).toBe(200);
    const kdsData = JSON.parse(resKds.payload);
    expect(Array.isArray(kdsData.orders)).toBe(true);

    // Debe contener la orden pagada pero NO la no pagada
    const foundPaid = kdsData.orders.find((o: any) => o.orderId === paidOrder.id);
    const foundUnpaid = kdsData.orders.find((o: any) => o.orderId === unpaidOrder.id);

    expect(foundPaid).toBeDefined();
    expect(foundUnpaid).toBeUndefined();

    // Verificación estricta: CERO montos ni precios para cocina
    expect(foundPaid.priceUsdCents).toBeUndefined();
    expect(foundPaid.totalToCollectUsdCents).toBeUndefined();
    expect(foundPaid.grossFoodSubtotalUsdCents).toBeUndefined();
    expect(foundPaid.rateMicroBs).toBeUndefined();

    for (const l of foundPaid.lines) {
      expect(l.unitPriceUsdCents).toBeUndefined();
      expect(l.proratedUnitPriceUsdCents).toBeUndefined();
      expect(l.subtotalUsdCents).toBeUndefined();
    }

    // Cronómetro y turno gigante
    expect(foundPaid.turnCode).toMatch(/^T-\d{3}$/);
    expect(typeof foundPaid.kitchenPassedAtMs).toBe('number');
  });

  it('Filtro por estación en KDS (?station=hot_dogs vs ?station=hamburguesas)', async () => {
    // Crear orden con perro caliente y hamburguesa (orden compuesta)
    const resCreate = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        idempotencyKey: `idemp_comp_${Date.now()}`,
        fulfillmentType: 'salon',
        tableNumber: 'MESA-5',
        customerName: 'Familia Gómez',
        lines: [
          {
            productId: 'prod_smash_clasica', // hamburguesas
            quantity: 1
          },
          {
            productId: 'prod_brazil_dog', // hot_dogs
            quantity: 2
          }
        ]
      }
    });
    const order = JSON.parse(resCreate.payload).order;

    // Cobrar orden
    await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }]
      }
    });

    // 1. Consulta para estación hamburguesas
    const resBurgers = await app.inject({
      method: 'GET',
      url: '/api/kds/orders?station=hamburguesas'
    });
    const burgersData = JSON.parse(resBurgers.payload);
    const burgerOrder = burgersData.orders.find((o: any) => o.orderId === order.id);
    expect(burgerOrder).toBeDefined();
    expect(burgerOrder.lines.every((l: any) => l.station === 'hamburguesas')).toBe(true);
    expect(burgerOrder.isComposite).toBe(true);

    // 2. Consulta para estación hot_dogs
    const resHotDogs = await app.inject({
      method: 'GET',
      url: '/api/kds/orders?station=hot_dogs'
    });
    const hotDogsData = JSON.parse(resHotDogs.payload);
    const hotDogOrder = hotDogsData.orders.find((o: any) => o.orderId === order.id);
    expect(hotDogOrder).toBeDefined();
    expect(hotDogOrder.lines.every((l: any) => l.station === 'hot_dogs')).toBe(true);
    expect(hotDogOrder.isComposite).toBe(true);
  });

  it('Actualización de línea individual y regla de ensamble automático al completar todas las estaciones', async () => {
    // Crear orden compuesta: 1 Hamburguesa Clásica y 1 Perro Brasilero
    const resCreate = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        idempotencyKey: `idemp_assembly_${Date.now()}`,
        fulfillmentType: 'delivery',
        customerName: 'Carlos Valera',
        customerPhone: '04141234567',
        lines: [
          { productId: 'prod_smash_clasica', quantity: 1 },
          { productId: 'prod_brazil_dog', quantity: 1 }
        ]
      }
    });
    const order = JSON.parse(resCreate.payload).order;

    await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [{ method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }]
      }
    });

    // Obtener las líneas en KDS
    const resKdsInitial = await app.inject({
      method: 'GET',
      url: '/api/kds/orders'
    });
    const kdsOrder = JSON.parse(resKdsInitial.payload).orders.find((o: any) => o.orderId === order.id);
    expect(kdsOrder).toBeDefined();
    expect(kdsOrder.fulfillmentStatus).toBe('en_preparacion');
    expect(kdsOrder.missingStations).toContain('hamburguesas');
    expect(kdsOrder.missingStations).toContain('hot_dogs');

    const burgerLine = kdsOrder.lines.find((l: any) => l.station === 'hamburguesas');
    const hotDogLine = kdsOrder.lines.find((l: any) => l.station === 'hot_dogs');
    expect(burgerLine).toBeDefined();
    expect(hotDogLine).toBeDefined();

    // Paso 1: Hamburguesero pone su línea en 'preparando'
    const resPrepBurger = await app.inject({
      method: 'POST',
      url: `/api/kds/lines/${burgerLine.lineId}/status`,
      payload: { status: 'preparando' }
    });
    expect(resPrepBurger.statusCode).toBe(200);
    const prepBurgerBody = JSON.parse(resPrepBurger.payload);
    expect(prepBurgerBody.stationStatusHamburguesas).toBe('en_preparacion');

    // Paso 2: Hamburguesero pone su línea en 'listo'
    const resReadyBurger = await app.inject({
      method: 'POST',
      url: `/api/kds/lines/${burgerLine.lineId}/status`,
      payload: { status: 'listo' }
    });
    expect(resReadyBurger.statusCode).toBe(200);
    const readyBurgerBody = JSON.parse(resReadyBurger.payload);

    // CRITERIO DE ACEPTACIÓN: La hamburguesa está lista, pero el perro sigue pendiente:
    // La orden general se mantiene en 'en_preparacion' indicando que falta hot_dogs
    expect(readyBurgerBody.orderFulfillmentStatus).toBe('en_preparacion');
    expect(readyBurgerBody.stationStatusHamburguesas).toBe('listo');
    expect(readyBurgerBody.stationStatusHotDogs).not.toBe('listo');
    expect(readyBurgerBody.missingStations).toEqual(['hot_dogs']);
    expect(readyBurgerBody.allReady).toBe(false);

    // Paso 3: Perrocalientero pone su línea en 'listo'
    const resReadyHotDog = await app.inject({
      method: 'POST',
      url: `/api/kds/lines/${hotDogLine.lineId}/status`,
      payload: { status: 'listo' }
    });
    expect(resReadyHotDog.statusCode).toBe(200);
    const readyHotDogBody = JSON.parse(resReadyHotDog.payload);

    // CRITERIO DE ACEPTACIÓN: Ahora todas las estaciones están listas -> Ensamble automático
    expect(readyHotDogBody.allReady).toBe(true);
    expect(readyHotDogBody.orderFulfillmentStatus).toBe('listo');
    expect(readyHotDogBody.missingStations).toEqual([]);

    // Verificar en la base de datos que orders.fulfillment_status es 'listo'
    const checkDb = rawDb.prepare('SELECT fulfillment_status FROM orders WHERE id = ?').get(order.id) as any;
    expect(checkDb.fulfillment_status).toBe('listo');
  });

  it('POST /api/kds/orders/:orderId/deliver marca la orden como entregada y la archiva en cerrado si está pagada', async () => {
    // Crear orden y pagar
    const resCreate = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        idempotencyKey: `idemp_deliv_${Date.now()}`,
        fulfillmentType: 'salon',
        lines: [{ productId: 'prod_smash_clasica', quantity: 1 }]
      }
    });
    const order = JSON.parse(resCreate.payload).order;

    await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { tenders: [{ method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }] }
    });

    // Marcar línea de cocina como lista antes de entregar
    const orderLines = rawDb.prepare('SELECT id FROM order_lines WHERE order_id = ?').all(order.id) as any[];
    await app.inject({
      method: 'POST',
      url: `/api/kds/lines/${orderLines[0].id}/status`,
      payload: { status: 'listo' }
    });

    // Entregar desde KDS
    const resDeliver = await app.inject({
      method: 'POST',
      url: `/api/kds/orders/${order.id}/deliver`,
      payload: { archive: true }
    });
    expect(resDeliver.statusCode).toBe(200);
    const deliverBody = JSON.parse(resDeliver.payload);
    expect(deliverBody.fulfillmentStatus).toBe('cerrado');
    expect(typeof deliverBody.closedAtMs).toBe('number');

    // Comprobar que ya no aparece en KDS activo
    const resKds = await app.inject({
      method: 'GET',
      url: '/api/kds/orders'
    });
    const found = JSON.parse(resKds.payload).orders.find((o: any) => o.orderId === order.id);
    expect(found).toBeUndefined();
  });

  it('Reposición urgente (re-fire) reactiva la orden en KDS con isRefire = true y alerta auditada', async () => {
    // 1. Crear y cobrar orden
    const resCreate = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        idempotencyKey: `idemp_refire_${Date.now()}`,
        fulfillmentType: 'salon',
        tableNumber: 'MESA-2',
        lines: [{ productId: 'prod_smash_clasica', quantity: 1 }]
      }
    });
    const order = JSON.parse(resCreate.payload).order;

    await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { tenders: [{ method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }] }
    });

    // Marcar línea de cocina como lista antes de entregar
    const refireLines = rawDb.prepare('SELECT id FROM order_lines WHERE order_id = ?').all(order.id) as any[];
    await app.inject({
      method: 'POST',
      url: `/api/kds/lines/${refireLines[0].id}/status`,
      payload: { status: 'listo' }
    });

    // Marcarla como entregada
    await app.inject({
      method: 'POST',
      url: `/api/kds/orders/${order.id}/deliver`,
      payload: { archive: false }
    });

    // 2. Disparar reposición urgente usando PIN de supervisor (654321)
    createRefirePrintJob(rawDb, order.id, 'Cliente devolvió plato por término de cocción', '654321');

    // 3. Consultar KDS
    const resKds = await app.inject({
      method: 'GET',
      url: '/api/kds/orders'
    });
    const refireOrder = JSON.parse(resKds.payload).orders.find((o: any) => o.orderId === order.id);
    expect(refireOrder).toBeDefined();
    expect(refireOrder.isRefire).toBe(true);
    expect(refireOrder.fulfillmentStatus).toBe('en_preparacion');
    expect(refireOrder.lines[0].status).toBe('pendiente');
  });

  it('Modificadores críticos como SIN CEBOLLA, POCA SALSA, ENVUELTA EN LECHUGA se agrupan en criticalModifiers', async () => {
    const resCreate = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        idempotencyKey: `idemp_critical_${Date.now()}`,
        fulfillmentType: 'salon',
        lines: [
          {
            productId: 'prod_smash_clasica',
            quantity: 1,
            customInstructions: 'ENVUELTA EN LECHUGA / SIN PAN',
            modifiers: [
              {
                ingredientId: 'ing_bl_cebolla',
                ingredientName: 'Cebolla',
                modifierType: 'SIN_INGREDIENTE'
              }
            ]
          }
        ]
      }
    });
    const order = JSON.parse(resCreate.payload).order;

    await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: { tenders: [{ method: 'cash_usd', amountCents: order.total_to_collect_usd_cents }] }
    });

    const resKds = await app.inject({
      method: 'GET',
      url: '/api/kds/orders'
    });
    const found = JSON.parse(resKds.payload).orders.find((o: any) => o.orderId === order.id);
    expect(found).toBeDefined();
    const line = found.lines[0];
    expect(line.criticalModifiers).toBeDefined();
    expect(line.criticalModifiers.some((c: string) => c.includes('SIN CEBOLLA'))).toBe(true);
    expect(line.criticalModifiers.some((c: string) => c.includes('ENVUELTA EN LECHUGA'))).toBe(true);
  });
});
