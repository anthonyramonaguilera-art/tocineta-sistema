/**
 * SUITE MAESTRA DE AUDITORÍA Y ENDURECIMIENTO — HITO M16
 * Verificación forense integral: KDS Opción B, Módulo Fiscal/IGTF en templates.ts,
 * Compatibilidad Dual Windows 10/11, Reversión de Cupones, Actualizaciones Resilientes,
 * Límite WhatsApp 3500 chars, Zonas de Delivery $2-$5 y Muestra Mínima Kasavana.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { renderTicketToEscPos, renderTicketToHtml } from '@tocineta/shared';
import { buildServer } from '../src/server.js';
import { getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';

// Módulos bajo prueba
import { getKdsOrders, updateKdsLineStatus } from '../src/modules/kds/kds-service.js';
import { computeFiscalBreakdown, buildReceiptTicketIR, type OrderReceiptData } from '../src/modules/printing/templates.js';
import {
  detectWindowsVersion,
  launchQuickAssistCascade,
  recordSupportFallbackSelection,
  SUPPORT_FALLBACK_OPTIONS,
  _resetSupportStateForTesting
} from '../src/modules/support/support-service.js';
import {
  applyCouponToOrder,
  reverseCouponRedemptionForOrder,
  validateCoupon
} from '../src/modules/coupons/coupon-service.js';
import { reportOrderIncident } from '../src/modules/incidents/incidents-service.js';
import { recoverStuckUpdatesOnBoot } from '../src/modules/updater/updater-service.js';
import {
  formatWhatsAppOrderMessage,
  MAX_WHATSAPP_MSG_LENGTH,
  OFFICIAL_DELIVERY_ZONES
} from '../src/modules/qr-menu/qr-menu-service.js';
import { generateMenuEngineeringReport } from '../src/modules/profitability/menu-engineering.js';

describe('HITO M16 — Suite Forense de Endurecimiento y Compatibilidad Dual Win10/Win11', () => {
  let app: FastifyInstance;
  let rawDb: Database.Database;
  const testJornadaId = `jornada_m16_${Date.now()}`;

  beforeAll(async () => {
    app = await buildServer({ disableStatic: true, logger: false });
    await app.ready();

    const dbCtx = getDatabaseContext();
    rawDb = dbCtx.rawDb;

    await runMigrations(rawDb);
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    // Asegurar jornada de prueba abierta
    rawDb.prepare(`
      INSERT OR IGNORE INTO jornadas (id, opened_by_user_id, opened_at_ms, status)
      VALUES (?, 'usr_admin', ?, 'abierta')
    `).run(testJornadaId, Date.now());
  });

  afterAll(async () => {
    _resetSupportStateForTesting();
    await app.close();
  });

  // =========================================================================
  // PRUEBA 1: KDS OPCIÓN B (TARJETA ÚNICA AGRUPADA + ITEM-LEVEL)
  // =========================================================================
  it('1. KDS Opción B: Tarjeta única agrupada por orden, avance 0/3 -> 1/3 y transición de columnas', () => {
    const orderId = `ord_kds_m16_${Date.now()}`;
    const now = Date.now();

    // Crear orden pagada con 3 platos (2 hamburguesas, 1 perro)
    rawDb.prepare(`
      INSERT INTO orders (
        id, jornada_id, order_number, fulfillment_type, payment_status,
        fulfillment_status, station_status_hamburguesas, station_status_hot_dogs,
        gross_food_subtotal_usd_cents, net_food_sales_usd_cents, total_to_collect_usd_cents,
        rate_micro_bs, created_by_user_id, created_at_ms, updated_at_ms, kitchen_passed_at_ms
      ) VALUES (?, ?, 777, 'salon', 'pagado', 'en_preparacion', 'pendiente', 'pendiente', 2500, 2500, 2500, 40000000, 'usr_cajera', ?, ?, ?)
    `).run(orderId, testJornadaId, now, now, now);

    const line1Id = `line_kds_1_${Date.now()}`;
    const line2Id = `line_kds_2_${Date.now()}`;
    const line3Id = `line_kds_3_${Date.now()}`;

    rawDb.prepare(`
      INSERT INTO order_lines (id, order_id, product_id, line_role, quantity, unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, station, status, created_at_ms)
      VALUES (?, ?, 'prod_smash_clasica', 'STANDARD', 1, 800, 800, 800, 'hamburguesas', 'pendiente', ?)
    `).run(line1Id, orderId, now);

    rawDb.prepare(`
      INSERT INTO order_lines (id, order_id, product_id, line_role, quantity, unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, station, status, created_at_ms)
      VALUES (?, ?, 'prod_doble_smash', 'STANDARD', 1, 1000, 1000, 1000, 'hamburguesas', 'pendiente', ?)
    `).run(line2Id, orderId, now);

    rawDb.prepare(`
      INSERT INTO order_lines (id, order_id, product_id, line_role, quantity, unit_price_usd_cents, prorated_unit_price_usd_cents, subtotal_usd_cents, station, status, created_at_ms)
      VALUES (?, ?, 'prod_classic_dog', 'STANDARD', 1, 700, 700, 700, 'hot_dogs', 'pendiente', ?)
    `).run(line3Id, orderId, now);

    // Estado inicial: Todas las líneas en 'pendiente' -> Tarjeta única en 'pendiente', 0/3 listos
    let kdsOrders = getKdsOrders(rawDb);
    let targetCard = kdsOrders.find(o => o.orderId === orderId);
    expect(targetCard).toBeDefined();
    expect(targetCard?.aggregateStatus).toBe('pendiente');
    expect(targetCard?.readyCount).toBe(0);
    expect(targetCard?.totalCount).toBe(3);

    // Pasar línea #1 a 'preparando'
    const update1 = updateKdsLineStatus(rawDb, line1Id, 'preparando', 'usr_plancha');
    expect(update1.newStatus).toBe('preparando');

    kdsOrders = getKdsOrders(rawDb);
    targetCard = kdsOrders.find(o => o.orderId === orderId);
    expect(targetCard?.aggregateStatus).toBe('preparando'); // Columna EN PREPARACIÓN
    expect(targetCard?.readyCount).toBe(0); // 0/3 platos listos aún
    expect(targetCard?.lines.find(l => l.lineId === line1Id)?.status).toBe('preparando');
    expect(targetCard?.lines.find(l => l.lineId === line2Id)?.status).toBe('pendiente');
    expect(targetCard?.lines.find(l => l.lineId === line3Id)?.status).toBe('pendiente');

    // Pasar línea #1 a 'listo'
    updateKdsLineStatus(rawDb, line1Id, 'listo', 'usr_plancha');
    kdsOrders = getKdsOrders(rawDb);
    targetCard = kdsOrders.find(o => o.orderId === orderId);
    expect(targetCard?.aggregateStatus).toBe('preparando'); // Sigue en preparación porque faltan líneas 2 y 3
    expect(targetCard?.readyCount).toBe(1); // 1/3 platos listos
    expect(targetCard?.lines.find(l => l.lineId === line1Id)?.status).toBe('listo');

    // Completar las otras 2 líneas -> Tarjeta pasa a 'listo'
    updateKdsLineStatus(rawDb, line2Id, 'listo', 'usr_plancha');
    updateKdsLineStatus(rawDb, line3Id, 'listo', 'usr_plancha');
    kdsOrders = getKdsOrders(rawDb);
    targetCard = kdsOrders.find(o => o.orderId === orderId);
    expect(targetCard?.aggregateStatus).toBe('listo'); // Columna LISTO PARA ENTREGAR
    expect(targetCard?.readyCount).toBe(3);
    expect(targetCard?.totalCount).toBe(3);
  });

  // =========================================================================
  // PRUEBA 2: MÓDULO FISCAL E IGTF EN TEMPLATES.TS
  // =========================================================================
  it('2. Fiscal e IGTF en templates.ts: emite Base Imponible e IVA (16%) en modo INCLUSIVE sin inflar comida, y nada si fiscal está apagado', () => {
    const mockOrder: OrderReceiptData = {
      id: 'ord_fiscal_test',
      orderNumber: 501,
      turnCode: 'T-501',
      fulfillmentType: 'salon',
      paymentStatus: 'pagado',
      netFoodSalesUsdCents: 1160, // $11.60 -> Base Imponible: $10.00 (1000 c), IVA 16%: $1.60 (160 c)
      deliveryFeeUsdCents: 0,
      discountUsdCents: 0,
      totalToCollectUsdCents: 1160,
      rateMicroBs: 40_000_000,
      createdAtMs: Date.now()
    };

    const mockPayments = [
      { method: 'CASH_USD' as const, currency: 'USD' as const, amountUsdCents: 1160, rateMicroBs: 40_000_000 }
    ];

    // Caso A: fiscal_module_enabled = 1, fiscal_price_mode = 'INCLUSIVE'
    const settingsActive = {
      fiscal_module_enabled: 1,
      fiscal_price_mode: 'INCLUSIVE' as const,
      igtf_enabled: 1,
      igtf_rate_bps: 300,
      igtf_applies_to: 'CASH_USD' as const
    };

    const breakdown = computeFiscalBreakdown(mockOrder, mockPayments, settingsActive);
    expect(breakdown).not.toBeNull();
    expect(breakdown?.baseImponibleUsdCents).toBe(1000);
    expect(breakdown?.ivaUsdCents).toBe(160);
    expect(breakdown?.baseImponibleUsdCents! + breakdown?.ivaUsdCents!).toBe(1160); // Total no se altera
    expect(breakdown?.igtfUsdCents).toBe(35); // 3% sobre $11.60 (1160 * 300 / 10000 = 34.8 -> 35 céntimos)

    const ticketIRActive = buildReceiptTicketIR(mockOrder, [], mockPayments, undefined, settingsActive);
    const escposOutput = renderTicketToEscPos(ticketIRActive);
    const escposString = Buffer.from(escposOutput).toString('utf-8');
    const htmlOutput = renderTicketToHtml(ticketIRActive);

    expect(escposString).toContain('Base Imponible');
    expect(escposString).toContain('IVA Estimado (16%)');
    expect(escposString).toContain('IGTF Divisas (3%)');
    expect(htmlOutput).toContain('Base Imponible');
    expect(htmlOutput).toContain('IVA Estimado (16%)');
    expect(htmlOutput).toContain('IGTF Divisas (3%)');

    // Caso B: fiscal_module_enabled = 0 -> CERO líneas fiscales emitidas
    const settingsDisabled = {
      fiscal_module_enabled: 0,
      fiscal_price_mode: 'INCLUSIVE' as const,
      igtf_enabled: 0,
      igtf_rate_bps: 300,
      igtf_applies_to: 'CASH_USD' as const
    };

    const breakdownDisabled = computeFiscalBreakdown(mockOrder, mockPayments, settingsDisabled);
    expect(breakdownDisabled).toBeNull();

    const ticketIRDisabled = buildReceiptTicketIR(mockOrder, [], mockPayments, undefined, settingsDisabled);
    const escposDisabled = Buffer.from(renderTicketToEscPos(ticketIRDisabled)).toString('utf-8');
    const htmlDisabled = renderTicketToHtml(ticketIRDisabled);

    expect(escposDisabled).not.toContain('Base Imponible');
    expect(escposDisabled).not.toContain('IVA Estimado (16%)');
    expect(htmlDisabled).not.toContain('Base Imponible');
  });

  // =========================================================================
  // PRUEBA 3: DETECCIÓN DUAL WIN10 / WIN11 Y QUICK ASSIST CASCADE (B1)
  // =========================================================================
  it('3. Detección Dual Win10/Win11 y Quick Assist Cascade: detecta build exacta y devuelve opciones fallback auditables', () => {
    // Verificación exacta de strings os.release()
    expect(detectWindowsVersion('10.0.19045')).toBe('WINDOWS_10');
    expect(detectWindowsVersion('10.0.19044')).toBe('WINDOWS_10');
    expect(detectWindowsVersion('10.0.22000')).toBe('WINDOWS_11');
    expect(detectWindowsVersion('10.0.22631')).toBe('WINDOWS_11');
    expect(detectWindowsVersion('6.1.7601')).toBe('OTHER_OS');

    // Cascada con simulación de fallback (cuando quickassist.exe no está disponible)
    const cascade = launchQuickAssistCascade({ forceFallback: true, releaseStr: '10.0.19045' });
    expect(cascade.launchStatus).toBe('FALLBACK_OPTIONS_REQUIRED');
    expect(cascade.detectedOs).toBe('WINDOWS_10');
    expect(cascade.fallbackOptions).toBeDefined();
    expect(cascade.fallbackOptions).toContain('Instalar Quick Assist desde Microsoft Store');
    expect(cascade.fallbackOptions).toContain('Usar TeamViewer Portable bajo autorización');
    expect(cascade.fallbackOptions).toContain('Soporte presencial');

    // Registro seguro de la opción seleccionada en audit_events
    const fallbackAudit = recordSupportFallbackSelection(rawDb, {
      selectedOption: 'Usar TeamViewer Portable bajo autorización',
      actorUserId: 'usr_admin',
      sessionId: 'sup_audit_test'
    });
    expect(fallbackAudit.success).toBe(true);

    const event = rawDb.prepare(`
      SELECT action, payload_json FROM audit_events WHERE action = 'SUPPORT_FALLBACK_SELECTED' ORDER BY created_at_ms DESC LIMIT 1
    `).get() as any;
    expect(event).toBeDefined();
    expect(event.action).toBe('SUPPORT_FALLBACK_SELECTED');
    expect(event.payload_json).toContain('TeamViewer');
  });

  // =========================================================================
  // PRUEBA 4: REVERSIÓN DE CUPÓN AL REEMBOLSAR (AJUSTE A1)
  // =========================================================================
  it('4. Reversión de Cupón (A1): cupón de 1 solo uso reembolsado restaura used_count = 0, marca reversed_at y permite reusarlo', () => {
    const couponCode = `ONETIME_${Date.now()}`;
    const couponId = `coup_${Date.now()}`;
    const now = Date.now();

    // Crear cupón con max_uses = 1
    rawDb.prepare(`
      INSERT INTO coupons (
        id, code, description, coupon_type, discount_mode, discount_value,
        courtesy_product_id, max_uses, used_count, expires_at_ms, is_active, created_at_ms
      ) VALUES (?, ?, 'Cupón 1 Uso Reembolso', 'DISCOUNT', 'FIXED_USD', 200, NULL, 1, 0, NULL, 1, ?)
    `).run(couponId, couponCode, now);

    // Crear orden y aplicar cupón
    const order1Id = `ord_rev_1_${Date.now()}`;
    rawDb.prepare(`
      INSERT INTO orders (
        id, jornada_id, order_number, fulfillment_type, payment_status, fulfillment_status,
        gross_food_subtotal_usd_cents, net_food_sales_usd_cents, total_to_collect_usd_cents,
        rate_micro_bs, created_by_user_id, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 881, 'salon', 'sin_pago', 'pendiente', 1500, 1500, 1500, 40000000, 'usr_cajera', ?, ?)
    `).run(order1Id, testJornadaId, now, now);

    applyCouponToOrder(rawDb, order1Id, couponCode, 'usr_cajera');

    let coupRow = rawDb.prepare('SELECT used_count FROM coupons WHERE id = ?').get(couponId) as any;
    expect(coupRow.used_count).toBe(1);

    // Si intentamos usarlo en otra orden antes del reembolso, debe fallar por max_uses
    const valBefore = validateCoupon(rawDb, couponCode, 1000);
    expect(valBefore.valid).toBe(false);

    // Reembolsar/anular orden #1 mediante incidente
    const refundResult = reportOrderIncident(rawDb, order1Id, {
      reasonCode: 'CLIENTE_CANCELO',
      responsibleArea: 'cliente',
      resolution: 'refund',
      authorizerPin: '123456' // PIN de Admin
    });
    expect(refundResult.success).toBe(true);

    // Verificar que coupon_redemptions tiene reversed_at_ms y reversed_at no nulos
    const redemption = rawDb.prepare('SELECT reversed_at_ms, reversed_at FROM coupon_redemptions WHERE order_id = ?').get(order1Id) as any;
    expect(redemption).toBeDefined();
    expect(redemption.reversed_at_ms).not.toBeNull();
    expect(redemption.reversed_at).not.toBeNull();

    // Verificar que used_count se decrementó a 0
    coupRow = rawDb.prepare('SELECT used_count FROM coupons WHERE id = ?').get(couponId) as any;
    expect(coupRow.used_count).toBe(0);

    // Crear nueva orden y comprobar que el cupón puede volver a aplicarse
    const order2Id = `ord_rev_2_${Date.now()}`;
    rawDb.prepare(`
      INSERT INTO orders (
        id, jornada_id, order_number, fulfillment_type, payment_status, fulfillment_status,
        gross_food_subtotal_usd_cents, net_food_sales_usd_cents, total_to_collect_usd_cents,
        rate_micro_bs, created_by_user_id, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 882, 'salon', 'sin_pago', 'pendiente', 2000, 2000, 2000, 40000000, 'usr_cajera', ?, ?)
    `).run(order2Id, testJornadaId, now, now);

    const reapply = applyCouponToOrder(rawDb, order2Id, couponCode, 'usr_cajera');
    expect(reapply.success).toBe(true);
  });

  // =========================================================================
  // PRUEBA 5: CUPÓN CON PRODUCTO AGOTADO (AJUSTE A2)
  // =========================================================================
  it('5. Cupón con Producto Agotado (A2): responde HTTP 400 con CUPON_PRODUCTO_AGOTADO si el ítem de cortesía tiene is_available = 0', async () => {
    const couponCode = `AGOTADO_${Date.now()}`;
    const prodId = 'prod_cafe_cortesia';
    const now = Date.now();

    // Poner el producto en agotado (is_available = 0)
    rawDb.prepare('UPDATE products SET is_available = 0 WHERE id = ?').run(prodId);

    rawDb.prepare(`
      INSERT INTO coupons (
        id, code, description, coupon_type, courtesy_product_id,
        is_active, used_count, created_at_ms
      ) VALUES (?, ?, 'Café Cortesía Agotado', 'COURTESY_ITEM', ?, 1, 0, ?)
    `).run(`coup_agot_${Date.now()}`, couponCode, prodId, now);

    const orderId = `ord_agot_${Date.now()}`;
    rawDb.prepare(`
      INSERT INTO orders (
        id, jornada_id, order_number, fulfillment_type, payment_status, fulfillment_status,
        gross_food_subtotal_usd_cents, net_food_sales_usd_cents, total_to_collect_usd_cents,
        rate_micro_bs, created_by_user_id, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 883, 'salon', 'sin_pago', 'pendiente', 1000, 1000, 1000, 40000000, 'usr_cajera', ?, ?)
    `).run(orderId, testJornadaId, now, now);

    // Intento de aplicación vía API
    const res = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/apply-coupon`,
      payload: { couponCode }
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('CUPON_PRODUCTO_AGOTADO');
    expect(body.message).toContain('El producto de cortesía está agotado');

    // Restaurar producto a disponible para no afectar otros tests
    rawDb.prepare('UPDATE products SET is_available = 1 WHERE id = ?').run(prodId);
  });

  // =========================================================================
  // PRUEBA 6: RECUPERACIÓN DE ACTUALIZACIÓN EN ARRANQUE (AJUSTE B2)
  // =========================================================================
  it("6. Recuperación de Update al Arrancar (B2): update en estado 'IN_PROGRESS' pasa a 'FAILED_ROLLBACK' y registra STUCK_UPDATE_RECOVERED_ON_BOOT", () => {
    const stuckId = `upd_stuck_${Date.now()}`;
    const now = Date.now();

    rawDb.prepare(`
      INSERT INTO system_updates (
        id, version, previous_version, description, manifest_sha256,
        applied_at_ms, status
      ) VALUES (?, '1.2.0-stuck', '1.1.0', 'Update interrumpido por corte eléctrico', 'sha256fake', ?, 'IN_PROGRESS')
    `).run(stuckId, now);

    const recoveredCount = recoverStuckUpdatesOnBoot(rawDb);
    expect(recoveredCount).toBeGreaterThanOrEqual(1);

    const updatedRow = rawDb.prepare('SELECT status, error_details FROM system_updates WHERE id = ?').get(stuckId) as any;
    expect(updatedRow.status).toBe('FAILED_ROLLBACK');
    expect(updatedRow.error_details).toContain('STUCK_UPDATE_RECOVERED_ON_BOOT');

    const auditRow = rawDb.prepare(`
      SELECT action, payload_json FROM audit_events WHERE action = 'STUCK_UPDATE_RECOVERED_ON_BOOT' AND entity_id = ?
    `).get(stuckId) as any;
    expect(auditRow).toBeDefined();
    expect(auditRow.action).toBe('STUCK_UPDATE_RECOVERED_ON_BOOT');
  });

  // =========================================================================
  // PRUEBA 7: LÍMITE WHATSAPP 3500 CHARS Y 4 ZONAS DELIVERY (C1 + R10)
  // =========================================================================
  it('7. Límite WhatsApp 3500 chars (C1) y Zonas Delivery $2–$5 (R10): mensaje masivo respeta MAX_WHATSAPP_MSG_LENGTH y soporta las 4 zonas', () => {
    // 1. Zonas oficiales
    expect(OFFICIAL_DELIVERY_ZONES).toHaveLength(4);
    const fees = OFFICIAL_DELIVERY_ZONES.map(z => z.feeUsdCents);
    expect(fees).toEqual([200, 300, 400, 500]);

    // 2. Orden masiva con 40 platos y notas extensas
    const massiveItems = [];
    for (let i = 1; i <= 40; i++) {
      massiveItems.push({
        name: `Hamburguesa Especial Doble Tocino Cheddar Edición Master #${i}`,
        quantity: 3,
        priceUsdCents: 1200,
        flavor: 'Salsa Especial Ahumada de la Casa con Ajo Rostizado',
        removals: ['Sin Cebolla', 'Sin Pepinillos', 'Sin Mostaza'],
        barraLibre: ['Tártara', 'Ajo', 'Maíz', 'BBQ', 'Tocineta Bits'],
        notes: `Por favor envolver cada hamburguesa de manera individual en papel térmico con etiqueta personalizada para el cliente #${i}`
      });
    }

    const massiveMsg = formatWhatsAppOrderMessage({
      fulfillmentType: 'delivery',
      customerName: 'Anthony Aguilera Director de Operaciones',
      customerPhone: '0412-1928527',
      deliveryAddress: 'Urbanización Alta Vista Norte, Manzana 12, Edificio Empresarial Torre Movistar Piso 7',
      deliveryReference: 'Diagonal al centro comercial, detrás de la farmacia principal',
      deliveryFeeUsdCents: 400, // Zona 3 ($4.00)
      items: massiveItems
    });

    expect(massiveMsg.text.length).toBeLessThanOrEqual(MAX_WHATSAPP_MSG_LENGTH);
    expect(MAX_WHATSAPP_MSG_LENGTH).toBe(3500);
    expect(massiveMsg.text).toContain('[PEDIDO EXTENSO TRUNCADO]');
    expect(massiveMsg.url).toContain('https://wa.me/');

    // 3. Orden de delivery estándar con verificación de tarifa de zona ($4.00)
    const standardMsg = formatWhatsAppOrderMessage({
      fulfillmentType: 'delivery',
      customerName: 'Anthony Aguilera',
      customerPhone: '0412-1928527',
      deliveryAddress: 'Alta Vista Norte',
      deliveryFeeUsdCents: 400, // Zona 3 ($4.00)
      items: [
        { name: 'Hamburguesa Doble', quantity: 2, priceUsdCents: 1000 }
      ]
    });

    expect(standardMsg.text).toContain('Tarifa Delivery: $4.00');
    expect(standardMsg.text).toContain('Tarifa de Delivery sujeta a validación de zona');
    expect(standardMsg.text.length).toBeLessThanOrEqual(MAX_WHATSAPP_MSG_LENGTH);
    expect(standardMsg.url).toContain('https://wa.me/');
  });

  // =========================================================================
  // PRUEBA 8: MUESTRA INSUFICIENTE EN KASAVANA & SMITH (D1)
  // =========================================================================
  it("8. Muestra Insuficiente en Kasavana (D1): con < 30 unidades vendidas, devuelve sampleStatus = 'DATOS_INSUFICIENTES'", () => {
    // Reporte para la jornada de prueba (con pocas o cero ventas)
    const report = generateMenuEngineeringReport(rawDb, { jornadaId: testJornadaId });

    // Como la base de datos de test tiene menos de 30 unidades vendidas:
    expect(report.sampleStatus).toBe('DATOS_INSUFICIENTES');
    expect(report.missingUnits).toBeGreaterThan(0);
    expect(report.missingDays).toBeGreaterThan(0);
    expect(report.hasStatisticalWarning).toBe(true);
    expect(report.statisticalWarningMessage).toBeDefined();
  });
});
