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
import { getKitchenBuildableLines } from '../src/modules/orders/kitchen-queries.js';
import { loginAs } from './test-helpers.js';

describe('Hito M11 - Módulo Operativo de Delivery, Liquidación de Motorizados y Cupones Duales (@tocineta/server)', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_m11_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_m11.db');
  let rawDb: Database.Database;

  let adminToken: string;
  let cajeraToken: string;
  let mesoneroToken: string;
  let openJornadaId: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    runMigrations(rawDb, path.join(__dirname, '../src/db/migrations'));
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    // Logins canónicos usando helper
    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
    mesoneroToken = (await loginAs(app, 'mesonero', rawDb)).token;

    // Abrir Jornada Oficial
    const resJornada = await app.inject({
      method: 'POST',
      url: '/api/jornadas/open',
      headers: { Authorization: `Bearer ${cajeraToken}` },
      payload: {
        rateStr: '40.00',
        initialCashUsdCents: 5000,
        initialCashBsCents: 200000
      }
    });
    openJornadaId = JSON.parse(resJornada.payload).jornada.id;
  });

  afterAll(async () => {
    await app.close();
    try {
      rawDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================================================
  // BLOQUE 1: CUPONES DUALES ("CUPONES PARA TI")
  // ==========================================================================
  describe('1. Motor de Cupones Duales (DISCOUNT & COURTESY_ITEM)', () => {
    
    it('Aplica cupón FIXED_USD (BIENVENIDA1): resta $1.00 del total de la orden', async () => {
      // 1. Crear orden con 1 Hamburguesa Texas Mex ($6.90 = 690 cents)
      const resCreate = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          tableNumber: 'Mesa 1',
          fulfillmentType: 'salon',
          lines: [{ productId: 'prod_texas_mex', quantity: 1 }]
        }
      });
      expect(resCreate.statusCode).toBe(201);
      const order = JSON.parse(resCreate.payload).order;
      expect(order.gross_food_subtotal_usd_cents).toBe(690);
      expect(order.total_to_collect_usd_cents).toBe(690);

      // 2. Aplicar cupón BIENVENIDA1 (-$1.00)
      const resApply = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/apply-coupon`,
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: { couponCode: 'BIENVENIDA1' }
      });

      expect(resApply.statusCode).toBe(200);
      const dataApply = JSON.parse(resApply.payload);
      expect(dataApply.success).toBe(true);
      expect(dataApply.discountUsdCents).toBe(100);
      expect(dataApply.order.discount_usd_cents).toBe(100);
      expect(dataApply.order.net_food_sales_usd_cents).toBe(590);
      expect(dataApply.order.total_to_collect_usd_cents).toBe(590);

      // 3. Verificar en base de datos redención registrada
      const redemption = rawDb.prepare('SELECT * FROM coupon_redemptions WHERE order_id = ?').get(order.id) as any;
      expect(redemption).toBeDefined();
      expect(redemption.benefit_usd_cents).toBe(100);
    });

    it('Aplica cupón PERCENTAGE_BPS (PARATI10): calcula 10% sobre subtotal de comida', async () => {
      // 1. Crear orden con 2 Hamburguesas Texas Mex (2 * 690 = 1380 cents = $13.80)
      const resCreate = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          tableNumber: 'Mesa 2',
          fulfillmentType: 'salon',
          lines: [{ productId: 'prod_texas_mex', quantity: 2 }]
        }
      });
      expect(resCreate.statusCode).toBe(201);
      const order = JSON.parse(resCreate.payload).order;
      expect(order.gross_food_subtotal_usd_cents).toBe(1380);

      // 2. Aplicar cupón PARATI10 (10% de $13.80 = $1.38 -> 138 cents)
      const resApply = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/apply-coupon`,
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: { couponCode: 'PARATI10' }
      });

      expect(resApply.statusCode).toBe(200);
      const dataApply = JSON.parse(resApply.payload);
      expect(dataApply.discountUsdCents).toBe(138);
      expect(dataApply.order.net_food_sales_usd_cents).toBe(1242);
      expect(dataApply.order.total_to_collect_usd_cents).toBe(1242);

      // 3. Intentar aplicar un segundo cupón a la misma orden -> Debe rechazar con 400
      const resDuplicate = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/apply-coupon`,
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: { couponCode: 'BIENVENIDA1' }
      });
      expect(resDuplicate.statusCode).toBe(400);
      expect(JSON.parse(resDuplicate.payload).error).toContain('ya tiene un cupón aplicado');

      // 4. Quitar cupón y verificar que se restaura el precio original
      const resRemove = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/remove-coupon`,
        headers: { Authorization: `Bearer ${cajeraToken}` }
      });
      expect(resRemove.statusCode).toBe(200);
      const dataRemove = JSON.parse(resRemove.payload);
      expect(dataRemove.order.discount_usd_cents).toBe(0);
      expect(dataRemove.order.net_food_sales_usd_cents).toBe(1380);
      expect(dataRemove.order.total_to_collect_usd_cents).toBe(1380);
    });

    it('Rechaza cupones expirados o con usos agotados', async () => {
      // Crear cupón expirado
      rawDb.prepare(`
        INSERT INTO coupons (
          id, code, description, coupon_type, discount_mode, discount_value,
          max_uses, used_count, expires_at_ms, is_active, created_at_ms
        ) VALUES ('coup_vencido', 'VENCIDO5', 'Cupón vencido', 'DISCOUNT', 'FIXED_USD', 500, 10, 0, ?, 1, ?)
      `).run(Date.now() - 3600000, Date.now() - 7200000);

      // Crear cupón agotado
      rawDb.prepare(`
        INSERT INTO coupons (
          id, code, description, coupon_type, discount_mode, discount_value,
          max_uses, used_count, expires_at_ms, is_active, created_at_ms
        ) VALUES ('coup_agotado', 'AGOTADO10', 'Cupón agotado', 'DISCOUNT', 'FIXED_USD', 100, 5, 5, NULL, 1, ?)
      `).run(Date.now());

      const resCreate = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          tableNumber: 'Mesa 3',
          lines: [{ productId: 'prod_street_dog', quantity: 1 }]
        }
      });
      expect(resCreate.statusCode).toBe(201);
      const order = JSON.parse(resCreate.payload).order;

      // Validar rechazo de vencido
      const resVencido = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/apply-coupon`,
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: { couponCode: 'VENCIDO5' }
      });
      expect(resVencido.statusCode).toBe(400);
      expect(JSON.parse(resVencido.payload).error).toContain('ha expirado');

      // Validar rechazo de agotado
      const resAgotado = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/apply-coupon`,
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: { couponCode: 'AGOTADO10' }
      });
      expect(resAgotado.statusCode).toBe(400);
      expect(JSON.parse(resAgotado.payload).error).toContain('límite máximo de usos');
    });

    it('Aplica cupón COURTESY_ITEM (CAFEGRATIS): cuenta cliente +$0.00, comanda con [OBSEQUIO CUPÓN - $0.00] y costo interno de 35¢ en MARKETING_COURTESY', async () => {
      // 1. Crear orden con 1 Perro Doritos ($3.50 = 350 cents)
      const resCreate = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          tableNumber: 'Barra',
          fulfillmentType: 'salon',
          lines: [{ productId: 'prod_doritos_dog_snacks', quantity: 1 }]
        }
      });
      expect(resCreate.statusCode).toBe(201);
      const order = JSON.parse(resCreate.payload).order;
      expect(order.total_to_collect_usd_cents).toBe(350);

      // 2. Aplicar cupón CAFEGRATIS
      const resApply = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/apply-coupon`,
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: { couponCode: 'CAFEGRATIS' }
      });
      expect(resApply.statusCode).toBe(200);

      const dataApply = JSON.parse(resApply.payload);
      expect(dataApply.success).toBe(true);
      // El total a pagar para el cliente sigue siendo exactamente $3.50 (+$0.00)
      expect(dataApply.order.total_to_collect_usd_cents).toBe(350);

      // 3. getKitchenBuildableLines() debe incluir Café de Cortesía [OBSEQUIO CUPÓN - $0.00]
      const kitchenLines = getKitchenBuildableLines(rawDb, order.id, { includeDrinks: true });
      expect(kitchenLines.length).toBe(2);
      const courtesyKitchenLine = kitchenLines.find(l => l.isCourtesyItem || l.displayName.includes('[OBSEQUIO CUPÓN - $0.00]'));
      expect(courtesyKitchenLine).toBeDefined();
      expect(courtesyKitchenLine?.displayName).toContain('[OBSEQUIO CUPÓN - $0.00]');

      // 4. Cobrar la orden en Caja ($3.50) con billete de $5.00 y vuelto en Bolívares
      const resPay = await app.inject({
        method: 'POST',
        url: `/api/orders/${order.id}/pay`,
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [
            { method: 'cash_usd', amountCents: 500 } // Paga con $5.00
          ],
          changeOutputs: {
            method: 'cash_bs',
            changeUsdCents: 0,
            changeBsCents: 6000 // Vuelto de $1.50 eq a 60.00 Bs
          }
        }
      });
      expect(resPay.statusCode).toBe(200);

      // 5. Verificar asiento contable de costo interno en MARKETING_COURTESY (35c)
      const marketingEntry = rawDb.prepare(`
        SELECT * FROM ledger_entries
        WHERE order_id = ? AND account_bucket = 'MARKETING_COURTESY'
      `).get(order.id) as any;

      expect(marketingEntry).toBeDefined();
      expect(marketingEntry.debit_usd_cents).toBe(35);
      expect(marketingEntry.description).toContain('Costo Interno Marketing Obsequio');
    });

  });

  // ==========================================================================
  // BLOQUE 2: FLOTA DE MOTORIZADOS, PRIVACIDAD Y DESPACHOS DE DELIVERY
  // ==========================================================================
  describe('2. Gestión de Flota y Enmascaramiento de Privacidad', () => {

    it('CRUD de Repartidores (/api/delivery/drivers)', async () => {
      // 1. Listar repartidores iniciales (sembrados en migración 0012)
      const resList = await app.inject({
        method: 'GET',
        url: '/api/delivery/drivers'
      });
      expect(resList.statusCode).toBe(200);
      const listData = JSON.parse(resList.payload);
      expect(listData.drivers.length).toBeGreaterThanOrEqual(3);
      expect(listData.drivers.some((d: any) => d.name === 'REPARTIDOR 1' || d.id === 'drv_carlos_mora')).toBe(true);

      // 2. Crear nuevo motorizado
      const resCreate = await app.inject({
        method: 'POST',
        url: '/api/delivery/drivers',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Daniel Villarroel',
          phone: '0412-9988776'
        }
      });
      expect(resCreate.statusCode).toBe(201);
      const createdDriver = JSON.parse(resCreate.payload).driver;
      expect(createdDriver.name).toBe('Daniel Villarroel');

      // 3. Actualizar estado del motorizado
      const resPatch = await app.inject({
        method: 'PATCH',
        url: `/api/delivery/drivers/${createdDriver.id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          phone: '0412-9988770',
          isActive: false
        }
      });
      expect(resPatch.statusCode).toBe(200);
      const updatedDriver = JSON.parse(resPatch.payload).driver;
      expect(updatedDriver.phone).toBe('0412-9988770');
      expect(updatedDriver.isActive).toBe(false);
    });

    it('Enmascara teléfono para roles no autorizados (mesonero/cajera) pero lo muestra completo a admin/supervisor', async () => {
      // 1. Crear orden de delivery con teléfono y dirección
      const resCreate = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          fulfillmentType: 'delivery',
          customerName: 'Rosario Mendoza',
          customerPhone: '0424-9728209',
          deliveryAddress: 'Urb. Los Olivos, Calle 5, Casa 12',
          deliveryReference: 'Frente al parque',
          deliveryFeeUsdCents: 300,
          lines: [{ productId: 'prod_texas_mex', quantity: 1 }]
        }
      });
      expect(resCreate.statusCode).toBe(201);
      const order = JSON.parse(resCreate.payload).order;

      // 2. Consulta con rol 'mesonero' -> Teléfono enmascarado
      const resMesonero = await app.inject({
        method: 'GET',
        url: `/api/orders/${order.id}`,
        headers: { Authorization: `Bearer ${mesoneroToken}` }
      });
      const orderMesonero = JSON.parse(resMesonero.payload).order;
      expect(orderMesonero.customer_phone).not.toBe('0424-9728209');
      expect(orderMesonero.customer_phone).toContain('***');

      // 3. Consulta con rol 'admin' -> Teléfono completo
      const resAdmin = await app.inject({
        method: 'GET',
        url: `/api/orders/${order.id}`,
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const orderAdmin = JSON.parse(resAdmin.payload).order;
      expect(orderAdmin.customer_phone).toBe('0424-9728209');
    });

  });

  // ==========================================================================
  // BLOQUE 3: LIQUIDACIÓN NOCTURNA DE MOTORIZADOS Y PARTIDA DOBLE
  // ==========================================================================
  describe('3. Liquidación Nocturna de Motorizados (Control de Efectivo y Fondos)', () => {

    it('Liquida un motorizado con 3 viajes ($3, $4 y $5 = $12.00) en modo PASS_THROUGH sin alterar FOOD_SALES', async () => {
      const driverId = 'drv_carlos_mora';

      // 1. VIAJE 1: Tarifa $3.00, Comida $6.90. Cliente pagó adelantado por Pago Móvil (Efectivo en mano = $0)
      const resOrd1 = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          fulfillmentType: 'delivery',
          customerName: 'Cliente Viaje 1',
          customerPhone: '0414-1111111',
          deliveryAddress: 'Sector Unare II',
          deliveryFeeUsdCents: 300, // $3.00
          motorizadoId: driverId,
          cashCollectedByDriver: false,
          lines: [{ productId: 'prod_texas_mex', quantity: 1 }] // $6.90
        }
      });
      expect(resOrd1.statusCode).toBe(201);
      const ord1 = JSON.parse(resOrd1.payload).order;
      expect(ord1.total_to_collect_usd_cents).toBe(990); // $6.90 + $3.00 = $9.90

      // Cobrar orden 1 por Pago Móvil (990 cents USD equiv = 396.00 Bs a tasa 40)
      await app.inject({
        method: 'POST',
        url: `/api/orders/${ord1.id}/pay`,
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'pago_movil', amountCents: 39600, referenceCode: 'REF111' }]
        }
      });

      // 2. VIAJE 2: Tarifa $4.00, Comida $6.90. Cliente pagó en EFECTIVO AL RECIBIR
      // El motorizado tiene en su poder el total en efectivo: $6.90 comida + $4.00 tarifa = $10.90
      const resOrd2 = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          fulfillmentType: 'delivery',
          customerName: 'Cliente Viaje 2',
          customerPhone: '0414-2222222',
          deliveryAddress: 'Alta Vista Sur',
          deliveryFeeUsdCents: 400, // $4.00
          motorizadoId: driverId,
          cashCollectedByDriver: true,
          lines: [{ productId: 'prod_texas_mex', quantity: 1 }] // $6.90
        }
      });
      expect(resOrd2.statusCode).toBe(201);
      const ord2 = JSON.parse(resOrd2.payload).order;
      expect(ord2.total_to_collect_usd_cents).toBe(1090); // $6.90 + $4.00 = $10.90

      // Cobrar orden 2 en caja
      await app.inject({
        method: 'POST',
        url: `/api/orders/${ord2.id}/pay`,
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: 1090 }]
        }
      });

      // 3. VIAJE 3: Tarifa $5.00, Comida $3.50 (Perro Doritos). Pagado adelantado por Binance
      const resOrd3 = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          fulfillmentType: 'delivery',
          customerName: 'Cliente Viaje 3',
          customerPhone: '0414-3333333',
          deliveryAddress: 'Villa Rosa',
          deliveryFeeUsdCents: 500, // $5.00
          motorizadoId: driverId,
          cashCollectedByDriver: false,
          lines: [{ productId: 'prod_doritos_dog_snacks', quantity: 1 }] // $3.50
        }
      });
      expect(resOrd3.statusCode).toBe(201);
      const ord3 = JSON.parse(resOrd3.payload).order;
      expect(ord3.total_to_collect_usd_cents).toBe(850); // $3.50 + $5.00 = $8.50

      await app.inject({
        method: 'POST',
        url: `/api/orders/${ord3.id}/pay`,
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'binance', amountCents: 850, referenceCode: 'BIN123' }]
        }
      });

      // 4. Consultar Vista Previa de Liquidación Nocturna (/api/delivery/settlement-preview)
      const resPreview = await app.inject({
        method: 'GET',
        url: `/api/delivery/settlement-preview?jornadaId=${openJornadaId}`
      });
      expect(resPreview.statusCode).toBe(200);
      const previewData = JSON.parse(resPreview.payload);

      const driverPreview = previewData.preview.find((p: any) => p.driverId === driverId);
      expect(driverPreview).toBeDefined();
      expect(driverPreview.totalTrips).toBe(3);
      // Tarifas ganadas: $3 + $4 + $5 = $12.00 (1200 cents)
      expect(driverPreview.totalDeliveryFeesUsdCents).toBe(1200);
      // Efectivo de comida en mano del viaje 2: $6.90 (690 cents)
      expect(driverPreview.totalFoodCashCollectedUsdCents).toBe(690);
      // Saldo neto: Caja debe pagar al motorizado: $12.00 ganados - $6.90 comida retenida = $5.10 a favor del repartidor (510)
      expect(driverPreview.balanceDirection).toBe('CASHIER_PAYS_DRIVER');
      expect(driverPreview.netBalanceUsdCents).toBe(510);

      // Guardar ventas de comida antes de liquidar
      const foodSalesBefore = rawDb.prepare(`
        SELECT COALESCE(SUM(credit_usd_cents), 0) as total
        FROM ledger_entries
        WHERE jornada_id = ? AND account_bucket = 'FOOD_SALES'
      `).get(openJornadaId) as { total: number };

      // 5. Ejecutar Liquidación del Motorizado (POST /api/delivery/settle-driver)
      const resSettle = await app.inject({
        method: 'POST',
        url: '/api/delivery/settle-driver',
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          jornadaId: openJornadaId,
          driverId
        }
      });
      expect(resSettle.statusCode).toBe(200);
      const settleResult = JSON.parse(resSettle.payload);
      expect(settleResult.success).toBe(true);
      expect(settleResult.settlement.totalTrips).toBe(3);
      expect(settleResult.settlement.totalDeliveryFeesUsdCents).toBe(1200);

      // 6. Verificar REGLA DE ORO DE CONTABILIDAD:
      // Las ventas netas de comida (FOOD_SALES) NO se modifican en lo absoluto tras liquidar al motorizado
      const foodSalesAfter = rawDb.prepare(`
        SELECT COALESCE(SUM(credit_usd_cents), 0) as total
        FROM ledger_entries
        WHERE jornada_id = ? AND account_bucket = 'FOOD_SALES'
      `).get(openJornadaId) as { total: number };

      expect(foodSalesAfter.total).toBe(foodSalesBefore.total);

      // 7. Verificar que el fondo MOTORIZADO_FUND quedó debitado por las tarifas pagadas
      const motorizadoDebits = rawDb.prepare(`
        SELECT COALESCE(SUM(debit_usd_cents), 0) as total_debits
        FROM ledger_entries
        WHERE jornada_id = ? AND account_bucket = 'MOTORIZADO_FUND'
      `).get(openJornadaId) as { total_debits: number };

      expect(motorizadoDebits.total_debits).toBeGreaterThanOrEqual(1200);

      // 8. Reintentar liquidar al mismo motorizado -> Debe indicar que no hay viajes pendientes
      const resSettleAgain = await app.inject({
        method: 'POST',
        url: '/api/delivery/settle-driver',
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          jornadaId: openJornadaId,
          driverId
        }
      });
      expect(resSettleAgain.statusCode).toBe(400);
      expect(JSON.parse(resSettleAgain.payload).error).toContain('no tiene viajes pendientes');
    });

    it('Soporta liquidación en modalidad HOUSE_REVENUE registrando el ingreso en la casa', async () => {
      const driverId = 'drv_jose_ramirez';

      // Crear orden de delivery de $4.00 tarifa + $6.90 comida = $10.90
      const resOrd = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          fulfillmentType: 'delivery',
          customerName: 'Cliente House Revenue',
          deliveryFeeUsdCents: 400,
          motorizadoId: driverId,
          lines: [{ productId: 'prod_texas_mex', quantity: 1 }]
        }
      });
      expect(resOrd.statusCode).toBe(201);
      const ord = JSON.parse(resOrd.payload).order;

      await app.inject({
        method: 'POST',
        url: `/api/orders/${ord.id}/pay`,
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          tenders: [{ method: 'cash_usd', amountCents: 1090 }]
        }
      });

      // Liquidar con override HOUSE_REVENUE
      const resSettleHouse = await app.inject({
        method: 'POST',
        url: '/api/delivery/settle-driver',
        headers: { Authorization: `Bearer ${cajeraToken}` },
        payload: {
          jornadaId: openJornadaId,
          driverId,
          modeOverride: 'HOUSE_REVENUE'
        }
      });

      expect(resSettleHouse.statusCode).toBe(200);
      const result = JSON.parse(resSettleHouse.payload);
      expect(result.accountingMode).toBe('HOUSE_REVENUE');

      // Verificar registro en tabla delivery_driver_settlements
      const settlementRecord = rawDb.prepare('SELECT * FROM delivery_driver_settlements WHERE driver_id = ?').get(driverId) as any;
      expect(settlementRecord).toBeDefined();
      expect(settlementRecord.delivery_accounting_mode).toBe('HOUSE_REVENUE');
    });

  });

});
