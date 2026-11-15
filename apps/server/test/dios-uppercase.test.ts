import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { initSqlite } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { DEFAULT_BUSINESS_SETTINGS, ensureBusinessSettingsDefensive } from '../src/db/business-settings.js';
import { OFFICIAL_SLOGAN, getPublicQrMenuData } from '../src/modules/qr-menu/qr-menu-service.js';
import {
  buildReceiptTicketIR,
  type OrderReceiptData,
  type ReceiptLineItem
} from '../src/modules/printing/templates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('D2 — "DIOS" siempre en mayúscula (código y datos)', () => {
  const tempDir = path.join(os.tmpdir(), `tocineta_dios_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_dios.db');
  let rawDb: Database.Database;

  const mockOrder: OrderReceiptData = {
    id: 'ord_dios_01',
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
      lineId: 'line_dios_01',
      productName: 'Hamburguesa',
      quantity: 1,
      priceUsdCents: 1000,
      modifiers: []
    }
  ];

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;
    await runMigrations(rawDb, path.join(__dirname, '../src/db/migrations'));
    ensureBusinessSettingsDefensive(rawDb);
  });

  afterAll(() => {
    try {
      rawDb?.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. El footer por defecto contiene "DIOS" y no "Dios"', () => {
    expect(DEFAULT_BUSINESS_SETTINGS.ticket_footer_message).toContain('DIOS');
    expect(DEFAULT_BUSINESS_SETTINGS.ticket_footer_message).not.toContain('Dios');
    expect(DEFAULT_BUSINESS_SETTINGS.ticket_footer_message).toBe('¡GRACIAS POR SU PREFERENCIA! DIOS le bendiga');
  });

  it('2. El eslogan por defecto (OFFICIAL_SLOGAN) contiene "DIOS" y no "Dios"', () => {
    expect(OFFICIAL_SLOGAN).toContain('DIOS');
    expect(OFFICIAL_SLOGAN).not.toContain('Dios');
    expect(OFFICIAL_SLOGAN).toBe('Cocinamos con amor, te servimos como mereces y damos gloria a DIOS');
  });

  it('3. El menú / banner QR contiene "DIOS" y no "Dios"', () => {
    const cloudDataDefault = getPublicQrMenuData(rawDb);
    expect(cloudDataDefault.slogan).toContain('DIOS');
    expect(cloudDataDefault.slogan).not.toContain('Dios');
    expect(cloudDataDefault.slogan).toBe('Cocinamos con amor, te servimos como mereces y damos gloria a DIOS');

    // Si settings contiene el literal antiguo con "Dios", se sanitiza a "DIOS"
    rawDb.prepare(`
      UPDATE business_settings
      SET slogan = 'Cocinamos con amor, te servimos como mereces y damos gloria a Dios'
      WHERE id = 'default'
    `).run();

    const cloudDataLegacy = getPublicQrMenuData(rawDb);
    expect(cloudDataLegacy.slogan).toContain('DIOS');
    expect(cloudDataLegacy.slogan).not.toContain('Dios');
  });

  it('4. El ticket renderizado contiene "DIOS" y no "Dios" en eslogan y pie de página', () => {
    // Caso A: Sin settings (fallback a defaults oficiales)
    const irDefault = buildReceiptTicketIR(mockOrder, mockLines);
    const sloganBlock = irDefault.blocks.find(b => b.type === 'text' && b.text.includes('damos gloria a DIOS'));
    expect(sloganBlock).toBeDefined();
    expect(sloganBlock?.text).not.toContain('Dios');

    const footerBlock = irDefault.blocks.find(b => b.type === 'footer') as any;
    expect(footerBlock).toBeDefined();
    expect(footerBlock.lines[0]).toBe('¡GRACIAS POR SU PREFERENCIA! DIOS le bendiga');
    expect(footerBlock.lines[0]).not.toContain('Dios');

    // Caso B: Con settings que tienen "Dios" en minúscula
    const legacySettings = {
      ...DEFAULT_BUSINESS_SETTINGS,
      slogan: 'Cocinamos con amor, te servimos como mereces y damos gloria a Dios',
      ticket_footer_message: '¡GRACIAS POR SU PREFERENCIA! Dios le bendiga'
    };
    const irLegacy = buildReceiptTicketIR(mockOrder, mockLines, legacySettings);
    const legacySloganBlock = irLegacy.blocks.find(b => b.type === 'text' && b.text.includes('damos gloria a DIOS'));
    expect(legacySloganBlock).toBeDefined();
    expect(legacySloganBlock?.text).not.toContain('Dios');

    const legacyFooterBlock = irLegacy.blocks.find(b => b.type === 'footer') as any;
    expect(legacyFooterBlock).toBeDefined();
    expect(legacyFooterBlock.lines[0]).toBe('¡GRACIAS POR SU PREFERENCIA! DIOS le bendiga');
    expect(legacyFooterBlock.lines[0]).not.toContain('Dios');
  });

  it('5. Migración 0046: actualiza campos configurables en business_settings con "Dios" a "DIOS"', () => {
    // Sembrar valores con "Dios"
    rawDb.prepare(`
      UPDATE business_settings
      SET slogan = 'Cocinamos con amor y damos gloria a Dios',
          ticket_footer_message = 'Muchas gracias, que Dios le bendiga siempre',
          ticket_header_message = 'Bienvenidos en el nombre de Dios'
      WHERE id = 'default'
    `).run();

    // Ejecutar el script SQL de la migración 0046 directamente
    const migrationSql = fs.readFileSync(
      path.join(__dirname, '../src/db/migrations/0046_dios_uppercase.sql'),
      'utf8'
    );
    rawDb.exec(migrationSql);

    const row = rawDb.prepare(`
      SELECT slogan, ticket_footer_message, ticket_header_message
      FROM business_settings
      WHERE id = 'default'
    `).get() as any;

    expect(row.slogan).toBe('Cocinamos con amor y damos gloria a DIOS');
    expect(row.slogan).not.toContain('Dios');

    expect(row.ticket_footer_message).toBe('Muchas gracias, que DIOS le bendiga siempre');
    expect(row.ticket_footer_message).not.toContain('Dios');

    expect(row.ticket_header_message).toBe('Bienvenidos en el nombre de DIOS');
    expect(row.ticket_header_message).not.toContain('Dios');
  });
});
