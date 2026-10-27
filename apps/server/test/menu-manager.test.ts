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
import { loginAs } from './test-helpers.js';

describe('Hito M3 - API de Catálogo, Gestor de Menú, Sincronización y Disponibilidad (@tocineta/server)', () => {
  let app: FastifyInstance;
  const tempDir = path.join(os.tmpdir(), `tocineta_m3_test_${Date.now()}`);
  const tempDb = path.join(tempDir, 'test_m3.db');
  let rawDb: Database.Database;

  let adminToken: string;
  let supervisorToken: string;
  let cajeraToken: string;
  let mesoneroToken: string;
  let cocineroToken: string;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    const dbCtx = initSqlite(tempDb);
    rawDb = dbCtx.rawDb;

    // Ejecutar migraciones 0001, 0002 y 0003
    await runMigrations(rawDb, { dbPath: tempDb });

    // Sembrar usuarios y catálogo inicial
    seedInitialUsers(rawDb);
    seedCatalog(rawDb);

    app = await buildServer({ logger: false, disableStatic: true });
    await app.ready();

    // Obtener tokens de autenticación para cada rol
    adminToken = (await loginAs(app, 'admin', rawDb)).token;
    supervisorToken = (await loginAs(app, 'supervisor', rawDb)).token;
    cajeraToken = (await loginAs(app, 'cajera', rawDb)).token;
    mesoneroToken = (await loginAs(app, 'mesero', rawDb)).token;
    cocineroToken = (await loginAs(app, 'plancha', rawDb)).token;
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
  // CRITERIO 1: Catálogo POS Operativo con Conversión en Bs y Reglas Oficiales
  // --------------------------------------------------------------------------
  describe('Criterio 1: GET /api/menu/pos', () => {
    it('Devuelve productos activos con conversión exacta a Bs, 6 sabores Pepsi y 6 Barra Libre, excluyendo Malteadas', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/menu/pos'
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.success).toBe(true);
      expect(data.rateMicroBs).toBeGreaterThan(0);
      expect(data.latestSeq).toBeDefined();

      // Verificar categorías públicas activas
      const catNames = data.categories.map((c: any) => c.name);
      expect(catNames).toContain('Hot Dogs');
      expect(catNames).toContain('Hamburguesas');
      expect(catNames).toContain('Combos');
      expect(catNames).toContain('Extras y Raciones');
      expect(catNames).toContain('Bebidas');

      // Regla 1: Feature flag Malteadas apagada por defecto y cortesías ocultas de grilla
      expect(catNames).not.toContain('Malteadas y Helados');
      expect(catNames).not.toContain('Obsequios Cupón');

      // Verificar sabores oficiales Pepsi para Refresco 1 Lt
      const bebidas = data.categories.find((c: any) => c.name === 'Bebidas');
      const refresco = bebidas.products.find((p: any) => p.name === 'Refresco 1 Lt');
      expect(refresco).toBeDefined();
      expect(refresco.priceUsdCents).toBe(180); // $1.80
      expect(refresco.priceBsCents).toBeGreaterThan(0);
      const flavorNames = refresco.flavors.map((f: any) => f.flavorName);
      expect(flavorNames).toEqual(['Pepsi', '7Up', 'Frescolita', 'Manzanita', 'Piña', 'Naranja']);

      // Verificar 6 ingredientes de Barra Libre ($0.00 venta)
      expect(data.barraLibreIngredients).toHaveLength(6);
      const blNames = data.barraLibreIngredients.map((b: any) => b.name);
      expect(blNames).toContain('Tomate');
      expect(blNames).toContain('Cebolla Caramelizada');
      expect(blNames).toContain('Maíz');
      expect(blNames).toContain('Chimichurri');
      expect(blNames).toContain('Relish');
      expect(blNames).toContain('Cebolla');
      for (const bl of data.barraLibreIngredients) {
        expect(bl.priceUsdCents).toBe(0);
        expect(bl.priceBsCents).toBe(0);
      }

      // Modificadores globales y tarifas delivery
      expect(data.globalModifiers).toContain('Sin Pan / Envuelta en Lechuga');
      expect(data.deliveryQuickTiers).toHaveLength(4);
    });
  });

  // --------------------------------------------------------------------------
  // CRITERIO 2: Feature Flag de Malteadas y Creación Dinámica de Producto
  // --------------------------------------------------------------------------
  describe('Criterio 2: Activar Malteadas y Crear "Malteada Oreo" ($4.50)', () => {
    it('Al activar MALTEADAS_Y_HELADOS y crear Malteada Oreo, aparece en GET /api/menu/pos', async () => {
      // 1. Activar categoría vía PATCH
      const toggleRes = await app.inject({
        method: 'PATCH',
        url: '/api/menu/categories/cat_malteadas/toggle-active',
        headers: { authorization: `Bearer ${adminToken}` }
      });
      expect(toggleRes.statusCode).toBe(200);
      expect(JSON.parse(toggleRes.payload).isActive).toBe(true);

      // 2. Crear Malteada Oreo ($4.50 / 450 cents)
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/menu/products',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          categoryId: 'cat_malteadas',
          name: 'Malteada Oreo',
          priceUsdCents: 450,
          station: 'caja_bebidas',
          description: 'Cremosa malteada artesanal con galletas Oreo'
        }
      });
      expect(createRes.statusCode).toBe(201);

      // 3. Verificar que aparece en GET /api/menu/pos
      const posRes1 = await app.inject({ method: 'GET', url: '/api/menu/pos' });
      const posData1 = JSON.parse(posRes1.payload);
      const malteadasCat = posData1.categories.find((c: any) => c.id === 'cat_malteadas');
      expect(malteadasCat).toBeDefined();
      expect(malteadasCat.name).toBe('Malteadas y Helados');
      const oreoProd = malteadasCat.products.find((p: any) => p.name === 'Malteada Oreo');
      expect(oreoProd).toBeDefined();
      expect(oreoProd.priceUsdCents).toBe(450);

      // 4. Desactivar categoría nuevamente
      const toggleRes2 = await app.inject({
        method: 'PATCH',
        url: '/api/menu/categories/cat_malteadas/toggle-active',
        headers: { authorization: `Bearer ${adminToken}` }
      });
      expect(toggleRes2.statusCode).toBe(200);
      expect(JSON.parse(toggleRes2.payload).isActive).toBe(false);

      // 5. Verificar que vuelve a ocultarse de GET /api/menu/pos
      const posRes2 = await app.inject({ method: 'GET', url: '/api/menu/pos' });
      const posData2 = JSON.parse(posRes2.payload);
      expect(posData2.categories.some((c: any) => c.id === 'cat_malteadas')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // CRITERIO 3: Sincronización de Disponibilidad ("Agotado") y Bus de Eventos
  // --------------------------------------------------------------------------
  describe('Criterio 3: Toggle Disponibilidad y Eventos Secuenciales', () => {
    it('Marcar "Doritos Dog Snacks" como agotado emite evento, incrementa seq y actualiza Combos', async () => {
      // 1. Obtener seq actual
      const posBefore = await app.inject({ method: 'GET', url: '/api/menu/pos' });
      const prevSeq = JSON.parse(posBefore.payload).latestSeq;

      // 2. Marcar Doritos Dog Snacks como agotado (isAvailable = false) vía Cajera
      const availRes = await app.inject({
        method: 'PATCH',
        url: '/api/menu/products/prod_doritos_dog_snacks/availability',
        headers: { authorization: `Bearer ${cajeraToken}` },
        payload: { isAvailable: false }
      });
      expect(availRes.statusCode).toBe(200);
      expect(JSON.parse(availRes.payload).isAvailable).toBe(false);

      // 3. Verificar recuperación de eventos en GET /api/events?since=<prevSeq>
      const eventsRes = await app.inject({
        method: 'GET',
        url: `/api/events?since=${prevSeq}`
      });
      expect(eventsRes.statusCode).toBe(200);
      const eventsData = JSON.parse(eventsRes.payload);
      expect(eventsData.events.length).toBeGreaterThanOrEqual(1);

      const availEvent = eventsData.events.find((e: any) => e.eventType === 'PRODUCT_AVAILABILITY_CHANGED');
      expect(availEvent).toBeDefined();
      expect(availEvent.entityId).toBe('prod_doritos_dog_snacks');
      expect(availEvent.payload.isAvailable).toBe(false);
      expect(availEvent.seq).toBeGreaterThan(prevSeq);

      // 4. Verificar en GET /api/menu/pos que Doritos Dog Snacks aparece no disponible en Hot Dogs y en Combo Clásico
      const posAfter = await app.inject({ method: 'GET', url: '/api/menu/pos' });
      const posData = JSON.parse(posAfter.payload);

      // A. En categoría Hot Dogs
      const hotDogs = posData.categories.find((c: any) => c.id === 'cat_hot_dogs');
      const doritosDog = hotDogs.products.find((p: any) => p.id === 'prod_doritos_dog_snacks');
      expect(doritosDog.isAvailable).toBe(false);

      // B. Dentro de las opciones del Combo Clásico
      const comboClasico = posData.combos.find((c: any) => c.id === 'prod_combo_clasico');
      expect(comboClasico).toBeDefined();
      for (const slot of comboClasico.slots) {
        if (slot.requiredStation === 'hot_dogs') {
          const doritosOption = slot.options.find((o: any) => o.productId === 'prod_doritos_dog_snacks');
          expect(doritosOption).toBeDefined();
          expect(doritosOption.isAvailable).toBe(false);
        }
      }

      // Restaurar disponibilidad
      await app.inject({
        method: 'PATCH',
        url: '/api/menu/products/prod_doritos_dog_snacks/availability',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { isAvailable: true }
      });
    });
  });

  // --------------------------------------------------------------------------
  // CRITERIO 4: Control de Acceso por Rol (RBAC)
  // --------------------------------------------------------------------------
  describe('Criterio 4: Mesonero y Cocinero reciben 403 Forbidden al modificar catálogo', () => {
    it('Mesonero recibe 403 Forbidden al intentar crear un producto', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/menu/products',
        headers: { authorization: `Bearer ${mesoneroToken}` },
        payload: {
          categoryId: 'cat_hot_dogs',
          name: 'Perro Ilegal',
          priceUsdCents: 100,
          station: 'hot_dogs'
        }
      });
      expect(res.statusCode).toBe(403);
    });

    it('Cocinero recibe 403 Forbidden al intentar cambiar precios de productos', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/menu/products/prod_street_dog',
        headers: { authorization: `Bearer ${cocineroToken}` },
        payload: { priceUsdCents: 999 }
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // CRITERIO 5: Actualización de Tasa Oficial BCV y Trazabilidad
  // --------------------------------------------------------------------------
  describe('Criterio 5: Actualizar Tasa BCV vía POST /api/menu/exchange-rate', () => {
    it('Actualiza la tasa a 42.50 Bs/$, recalcula precios en GET /api/menu/pos y registra auditoría', async () => {
      const updateRes = await app.inject({
        method: 'POST',
        url: '/api/menu/exchange-rate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { rateStr: '42.50' }
      });

      expect(updateRes.statusCode).toBe(200);
      const updateData = JSON.parse(updateRes.payload);
      expect(updateData.rateMicroBs).toBe(42_500_000);
      expect(updateData.formattedRate).toBe('42,5');

      // Verificar en GET /api/menu/pos que la tasa y el cálculo en Bs cambiaron
      const posRes = await app.inject({ method: 'GET', url: '/api/menu/pos' });
      const posData = JSON.parse(posRes.payload);
      expect(posData.rateMicroBs).toBe(42_500_000);

      // Street Dog ($2.50 / 250 cents) * 42.50 = 106.25 Bs -> 10625 Bs cents
      const hotDogs = posData.categories.find((c: any) => c.id === 'cat_hot_dogs');
      const streetDog = hotDogs.products.find((p: any) => p.name === 'Street Dog');
      expect(streetDog.priceBsCents).toBe(10625);

      // Verificar trazabilidad en tabla exchange_rates
      const currentRate = rawDb.prepare('SELECT * FROM exchange_rates WHERE is_current = 1').get() as any;
      expect(currentRate.rate_micro_bs).toBe(42_500_000);

      // Verificar registro en audit_events
      const audit = rawDb.prepare(`
        SELECT * FROM audit_events 
        WHERE action = 'EXCHANGE_RATE_UPDATED' 
        ORDER BY created_at_ms DESC 
        LIMIT 1
      `).get() as any;
      expect(audit).toBeDefined();
      expect(audit.actor_user_id).toBe('usr_admin');
    });
  });

  // --------------------------------------------------------------------------
  // CRITERIO 6: Subida Local de Fotografía y Cupones
  // --------------------------------------------------------------------------
  describe('Criterio 6: Subida Local de Fotografía y Gestión de Cupones', () => {
    it('Sube una foto base64 para un producto y actualiza image_url', async () => {
      // 1x1 GIF / PNG transparente en base64
      const dummyPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      const photoRes = await app.inject({
        method: 'POST',
        url: '/api/menu/products/prod_street_dog/photo',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { base64: dummyPngBase64 }
      });

      expect(photoRes.statusCode).toBe(200);
      const photoData = JSON.parse(photoRes.payload);
      expect(photoData.imageUrl).toMatch(/^\/uploads\/prod_street_dog-/);

      // Verificar persistencia en base de datos
      const prod = rawDb.prepare('SELECT image_url FROM products WHERE id = ?').get('prod_street_dog') as any;
      expect(prod.image_url).toBe(photoData.imageUrl);
    });

    it('Permite crear y conmutar un cupón de cortesía', async () => {
      const coupRes = await app.inject({
        method: 'POST',
        url: '/api/menu/coupons',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          code: 'PROMO2026',
          description: 'Cupón especial de bienvenida',
          couponType: 'DISCOUNT',
          discountMode: 'FIXED_USD',
          discountValue: 200,
          maxUses: 50
        }
      });

      expect(coupRes.statusCode).toBe(201);
      const couponId = JSON.parse(coupRes.payload).coupon.id;

      // Desactivar cupón
      const toggleRes = await app.inject({
        method: 'PATCH',
        url: `/api/menu/coupons/${couponId}`,
        headers: { authorization: `Bearer ${adminToken}` }
      });
      expect(toggleRes.statusCode).toBe(200);
      expect(JSON.parse(toggleRes.payload).isActive).toBe(false);
    });
  });
});
