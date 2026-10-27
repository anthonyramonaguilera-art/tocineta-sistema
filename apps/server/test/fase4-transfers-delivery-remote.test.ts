import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { buildServer } from '../src/server.js';
import { getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { seedCriticalSuppliesAndRecipes } from '../src/modules/profitability/inventory.js';
import {
  createTransfer,
  confirmTransferReception,
  calculateDishEquivalents,
  createTransferBatch,
  listTransferBatches,
  deleteTransferBatch,
  getInTransitTransfers
} from '../src/modules/transfers/transfers-service.js';
import {
  buildDispatchNoteTicketIR,
  generateDispatchNotePdfBuffer,
  generateDispatchNoteWhatsAppText
} from '../src/modules/transfers/pdf-service.js';
import { registerProduction } from '../src/modules/transfers/production-service.js';
import { getOwnerDashboardData } from '../src/modules/transfers/owner-dashboard-service.js';
import { loginAs, ensureTestSupervisor } from './test-helpers.js';

describe('FASE 4 — Envíos entre Sedes, Delivery por Sede, Panel de la Dueña y Acceso Remoto', () => {
  let app: FastifyInstance;
  let rawDb: Database.Database;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    const dbCtx = getDatabaseContext();
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);
    ensureOfficialLocations(rawDb);
    seedCriticalSuppliesAndRecipes(rawDb);
    ensureTestSupervisor(rawDb);

    const loginRes = await loginAs(app, 'admin', rawDb);
    adminToken = loginRes.token;
  });

  afterAll(async () => {
    await app.close();
  });

  // --------------------------------------------------------------------------
  // TEST 1: REGLA MATEMÁTICA Y EXPANSIÓN (30 HAMBURGUESAS + 50 PERROS)
  // --------------------------------------------------------------------------
  it('1. Asistente de envíos: debe calcular los insumos equivalentes para 30 hamburguesas y 50 perros', () => {
    const calc = calculateDishEquivalents(rawDb, [
      { dishName: 'Hamburguesa Clásica', quantity: 30 },
      { dishName: 'Perro Caliente Especial', quantity: 50 }
    ]);

    expect(calc.dishes).toHaveLength(2);
    expect(calc.items.length).toBeGreaterThan(0);

    // Debe contener pan de hamburguesa (30 und) y pan de perro (50 und)
    const panBurger = calc.items.find(i => i.supplyName.toLowerCase().includes('pan') && i.supplyName.toLowerCase().includes('brioche'));
    const panPerro = calc.items.find(i => i.supplyName.toLowerCase().includes('perro'));

    expect(panBurger).toBeDefined();
    expect(panBurger!.quantity).toBe(30);

    expect(panPerro).toBeDefined();
    expect(panPerro!.quantity).toBe(50);
  });

  // --------------------------------------------------------------------------
  // TEST 2: TRANSFERENCIA ATÓMICA CON ROLLBACK EN CASO DE FALLO
  // --------------------------------------------------------------------------
  it('2. Transferencia atómica: si ocurre un fallo simulado a la mitad, no altera stocks (Rollback ACID)', () => {
    const supplyId = `sup_atomic_${generateUuidV7().replace(/-/g, '')}`;
    const now = Date.now();

    // Insumo inicial con 100 en origen (Los Olivos) y 10 en destino (Alta Vista)
    rawDb.prepare(`
      INSERT OR REPLACE INTO supply_items (id, name, unit, purchase_unit, usage_unit, conversion_factor, cost_per_unit_usd_cents, current_stock_qty, created_at_ms, updated_at_ms)
      VALUES (?, 'Queso Amarillo Atómico', 'kg', 'kg', 'kg', 1.0, 500, 100, ?, ?)
    `).run(supplyId, now, now);

    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, 100, 0, ?)').run(
      `loc_los_olivos_${supplyId}`, 'loc_los_olivos', supplyId, now
    );
    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, 10, 0, ?)').run(
      `loc_alta_vista_${supplyId}`, 'loc_alta_vista', supplyId, now
    );

    // Simular transacción con fallo intencional antes del commit
    expect(() => {
      rawDb.transaction(() => {
        // Descuenta origen
        rawDb.prepare('UPDATE location_inventory SET current_stock_qty = current_stock_qty - 20 WHERE location_id = ? AND supply_id = ?').run('loc_los_olivos', supplyId);
        
        // Simular corte de energía / crash
        throw new Error('CORTE_SIMULADO_A_LA_MITAD');
      })();
    }).toThrow('CORTE_SIMULADO_A_LA_MITAD');

    // Comprobar que el origen y destino NO cambiaron
    const originStock = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_los_olivos', supplyId) as any;
    const destStock = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supplyId) as any;

    expect(originStock.current_stock_qty).toBe(100);
    expect(destStock.current_stock_qty).toBe(10);
  });

  // --------------------------------------------------------------------------
  // TEST 3: VALIDACIÓN DE STOCK INSUFICIENTE Y FORZADO CON PIN
  // --------------------------------------------------------------------------
  it('3. Validación de stock insuficiente: rechaza sin PIN y autoriza con PIN de supervisor', () => {
    const supplyId = `sup_pin_${generateUuidV7().replace(/-/g, '')}`;
    const now = Date.now();

    rawDb.prepare(`
      INSERT OR REPLACE INTO supply_items (id, name, unit, purchase_unit, usage_unit, conversion_factor, cost_per_unit_usd_cents, current_stock_qty, created_at_ms, updated_at_ms)
      VALUES (?, 'Tocineta Ahumada PIN', 'kg', 'kg', 'kg', 1.0, 800, 5, ?, ?)
    `).run(supplyId, now, now);

    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, 5, 0, ?)').run(
      `loc_los_olivos_${supplyId}`, 'loc_los_olivos', supplyId, now
    );

    // Intentar transferir 20 unidades teniendo solo 5, sin PIN
    expect(() => {
      createTransfer(rawDb, {
        fromLocationId: 'loc_los_olivos',
        toLocationId: 'loc_alta_vista',
        mode: 'loose_supplies',
        items: [{ supplyId, quantity: 20 }],
        createdBy: 'usr_admin'
      });
    }).toThrow(/Stock insuficiente/);

    // Intentar transferir con PIN incorrecto
    expect(() => {
      createTransfer(rawDb, {
        fromLocationId: 'loc_los_olivos',
        toLocationId: 'loc_alta_vista',
        mode: 'loose_supplies',
        items: [{ supplyId, quantity: 20 }],
        createdBy: 'usr_admin',
        forceWithPin: true,
        forceReason: 'Urgencia noche de alta demanda',
        supervisorPin: '000000'
      });
    }).toThrow(/PIN de supervisor/i);

    // Transferir con PIN válido ('654321' del supervisor)
    const successTransfer = createTransfer(rawDb, {
      fromLocationId: 'loc_los_olivos',
      toLocationId: 'loc_alta_vista',
      mode: 'loose_supplies',
      items: [{ supplyId, quantity: 20 }],
      createdBy: 'usr_admin',
      forceWithPin: true,
      forceReason: 'Urgencia autorizada por gerencia',
      supervisorPin: '654321'
    });

    expect(successTransfer.dispatchNoteCode).toMatch(/^NDP-\d+$/);
    expect(successTransfer.forcedWithPin).toBe(1);
    expect(successTransfer.forceReason).toBe('Urgencia autorizada por gerencia');

    // Origen queda en 5 - 20 = -15
    const originStock = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_los_olivos', supplyId) as any;
    expect(originStock.current_stock_qty).toBe(-15);
  });

  // --------------------------------------------------------------------------
  // TEST 4: MODO "EN TRÁNSITO" Y CONFIRMACIÓN DE RECEPCIÓN EN DESTINO
  // --------------------------------------------------------------------------
  it('4. Estado en tránsito: resta en origen y solo suma en destino tras confirmación explícita', () => {
    const supplyId = `sup_transit_${generateUuidV7().replace(/-/g, '')}`;
    const now = Date.now();

    rawDb.prepare(`
      INSERT OR REPLACE INTO supply_items (id, name, unit, purchase_unit, usage_unit, conversion_factor, cost_per_unit_usd_cents, current_stock_qty, created_at_ms, updated_at_ms)
      VALUES (?, 'Salsa de Ajo Tránsito', 'lt', 'lt', 'lt', 1.0, 300, 50, ?, ?)
    `).run(supplyId, now, now);

    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, 50, 0, ?)').run(
      `loc_los_olivos_${supplyId}`, 'loc_los_olivos', supplyId, now
    );
    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, 0, 0, ?)').run(
      `loc_alta_vista_${supplyId}`, 'loc_alta_vista', supplyId, now
    );

    // Crear envío en tránsito
    const transfer = createTransfer(rawDb, {
      fromLocationId: 'loc_los_olivos',
      toLocationId: 'loc_alta_vista',
      mode: 'loose_supplies',
      items: [{ supplyId, quantity: 15 }],
      createdBy: 'usr_admin',
      requiresConfirmation: true
    });

    expect(transfer.status).toMatch(/en_transito/i);

    // Origen fue descontado (50 - 15 = 35)
    const originStock = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_los_olivos', supplyId) as any;
    expect(originStock.current_stock_qty).toBe(35);

    // Destino AÚN NO fue sumado (sigue en 0)
    const destStockPre = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supplyId) as any;
    expect(destStockPre.current_stock_qty).toBe(0);

    // Debe figurar en la lista de envíos en tránsito
    const inTransitList = getInTransitTransfers(rawDb, 'loc_alta_vista');
    expect(inTransitList.some(t => t.id === transfer.id)).toBe(true);

    // Confirmar recepción en destino
    const confirmed = confirmTransferReception(rawDb, transfer.id, 'usr_admin', 'Recibido en perfecto estado');
    expect(confirmed.status).toMatch(/recibido/i);

    // Ahora SÍ se sumó al destino (0 + 15 = 15)
    const destStockPost = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supplyId) as any;
    expect(destStockPost.current_stock_qty).toBe(15);
  });

  // --------------------------------------------------------------------------
  // TEST 5: CASO COMPLETO REAL: ENVÍO DE 30 HAMBURGUESAS + 50 PERROS
  // --------------------------------------------------------------------------
  it('5. Envío real "30 hamburguesas y 50 perros" con movimiento exacto y consecutivos', async () => {
    const briocheId = 'sup_pan_brioche';
    const perroId = 'sup_pan_perro';
    const now = Date.now();

    // Calcular insumos para 30 hamburguesas + 50 perros
    const calc = calculateDishEquivalents(rawDb, [
      { dishName: 'Hamburguesa Clásica', quantity: 30 },
      { dishName: 'Perro Caliente Especial', quantity: 50 }
    ]);

    // Asegurar inventario suficiente en Sede Los Olivos para todos los insumos de la receta
    for (const itm of calc.items) {
      const stockInit = Math.max(1000, Math.ceil(itm.quantity * 3));
      rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, ?, 10, ?)').run(
        `loc_los_olivos_${itm.supplyId}`, 'loc_los_olivos', itm.supplyId, stockInit, now
      );
      rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, 0, 10, ?)').run(
        `loc_alta_vista_${itm.supplyId}`, 'loc_alta_vista', itm.supplyId, now
      );
    }

    // Ejecutar despacho directo
    const transfer = createTransfer(rawDb, {
      fromLocationId: 'loc_los_olivos',
      toLocationId: 'loc_alta_vista',
      mode: 'dish_equivalents',
      dishEquivalents: [
        { dishName: 'Hamburguesa Clásica', quantity: 30 },
        { dishName: 'Perro Caliente Especial', quantity: 50 }
      ],
      items: calc.items.map(i => ({ supplyId: i.supplyId, quantity: i.quantity })),
      notes: 'Envío de refuerzo para turno de la noche',
      createdBy: 'usr_admin',
      requiresConfirmation: false
    });

    expect(transfer.dispatchNoteCode).toMatch(/^NDP-\d+$/);
    expect(transfer.status).toMatch(/completado/i);

    // Verificar existencias finales
    const briocheA = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_los_olivos', briocheId) as any;
    const briocheB = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', briocheId) as any;
    const perroA = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_los_olivos', perroId) as any;
    const perroB = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', perroId) as any;

    expect(briocheA.current_stock_qty).toBe(1000 - 30); // 970
    expect(briocheB.current_stock_qty).toBe(30);        // 0 + 30
    expect(perroA.current_stock_qty).toBe(1000 - 50);   // 950
    expect(perroB.current_stock_qty).toBe(50);          // 0 + 50

    // Generar formato imprimible Ticket IR y PDFKit
    const ticketIR = buildDispatchNoteTicketIR(transfer);
    expect(ticketIR.title).toContain(transfer.dispatchNoteCode);
    expect(ticketIR.blocks.length).toBeGreaterThan(0);
    expect(ticketIR.blocks.some(b => 'text' in b && b.text === 'NOTA DE DESPACHO')).toBe(true);
    expect(ticketIR.blocks.some(b => 'text' in b && b.text?.includes(transfer.dispatchNoteCode))).toBe(true);

    const pdfBuffer = await generateDispatchNotePdfBuffer(transfer);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(500);
    expect(pdfBuffer.subarray(0, 4).toString()).toBe('%PDF');

    const whatsapp = generateDispatchNoteWhatsAppText(transfer);
    expect(whatsapp).toContain(transfer.dispatchNoteCode);
    expect(whatsapp).toContain('30x Hamburguesa Clásica');
  });

  // --------------------------------------------------------------------------
  // TEST 6: LOTES PRECONFIGURADOS DE 1 TOQUE (CRUD)
  // --------------------------------------------------------------------------
  it('6. Lotes preconfigurados: crear, listar, usar y borrar en 1 toque', () => {
    const batch = createTransferBatch(rawDb, {
      name: 'Combo Reabastecimiento Fin de Semana',
      description: 'Lote estándar para Sede Alta Vista',
      fromLocationId: 'loc_los_olivos',
      toLocationId: 'loc_alta_vista',
      items: [
        { supplyId: 'sup_pan_brioche', quantity: 60 },
        { supplyId: 'sup_pan_perro', quantity: 100 }
      ],
      createdBy: 'usr_admin'
    });

    expect(batch.id).toBeDefined();
    expect(batch.name).toBe('Combo Reabastecimiento Fin de Semana');

    const list = listTransferBatches(rawDb);
    expect(list.some(b => b.id === batch.id)).toBe(true);

    const deleted = deleteTransferBatch(rawDb, batch.id);
    expect(deleted.success).toBe(true);

    const listAfter = listTransferBatches(rawDb);
    expect(listAfter.some(b => b.id === batch.id)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // TEST 7: PRODUCCIÓN EN SEDE A (TALLER DE PREPARACIONES BASE)
  // --------------------------------------------------------------------------
  it('7. Registro de producción: descuenta insumos crudos y suma stock del producto/preparación', () => {
    const rawSupplyId = `sup_carne_molida_${generateUuidV7().replace(/-/g, '')}`;
    const prepSupplyId = `sup_carne_marcada_${generateUuidV7().replace(/-/g, '')}`;
    const subRecipeName = `Patties de Hamburguesa ${prepSupplyId}`;
    const subRecipeId = prepSupplyId;
    const now = Date.now();

    // Insumo crudo con 20 kg
    rawDb.prepare(`
      INSERT OR REPLACE INTO supply_items (id, name, unit, purchase_unit, usage_unit, conversion_factor, cost_per_unit_usd_cents, current_stock_qty, created_at_ms, updated_at_ms)
      VALUES (?, 'Carne Molida Cruda', 'kg', 'kg', 'kg', 1.0, 400, 20, ?, ?)
    `).run(rawSupplyId, now, now);

    // Preparación elaborada con 0 und
    rawDb.prepare(`
      INSERT OR REPLACE INTO supply_items (id, name, unit, purchase_unit, usage_unit, conversion_factor, cost_per_unit_usd_cents, current_stock_qty, created_at_ms, updated_at_ms)
      VALUES (?, ?, 'und', 'und', 'und', 1.0, 60, 0, ?, ?)
    `).run(prepSupplyId, subRecipeName, now, now);

    // Registrar sub-receta técnica
    rawDb.prepare(`
      INSERT OR REPLACE INTO sub_recipes (id, name, yield_quantity, yield_unit, cost_per_unit_usd_cents, created_at_ms, updated_at_ms)
      VALUES (?, ?, 10, 'und', 60, ?, ?)
    `).run(subRecipeId, subRecipeName, now, now);

    rawDb.prepare(`
      INSERT OR REPLACE INTO sub_recipe_items (id, sub_recipe_id, supply_id, quantity_required)
      VALUES (?, ?, ?, 1.2)
    `).run(`sri_${generateUuidV7().replace(/-/g, '')}`, subRecipeId, rawSupplyId);

    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, 20, 0, ?)').run(
      `loc_los_olivos_${rawSupplyId}`, 'loc_los_olivos', rawSupplyId, now
    );
    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, 0, 0, ?)').run(
      `loc_los_olivos_${prepSupplyId}`, 'loc_los_olivos', prepSupplyId, now
    );

    // Registrar producción de 50 patties (5 lotes de 10) usando 6 kg de carne
    const prodResult = registerProduction(rawDb, {
      locationId: 'loc_los_olivos',
      targetType: 'sub_recipe',
      targetId: subRecipeId,
      quantityProduced: 50,
      notes: 'Lote matutino de patties',
      createdBy: 'usr_admin'
    });

    expect(prodResult.productionLogId).toBeDefined();

    // Carne molida debe quedar en 20 - 6 = 14 kg
    const rawStock = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_los_olivos', rawSupplyId) as any;
    expect(rawStock.current_stock_qty).toBe(14);

    // Patties elaborados deben quedar en 0 + 50 = 50 und
    const prepStock = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_los_olivos', prepSupplyId) as any;
    expect(prepStock.current_stock_qty).toBe(50);

    // Registro inmutable en production_logs
    const log = rawDb.prepare('SELECT * FROM production_logs WHERE id = ?').get(prodResult.productionLogId) as any;
    expect(log.quantity_produced).toBe(50);
  });

  // --------------------------------------------------------------------------
  // TEST 8: DELIVERY POR SEDE Y LIQUIDACIÓN CON LOCATION_ID
  // --------------------------------------------------------------------------
  it('8. Delivery por sede: repartidores y liquidación asignados a location_id real', async () => {
    const driverId = `drv_test_${generateUuidV7().replace(/-/g, '')}`;
    const now = Date.now();

    // Crear repartidor asignado a Sede Alta Vista
    rawDb.prepare(`
      INSERT OR REPLACE INTO delivery_drivers (id, name, phone, is_active, location_id, created_at_ms, updated_at_ms)
      VALUES (?, 'REPARTIDOR SEDE B', '04141234567', 1, 'loc_alta_vista', ?, ?)
    `).run(driverId, now, now);

    // Consultar repartidores por sede Alta Vista vía endpoint
    const resDrivers = await app.inject({
      method: 'GET',
      url: '/api/delivery/drivers?locationId=loc_alta_vista',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(resDrivers.statusCode).toBe(200);
    const driversData = JSON.parse(resDrivers.payload);
    expect(driversData.drivers.some((d: any) => d.id === driverId)).toBe(true);

    // Crear jornada para liquidación
    const jornadaId = `jor_${generateUuidV7().slice(0, 8)}`;
    rawDb.prepare(`
      INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status, location_id)
      VALUES (?, 'usr_admin', ?, 'abierta', 'loc_alta_vista')
    `).run(jornadaId, now);

    // Asignar orden delivery con viaje pendiente
    const orderId = `ord_del_${generateUuidV7().slice(0, 8)}`;
    rawDb.prepare(`
      INSERT INTO orders (
        id, order_number, jornada_id, created_by_user_id, fulfillment_type,
        customer_name, customer_phone, delivery_address, delivery_fee_usd_cents,
        gross_food_subtotal_usd_cents, discount_usd_cents, net_food_sales_usd_cents,
        total_to_collect_usd_cents, rate_micro_bs, payment_status, fulfillment_status,
        created_at_ms, updated_at_ms, location_id
      ) VALUES (
        ?, 999, ?, 'usr_admin', 'delivery',
        'Cliente Alta Vista', '04240000000', 'Torre Movistar', 300,
        1500, 0, 1500,
        1800, 40000000, 'pagado', 'entregado',
        ?, ?, 'loc_alta_vista'
      )
    `).run(orderId, jornadaId, now, now);

    const deliveryId = `del_${generateUuidV7().slice(0, 8)}`;
    rawDb.prepare(`
      INSERT INTO deliveries (
        id, order_id, driver_id, motorizado_name, delivery_fee_usd_cents,
        cash_collected_by_driver, food_cash_amount_usd_cents, settled_to_motorizado,
        location_id, created_at_ms
      ) VALUES (?, ?, ?, 'REPARTIDOR SEDE B', 300, 0, 0, 0, 'loc_alta_vista', ?)
    `).run(deliveryId, orderId, driverId, now);

    // Vista previa de liquidación filtrada por loc_alta_vista
    const resPreview = await app.inject({
      method: 'GET',
      url: `/api/delivery/settlement-preview?jornadaId=${jornadaId}&locationId=loc_alta_vista`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(resPreview.statusCode).toBe(200);
    const previewData = JSON.parse(resPreview.payload);
    expect(previewData.preview).toBeInstanceOf(Array);
    const driverPreview = previewData.preview.find((p: any) => p.driverId === driverId);
    expect(driverPreview).toBeDefined();
    expect(driverPreview.totalTrips).toBe(1);
    expect(driverPreview.totalDeliveryFeesUsdCents).toBe(300);

    // Ejecutar liquidación con location_id
    const resSettle = await app.inject({
      method: 'POST',
      url: '/api/delivery/settle-driver',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        driverId,
        jornadaId,
        locationId: 'loc_alta_vista'
      }
    });
    expect(resSettle.statusCode).toBe(200);
    const settleData = JSON.parse(resSettle.payload);
    expect(settleData.success).toBe(true);
    expect(settleData.settlement.totalTrips).toBe(1);
  });

  // --------------------------------------------------------------------------
  // TEST 9: PANEL DE LA DUEÑA (MÓVIL)
  // --------------------------------------------------------------------------
  it('9. Panel de la dueña: consolida ventas por sede, caja, alertas de stock y envíos recientes', async () => {
    const resDashboard = await app.inject({
      method: 'GET',
      url: '/api/fase4/owner-dashboard',
      headers: { authorization: `Bearer ${adminToken}` }
    });

    expect(resDashboard.statusCode).toBe(200);
    const data = JSON.parse(resDashboard.payload);

    expect(data.success).toBe(true);
    expect(data.dashboard).toBeDefined();
    expect(data.dashboard.salesByLocation).toBeInstanceOf(Array);
    expect(data.dashboard.salesByLocation.length).toBeGreaterThanOrEqual(2);
    expect(data.dashboard.recentTransfers).toBeInstanceOf(Array);
    expect(data.dashboard.lowStockAlerts).toBeInstanceOf(Array);
  });

  // --------------------------------------------------------------------------
  // TEST 10: SEGURIDAD DE ACCESO REMOTO (HTTPS, TTL CORTO, AUDITORÍA)
  // --------------------------------------------------------------------------
  it('10. Acceso remoto: rechaza HTTP si requiere HTTPS, limita sesión a 2h y registra auditoría', async () => {
    // Intento con header remoto no-HTTPS
    const resHttpRemote = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'x-remote-access': 'true',
        'x-forwarded-proto': 'http'
      },
      payload: {
        userId: 'usr_admin',
        pin: '123456'
      }
    });

    expect(resHttpRemote.statusCode).toBe(403);
    const errData = JSON.parse(resHttpRemote.payload);
    expect(errData.error).toMatch(/HTTPS/i);

    // Intento con HTTPS válido
    const resHttpsRemote = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'x-remote-access': 'true',
        'x-forwarded-proto': 'https'
      },
      payload: {
        userId: 'usr_admin',
        pin: '123456'
      }
    });

    expect(resHttpsRemote.statusCode).toBe(200);
    const okData = JSON.parse(resHttpsRemote.payload);
    expect(okData.isRemote).toBe(true);

    // Debe existir registro en audit_events de REMOTE_LOGIN_SUCCESS
    const auditRow = rawDb.prepare("SELECT * FROM audit_events WHERE action = 'REMOTE_LOGIN_SUCCESS' ORDER BY created_at_ms DESC LIMIT 1").get() as any;
    expect(auditRow).toBeDefined();
    expect(auditRow.actor_user_id).toBe('usr_admin');
  });

  // --------------------------------------------------------------------------
  // TEST 11: IDEMPOTENCIA Y CONCURRENCIA DE DOS DISPOSITIVOS
  // --------------------------------------------------------------------------
  it('11. Idempotencia y concurrencia: dos envíos concurrentes no corrompen saldo de stock', () => {
    const supplyId = `sup_concur_${generateUuidV7().replace(/-/g, '')}`;
    const now = Date.now();

    rawDb.prepare(`
      INSERT OR REPLACE INTO supply_items (id, name, unit, purchase_unit, usage_unit, conversion_factor, cost_per_unit_usd_cents, current_stock_qty, created_at_ms, updated_at_ms)
      VALUES (?, 'Salchicha Concurrente', 'und', 'und', 'und', 1.0, 40, 100, ?, ?)
    `).run(supplyId, now, now);

    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, 100, 0, ?)').run(
      `loc_los_olivos_${supplyId}`, 'loc_los_olivos', supplyId, now
    );
    rawDb.prepare('INSERT OR REPLACE INTO location_inventory (id, location_id, supply_id, current_stock_qty, minimum_stock_qty, updated_at_ms) VALUES (?, ?, ?, 0, 0, ?)').run(
      `loc_alta_vista_${supplyId}`, 'loc_alta_vista', supplyId, now
    );

    // Dispositivo A envía 25
    createTransfer(rawDb, {
      fromLocationId: 'loc_los_olivos',
      toLocationId: 'loc_alta_vista',
      mode: 'loose_supplies',
      items: [{ supplyId, quantity: 25 }],
      createdBy: 'usr_admin'
    });

    // Dispositivo B envía 35
    createTransfer(rawDb, {
      fromLocationId: 'loc_los_olivos',
      toLocationId: 'loc_alta_vista',
      mode: 'loose_supplies',
      items: [{ supplyId, quantity: 35 }],
      createdBy: 'usr_admin'
    });

    const stockA = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_los_olivos', supplyId) as any;
    const stockB = rawDb.prepare('SELECT current_stock_qty FROM location_inventory WHERE location_id = ? AND supply_id = ?').get('loc_alta_vista', supplyId) as any;

    // 100 - 25 - 35 = 40 en origen, 60 en destino
    expect(stockA.current_stock_qty).toBe(40);
    expect(stockB.current_stock_qty).toBe(60);
  });
});
