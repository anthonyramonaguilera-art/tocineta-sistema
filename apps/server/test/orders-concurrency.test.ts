import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { buildServer } from '../src/server.js';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { createIdempotencyKey, generateUuidV7 } from '@tocineta/shared';
import { loginAs } from './test-helpers.js';

describe('Hito M4 - Gestión de Pedidos, Concurrencia Optimista, Prorrateo e Idempotencia (@tocineta/server)', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_m4_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_m4.db');
  let rawDb: Database.Database;

  let adminToken: string;
  let supervisorToken: string;
  let mesoneroToken: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    // Ejecutar migraciones 0001 a 0004
    await runMigrations(rawDb, { dbPath: tempDb });

    // Sembrar usuarios y catálogo
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    // Logins canónicos usando helper
    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    supervisorToken = (await loginAs(app, 'supervisor', rawDb)).token;
    mesoneroToken = (await loginAs(app, 'mesero', rawDb)).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      const dbCtx = getDatabaseContext();
      dbCtx.rawDb.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // --------------------------------------------------------------------------
  // 1. CREACIÓN DE PEDIDO Y PRORRATEO HAMILTON EN COMBOS
  // --------------------------------------------------------------------------
  describe('Creación de Pedido (POST /api/orders)', () => {
    it('Crea un pedido con Combo Clásico prorrateado, estado sin_pago y fulfillment enviado', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          tableNumber: 'Mesa 4',
          fulfillmentType: 'salon',
          notes: 'Servir todo junto',
          lines: [
            {
              productId: 'prod_combo_clasico', // $7.90 (790 cents)
              quantity: 1,
              comboChildren: [
                {
                  productId: 'prod_doritos_dog_snacks', // Precio normal $3.50
                  quantity: 1,
                  modifiers: [
                    {
                      ingredientId: 'ing_bl_maiz',
                      ingredientName: 'Maíz',
                      modifierType: 'BARRA_LIBRE',
                      extraPriceUsdCents: 0
                    }
                  ]
                },
                {
                  productId: 'prod_brazil_dog', // Precio normal $3.50
                  quantity: 1,
                  modifiers: [
                    {
                      ingredientId: 'ing_base_salsa_ajo',
                      ingredientName: 'Salsa de Ajo',
                      modifierType: 'SIN_INGREDIENTE'
                    }
                  ]
                },
                {
                  productId: 'prod_malta_lata_250', // Precio normal $1.50
                  quantity: 1
                }
              ]
            }
          ]
        }
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.payload);
      expect(data.success).toBe(true);

      const order = data.order;
      expect(order.table_number).toBe('Mesa 4');
      expect(order.payment_status).toBe('sin_pago');
      expect(order.fulfillment_status).toBe('enviado');
      expect(order.total_to_collect_usd_cents).toBe(790);
      expect(order.version).toBe(1);

      // Verificar líneas creadas
      expect(order.lines.length).toBe(4); // 1 Padre + 3 Hijos

      const parent = order.lines.find((l: any) => l.line_role === 'COMBO_PARENT');
      expect(parent).toBeDefined();
      expect(parent.unit_price_usd_cents).toBe(790);

      const children = order.lines.filter((l: any) => l.line_role === 'COMBO_CHILD');
      expect(children.length).toBe(3);

      // Suma y proporcionalidad exacta de Hamilton de los hijos
      const proratedValues = children.map((c: any) => c.prorated_unit_price_usd_cents);
      expect(proratedValues).toEqual([325, 325, 140]);
      const sumProrated = children.reduce((sum: number, c: any) => sum + c.prorated_unit_price_usd_cents, 0);
      expect(sumProrated).toBe(790);

      // Verificar que snapshot_json fue persistido
      for (const line of order.lines) {
        expect(line.snapshot_json).toBeDefined();
        expect(JSON.parse(line.snapshot_json)).toBeDefined();
      }
    });

    it('Garantiza idempotencia ante reintentos de red con Idempotency-Key', async () => {
      const idempotencyKey = createIdempotencyKey('order', generateUuidV7());
      const payload = {
        tableNumber: 'Mesa 10',
        lines: [
          {
            productId: 'prod_street_dog',
            quantity: 2
          }
        ]
      };

      // Primer envío
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: {
          authorization: `Bearer ${mesoneroToken}`,
          'Idempotency-Key': idempotencyKey
        },
        payload
      });
      expect(res1.statusCode).toBe(201);
      const order1 = JSON.parse(res1.payload).order;

      // Segundo envío con la misma Idempotency-Key (simula retry de red)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: {
          authorization: `Bearer ${mesoneroToken}`,
          'Idempotency-Key': idempotencyKey
        },
        payload
      });
      expect(res2.statusCode).toBe(201);
      const order2 = JSON.parse(res2.payload).order;

      // Mismo ID de orden, cero duplicados en la base de datos
      expect(order1.id).toBe(order2.id);

      const count = rawDb.prepare("SELECT COUNT(*) as cnt FROM orders WHERE table_number = 'Mesa 10'").get() as any;
      expect(count.cnt).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // 2. CONCURRENCIA OPTIMISTA (VERSION) Y DETECCIÓN DE CONFLICTOS (409)
  // --------------------------------------------------------------------------
  describe('Concurrencia Optimista (PATCH /api/orders/:id)', () => {
    it('Permite editar cuando version coincide e incrementa version a 2', async () => {
      // 1. Crear orden inicial
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          tableNumber: 'Mesa 2',
          lines: [{ productId: 'prod_street_dog', quantity: 1 }]
        }
      });
      const order = JSON.parse(createRes.payload).order;
      expect(order.version).toBe(1);

      // 2. Editar con version: 1
      const editRes = await app.inject({
        method: 'PATCH',
        url: `/api/orders/${order.id}`,
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          version: 1,
          notes: 'Agregar servilletas extra'
        }
      });

      expect(editRes.statusCode).toBe(200);
      const updatedOrder = JSON.parse(editRes.payload).order;
      expect(updatedOrder.version).toBe(2);
      expect(updatedOrder.notes).toBe('Agregar servilletas extra');
    });

    it('Responde 409 Conflict si dos dispositivos intentan editar la misma orden simultáneamente', async () => {
      // 1. Crear orden
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          tableNumber: 'Mesa 7',
          lines: [{ productId: 'prod_doritos_dog_snacks', quantity: 1 }]
        }
      });
      const order = JSON.parse(createRes.payload).order;

      // Dos teléfonos leyeron version: 1
      const phone1Payload = { version: 1, notes: 'Modificación desde Teléfono 1' };
      const phone2Payload = { version: 1, notes: 'Modificación desde Teléfono 2' };

      // Teléfono 1 envía y gana la carrera
      const resPhone1 = await app.inject({
        method: 'PATCH',
        url: `/api/orders/${order.id}`,
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: phone1Payload
      });
      expect(resPhone1.statusCode).toBe(200);

      // Teléfono 2 envía con version: 1 desactualizada -> 409 Conflict
      const resPhone2 = await app.inject({
        method: 'PATCH',
        url: `/api/orders/${order.id}`,
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: phone2Payload
      });

      expect(resPhone2.statusCode).toBe(409);
      const conflictData = JSON.parse(resPhone2.payload);
      expect(conflictData.success).toBe(false);
      expect(conflictData.error).toContain('CONFLICT_CONCURRENT_EDIT');
      expect(conflictData.serverVersion).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // 3. AUTORIZACIÓN SIN PAGO PREVIO
  // --------------------------------------------------------------------------
  describe('Autorización Sin Pago (POST /api/orders/:id/authorize-without-payment)', () => {
    it('Admin autoriza pedido: pasa a autorizado_sin_pago y en_preparacion dejando deuda abierta', async () => {
      // Crear orden sin pago
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          tableNumber: 'Mesa VIP',
          lines: [{ productId: 'prod_texas_mex', quantity: 2 }]
        }
      });
      const order = JSON.parse(createRes.payload).order;

      // Intentar autorizar con PIN erróneo -> 401
      const failPinRes = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/authorize-without-payment`,
        payload: {
          authorizerUserId: 'usr_admin',
          pin: '000000'
        }
      });
      expect(failPinRes.statusCode).toBe(401);

      // Autorizar con credenciales válidas de Admin
      const authRes = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/authorize-without-payment`,
        payload: {
          authorizerUserId: 'usr_admin',
          pin: '123456'
        }
      });

      expect(authRes.statusCode).toBe(200);
      const authOrder = JSON.parse(authRes.payload).order;
      expect(authOrder.payment_status).toBe('autorizado_sin_pago');
      expect(authOrder.fulfillment_status).toBe('en_preparacion');
      expect(authOrder.authorized_without_payment_by).toBe('usr_admin');

      // Verificar que la comanda de cocina está lista
      const detailRes = await app.inject({
        method: 'GET',
        url: `/api/orders/${order.id}`
      });
      const detailData = JSON.parse(detailRes.payload);
      expect(detailData.kitchenLines.length).toBeGreaterThan(0);
      expect(detailData.kitchenLines[0].productName).toBe('Texas Mex');
    });

    it('Mesonero intentando autorizar sin pago recibe 403 Forbidden', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          tableNumber: 'Mesa 8',
          lines: [{ productId: 'prod_street_dog', quantity: 1 }]
        }
      });
      const order = JSON.parse(createRes.payload).order;

      const mesAuthRes = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/authorize-without-payment`,
        payload: {
          authorizerUserId: 'usr_mesero',
          pin: '2222'
        }
      });

      expect(mesAuthRes.statusCode).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // 4. MODO DE MESA: TICKET INDEPENDIENTE
  // --------------------------------------------------------------------------
  describe('Modo de Mesa Predeterminado (ticket_independiente)', () => {
    it('Crear dos pedidos consecutivos para Mesa 4 genera órdenes independientes', async () => {
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          tableNumber: 'Mesa 4',
          lines: [{ productId: 'prod_street_dog', quantity: 2 }]
        }
      });
      const order1 = JSON.parse(res1.payload).order;

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          tableNumber: 'Mesa 4',
          lines: [{ productId: 'prod_malta_lata_250', quantity: 1 }]
        }
      });
      const order2 = JSON.parse(res2.payload).order;

      // Son dos órdenes distintas con números de orden sucesivos
      expect(order1.id).not.toBe(order2.id);
      expect(order2.order_number).toBeGreaterThan(order1.order_number);
      expect(order1.table_number).toBe('Mesa 4');
      expect(order2.table_number).toBe('Mesa 4');
    });
  });
});
