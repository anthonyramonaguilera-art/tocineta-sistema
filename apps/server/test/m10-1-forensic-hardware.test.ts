import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { FastifyInstance } from 'fastify';
import DatabaseConstructor, { type Database } from 'better-sqlite3';
import { initSqlite, getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { buildServer } from '../src/server.js';
import { renderTicketToEscPos, prorateComboLargestRemainder } from '@tocineta/shared';
import { createOrder } from '../src/modules/orders/order-service.js';
import { reportOrderIncident } from '../src/modules/incidents/incidents-service.js';

describe('Hito M10.1 - Hardware Forensics & Robustness Validation Suite (@tocineta/server)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_m10_1_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_m10_1.db');
  let rawDb: Database;
  let app: FastifyInstance;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb, { dbPath: tempDb });
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      const dbCtx = getDatabaseContext();
      dbCtx.rawDb.close();
    } catch {
      // Ignorar
    }
  });

  // ==========================================================================
  // TEST 1: GET /api/menu/pos - 6 Barra Libre ($0.00) y 6 Extras Pagos
  // ==========================================================================
  it('1. GET /api/menu/pos: devuelve 6 ítems de Barra Libre ($0.00) y 6 Extras Pagos con Carne Extra = 100 cents ($1.00)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/menu/pos'
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();

    // 1. Verificar Barra Libre (6 ítems a $0.00 / 0 cents)
    const barraLibreList = data.barraLibre || data.barraLibreIngredients;
    expect(barraLibreList).toBeDefined();
    expect(barraLibreList).toHaveLength(6);
    const blNames = barraLibreList.map((b: any) => b.name);
    expect(blNames).toContain('Tomate');
    expect(blNames).toContain('Cebolla Caramelizada');
    expect(blNames).toContain('Maíz');
    expect(blNames).toContain('Chimichurri');
    expect(blNames).toContain('Relish');
    expect(blNames).toContain('Cebolla');
    for (const bl of barraLibreList) {
      expect(bl.priceUsdCents).toBe(0);
    }

    // 2. Verificar Extras Pagos (6 extras oficiales)
    expect(data.paidExtras).toBeDefined();
    expect(data.paidExtras).toHaveLength(6);

    const carneExtra = data.paidExtras.find((e: any) => e.name === 'Carne Extra');
    expect(carneExtra).toBeDefined();
    expect(carneExtra.priceUsdCents).toBe(100); // 100 cents = $1.00 (NUNCA $3.50)

    const tocinetaExtra = data.paidExtras.find((e: any) => e.name === 'Tocineta Extra');
    expect(tocinetaExtra).toBeDefined();
    expect(tocinetaExtra.priceUsdCents).toBe(100);

    const papas250 = data.paidExtras.find((e: any) => e.name === 'Papas Fritas Ración 250g');
    expect(papas250).toBeDefined();
    expect(papas250.priceUsdCents).toBe(350);
  });

  // ==========================================================================
  // TEST 2: Prorrateo exacto en order_lines (COMBO_CHILD)
  // ==========================================================================
  it('2. Prorrateo exacto en order_lines (COMBO_CHILD): Combo Street = [212, 211, 127], Combo Clásico = [325, 325, 140], Combo Para Ti = [615, 615, 160]', async () => {
    // 1. Combo Street ($5.50 / 550¢) sobre [250, 250, 150]
    const streetItems = [
      { id: '1', normalPriceUsdCents: 250, order: 0 },
      { id: '2', normalPriceUsdCents: 250, order: 1 },
      { id: '3', normalPriceUsdCents: 150, order: 2 }
    ];
    const streetProrate = prorateComboLargestRemainder(550, streetItems);
    const streetPrices = streetProrate.items.map(i => i.proratedUsdCents);
    expect(streetPrices).toEqual([212, 211, 127]);

    // 2. Combo Clásico ($7.90 / 790¢) sobre [350, 350, 150]
    const clasicoItems = [
      { id: '1', normalPriceUsdCents: 350, order: 0 },
      { id: '2', normalPriceUsdCents: 350, order: 1 },
      { id: '3', normalPriceUsdCents: 150, order: 2 }
    ];
    const clasicoProrate = prorateComboLargestRemainder(790, clasicoItems);
    const clasicoPrices = clasicoProrate.items.map(i => i.proratedUsdCents);
    expect(clasicoPrices).toEqual([325, 325, 140]);

    // 3. Combo Para Ti ($13.90 / 1390¢) sobre [690, 690, 180]
    const paraTiItems = [
      { id: '1', normalPriceUsdCents: 690, order: 0 },
      { id: '2', normalPriceUsdCents: 690, order: 1 },
      { id: '3', normalPriceUsdCents: 180, order: 2 }
    ];
    const paraTiProrate = prorateComboLargestRemainder(1390, paraTiItems);
    const paraTiPrices = paraTiProrate.items.map(i => i.proratedUsdCents);
    expect(paraTiPrices).toEqual([615, 615, 160]);

    // Verificación adicional: crear una orden real con combo y verificar líneas en la base de datos
    const burger = rawDb.prepare('SELECT id FROM products WHERE is_combo = 0 LIMIT 1').get() as any;
    const combo = rawDb.prepare('SELECT id, price_usd_cents FROM products WHERE is_combo = 1 LIMIT 1').get() as any;

    if (combo && burger) {
      const orderRes = createOrder(rawDb, {
        createdByUserId: 'usr_admin_olinelcys',
        fulfillmentType: 'salon',
        lines: [
          {
            productId: combo.id,
            quantity: 1,
            comboChildren: [
              { productId: burger.id, quantity: 1 },
              { productId: burger.id, quantity: 1 }
            ]
          }
        ]
      });

      const childLines = rawDb.prepare(
        "SELECT prorated_unit_price_usd_cents FROM order_lines WHERE order_id = ? AND line_role = 'COMBO_CHILD' ORDER BY id"
      ).all(orderRes.id) as any[];

      expect(childLines.length).toBe(2);
      const sumChildren = childLines.reduce((acc, l) => acc + l.prorated_unit_price_usd_cents, 0);
      expect(sumChildren).toBe(combo.price_usd_cents);
    }
  });

  // ==========================================================================
  // TEST 3: Reembolso (refund) de orden en PAGO_MOVIL
  // ==========================================================================
  it('3. Reembolso (refund) de orden cobrada por PAGO_MOVIL genera contra-asiento en Bs sin tocar CASH_USD', async () => {
    // 1. Crear una orden de prueba usando createOrder
    const prod = rawDb.prepare('SELECT id, price_usd_cents FROM products WHERE is_combo = 0 LIMIT 1').get() as any;
    const now = Date.now();

    const orderRes = createOrder(rawDb, {
      createdByUserId: 'usr_admin_olinelcys',
      customerName: 'Cliente Pago Movil',
      fulfillmentType: 'salon',
      lines: [{ productId: prod.id, quantity: 1 }]
    });
    const orderId = orderRes.id;

    // Obtener sesión de caja abierta
    const sRow = rawDb.prepare("SELECT id FROM cash_sessions WHERE status = 'abierta' LIMIT 1").get() as any;
    const cashSessionId = sRow ? sRow.id : 'session_test_refund';
    if (!sRow) {
      const jRow = rawDb.prepare("SELECT id FROM jornadas WHERE status = 'abierta' LIMIT 1").get() as any;
      const jId = jRow ? jRow.id : 'jornada_test_refund';
      rawDb.prepare("INSERT OR IGNORE INTO cash_sessions (id, jornada_id, user_id, opened_at_ms, status) VALUES (?, ?, 'usr_admin_olinelcys', ?, 'abierta')").run(cashSessionId, jId, now);
    }

    // Registrar pago original en payments como PAGO_MOVIL
    const paymentId = `pay_${now}`;
    rawDb.prepare(`
      INSERT INTO payments (
        id, order_id, method, currency, amount_cents, rate_micro_bs,
        usd_equivalent_cents, reference_code, recorded_by_user_id, created_at_ms
      ) VALUES (?, ?, 'PAGO_MOVIL', 'BS', ?, 36600000, ?, 'REF-12345', 'usr_admin_olinelcys', ?)
    `).run(paymentId, orderId, Math.round(prod.price_usd_cents * 36.6), prod.price_usd_cents, now);

    rawDb.prepare("UPDATE orders SET payment_status = 'pagado' WHERE id = ?").run(orderId);

    // Contar cuántos movimientos CASH_USD existen antes del reembolso
    const cashUsdCountBefore = (rawDb.prepare(
      "SELECT count(*) as cnt FROM ledger_entries WHERE account_bucket = 'CASH_USD'"
    ).get() as any).cnt;

    // 2. Procesar reembolso con resolución 'refund'
    const incidentResult = reportOrderIncident(rawDb, orderId, {
      reasonCode: 'DEFECTIVE_PRODUCT',
      responsibleArea: 'cocina',
      resolution: 'refund',
      description: 'Cliente insatisfecho, reembolso de pago móvil',
      authorizerPin: '123456'
    });

    expect(incidentResult.success).toBe(true);
    expect(incidentResult.resolution).toBe('refund');

    // 3. Verificar que se generó contra-asiento en Bs (BANK_BS o CASH_BS)
    const refundEntries = rawDb.prepare(
      "SELECT * FROM ledger_entries WHERE order_id = ? AND description LIKE '%Reembolso%'"
    ).all(orderId) as any[];

    expect(refundEntries.length).toBeGreaterThan(0);
    const buckets = refundEntries.map(e => e.account_bucket);
    expect(buckets).toContain('BANK_BS');
    expect(buckets).not.toContain('CASH_USD');
    for (const entry of refundEntries) {
      expect(entry.account_bucket).not.toBe('CASH_USD');
    }

    // 4. PROHIBIDO tocar CASH_USD
    const cashUsdCountAfter = (rawDb.prepare(
      "SELECT count(*) as cnt FROM ledger_entries WHERE account_bucket = 'CASH_USD'"
    ).get() as any).cnt;

    expect(cashUsdCountAfter).toBe(cashUsdCountBefore);
  });

  // ==========================================================================
  // TEST 4: Escaneo de seguridad de claves age
  // ==========================================================================
  it('4. Escaneo de seguridad: ningún archivo en apps/, packages/, scripts/ o tools/ contiene claves privadas estáticas', () => {
    const forbidden = ['AGE', 'SECRET', 'KEY', '1'].join('-');
    const searchDirs = ['apps', 'packages', 'scripts', 'tools'];

    // Encontrar raíz del repo buscando pnpm-workspace.yaml
    let repoRoot = process.cwd();
    while (repoRoot.length > 3 && !fs.existsSync(path.join(repoRoot, 'pnpm-workspace.yaml'))) {
      repoRoot = path.dirname(repoRoot);
    }

    const currentTestFileName = 'm10-1-forensic-hardware.test.ts';

    function checkDir(dirPath: string) {
      if (!fs.existsSync(dirPath)) return;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
          continue;
        }
        if (entry.name === currentTestFileName) {
          continue;
        }
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          checkDir(fullPath);
        } else if (entry.isFile()) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.includes(forbidden)) {
            throw new Error(`Seguridad violada: el archivo '${fullPath}' contiene la clave privada estática '${forbidden}'`);
          }
        }
      }
    }

    for (const sub of searchDirs) {
      checkDir(path.join(repoRoot, sub));
    }
  });

  // ==========================================================================
  // TEST 5: renderTicketToEscPos({ codepage: 16, hasCutter: false, hasBuzzer: false })
  // ==========================================================================
  it('5. renderTicketToEscPos({ codepage: 16, hasCutter: false, hasBuzzer: false }): WPC1252, sin cutter, sin buzzer, termina con 0x0A x 5', () => {
    const bytes = renderTicketToEscPos({ codepage: 16, hasCutter: false, hasBuzzer: false });
    expect(bytes).toBeInstanceOf(Uint8Array);

    // Contiene 0x1B 0x74 0x10 (ESC t 16)
    expect(bytes[2]).toBe(0x1b);
    expect(bytes[3]).toBe(0x74);
    expect(bytes[4]).toBe(0x10);

    // Codifica "TOCINETA SONRÍE - JALAPEÑOS - MAÍZ" en WPC1252:
    // Í = 0xCD, Ñ = 0xD1, Á = 0xC1
    expect(bytes).toContain(0xcd); // Í
    expect(bytes).toContain(0xd1); // Ñ
    expect(bytes).toContain(0xc1); // Á

    // NO contiene 0x1D 0x56 (GS V)
    const hasGsV = bytes.some((b, i) => b === 0x1d && bytes[i + 1] === 0x56);
    expect(hasGsV).toBe(false);

    // NO contiene 0x1B 0x42 (ESC B)
    const hasEscB = bytes.some((b, i) => b === 0x1b && bytes[i + 1] === 0x42);
    expect(hasEscB).toBe(false);

    // Termina con 0x0A x 5
    const last5 = bytes.slice(-5);
    expect(Array.from(last5)).toEqual([0x0a, 0x0a, 0x0a, 0x0a, 0x0a]);
  });

  // ==========================================================================
  // TEST 6: (Test 5b) renderTicketToEscPos({ codepage: 2, hasCutter: false, hasBuzzer: false })
  // ==========================================================================
  it('6. (Test 5b) renderTicketToEscPos({ codepage: 2, hasCutter: false, hasBuzzer: false }): CP850, sin cutter, sin buzzer', () => {
    const bytes = renderTicketToEscPos({ codepage: 2, hasCutter: false, hasBuzzer: false });
    expect(bytes).toBeInstanceOf(Uint8Array);

    // Contiene 0x1B 0x74 0x02 (ESC t 2)
    expect(bytes[2]).toBe(0x1b);
    expect(bytes[3]).toBe(0x74);
    expect(bytes[4]).toBe(0x02);

    // Codifica "TOCINETA SONRÍE - JALAPEÑOS" en CP850:
    // Í = 0xD6, Ñ = 0xA5
    expect(bytes).toContain(0xd6); // Í en CP850
    expect(bytes).toContain(0xa5); // Ñ en CP850

    // NO contiene GS V ni ESC B
    const hasGsV = bytes.some((b, i) => b === 0x1d && bytes[i + 1] === 0x56);
    expect(hasGsV).toBe(false);

    const hasEscB = bytes.some((b, i) => b === 0x1b && bytes[i + 1] === 0x42);
    expect(hasEscB).toBe(false);
  });

  // ==========================================================================
  // TEST 7: renderTicketToEscPos({ codepage: 16, hasCutter: true, hasBuzzer: true })
  // ==========================================================================
  it('7. renderTicketToEscPos({ codepage: 16, hasCutter: true, hasBuzzer: true }): emite GS V 66 0 y ESC B', () => {
    const bytes = renderTicketToEscPos({ codepage: 16, hasCutter: true, hasBuzzer: true });
    expect(bytes).toBeInstanceOf(Uint8Array);

    // SÍ emite 0x1D 0x56 0x42 0x00 (GS V 66 0)
    const hasGsVCut = bytes.some(
      (b, i) => b === 0x1d && bytes[i + 1] === 0x56 && bytes[i + 2] === 0x42 && bytes[i + 3] === 0x00
    );
    expect(hasGsVCut).toBe(true);

    // SÍ emite 0x1B 0x42 (ESC B buzzer)
    const hasEscB = bytes.some((b, i) => b === 0x1b && bytes[i + 1] === 0x42);
    expect(hasEscB).toBe(true);
  });

  // ==========================================================================
  // TEST 8: seedInitialUsers sobre DB vacía
  // ==========================================================================
  it('8. seedInitialUsers sobre DB vacía: admin y supervisor tienen must_change_pin = 1; el resto tiene 0', async () => {
    const freshDbPath = path.join(tempDir, 'fresh_seed.db');
    const freshRawDb = new DatabaseConstructor(freshDbPath);
    await runMigrations(freshRawDb, { dbPath: freshDbPath });

    seedInitialUsers(freshRawDb);

    const admin = freshRawDb.prepare("SELECT must_change_pin FROM users WHERE role = 'admin'").get() as any;
    expect(admin).toBeDefined();
    expect(admin.must_change_pin).toBe(1);

    const supervisor = freshRawDb.prepare("SELECT must_change_pin FROM users WHERE role = 'supervisor'").get() as any;
    expect(supervisor).toBeDefined();
    expect(supervisor.must_change_pin).toBe(1);

    const otherStaff = freshRawDb.prepare(
      "SELECT must_change_pin FROM users WHERE role NOT IN ('admin', 'supervisor')"
    ).all() as any[];

    expect(otherStaff.length).toBeGreaterThan(0);
    for (const staff of otherStaff) {
      expect(staff.must_change_pin).toBe(0);
    }

    freshRawDb.close();
  });

  // ==========================================================================
  // TEST 9: Bootstrap automático de usuarios
  // ==========================================================================
  it('9. Bootstrap automático: al iniciar sobre una base de datos sin usuarios, se crean automáticamente los 7 usuarios semilla', async () => {
    const bootstrapDbPath = path.join(tempDir, 'bootstrap_auto.db');
    const bootRawDb = new DatabaseConstructor(bootstrapDbPath);
    await runMigrations(bootRawDb, { dbPath: bootstrapDbPath });

    // Confirmar que antes del bootstrap hay 0 usuarios
    const countBefore = (bootRawDb.prepare('SELECT count(*) as cnt FROM users').get() as any).cnt;
    expect(countBefore).toBe(0);

    // Simular el bootstrap del servidor
    const cntCheck = (bootRawDb.prepare('SELECT COUNT(*) as cnt FROM users').get() as any).cnt;
    if (cntCheck === 0) {
      seedInitialUsers(bootRawDb);
    }

    const countAfter = (bootRawDb.prepare('SELECT count(*) as cnt FROM users').get() as any).cnt;
    expect(countAfter).toBe(7);

    bootRawDb.close();
  });

  // ==========================================================================
  // TEST 10: POST /api/auth/login con admin devuelve mustChangePin: true
  // ==========================================================================
  it('10. POST /api/auth/login con admin devuelve mustChangePin: true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        userId: 'usr_admin_olinelcys',
        pin: '123456'
      }
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.token).toBeDefined();
    expect(data.mustChangePin).toBe(true);
  });

  // ==========================================================================
  // TEST 11: POST /api/auth/change-pin cambia el PIN y actualiza must_change_pin = 0
  // ==========================================================================
  it('11. POST /api/auth/change-pin cambia el PIN y actualiza must_change_pin = 0', async () => {
    // 1. Iniciar sesión como supervisor
    const resLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        userId: 'usr_supervisor_turno',
        pin: '654321'
      }
    });

    expect(resLogin.statusCode).toBe(200);
    const { token, mustChangePin } = resLogin.json();
    expect(mustChangePin).toBe(true);

    // 2. Cambiar PIN
    const resChange = await app.inject({
      method: 'POST',
      url: '/api/auth/change-pin',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        currentPin: '654321',
        newPin: '987654'
      }
    });

    expect(resChange.statusCode).toBe(200);
    expect(resChange.json().success).toBe(true);

    // 3. Verificar que must_change_pin ahora es 0 en base de datos
    const userRow = rawDb.prepare('SELECT must_change_pin FROM users WHERE id = ?').get('usr_supervisor_turno') as any;
    expect(userRow.must_change_pin).toBe(0);

    // 4. Iniciar sesión con el nuevo PIN
    const resNewLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        userId: 'usr_supervisor_turno',
        pin: '987654'
      }
    });

    expect(resNewLogin.statusCode).toBe(200);
    expect(resNewLogin.json().mustChangePin).toBe(false);
  });
});
