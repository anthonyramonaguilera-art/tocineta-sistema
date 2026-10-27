import { initSqlite } from './connection.js';
import { runMigrations } from './migrate.js';
import { seedCatalog } from './seed-catalog.js';
import { seedInitialUsers } from '../modules/auth/seed-users.js';
import { ensureOfficialLocations } from '../modules/profitability/locations-service.js';
import { seedDemoData } from '../modules/profitability/setup-wizard-service.js';

async function main() {
  const dbPath = process.env.DB_PATH || './data/tocineta.db';
  console.log(`\n=============================================================`);
  console.log(`🧪 SEMBRANDO DATOS DEMO PARA DEMOSTRACIONES (db:seed-demo)`);
  console.log(`=============================================================`);

  const dbCtx = initSqlite(dbPath);
  try {
    await runMigrations(dbCtx.rawDb, { dbPath });
    ensureOfficialLocations(dbCtx.rawDb);
    seedInitialUsers(dbCtx.rawDb);
    seedCatalog(dbCtx.rawDb);
    seedDemoData(dbCtx.rawDb);
    console.log(`✅ Datos demo sembrados con éxito. Modo DEMO activado.`);
    console.log(`✨ En la pantalla se mostrará el badge visual "DEMO".`);
  } finally {
    dbCtx.rawDb.close();
  }
}

main().catch(err => {
  console.error('❌ Error fatal en db:seed-demo:', err);
  process.exit(1);
});
