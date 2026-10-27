import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { buildServer } from '../src/server.js';
import { getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import {
  STAFF_PERMISSIONS,
  getDefaultPermissionsForRole,
  canUserProcessPayments,
  canUserVoidOrders,
  canUserEditMenu,
  canUserViewCosts,
  canUserViewProfitability,
  canUserTakeOrders
} from '@tocineta/shared';
import {
  createStaffUser,
  listStaffUsers
} from '../src/modules/staff/users-service.js';
import {
  getPayrollSettings,
  updatePayrollSettings,
  upsertPayrollProfile,
  addPayrollAdjustment,
  addStaffConsumption,
  executeSettlement,
  generateSettlementPdf
} from '../src/modules/staff/payroll-service.js';
import { TipsService } from '../src/modules/staff/tips-service.js';
import { reportOrderIncident } from '../src/modules/incidents/incidents-service.js';
import { loginAs, ensureTestSupervisor } from './test-helpers.js';

describe('FASE 6 — PERSONAL, PERMISOS, NÓMINA Y PROPINAS', () => {
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
    ensureTestSupervisor(rawDb);

    const now = Date.now();
    rawDb.prepare(`
      INSERT OR IGNORE INTO jornadas (
        id, location_id, opened_by_user_id, opened_at_ms, status
      ) VALUES ('jor_activa', 'loc_alta_vista', 'usr_admin', ?, 'abierta')
    `).run(now);

    const loginRes = await loginAs(app, 'admin', rawDb);
    adminToken = loginRes.token;
  });

  afterAll(async () => {
    await app.close();
  });

  const testId = Date.now();
  const mariaUsername = `maria.gomez.${testId}`;

  // --------------------------------------------------------------------------
  // TEST 1: USUARIOS Y SEMILLA CON PIN OBLIGATORIO
  // --------------------------------------------------------------------------
  it('1. Usuarios: creación de empleado con nombre real, usuario único y cambio de PIN en semillas', async () => {
    // 1.1 Verificar que usuarios semilla tienen must_change_pin = 1
    const seedUser = rawDb.prepare("SELECT must_change_pin FROM users WHERE id = 'usr_cajera'").get() as any;
    expect(seedUser).toBeDefined();
    expect(seedUser.must_change_pin).toBe(1);

    // 1.2 Crear empleado real con nombre individual y usuario único
    const newEmployee = createStaffUser(rawDb, {
      name: 'María Gómez',
      username: mariaUsername,
      role: 'mesonero',
      pin: '2468',
      baseSalaryUsdCents: 5000,
      frequency: 'SEMANAL'
    });

    expect(newEmployee.id).toBeDefined();
    expect(newEmployee.name).toBe('María Gómez');
    expect(newEmployee.username).toBe(mariaUsername);
    expect(newEmployee.role).toBe('mesonero');
    expect(newEmployee.mustChangePin).toBe(false);
    expect(newEmployee.payrollProfile?.baseSalaryUsdCents).toBe(5000);

    // 1.3 Verificar unicidad de username
    expect(() => {
      createStaffUser(rawDb, {
        name: 'Otra María',
        username: mariaUsername,
        role: 'mesonero',
        pin: '1357'
      });
    }).toThrow(/ya está en uso/);

    // 1.4 Listar personal con perfil de nómina vía API
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(listRes.statusCode).toBe(200);
    const listJson = JSON.parse(listRes.payload);
    expect(listJson.success).toBe(true);
    const maria = listJson.users.find((u: any) => u.username === mariaUsername);
    expect(maria).toBeDefined();
    expect(maria.payrollProfile?.baseSalaryUsdCents).toBe(5000);
  });

  // --------------------------------------------------------------------------
  // TEST 2: PERMISOS GRANULARES Y RBAC
  // --------------------------------------------------------------------------
  it('2. Permisos: configuración por rol y persona, costos y utilidades restringidos', async () => {
    const waiterPerms = getDefaultPermissionsForRole('mesonero');
    expect(waiterPerms).toContain(STAFF_PERMISSIONS.POS_TAKE_ORDERS);
    expect(waiterPerms).not.toContain(STAFF_PERMISSIONS.VIEW_COSTS);
    expect(waiterPerms).not.toContain(STAFF_PERMISSIONS.VIEW_PROFITABILITY);

    const waiter = { role: 'mesonero', permissions: waiterPerms };
    expect(canUserTakeOrders(waiter)).toBe(true);
    expect(canUserViewCosts(waiter)).toBe(false);
    expect(canUserViewProfitability(waiter)).toBe(false);
    expect(canUserVoidOrders(waiter)).toBe(false);
    expect(canUserEditMenu(waiter)).toBe(false);

    const adminPerms = getDefaultPermissionsForRole('admin');
    const admin = { role: 'admin', permissions: adminPerms };
    expect(canUserViewCosts(admin)).toBe(true);
    expect(canUserViewProfitability(admin)).toBe(true);
    expect(canUserVoidOrders(admin)).toBe(true);
    expect(canUserProcessPayments(admin)).toBe(true);

    const staffList = listStaffUsers(rawDb);
    const employee = staffList.find(s => s.username === mariaUsername)!;
    const updatedPerms = [...employee.permissions, STAFF_PERMISSIONS.VIEW_COSTS];

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${employee.id}/permissions`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { permissions: updatedPerms }
    });
    expect(patchRes.statusCode).toBe(200);

    const updatedEmployee = { role: employee.role, permissions: updatedPerms };
    expect(canUserViewCosts(updatedEmployee)).toBe(true);
    expect(canUserViewProfitability(updatedEmployee)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // TEST 3: TRAZABILIDAD EN OPERACIONES (PEDIDOS, PAGOS, ANULACIONES, MERMAS)
  // --------------------------------------------------------------------------
  it('3. Trazabilidad: pedido, pago, merma y anulación guardan quién lo hizo', () => {
    const now = Date.now();
    const orderId = `ord_test_trazabilidad_${now}`;

    // 3.1 Pedido guarda created_by_user_id
    rawDb.prepare(`
      INSERT INTO orders (
        id, order_number, location_id, jornada_id, created_by_user_id,
        gross_food_subtotal_usd_cents, net_food_sales_usd_cents, total_to_collect_usd_cents,
        delivery_fee_usd_cents, fulfillment_type, payment_status, fulfillment_status,
        rate_micro_bs, created_at_ms, updated_at_ms
      ) VALUES (?, 901, 'loc_alta_vista', 'jor_activa', 'usr_cajera', 2000, 2000, 2000, 0, 'salon', 'sin_pago', 'pendiente', 40000000, ?, ?)
    `).run(orderId, now, now);

    const savedOrder = rawDb.prepare('SELECT created_by_user_id FROM orders WHERE id = ?').get(orderId) as any;
    expect(savedOrder.created_by_user_id).toBe('usr_cajera');

    // 3.2 Pago guarda recorded_by_user_id
    const paymentId = `pay_test_${now}`;
    rawDb.prepare(`
      INSERT INTO payments (
        id, order_id, method, currency, amount_cents,
        rate_micro_bs, usd_equivalent_cents, recorded_by_user_id, created_at_ms
      ) VALUES (?, ?, 'EFECTIVO_USD', 'USD', 2000, 40000000, 2000, 'usr_cajera', ?)
    `).run(paymentId, orderId, now);

    const savedPayment = rawDb.prepare('SELECT recorded_by_user_id FROM payments WHERE id = ?').get(paymentId) as any;
    expect(savedPayment.recorded_by_user_id).toBe('usr_cajera');

    // 3.3 Anulación guarda cancelled_by_user_id (vía supervisor)
    reportOrderIncident(rawDb, orderId, {
      reasonCode: 'ERROR_DIGITACION',
      responsibleArea: 'mesonero',
      resolution: 'void_paid',
      authorizerPin: '123456'
    });

    const cancelledOrder = rawDb.prepare('SELECT payment_status, cancelled_by_user_id FROM orders WHERE id = ?').get(orderId) as any;
    expect(cancelledOrder.payment_status).toBe('anulado');
    expect(cancelledOrder.cancelled_by_user_id).toBeDefined();

    // 3.4 Merma / Incidente guarda authorized_by_user_id
    const incident = rawDb.prepare('SELECT authorized_by_user_id FROM worker_incidents WHERE order_id = ?').get(orderId) as any;
    expect(incident.authorized_by_user_id).toBe(cancelledOrder.cancelled_by_user_id);
  });

  // --------------------------------------------------------------------------
  // TEST 4: NÓMINA, CONSUMOS, CENA FIJA Y LIQUIDACIÓN EXACTA
  // --------------------------------------------------------------------------
  it('4. Nómina: cálculo exacto Neto = base + bonos − adelantos − consumos cobrados y recibo PDF', async () => {
    updatePayrollSettings(rawDb, {
      payrollEnabled: true,
      fixedDinnerEnabled: true,
      fixedDinnerCostUsdCents: 250
    });
    const settings = getPayrollSettings(rawDb);
    expect(settings.payrollEnabled).toBe(true);
    expect(settings.fixedDinnerEnabled).toBe(true);
    expect(settings.fixedDinnerCostUsdCents).toBe(250);

    // Crear trabajador para la liquidación
    const worker = createStaffUser(rawDb, {
      name: 'Lucía Méndez',
      username: `lucia.mendez.${testId}`,
      role: 'mesonero',
      pin: '4321',
      baseSalaryUsdCents: 5000,
      frequency: 'SEMANAL'
    });

    upsertPayrollProfile(rawDb, worker.id, {
      frequency: 'SEMANAL',
      baseSalaryUsdCents: 5000
    });

    // Bonos ($15.00) y Adelantos ($10.00)
    addPayrollAdjustment(rawDb, {
      userId: worker.id,
      type: 'BONO',
      amountUsdCents: 1500,
      concept: 'Bono puntualidad',
      createdByUserId: 'usr_admin'
    });
    addPayrollAdjustment(rawDb, {
      userId: worker.id,
      type: 'ADELANTO',
      amountUsdCents: 1000,
      concept: 'Adelanto en efectivo',
      createdByUserId: 'usr_admin'
    });

    // Consumos:
    // - 1 cena fija ($2.50)
    // - 1 consumo adicional $4.00 a cobrar
    // - 1 consumo adicional $3.00 a perdonar
    addStaffConsumption(rawDb, {
      userId: worker.id,
      concept: 'Cena del turno',
      amountUsdCents: 250,
      isFixedDinner: true
    });
    const cons1 = addStaffConsumption(rawDb, {
      userId: worker.id,
      concept: 'Hamburguesa Doble',
      amountUsdCents: 400,
      isFixedDinner: false
    });
    const cons2 = addStaffConsumption(rawDb, {
      userId: worker.id,
      concept: 'Refresco Familiar',
      amountUsdCents: 300,
      isFixedDinner: false
    });

    // Liquidación: Neto = 5000 + 1500 - 1000 - 400 = 5100 ($51.00 USD)
    const settlement = executeSettlement(rawDb, {
      userId: worker.id,
      periodStartMs: Date.now() - 7 * 86400000,
      periodEndMs: Date.now(),
      frequency: 'SEMANAL',
      baseSalaryUsdCents: 5000,
      chargedConsumptionIds: [cons1.id],
      forgivenConsumptionIds: [cons2.id],
      paymentMethod: 'EFECTIVO_USD',
      settledByUserId: 'usr_admin'
    });

    expect(settlement.baseSalaryUsdCents).toBe(5000);
    expect(settlement.bonusesUsdCents).toBe(1500);
    expect(settlement.advancesUsdCents).toBe(1000);
    expect(settlement.consumptionsChargedUsdCents).toBe(400);
    expect(settlement.consumptionsForgivenUsdCents).toBe(300);
    expect(settlement.fixedDinnerCount).toBe(1);
    expect(settlement.netUsdCents).toBe(5100);

    // Gasto del local por cena fija
    const dinnerExpense = rawDb.prepare(
      "SELECT * FROM operating_expenses WHERE category = 'ALIMENTACION_PERSONAL' ORDER BY created_at_ms DESC LIMIT 1"
    ).get() as any;
    expect(dinnerExpense).toBeDefined();
    expect(dinnerExpense.amount_usd_cents).toBe(250);

    // Recibo PDF generado
    const pdfBuffer = await generateSettlementPdf(rawDb, settlement.settlementId);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(500);
    expect(pdfBuffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  // --------------------------------------------------------------------------
  // TEST 5: POOL DE PROPINAS (EQUAL Y HOURS)
  // --------------------------------------------------------------------------
  it('5. Propinas: pool acumulado, reparto equitativo y por horas entre meseros', async () => {
    const t = Date.now();
    const mesero1 = createStaffUser(rawDb, { name: 'Mesero Uno', username: `mesero.uno.${t}`, role: 'mesonero', pin: '1111' });
    const mesero2 = createStaffUser(rawDb, { name: 'Mesero Dos', username: `mesero.dos.${t}`, role: 'mesonero', pin: '2222' });
    const mesero3 = createStaffUser(rawDb, { name: 'Mesero Tres', username: `mesero.tres.${t}`, role: 'mesonero', pin: '3333' });

    // Pool 1: Reparto Equitativo (EQUAL)
    const pool1 = await TipsService.getOrCreateOpenPool('loc_alta_vista', 'jor_activa');
    await TipsService.addTip({
      tipPoolId: pool1.id,
      locationId: 'loc_alta_vista',
      jornadaId: 'jor_activa',
      amountUsdCents: 6000,
      amountBsCents: 240000
    });

    const res1 = await TipsService.closeAndDistributePool({
      tipPoolId: pool1.id,
      closedByUserId: 'usr_admin',
      splitMode: 'EQUAL',
      participants: [
        { userId: mesero1.id },
        { userId: mesero2.id },
        { userId: mesero3.id }
      ]
    });

    expect(res1.pool.status).toBe('CLOSED');
    expect(res1.distributions.length).toBe(3);
    for (const d of res1.distributions) {
      expect(d.amountUsdCents).toBe(2000);
    }

    // Pool 2: Reparto por Horas (HOURS)
    const pool2 = await TipsService.getOrCreateOpenPool('loc_alta_vista', 'jor_activa');
    await TipsService.addTip({
      tipPoolId: pool2.id,
      locationId: 'loc_alta_vista',
      jornadaId: 'jor_activa',
      amountUsdCents: 10000,
      amountBsCents: 400000
    });

    const res2 = await TipsService.closeAndDistributePool({
      tipPoolId: pool2.id,
      closedByUserId: 'usr_admin',
      splitMode: 'HOURS',
      participants: [
        { userId: mesero1.id, hoursWorked: 6 },
        { userId: mesero2.id, hoursWorked: 4 }
      ]
    });

    expect(res2.pool.status).toBe('CLOSED');
    const d1 = res2.distributions.find(d => d.userId === mesero1.id)!;
    const d2 = res2.distributions.find(d => d.userId === mesero2.id)!;
    expect(d1.amountUsdCents).toBe(6000);
    expect(d2.amountUsdCents).toBe(4000);
    expect(d1.amountUsdCents + d2.amountUsdCents).toBe(10000);

    // Marcar distribución pagada
    await TipsService.markDistributionPaid(d1.id);
    const updatedDist = rawDb.prepare('SELECT status FROM tip_pool_distributions WHERE id = ?').get(d1.id) as any;
    expect(updatedDist.status).toBe('PAGADO');
  });
});
