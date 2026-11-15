import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import {
  buildReceiptTicketIR,
  type OrderReceiptData,
  type ReceiptLineItem
} from '../src/modules/printing/templates.js';
import { enqueueOrderPrintJobs } from '../src/modules/printing/worker.js';
import type { TicketIR } from '@tocineta/shared';

describe('C1 — Eslogan, marca y DIOS en la nota de entrega (@tocineta/server)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_receipt_brand_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_receipt_brand.db');
  let rawDb: Database.Database;
  let adminId: string;

  const mockOrder: OrderReceiptData = {
    id: 'ord_brand_test_01',
    orderNumber: 101,
    fulfillmentType: 'dine_in',
    tableNumber: 'M1',
    customerName: 'Cliente Prueba',
    grossFoodSubtotalUsdCents: 1000,
    discountUsdCents: 0,
    deliveryFeeUsdCents: 0,
    totalToCollectUsdCents: 1000,
    rateMicroBs: 40_000_000,
    createdAtMs: Date.now()
  };

  const mockLines: ReceiptLineItem[] = [
    {
      lineId: 'line_brand_01',
      productName: 'Hamburguesa Especial',
      quantity: 1,
      priceUsdCents: 1000,
      modifiers: []
    }
  ];

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    runMigrations(rawDb, path.join(__dirname, '../src/db/migrations'));
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    // Sembrar jornada activa para órdenes
    const admin = rawDb.prepare('SELECT id FROM users WHERE role = ?').get('admin') as any;
    adminId = admin.id;
    rawDb.prepare(`
      INSERT INTO jornadas (id, opened_by_user_id, opened_at_ms, status, initial_cash_usd_cents, initial_cash_bs_cents)
      VALUES (?, ?, ?, 'abierta', 0, 0)
    `).run('jornada_brand_test', adminId, Date.now());
  });

  afterAll(() => {
    try {
      rawDb?.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignorar limpieza en pruebas
    }
  });

  describe('Unitaria: buildReceiptTicketIR', () => {
    it('con slogan = "Sabor de barrio" el IR contiene "Sabor de barrio"', () => {
      const ir = buildReceiptTicketIR(mockOrder, mockLines, {
        slogan: 'Sabor de barrio'
      });

      const sloganBlock = ir.blocks.find(
        (b) => b.type === 'text' && b.text.includes('Sabor de barrio')
      );
      expect(sloganBlock).toBeDefined();
      expect(sloganBlock?.text).toBe('"Sabor de barrio"');
    });

    it('con slogan vacío contiene el fallback con "DIOS" en mayúscula', () => {
      const ir = buildReceiptTicketIR(mockOrder, mockLines, {
        slogan: ''
      });

      const sloganBlock = ir.blocks.find(
        (b) => b.type === 'text' && b.text.includes('DIOS')
      );
      expect(sloganBlock).toBeDefined();
      expect(sloganBlock?.text).toBe(
        '"Cocinamos con amor, te servimos como mereces y damos gloria a DIOS"'
      );
    });

    it('con slogan de solo espacios contiene el fallback con "DIOS" en mayúscula', () => {
      const ir = buildReceiptTicketIR(mockOrder, mockLines, {
        slogan: '   '
      });

      const sloganBlock = ir.blocks.find(
        (b) => b.type === 'text' && b.text.includes('DIOS')
      );
      expect(sloganBlock).toBeDefined();
      expect(sloganBlock?.text).toBe(
        '"Cocinamos con amor, te servimos como mereces y damos gloria a DIOS"'
      );
    });

    it('con settings undefined contiene el fallback con "DIOS" en mayúscula', () => {
      const ir = buildReceiptTicketIR(mockOrder, mockLines);

      const sloganBlock = ir.blocks.find(
        (b) => b.type === 'text' && b.text.includes('DIOS')
      );
      expect(sloganBlock).toBeDefined();
      expect(sloganBlock?.text).toBe(
        '"Cocinamos con amor, te servimos como mereces y damos gloria a DIOS"'
      );
    });

    it('pie de ticket usa fallback con "DIOS le bendiga" en mayúscula cuando no está configurado', () => {
      const ir = buildReceiptTicketIR(mockOrder, mockLines);

      const footerBlock = ir.blocks.find((b) => b.type === 'footer') as any;
      expect(footerBlock).toBeDefined();
      expect(footerBlock.lines[0]).toBe('¡GRACIAS POR SU PREFERENCIA! DIOS le bendiga');
    });

    it('pie de ticket usa ticket_footer_message cuando está configurado', () => {
      const ir = buildReceiptTicketIR(mockOrder, mockLines, {
        ticket_footer_message: '¡Vuelva pronto amigo!'
      });

      const footerBlock = ir.blocks.find((b) => b.type === 'footer') as any;
      expect(footerBlock).toBeDefined();
      expect(footerBlock.lines[0]).toBe('¡Vuelva pronto amigo!');
    });
  });

  describe('Integración: enqueueOrderPrintJobs con base de datos real', () => {
    it('encola nota de entrega con eslogan configurado y luego con fallback DIOS', () => {
      // 1. Configurar eslogan personalizado
      rawDb.prepare(`
        UPDATE business_settings
        SET slogan = 'Sabor de barrio', business_name = 'TOCINETA TEST'
        WHERE id = 'default'
      `).run();

      const prod = rawDb.prepare('SELECT id FROM products WHERE is_active = 1 LIMIT 1').get() as any;
      const prodId = prod.id;

      // Insertar orden 1
      const orderId1 = 'ord_brand_integ_01';
      const now = Date.now();
      rawDb.prepare(`
        INSERT INTO orders (
          id, order_number, jornada_id, created_by_user_id, fulfillment_type, table_number, customer_name,
          gross_food_subtotal_usd_cents, discount_usd_cents, delivery_fee_usd_cents,
          total_to_collect_usd_cents, rate_micro_bs, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orderId1, 201, 'jornada_brand_test', adminId, 'salon', 'M2', 'Cliente Uno',
        1500, 0, 0, 1500, 40_000_000, now, now
      );

      // Insertar línea
      rawDb.prepare(`
        INSERT INTO order_lines (
          id, order_id, product_id, quantity, unit_price_usd_cents,
          prorated_unit_price_usd_cents, subtotal_usd_cents, station, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('line_01', orderId1, prodId, 1, 1500, 1500, 1500, 'hamburguesas', now);

      // Encolar trabajos de impresión
      const res1 = enqueueOrderPrintJobs(rawDb, orderId1);
      expect(res1.cajaJobId).toBeTruthy();

      const job1Row = rawDb.prepare('SELECT ticket_ir_json FROM print_jobs WHERE id = ?').get(res1.cajaJobId) as any;
      expect(job1Row).toBeDefined();
      const ir1 = JSON.parse(job1Row.ticket_ir_json) as TicketIR;
      const sloganBlock1 = ir1.blocks.find((b) => b.type === 'text' && b.text.includes('Sabor de barrio'));
      expect(sloganBlock1).toBeDefined();
      expect(sloganBlock1?.text).toBe('"Sabor de barrio"');

      // 2. Limpiar eslogan a vacío
      rawDb.prepare(`
        UPDATE business_settings
        SET slogan = ''
        WHERE id = 'default'
      `).run();

      // Insertar orden 2
      const orderId2 = 'ord_brand_integ_02';
      const now2 = Date.now();
      rawDb.prepare(`
        INSERT INTO orders (
          id, order_number, jornada_id, created_by_user_id, fulfillment_type, table_number, customer_name,
          gross_food_subtotal_usd_cents, discount_usd_cents, delivery_fee_usd_cents,
          total_to_collect_usd_cents, rate_micro_bs, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orderId2, 202, 'jornada_brand_test', adminId, 'salon', 'M3', 'Cliente Dos',
        1500, 0, 0, 1500, 40_000_000, now2, now2
      );

      rawDb.prepare(`
        INSERT INTO order_lines (
          id, order_id, product_id, quantity, unit_price_usd_cents,
          prorated_unit_price_usd_cents, subtotal_usd_cents, station, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('line_02', orderId2, prodId, 1, 1500, 1500, 1500, 'hamburguesas', now2);

      // Encolar trabajos para orden 2
      const res2 = enqueueOrderPrintJobs(rawDb, orderId2);
      expect(res2.cajaJobId).toBeTruthy();

      const job2Row = rawDb.prepare('SELECT ticket_ir_json FROM print_jobs WHERE id = ?').get(res2.cajaJobId) as any;
      expect(job2Row).toBeDefined();
      const ir2 = JSON.parse(job2Row.ticket_ir_json) as TicketIR;
      const sloganBlock2 = ir2.blocks.find((b) => b.type === 'text' && b.text.includes('DIOS'));
      expect(sloganBlock2).toBeDefined();
      expect(sloganBlock2?.text).toBe('"Cocinamos con amor, te servimos como mereces y damos gloria a DIOS"');

      const footerBlock2 = ir2.blocks.find((b) => b.type === 'footer') as any;
      expect(footerBlock2).toBeDefined();
      expect(footerBlock2.lines[0]).toBe('¡GRACIAS POR SU PREFERENCIA! DIOS le bendiga');

      // 3. Verificar inmutabilidad: el ticket 1 YA encolado conserva su eslogan
      const job1RowAgain = rawDb.prepare('SELECT ticket_ir_json FROM print_jobs WHERE id = ?').get(res1.cajaJobId) as any;
      const ir1Again = JSON.parse(job1RowAgain.ticket_ir_json) as TicketIR;
      const sloganBlock1Again = ir1Again.blocks.find((b) => b.type === 'text' && b.text.includes('Sabor de barrio'));
      expect(sloganBlock1Again).toBeDefined();
      expect(sloganBlock1Again?.text).toBe('"Sabor de barrio"');
    });
  });
});
