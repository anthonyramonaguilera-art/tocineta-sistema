import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { initSqlite } from './connection.js';
import { runMigrations } from './migrate.js';
import { ensureOfficialLocations } from '../modules/profitability/locations-service.js';
import { seedInitialUsers } from '../modules/auth/seed-users.js';
import { seedCatalog } from './seed-catalog.js';
import { seedProductPhotos } from '../modules/menu/photo-seed.js';
import { ensureBusinessSettingsDefensive } from './business-settings.js';

export async function createFreshProductionDatabase(customDbPath?: string): Promise<{
  dbPath: string;
  backupPath: string | null;
  counts: {
    products: number;
    supplyItems: number;
    recipes: number;
    sedes: number;
    users: number;
    printers: number;
    orders: number;
    operatingExpenses: number;
    socios: number;
    proveedores: number;
    customers: number;
  };
}> {
  const dbPath = customDbPath || env.DB_PATH || './data/tocineta.db';
  const resolvedDbPath = path.resolve(process.cwd(), dbPath);
  console.log(`📁 Ruta ABSOLUTA de la base de datos: ${resolvedDbPath}`);

  // (b) Copiar a backups/preventive si existe
  let backupPath: string | null = null;
  if (fs.existsSync(resolvedDbPath)) {
    const backupDir = path.resolve(path.dirname(resolvedDbPath), 'backups/preventive');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = path.join(backupDir, `pre_fresh_backup_${timestamp}.db`);
    fs.copyFileSync(resolvedDbPath, backupPath);

    const walPath = resolvedDbPath + '-wal';
    const shmPath = resolvedDbPath + '-shm';
    if (fs.existsSync(walPath)) {
      fs.copyFileSync(walPath, backupPath + '-wal');
    }
    if (fs.existsSync(shmPath)) {
      fs.copyFileSync(shmPath, backupPath + '-shm');
    }
    console.log(`📸 Backup preventivo generado: ${backupPath}`);

    // (c) Mover el original (renómbralo con marca de fecha, no lo borres)
    const movedPath = path.join(path.dirname(resolvedDbPath), `tocineta_archived_${timestamp}.db`);
    fs.renameSync(resolvedDbPath, movedPath);
    if (fs.existsSync(walPath)) {
      fs.renameSync(walPath, movedPath + '-wal');
    }
    if (fs.existsSync(shmPath)) {
      fs.renameSync(shmPath, movedPath + '-shm');
    }
    console.log(`📦 Base original archivada en: ${movedPath}`);
  }

  // (d) Crear la base nueva con runMigrations + ensureOfficialLocations + seedInitialUsers + seedCatalog + ensureBusinessSettingsDefensive (modo 'free', print_mode 'one')
  const dbCtx = initSqlite(resolvedDbPath);
  const rawDb = dbCtx.rawDb;

  try {
    console.log(`⚙️ Ejecutando migraciones forward-only...`);
    await runMigrations(rawDb, { dbPath: resolvedDbPath });

    console.log(`📍 Asegurando sedes oficiales...`);
    ensureOfficialLocations(rawDb);

    console.log(`👥 Sembrando usuarios iniciales...`);
    seedInitialUsers(rawDb);

    console.log(`🍔 Sembrando catálogo oficial...`);
    seedCatalog(rawDb);
    seedProductPhotos(rawDb);

    console.log(`⚙️ Asegurando ajustes del negocio (inventory_operation_mode='free', print_mode='one')...`);
    ensureBusinessSettingsDefensive(rawDb);
    rawDb.prepare(`
      UPDATE business_settings 
      SET inventory_operation_mode = 'free', print_mode = 'one', updated_at_ms = ? 
      WHERE id = 'default'
    `).run(Date.now());

    // 2) Verificación final automática
    console.log(`🔍 Ejecutando verificación final automática...`);

    const ordersCount = (rawDb.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c;
    const operatingExpensesCount = (rawDb.prepare('SELECT COUNT(*) as c FROM operating_expenses').get() as any).c;
    const sociosCount = (rawDb.prepare('SELECT COUNT(*) as c FROM business_partners').get() as any).c;
    const suppliersCount = (rawDb.prepare('SELECT COUNT(*) as c FROM suppliers').get() as any).c;
    const customersCount = (rawDb.prepare('SELECT COUNT(*) as c FROM customers').get() as any).c;
    const locationsCount = (rawDb.prepare('SELECT COUNT(*) as c FROM locations').get() as any).c;
    const usersCount = (rawDb.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
    const printersCount = (rawDb.prepare('SELECT COUNT(*) as c FROM printers').get() as any).c;

    if (ordersCount !== 0) throw new Error(`VERIFICATION_FAIL: orders count is ${ordersCount}, expected 0`);
    if (operatingExpensesCount !== 0) throw new Error(`VERIFICATION_FAIL: operating_expenses count is ${operatingExpensesCount}, expected 0`);
    if (sociosCount !== 0) throw new Error(`VERIFICATION_FAIL: business_partners (socios) count is ${sociosCount}, expected 0`);
    if (suppliersCount !== 0) throw new Error(`VERIFICATION_FAIL: suppliers count is ${suppliersCount}, expected 0`);
    if (customersCount !== 0) throw new Error(`VERIFICATION_FAIL: customers count is ${customersCount}, expected 0`);
    if (locationsCount !== 2) throw new Error(`VERIFICATION_FAIL: locations (sedes) count is ${locationsCount}, expected 2`);
    if (usersCount !== 5) throw new Error(`VERIFICATION_FAIL: users count is ${usersCount}, expected 5`);
    if (printersCount !== 2) throw new Error(`VERIFICATION_FAIL: printers count is ${printersCount}, expected 2`);

    // Comprobar ausencia de 'Wjsn' o 'Jsjs' en ninguna tabla de texto relevante
    const tables = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
    for (const t of tables) {
      const cols = rawDb.prepare(`PRAGMA table_info("${t.name}")`).all() as Array<{ name: string; type: string }>;
      const textCols = cols.filter(c => /text|char|clob/i.test(c.type));
      for (const c of textCols) {
        const match = rawDb.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}" WHERE "${c.name}" LIKE '%Wjsn%' OR "${c.name}" LIKE '%Jsjs%'`).get() as { cnt: number };
        if (match.cnt > 0) {
          throw new Error(`CONTAMINATION_FAIL: Found 'Wjsn' or 'Jsjs' in table ${t.name}, column ${c.name}`);
        }
      }
    }

    // PRAGMA foreign_key_check vacío
    const fkErrors = rawDb.prepare('PRAGMA foreign_key_check').all();
    if (fkErrors.length > 0) {
      throw new Error(`FOREIGN_KEY_CHECK_FAIL: ${JSON.stringify(fkErrors)}`);
    }

    // PRAGMA integrity_check = ok
    const integrityRes = rawDb.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    if (integrityRes.length !== 1 || integrityRes[0].integrity_check !== 'ok') {
      throw new Error(`INTEGRITY_CHECK_FAIL: ${JSON.stringify(integrityRes)}`);
    }

    // Conteos y listado requerido sin fallar:
    const productsCount = (rawDb.prepare('SELECT COUNT(*) as c FROM products').get() as any).c;
    const supplyItemsCount = (rawDb.prepare('SELECT COUNT(*) as c FROM supply_items').get() as any).c;
    const recipesCount = (rawDb.prepare('SELECT COUNT(*) as c FROM product_ingredients').get() as any).c;

    console.log(`\n📊 Conteos de siembra:`);
    console.log(`   - Products: ${productsCount}`);
    console.log(`   - Supply Items: ${supplyItemsCount}`);
    console.log(`   - Recipes (Product Ingredients): ${recipesCount}`);

    console.log(`\n🍔 Listado de Productos y Precios en USD:`);
    const productsList = rawDb.prepare('SELECT name, price_usd_cents FROM products ORDER BY name').all() as Array<{ name: string; price_usd_cents: number }>;
    for (const p of productsList) {
      console.log(`   - ${p.name}: $${(p.price_usd_cents / 100).toFixed(2)}`);
    }

    console.log(`\n✅ ¡Base de datos de producción nueva y limpia creada y verificada con éxito!\n`);

    return {
      dbPath: resolvedDbPath,
      backupPath,
      counts: {
        products: productsCount,
        supplyItems: supplyItemsCount,
        recipes: recipesCount,
        sedes: locationsCount,
        users: usersCount,
        printers: printersCount,
        orders: ordersCount,
        operatingExpenses: operatingExpensesCount,
        socios: sociosCount,
        proveedores: suppliersCount,
        customers: customersCount
      }
    };
  } finally {
    rawDb.close();
  }
}

// Si se ejecuta directamente por CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  createFreshProductionDatabase().catch(err => {
    console.error('❌ Error fatal en db:fresh-prod:', err);
    process.exit(1);
  });
}
