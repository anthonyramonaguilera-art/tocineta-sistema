import { initSqlite } from './connection.js';
import { resetForProduction } from './reset-for-production.js';
import { resetToProductionClean } from '../modules/profitability/setup-wizard-service.js';

async function main() {
  const dbPath = process.env.DB_PATH || './data/tocineta.db';
  console.log(`\n=============================================================`);
  console.log(`🛡️ INICIALIZACIÓN DE PRODUCCIÓN LIMPIA (db:init-prod)`);
  console.log(`=============================================================`);
  
  await resetForProduction(dbPath);

  const dbCtx = initSqlite(dbPath);
  try {
    resetToProductionClean(dbCtx.rawDb);
    console.log(`✅ Base de datos verificada y saneada: Cero datos demo, modo producción activo.`);
  } finally {
    dbCtx.rawDb.close();
  }
}

main().catch(err => {
  console.error('❌ Error fatal en db:init-prod:', err);
  process.exit(1);
});
