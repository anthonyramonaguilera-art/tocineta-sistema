import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildServer } from '../src/server.js';
import { getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import {
  formatWhatsAppOrderMessage,
  verifyZeroPersonalDataLeak,
  OFFICIAL_WHATSAPP_NUMBER,
  OFFICIAL_WHATSAPP_DISPLAY,
  OFFICIAL_SLOGAN
} from '../src/modules/qr-menu/qr-menu-service.js';

describe('Hito M13 - Menú Digital QR Estático, WhatsApp y Cloud Privacy Guard (Prueba de Aceptación #25)', () => {
  let app: FastifyInstance;
  let rawDb: Database.Database;
  const testDistDir = path.resolve(process.cwd(), './data/test-qr-dist');
  const testJornadaId = 'jornada_m13_test';

  beforeAll(async () => {
    app = await buildServer({ disableStatic: true });
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
    // Limpieza de archivos de prueba
    if (fs.existsSync(testDistDir)) {
      fs.rmSync(testDistDir, { recursive: true, force: true });
    }
    await app.close();
  });

  // =========================================================================
  // SUB-PRUEBA 1: Exportador Estático Sanitizado (Sin costos internos ni malteadas inactivas)
  // =========================================================================
  describe('1. Exportador Estático Sanitizado y Endpoint GET /api/qr-menu/data', () => {
    it('1.1 GET /api/qr-menu/data devuelve payload sanitizado con USD, Bs y timestamp de tasa en Caracas', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/qr-menu/data'
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);

      // Verificación de datos de marca y contacto
      expect(body.storeName).toBe('TOCINETA');
      expect(body.slogan).toBe(OFFICIAL_SLOGAN);
      expect(body.whatsappNumber).toBe(OFFICIAL_WHATSAPP_NUMBER);
      expect(body.whatsappDisplay).toBe(OFFICIAL_WHATSAPP_DISPLAY);
      expect(body.schedule).toContain('Martes a Domingo');
      expect(body.location).toContain('Alta Vista');

      // Tasa BCV y timestamp de Caracas
      expect(body.currency.rateMicroBs).toBeGreaterThan(0);
      expect(body.currency.rateFormatted).toBeDefined();
      expect(body.currency.rateUpdatedAtCaracas).toMatch(/\d{2}\/\d{2}\/\d{4}/);

      // Verificación de categorías y productos
      expect(body.categories.length).toBeGreaterThan(0);
      for (const cat of body.categories) {
        expect(cat.id).not.toBe('cat_malteadas'); // Excluida mientras is_active = 0
        expect(cat.products.length).toBeGreaterThanOrEqual(0);

        for (const prod of cat.products) {
          expect(prod.priceUsdCents).toBeGreaterThan(0);
          expect(prod.priceBsCents).toBeGreaterThan(0);
          expect(prod.priceUsdFormatted).toMatch(/^\$\d+\.\d{2}$/);
          expect(prod.priceBsFormatted).toMatch(/^Bs\.\s\d+/);

          // CERO FILTRACIÓN: No debe existir estimated_cost_usd_cents ni campos internos
          expect((prod as any).estimated_cost_usd_cents).toBeUndefined();
          expect((prod as any).estimatedCostUsdCents).toBeUndefined();
          expect((prod as any).cost).toBeUndefined();
        }
      }

      // Verificación de Barra Libre ($0.00 al público)
      expect(body.barraLibre.length).toBeGreaterThan(0);
      for (const bl of body.barraLibre) {
        expect(bl.priceUsdCents).toBe(0);
        expect(bl.priceBsCents).toBe(0);
        expect(bl.priceFormatted).toContain('Gratis');
      }
    });

    it('1.2 POST /api/qr-menu/export-static compila index.html y menu-snapshot.json en carpeta de distribución', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/qr-menu/export-static',
        payload: { customDistDir: testDistDir }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.files).toContain('index.html');
      expect(body.files).toContain('menu-snapshot.json');

      // Verificar que los archivos físicos existen en disco
      const htmlPath = path.join(testDistDir, 'index.html');
      const jsonPath = path.join(testDistDir, 'menu-snapshot.json');
      expect(fs.existsSync(htmlPath)).toBe(true);
      expect(fs.existsSync(jsonPath)).toBe(true);

      const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
      const jsonContent = fs.readFileSync(jsonPath, 'utf-8');

      // Validar contenido del snapshot JSON
      const parsedJson = JSON.parse(jsonContent);
      expect(parsedJson.storeName).toBe('TOCINETA');
      expect(jsonContent).not.toContain('estimated_cost_usd_cents');
      expect(jsonContent).not.toContain('cat_malteadas');

      // Validar contenido del HTML autocontenido
      expect(htmlContent).toContain('TOCINETA');
      expect(htmlContent).toContain(OFFICIAL_SLOGAN);
      expect(htmlContent).toContain(OFFICIAL_WHATSAPP_DISPLAY);
      expect(htmlContent).toContain('Tasa BCV');
      expect(htmlContent).toContain('Enviar Pedido por WhatsApp');
    });

    it('1.3 GET /qr sirve el Menú Digital con Cabecera oficial, horario, tasa BCV y diseño responsive', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/qr'
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.payload).toContain('<!DOCTYPE html>');
      expect(res.payload).toContain('Cocinamos con amor, te servimos como mereces y damos gloria a Dios');
      expect(res.payload).toContain('0412-1928527');
      expect(res.payload).toContain('Alta Vista detrás de Torre Movistar');
      expect(res.payload).toContain('Tasa BCV');
    });
  });

  // =========================================================================
  // SUB-PRUEBA 2: Generador de Pedidos a WhatsApp Oficial (0412-1928527)
  // =========================================================================
  describe('2. Generador y Formateador Oficial de Pedidos a WhatsApp (584121928527)', () => {
    it('2.1 Formatea correctamente una orden de Combo Clásico con Barra Libre y modalidad Delivery', () => {
      const result = formatWhatsAppOrderMessage({
        fulfillmentType: 'delivery',
        customerName: 'Manuel Varon',
        customerPhone: '0414-8889900',
        deliveryAddress: 'Urb. Chilemex, Calle Ecuador, Casa 25',
        deliveryReference: 'Portón blanco frente a la panadería',
        deliveryFeeUsdCents: 200, // $2.00
        items: [
          {
            name: 'Combo Clásico 1 Smash',
            quantity: 2,
            priceUsdCents: 500, // $5.00 c/u
            comboSelections: [
              {
                slotName: 'Hamburguesa',
                productName: 'Hamburguesa Clásica 1 Carne',
                removals: ['Pepinillos'],
                barraLibre: ['Salsa de Ajo', 'Maíz Dulce', 'Papas Ralladas']
              },
              {
                slotName: 'Bebida',
                productName: 'Refresco Lata 355ml',
                flavor: 'Pepsi Clásica'
              }
            ]
          },
          {
            name: 'Papas Fritas Especiales',
            quantity: 1,
            priceUsdCents: 350,
            barraLibre: ['Cheddar Fundido', 'Tocineta Bits']
          }
        ]
      }, 40_000_000); // Tasa 40.00 Bs/$

      // 1. Número de WhatsApp oficial en el enlace
      expect(result.url).toContain(`https://wa.me/${OFFICIAL_WHATSAPP_NUMBER}?text=`);

      // 2. Desglose detallado de platos y Barra Libre
      expect(result.text).toContain('*¡HOLA, TOCINETA!*');
      expect(result.text).toContain('Combo Clásico 1 Smash');
      expect(result.text).toContain('Hamburguesa Clásica 1 Carne');
      expect(result.text).toContain('Pepinillos');
      expect(result.text).toContain('Salsa de Ajo, Maíz Dulce, Papas Ralladas');
      expect(result.text).toContain('Pepsi Clásica');
      expect(result.text).toContain('Papas Fritas Especiales');
      expect(result.text).toContain('Cheddar Fundido, Tocineta Bits');

      // 3. Modalidad y datos de entrega
      expect(result.text).toContain('🛵 Delivery a Domicilio');
      expect(result.text).toContain('Manuel Varon');
      expect(result.text).toContain('0414-8889900');
      expect(result.text).toContain('Urb. Chilemex, Calle Ecuador, Casa 25');
      expect(result.text).toContain('Portón blanco frente a la panadería');

      // 4. Totales calculados en USD y Bs
      // Comida: (2 * 5.00) + (1 * 3.50) = $13.50 (Bs. 540,00 a 40 Bs/$)
      // Delivery: $2.00 (Bs. 80,00)
      // Total: $15.50 (Bs. 620,00)
      expect(result.text).toContain('$13.50');
      expect(result.text).toContain('$2.00');
      expect(result.text).toContain('TOTAL ESTIMADO: $15.50 / Bs. 620,00');
      expect(result.text).toContain(OFFICIAL_SLOGAN);
    });

    it('2.2 Formatea orden para Retiro en Food Truck (Takeout) sin recargo de delivery', () => {
      const result = formatWhatsAppOrderMessage({
        fulfillmentType: 'takeout',
        customerName: 'Cliente Retiro',
        items: [
          {
            name: 'Pepito Especial Mixto',
            quantity: 1,
            priceUsdCents: 700,
            barraLibre: ['Salsa Tártara', 'Tocineta Crispy']
          }
        ]
      }, 40_000_000);

      expect(result.text).toContain('🍔 Para Llevar / Retiro en Food Truck');
      expect(result.text).toContain('Cliente Retiro');
      expect(result.text).not.toContain('Tarifa Delivery');
      expect(result.text).toContain('TOTAL ESTIMADO: $7.00 / Bs. 280,00');
    });
  });

  // =========================================================================
  // SUB-PRUEBA 3: Resumen Financiero en la Nube y Guard Estricto de Privacidad
  // =========================================================================
  describe('3. Cloud Financial Summary y Guard de Privacidad Estricto (Zero Personal Data Leak)', () => {
    it('3.1 Registra orden de delivery con datos sensibles y verifica que cloud-summary solo exponga métricas agregadas', async () => {
      // 1. Insertar orden de prueba con datos personales reales de cliente de delivery
      const testOrderId = `ord_test_privacy_${Date.now()}`;
      const sensitiveName = 'Rosangela Del Carmen Navarro';
      const sensitivePhone = '04249123456';
      const sensitiveAddress = 'Residencias Los Raudales, Torre C, Apto 12-B';
      const sensitiveRef = 'Al lado de la caseta de vigilancia';

      // Insertar orden
      rawDb.prepare(`
        INSERT INTO orders (
          id, order_number, jornada_id, created_by_user_id, fulfillment_type,
          customer_name, customer_phone, delivery_address, delivery_reference,
          fulfillment_status, payment_status, rate_micro_bs,
          net_food_sales_usd_cents, delivery_fee_usd_cents, discount_usd_cents,
          total_to_collect_usd_cents, created_at_ms, updated_at_ms
        ) VALUES (
          ?, 999, ?, 'usr_admin', 'delivery',
          ?, ?, ?, ?,
          'entregado', 'pagado', 40000000,
          1400, 200, 0,
          1600, ?, ?
        )
      `).run(
        testOrderId, testJornadaId, sensitiveName, sensitivePhone,
        sensitiveAddress, sensitiveRef,
        Date.now(), Date.now()
      );

      // Insertar línea de orden
      rawDb.prepare(`
        INSERT INTO order_lines (
          id, order_id, product_id, station, line_role, quantity,
          unit_price_usd_cents, prorated_unit_price_usd_cents,
          subtotal_usd_cents, created_at_ms
        ) VALUES (
          ?, ?, 'prod_street_dog', 'hot_dogs', 'STANDARD', 2,
          700, 700, 1400, ?
        )
      `).run(`line_${testOrderId}`, testOrderId, Date.now());

      // 2. Invocar endpoint GET /api/qr-menu/cloud-summary
      const res = await app.inject({
        method: 'GET',
        url: `/api/qr-menu/cloud-summary?jornadaId=${testJornadaId}`
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);

      // Métricas financieras agregadas existen y son numéricas
      expect(body.totals.ordersCount).toBeGreaterThanOrEqual(1);
      expect(body.totals.totalFoodSalesUsdCents).toBeGreaterThanOrEqual(1400);
      expect(body.totals.totalCollectedUsdCents).toBeGreaterThanOrEqual(1600);
      expect(body.dishesSold.length).toBeGreaterThanOrEqual(1);

      // 3. INSPECCIÓN PROFUNDA DE PRIVACIDAD: Ningún dato personal del cliente está presente
      const serializedResponse = res.payload.toLowerCase();
      expect(serializedResponse).not.toContain('rosangela');
      expect(serializedResponse).not.toContain('navarro');
      expect(serializedResponse).not.toContain('04249123456');
      expect(serializedResponse).not.toContain('4249123456');
      expect(serializedResponse).not.toContain('los raudales');
      expect(serializedResponse).not.toContain('torre c');
      expect(serializedResponse).not.toContain('vigilancia');

      // 4. Limpiar datos de prueba
      rawDb.prepare('DELETE FROM order_lines WHERE order_id = ?').run(testOrderId);
      rawDb.prepare('DELETE FROM orders WHERE id = ?').run(testOrderId);
    });

    it('3.2 El guard verifyZeroPersonalDataLeak detecta e intercepta activamente cualquier filtración de datos', () => {
      // Registrar un cliente sensible temporal
      const testOrderId = `ord_leak_test_${Date.now()}`;
      rawDb.prepare(`
        INSERT INTO orders (
          id, order_number, jornada_id, created_by_user_id, fulfillment_type,
          customer_name, customer_phone, delivery_address,
          fulfillment_status, payment_status, rate_micro_bs,
          net_food_sales_usd_cents, total_to_collect_usd_cents, created_at_ms, updated_at_ms
        ) VALUES (
          ?, 998, ?, 'usr_admin', 'delivery',
          'Alejandro Magno Bastardo', '04128765432',
          'Sector Villa Brasil Manzana 8 Casa 10',
          'entregado', 'pagado', 40000000,
          1000, 1000, ?, ?
        )
      `).run(testOrderId, testJornadaId, Date.now(), Date.now());

      try {
        // A) Payload seguro -> Debe pasar sin error
        const safePayload = JSON.stringify({
          ordersCount: 45,
          totalUsdCents: 45000,
          dishesSold: [{ name: 'Hamburguesa Clásica', quantity: 20 }]
        });
        expect(() => verifyZeroPersonalDataLeak(safePayload, rawDb)).not.toThrow();

        // B) Payload con teléfono filtrado -> Debe arrojar DATA_PRIVACY_VIOLATION
        const leakPhonePayload = JSON.stringify({
          ordersCount: 1,
          clientContact: '04128765432'
        });
        expect(() => verifyZeroPersonalDataLeak(leakPhonePayload, rawDb)).toThrow(
          /DATA_PRIVACY_VIOLATION.*teléfono/
        );

        // C) Payload con nombre de cliente filtrado -> Debe arrojar DATA_PRIVACY_VIOLATION
        const leakNamePayload = JSON.stringify({
          ordersCount: 1,
          customer: 'Alejandro Magno Bastardo'
        });
        expect(() => verifyZeroPersonalDataLeak(leakNamePayload, rawDb)).toThrow(
          /DATA_PRIVACY_VIOLATION.*nombre/
        );

        // D) Payload con dirección filtrada -> Debe arrojar DATA_PRIVACY_VIOLATION
        const leakAddrPayload = JSON.stringify({
          ordersCount: 1,
          destination: 'Sector Villa Brasil Manzana 8 Casa 10'
        });
        expect(() => verifyZeroPersonalDataLeak(leakAddrPayload, rawDb)).toThrow(
          /DATA_PRIVACY_VIOLATION.*dirección/
        );
      } finally {
        // Limpiar registro
        rawDb.prepare('DELETE FROM orders WHERE id = ?').run(testOrderId);
      }
    });
  });
});
