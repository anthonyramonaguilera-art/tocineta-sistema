import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { buildServer } from '../src/server.js';
import { getDatabaseContext } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedInitialUsers } from '../src/modules/auth/seed-users.js';
import { seedCatalog } from '../src/db/seed-catalog.js';
import { ensureOfficialLocations } from '../src/modules/profitability/locations-service.js';
import { loginAs, ensureTestSupervisor } from './test-helpers.js';
import { restoreAndVerifyDatabase } from '../src/modules/backups/restore-engine.js';
import path from 'node:path';
import fs from 'node:fs';

describe('FASE 7 — COTIZADOR + SOCIOS + MENÚ QR + CONFIGURACIÓN DEL NEGOCIO + ENDURECIMIENTO', () => {
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

    const loginRes = await loginAs(app, 'admin', rawDb);
    adminToken = loginRes.token;

    // Estado limpio para pruebas de Fase 7
    rawDb.prepare('DELETE FROM partner_transactions').run();
    rawDb.prepare('DELETE FROM business_partners').run();
    rawDb.prepare('DELETE FROM event_quotation_extras').run();
    rawDb.prepare('DELETE FROM event_quotation_items').run();
    rawDb.prepare('DELETE FROM event_quotations').run();
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // A) COTIZADOR DE EVENTOS
  // =========================================================================
  describe('A) Cotizador de Eventos y Catering', () => {
    let createdQuoteId: string;

    it('Crea una cotización con platos reales, descuentos por volumen y costos extras', async () => {
      // Tomamos un plato real del catálogo (tabla products)
      const dish = rawDb.prepare(`SELECT id, name, price_usd_cents FROM products WHERE is_active = 1 LIMIT 1`).get() as any;
      expect(dish).toBeDefined();

      const payload = {
        eventName: 'Boda Corporativa Alta Vista',
        clientName: 'Empresas Unidas C.A.',
        clientPhone: '0414-8889900',
        eventDate: '2026-12-15',
        guestCount: 50,
        notes: 'Boda Corporativa Alta Vista - Servicio en jardín exterior',
        discountType: 'PERCENTAGE',
        discountValue: 10, // 10%
        items: [
          {
            dishId: dish.id,
            quantity: 50,
            unitPriceUsdCents: dish.price_usd_cents,
            notes: 'Sin cebolla'
          }
        ],
        extras: [
          {
            concept: 'Transporte y logística de trailers',
            costUsdCents: 5000, // $50.00
            notes: 'Flete ida y vuelta'
          },
          {
            concept: 'Personal de atención extra (2 personas)',
            costUsdCents: 6000 // $60.00
          }
        ]
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/quotes',
        headers: { authorization: `Bearer ${adminToken}` },
        payload
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.quote).toBeDefined();
      createdQuoteId = body.quote.id;
      expect(body.quote.id).toBeDefined();
      expect(body.quote.status).toBe('BORRADOR');
      expect(body.quote.items.length).toBe(1);
      expect(body.quote.extras.length).toBe(2);

      // Verificamos simulación de utilidad privada
      expect(body.quote.projectedMarginPercent).toBeDefined();
      expect(typeof body.quote.projectedProfitUsdCents).toBe('number');
    });

    it('Permite consultar cotizaciones con filtro y búsqueda', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/quotes',
        headers: { authorization: `Bearer ${adminToken}` }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const list = body.quotes || body;
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
      expect(list[0].id).toBe(createdQuoteId);
    });

    it('Genera el PDF del cliente sin exponer costos internos ni recetas', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/quotes/${createdQuoteId}/pdf`,
        headers: { authorization: `Bearer ${adminToken}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      const pdfBuffer = res.rawPayload;
      expect(pdfBuffer.length).toBeGreaterThan(500);

      // El PDF no debe contener palabras de costos internos
      const pdfText = pdfBuffer.toString('latin1');
      expect(pdfText).not.toContain('estimated_ingredient_cost');
      expect(pdfText).not.toContain('projectedProfitUsdCents');
    });

    it('Genera texto de WhatsApp para el cliente sin costos internos', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/quotes/${createdQuoteId}/whatsapp`,
        headers: { authorization: `Bearer ${adminToken}` }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.whatsappText).toContain('Boda Corporativa Alta Vista');
      expect(body.whatsappText).toContain('Empresas Unidas C.A.');
      expect(body.whatsappText).toContain('TOTAL COTIZADO:');
      // Prohibido costos internos en mensaje para el cliente
      expect(body.whatsappText).not.toContain('Costo de Insumos');
      expect(body.whatsappText).not.toContain('Utilidad');
    });

    it('Convierte la cotización en reserva y calcula la lista consolidada de compras de insumos', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/quotes/${createdQuoteId}/reserve`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { eventDate: '2026-12-18' }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.quote.status).toBe('RESERVADA');
      expect(Array.isArray(body.shoppingList)).toBe(true);
    });
  });

  // =========================================================================
  // B) SOCIOS Y PARTICIPACIÓN
  // =========================================================================
  describe('B) Socios y Reparto de Utilidades', () => {
    let partnerId1: string;
    let partnerId2: string;

    it('Permite activar el módulo de socios mediante la bandera de la dueña', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/partners/toggle-module',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { enabled: true }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.partnersModuleEnabled).toBe(true);
    });

    it('Crea dos socios con porcentajes accionarios que suman 100%', async () => {
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/partners',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Socio Fundador A',
          dni: 'V-10200300',
          phone: '0414-1112233',
          email: 'socio.a@tocineta.local',
          sharePercentage: 60
        }
      });
      expect(res1.statusCode).toBe(201);
      partnerId1 = res1.json().partner.id;

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/partners',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Socio Inversionista B',
          dni: 'V-20300400',
          phone: '0414-4445566',
          email: 'socio.b@tocineta.local',
          sharePercentage: 40
        }
      });
      expect(res2.statusCode).toBe(201);
      partnerId2 = res2.json().partner.id;
    });

    it('Registra aportes de capital y retiros a cuenta de utilidades', async () => {
      // Aporte de $1,000.00
      const resAporte = await app.inject({
        method: 'POST',
        url: '/api/partners/transactions',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          partnerId: partnerId1,
          type: 'APORTE',
          amountUsdCents: 100000,
          paymentMethod: 'TRANSFERENCIA_USD',
          notes: 'Aporte para ampliación de plancha'
        }
      });
      expect(resAporte.statusCode).toBe(200);

      // Retiro a cuenta de utilidades de $200.00
      const resRetiro = await app.inject({
        method: 'POST',
        url: '/api/partners/transactions',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          partnerId: partnerId1,
          type: 'RETIRO_UTILIDADES',
          amountUsdCents: 20000,
          paymentMethod: 'EFECTIVO_USD',
          notes: 'Retiro quincenal'
        }
      });
      expect(resRetiro.statusCode).toBe(200);
    });

    it('Ejecuta el reparto de dividendos proporcional a los porcentajes de cada socio', async () => {
      // Reparto de $500.00 global (60% para socio 1 = $300, 40% para socio 2 = $200)
      const res = await app.inject({
        method: 'POST',
        url: '/api/partners/distribute-profits',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          totalAmountUsdCents: 50000,
          notes: 'Reparto de utilidades del mes'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.totalDistributedUsdCents).toBe(50000);
      expect(body.distributions.length).toBe(2);

      const d1 = body.distributions.find((d: any) => d.partnerId === partnerId1);
      const d2 = body.distributions.find((d: any) => d.partnerId === partnerId2);
      expect(d1.amountUsdCents).toBe(30000); // 60% of $500 = $300
      expect(d2.amountUsdCents).toBe(20000); // 40% of $500 = $200
    });
  });

  // =========================================================================
  // C) MENÚ DIGITAL QR / WEB
  // =========================================================================
  describe('C) Menú Digital QR / Web Dinámico', () => {
    it('Lee la carta real y datos del negocio desde la base de datos', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/qr-menu/menu'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.businessName).toBeDefined();
      expect(Array.isArray(body.categories)).toBe(true);
      expect(Array.isArray(body.dishes)).toBe(true);
    });

    it('Oculta automáticamente platos agotados (is_available = 0)', async () => {
      // Marcamos un producto como agotado
      const prod = rawDb.prepare(`SELECT id FROM products WHERE is_active = 1 LIMIT 1`).get() as any;
      rawDb.prepare(`UPDATE products SET is_available = 0 WHERE id = ?`).run(prod.id);

      const res = await app.inject({
        method: 'GET',
        url: '/api/qr-menu/menu'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const hiddenDish = body.dishes.find((d: any) => d.id === prod.id);
      expect(hiddenDish).toBeUndefined();

      // Restauramos disponibilidad
      rawDb.prepare(`UPDATE products SET is_available = 1 WHERE id = ?`).run(prod.id);
    });
  });

  // =========================================================================
  // D) CONFIGURACIÓN DEL NEGOCIO MULTI-RESTAURANTE
  // =========================================================================
  describe('D) Configuración Multi-Restaurante y Onboarding', () => {
    it('Retorna la configuración del negocio con impuestos apagados por defecto', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/business-settings',
        headers: { authorization: `Bearer ${adminToken}` }
      });

      expect(res.statusCode).toBe(200);
      const settings = res.json();
      expect(settings.taxIvaEnabled).toBe(false);
      expect(settings.taxIgtfEnabled).toBe(false);
      expect(settings.brandName).toBeDefined();
      expect(settings.locations).toBeDefined();
    });

    it('Permite actualizar todos los parámetros de marca e identidad', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/business-settings',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          brandName: 'TOCINETA GOURMET',
          legalName: 'TOCINETA GOURMET C.A.',
          rif: 'J-50123456-7',
          slogan: 'El sabor auténtico de la calle',
          physicalAddress: 'Sector Comercial Norte, Local 3',
          contactPhone: '0414-9998877',
          taxIvaEnabled: false,
          taxIgtfEnabled: false,
          taxIvaPercent: 16,
          taxIgtfPercent: 3,
          bcvRateChangeHour: '17:30',
          ticketFooterMessage: '¡Gracias por visitarnos!'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.settings.brandName).toBe('TOCINETA GOURMET');
      expect(body.settings.rif).toBe('J-50123456-7');
    });

    it('Ejecuta el asistente de primera instalación (onboarding wizard)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/business-settings/onboarding',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          businessName: 'TOCINETA ALTA VISTA',
          slogan: 'Calidad superior en cada bocado',
          rif: 'J-12345678-9',
          phone: '0412-3334455',
          address: 'Detrás de Torre Movistar',
          locationName: 'Sede Principal Alta Vista'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.settings.business_name).toBe('TOCINETA ALTA VISTA');
      expect(Boolean(body.settings.onboarding_completed)).toBe(true);
    });
  });

  // =========================================================================
  // E) ENDURECIMIENTO: RESTORE DRILL Y CARGA CONCURRENTE
  // =========================================================================
  describe('E) Endurecimiento, Simulacro de Restauración y Concurrencia', () => {
    it('Ejecuta el simulacro de restauración de respaldo verificado (dry-run)', async () => {
      const latestSnapshot = path.resolve(process.cwd(), 'data/snapshots/pre-migrate-1793096315970.db');
      let testBackupPath = latestSnapshot;

      if (!fs.existsSync(testBackupPath)) {
        testBackupPath = path.resolve(process.cwd(), 'data/tocineta.db');
      }

      const result = await restoreAndVerifyDatabase({
        backupFilePath: testBackupPath,
        dryRun: true
      });

      expect(result.integrityCheck).toBe('ok');
      expect(result.auditChain.valid).toBe(true);
      expect(result.durationMs).toBeLessThan(10000); // Menor a 10s
    });

    it('Soporta carga simultánea de 5 dispositivos concurrentes sin bloqueos ni errores', async () => {
      const requests = [
        // Dispositivo 1: Caja consultando estado
        app.inject({ method: 'GET', url: '/api/business-settings', headers: { authorization: `Bearer ${adminToken}` } }),
        // Dispositivo 2: Mesonero 1 consultando menú público
        app.inject({ method: 'GET', url: '/api/qr-menu/menu' }),
        // Dispositivo 3: Mesonero 2 consultando cotizaciones
        app.inject({ method: 'GET', url: '/api/quotes', headers: { authorization: `Bearer ${adminToken}` } }),
        // Dispositivo 4: Cocina KDS consultando órdenes activas
        app.inject({ method: 'GET', url: '/api/kds/orders' }),
        // Dispositivo 5: Cliente consultando menú QR
        app.inject({ method: 'GET', url: '/api/qr-menu/data' })
      ];

      const responses = await Promise.all(requests);
      for (const res of responses) {
        expect(res.statusCode).toBeLessThan(400);
      }
    });
  });
});
