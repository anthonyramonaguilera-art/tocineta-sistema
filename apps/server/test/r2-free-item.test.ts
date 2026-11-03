import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { buildServer } from '../src/server.js';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { loginAs, ensureTestSupervisor, CANONICAL_CREDENTIALS } from './test-helpers.js';
import { getJornadaReportData } from '../src/modules/reports/reports-service.js';
import { loadOrderReceiptDataFromDb } from '../src/modules/printing/templates.js';
import { getKitchenBuildableLines } from '../src/modules/orders/kitchen-queries.js';

describe('TAREA L-1a: Ítem libre de mostrador con permiso D16', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_free_item_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_free_item.db');
  let rawDb: InstanceType<typeof Database>;

  let adminToken: string;
  let cajeraToken: string;
  let mesoneroToken: string;
  let supervisorToken: string;
  let jornadaId: string;
  const ADMIN_PIN = CANONICAL_CREDENTIALS.admin.pin; // '123456'

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    runMigrations(rawDb, path.join(__dirname, '../src/db/migrations'));
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureTestSupervisor(rawDb);

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
    mesoneroToken = (await loginAs(app, 'mesonero', rawDb)).token;
    supervisorToken = (await loginAs(app, 'supervisor', rawDb)).token;

    // Abrir jornada de prueba
    const openRes = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        rateStr: '40.00',
        initialCashUsdCents: 5000,
        initialCashBsCents: 200000,
        notes: 'Jornada Test L-1a'
      }
    });
    jornadaId = openRes.json().jornada.id;

    // Abrir sesión de caja para cobros
    await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        initialCashUsdCents: 5000,
        initialCashBsCents: 200000,
        locationId: 'loc_alta_vista'
      }
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // a) Admin y cajera crean orden con prod_libre 'Torta', $3.50 (350) x 2 -> total $7.00 (700)
  it('a) Admin y cajera crean orden con prod_libre "Torta", 350c x 2 -> total 700c', async () => {
    // 1. Admin crea orden
    const adminRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        lines: [
          {
            productId: 'prod_libre',
            customName: 'Torta',
            customPriceUsdCents: 350,
            quantity: 2,
            station: 'caja_bebidas'
          }
        ]
      }
    });
    expect(adminRes.statusCode).toBe(201);
    const adminOrder = adminRes.json().order;
    expect(adminOrder.gross_food_subtotal_usd_cents).toBe(700);
    expect(adminOrder.total_to_collect_usd_cents).toBe(700);
    expect(adminOrder.lines[0].custom_name).toBe('Torta');
    expect(adminOrder.lines[0].product_name).toBe('Torta');
    expect(adminOrder.lines[0].unit_price_usd_cents).toBe(350);
    expect(adminOrder.lines[0].subtotal_usd_cents).toBe(700);

    // 2. Cajera crea orden
    const cajeraRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        lines: [
          {
            productId: 'prod_libre',
            customName: 'Torta',
            customPriceUsdCents: 350,
            quantity: 2
          }
        ]
      }
    });
    expect(cajeraRes.statusCode).toBe(201);
    const cajeraOrder = cajeraRes.json().order;
    expect(cajeraOrder.gross_food_subtotal_usd_cents).toBe(700);
    expect(cajeraOrder.total_to_collect_usd_cents).toBe(700);
    expect(cajeraOrder.lines[0].custom_name).toBe('Torta');
    expect(cajeraOrder.lines[0].product_name).toBe('Torta');
  });

  // b) Mesonero por defecto -> 403 FREE_ITEM_FORBIDDEN; si Admin autoriza con {"canAddFreeItem": true} -> 201; y si cajera tiene {"canAddFreeItem": false} -> 403
  it('b) Mesonero por defecto -> 403; con canAddFreeItem: true -> 201; cajera con canAddFreeItem: false -> 403', async () => {
    const mesoneroUserId = CANONICAL_CREDENTIALS.mesonero.userId; // 'usr_mesero'
    const cajeraUserId = CANONICAL_CREDENTIALS.cajera.userId; // 'usr_cajera'

    // 1. Mesonero por defecto -> 403
    const mesRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        lines: [
          {
            productId: 'prod_libre',
            customName: 'Torta',
            customPriceUsdCents: 350,
            quantity: 1
          }
        ]
      }
    });
    expect(mesRes.statusCode).toBe(403);
    expect(mesRes.json().error).toMatch(/FREE_ITEM_FORBIDDEN/);

    // 2. Admin otorga permiso a mesonero
    rawDb.prepare('UPDATE users SET permissions_json = ? WHERE id = ?')
      .run(JSON.stringify({ canAddFreeItem: true }), mesoneroUserId);

    const mesResAllowed = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${mesoneroToken}` },
      payload: {
        lines: [
          {
            productId: 'prod_libre',
            customName: 'Torta',
            customPriceUsdCents: 350,
            quantity: 1
          }
        ]
      }
    });
    expect(mesResAllowed.statusCode).toBe(201);

    // 3. Admin revoca explícitamente a cajera
    rawDb.prepare('UPDATE users SET permissions_json = ? WHERE id = ?')
      .run(JSON.stringify({ canAddFreeItem: false }), cajeraUserId);

    const cajeraResRevoked = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        lines: [
          {
            productId: 'prod_libre',
            customName: 'Torta',
            customPriceUsdCents: 350,
            quantity: 1
          }
        ]
      }
    });
    expect(cajeraResRevoked.statusCode).toBe(403);
    expect(cajeraResRevoked.json().error).toMatch(/FREE_ITEM_FORBIDDEN/);

    // Restaurar cajera
    rawDb.prepare('UPDATE users SET permissions_json = ? WHERE id = ?')
      .run('[]', cajeraUserId);
  });

  // c) customPriceUsdCents en un producto normal -> 400 FREE_ITEM_FIELDS_NOT_ALLOWED
  it('c) customPriceUsdCents en producto normal -> 400 FREE_ITEM_FIELDS_NOT_ALLOWED', async () => {
    const normalProd = rawDb.prepare("SELECT id FROM products WHERE id != 'prod_libre' LIMIT 1").get() as any;
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        lines: [
          {
            productId: normalProd.id,
            customPriceUsdCents: 500,
            quantity: 1
          }
        ]
      }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/FREE_ITEM_FIELDS_NOT_ALLOWED/);
  });

  // d) Precio 0, 50001, decimal o cantidad 100 -> 400
  it('d) Precio 0, 50001, decimal o cantidad 100 -> 400', async () => {
    // Precio 0
    const resZero = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        lines: [{ productId: 'prod_libre', customName: 'Torta', customPriceUsdCents: 0, quantity: 1 }]
      }
    });
    expect(resZero.statusCode).toBe(400);

    // Precio 50001
    const resOver = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        lines: [{ productId: 'prod_libre', customName: 'Torta', customPriceUsdCents: 50001, quantity: 1 }]
      }
    });
    expect(resOver.statusCode).toBe(400);

    // Precio decimal
    const resDecimal = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        lines: [{ productId: 'prod_libre', customName: 'Torta', customPriceUsdCents: 350.5, quantity: 1 }]
      }
    });
    expect(resDecimal.statusCode).toBe(400);

    // Cantidad 100
    const resQty100 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        lines: [{ productId: 'prod_libre', customName: 'Torta', customPriceUsdCents: 350, quantity: 100 }]
      }
    });
    expect(resQty100.statusCode).toBe(400);
  });

  // e) Cobrar la orden y anularla con PIN: ledger neto 0 y sin error de inventario
  it('e) Cobrar la orden y anularla con PIN: ledger neto 0 y sin error de inventario', async () => {
    // 1. Crear orden con prod_libre
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        lines: [{ productId: 'prod_libre', customName: 'Torta Especial', customPriceUsdCents: 1000, quantity: 1 }]
      }
    });
    expect(createRes.statusCode).toBe(201);
    const orderId = createRes.json().order.id;

    // 2. Cobrar la orden en efectivo USD
    const payRes = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'efectivo_usd', amountCents: 1000 }
        ]
      }
    });
    expect(payRes.statusCode).toBe(200);

    // 3. Anular la orden con PIN de admin (123456)
    const annulRes = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/void`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        reason: 'Error en pedido de prueba',
        supervisorPin: ADMIN_PIN
      }
    });
    expect(annulRes.statusCode).toBe(200);

    // Verificar ledger neto 0 tras anulación en cada bucket
    const ledgerEntries = rawDb.prepare('SELECT account_bucket, debit_usd_cents, credit_usd_cents FROM ledger_entries WHERE order_id = ?').all(orderId) as any[];
    expect(ledgerEntries.length).toBeGreaterThan(0);
    const totalDebit = ledgerEntries.reduce((acc, l) => acc + l.debit_usd_cents, 0);
    const totalCredit = ledgerEntries.reduce((acc, l) => acc + l.credit_usd_cents, 0);
    expect(totalDebit).toBe(totalCredit);

    const cashUsdEntries = ledgerEntries.filter(l => l.account_bucket === 'CASH_USD');
    const cashDebit = cashUsdEntries.reduce((acc, l) => acc + l.debit_usd_cents, 0);
    const cashCredit = cashUsdEntries.reduce((acc, l) => acc + l.credit_usd_cents, 0);
    expect(cashDebit).toBe(cashCredit);

    // Verificar que no hay movimientos de inventario fallidos o corruptos
    const invMovements = rawDb.prepare('SELECT * FROM inventory_movements WHERE order_id = ?').all(orderId);
    expect(invMovements.length).toBe(0);
  });

  // f) GET /api/menu/pos NO lista prod_libre ni cat_libre
  it('f) GET /api/menu/pos NO lista prod_libre ni cat_libre', async () => {
    const menuRes = await app.inject({
      method: 'GET',
      url: '/api/menu/pos',
      headers: { authorization: `Bearer ${cajeraToken}` }
    });
    expect(menuRes.statusCode).toBe(200);
    const body = menuRes.json();
    const categories = body.categories || [];
    const products = body.products || [];

    const foundCat = categories.find((c: any) => c.id === 'cat_libre');
    expect(foundCat).toBeUndefined();

    const foundProd = products.find((p: any) => p.id === 'prod_libre');
    expect(foundProd).toBeUndefined();
  });

  // g) El recibo/comanda muestra 'Torta' y el reporte Z informa freeItemsUsdCents = 700
  it('g) El recibo/comanda muestra "Torta" y el reporte Z informa freeItemsUsdCents = 700', async () => {
    // 1. Crear orden con 2 tortas ($3.50 c/u = $7.00) enviadas a estación hot_dogs para cocina
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        lines: [{ productId: 'prod_libre', customName: 'Torta', customPriceUsdCents: 350, quantity: 2, station: 'hot_dogs' }]
      }
    });
    expect(createRes.statusCode).toBe(201);
    const orderId = createRes.json().order.id;

    // Verificar consulta de comanda (kitchen-queries)
    const kitchenLines = getKitchenBuildableLines(rawDb, orderId);
    expect(kitchenLines.length).toBeGreaterThan(0);
    expect(kitchenLines[0].productName).toBe('Torta');

    // Verificar recibo (printing templates)
    const receiptData = loadOrderReceiptDataFromDb(rawDb, orderId);
    expect(receiptData.lines.length).toBeGreaterThan(0);
    expect(receiptData.lines[0].productName).toBe('Torta');

    // Cobrar la orden para que impacte el reporte Z
    const payRes = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      headers: { authorization: `Bearer ${cajeraToken}` },
      payload: {
        tenders: [
          { method: 'efectivo_usd', amountCents: 700 }
        ]
      }
    });
    expect(payRes.statusCode).toBe(200);

    // Verificar que el reporte Z informa freeItemsUsdCents = 700 (la orden anulada en e no suma por estar anulada)
    const reportData = getJornadaReportData(rawDb, jornadaId);
    expect(reportData.freeItemsUsdCents).toBe(700);
  });
});
