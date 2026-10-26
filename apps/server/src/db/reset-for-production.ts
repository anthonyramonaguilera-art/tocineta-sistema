import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSqlite } from './connection.js';
import { runMigrations } from './migrate.js';
import { seedCatalog } from './seed-catalog.js';
import { seedInitialUsers } from '../modules/auth/seed-users.js';
import { ensureBusinessSettingsDefensive } from './business-settings.js';

export async function resetForProduction(dbPathInput?: string): Promise<{
  backupPath: string | null;
  ordersDeleted: number;
  couponsReset: number;
}> {
  const dbPath = dbPathInput || process.env.DB_PATH || './data/tocineta.db';
  console.log(`\n=============================================================`);
  console.log(`🛡️ RESTABLECIMIENTO DE BASE DE DATOS LIMPIA PARA PRODUCCIÓN`);
  console.log(`=============================================================`);
  console.log(`📁 Archivo objetivo: ${dbPath}`);

  // 1. Backup preventivo del archivo actual si existe
  let backupPath: string | null = null;
  if (fs.existsSync(dbPath)) {
    const backupDir = path.resolve(path.dirname(dbPath), 'backups/preventive');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = path.join(backupDir, `pre_reset_backup_${timestamp}.db`);
    fs.copyFileSync(dbPath, backupPath);
    console.log(`📸 Backup preventivo generado: ${backupPath}`);
  }

  // 2. Abrir conexión SQLite con PRAGMAs obligatorios
  const dbCtx = initSqlite(dbPath);
  let ordersDeleted = 0;
  let couponsReset = 0;

  try {
    // 3. Aplicar migraciones forward-only pendientes de forma idempotente
    console.log(`⚙️ Aplicando migraciones pendientes...`);
    const migRes = await runMigrations(dbCtx.rawDb, { dbPath });
    if (migRes.appliedCount > 0) {
      console.log(`✅ ${migRes.appliedCount} migración(es) aplicada(s) exitosamente.`);
    }

    // 4. Limpieza transaccional de órdenes, líneas, pagos, arqueos y turnos
    console.log(`🧹 Limpiando órdenes de prueba, arqueos, turnos y secuencias...`);
    const cleanTx = dbCtx.rawDb.transaction(() => {
      const safeDelete = (tableName: string) => {
        try {
          const tableExists = dbCtx.rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
          if (tableExists) {
            return dbCtx.rawDb.prepare(`DELETE FROM ${tableName}`).run();
          }
        } catch {
          // Ignorar tabla si no existe
        }
        return { changes: 0 };
      };

      // Eliminar dependientes de órdenes
      safeDelete('order_line_modifiers');
      safeDelete('order_lines');
      safeDelete('change_deliveries');
      safeDelete('payments');
      
      // Desactivar temporalmente el trigger de inmutabilidad del ledger para limpieza de producción
      dbCtx.rawDb.exec('DROP TRIGGER IF EXISTS trg_ledger_entries_no_delete');
      safeDelete('ledger_entries');
      dbCtx.rawDb.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_delete
        BEFORE DELETE ON ledger_entries
        BEGIN
          SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE: ledger_entries is append-only and immutable');
        END;
      `);

      safeDelete('print_jobs');
      safeDelete('worker_incidents');
      safeDelete('deliveries');
      safeDelete('delivery_driver_settlements');
      safeDelete('emergency_deferred_orders');

      // Eliminar órdenes
      const ordRes = safeDelete('orders');
      ordersDeleted = ordRes.changes;

      // Eliminar arqueos de caja y jornadas
      safeDelete('cash_sessions');
      safeDelete('jornadas');

      // Eliminar sesiones activas para exigir login limpio
      safeDelete('sessions');

      // Reiniciar secuencias autoincrementales de SQLite
      try {
        dbCtx.rawDb.prepare(`
          DELETE FROM sqlite_sequence 
          WHERE name IN ('orders', 'order_lines', 'order_line_modifiers', 'payments', 'change_deliveries', 'ledger_entries', 'print_jobs', 'worker_incidents', 'cash_sessions', 'jornadas')
        `).run();
      } catch {
        // Ignorar si sqlite_sequence no está inicializada aún
      }

      // 5. Cupones: Eliminar cupones de prueba y dejar únicamente los 4 oficiales
      dbCtx.rawDb.prepare(`
        DELETE FROM coupons 
        WHERE code NOT IN ('PARATI10', 'BIENVENIDA1', 'CAFEGRATIS', 'SNACKSGRATIS')
      `).run();

      const coupUpdate = dbCtx.rawDb.prepare(`
        UPDATE coupons 
        SET used_count = 0, is_active = 1 
        WHERE code IN ('PARATI10', 'BIENVENIDA1', 'CAFEGRATIS', 'SNACKSGRATIS')
      `).run();
      couponsReset = coupUpdate.changes;

      // 6. Asegurar business_settings defensivo
      ensureBusinessSettingsDefensive(dbCtx.rawDb);
    });

    cleanTx();
    console.log(`✅ ${ordersDeleted} orden(es) de prueba eliminada(s). Secuencia reiniciada para #CMD-0001 / T-001.`);
    console.log(`✅ Cupones reiniciados (4 cupones oficiales listos con used_count = 0).`);

    // 7. Reiniciar usuarios iniciales limpios con sus credenciales oficiales
    console.log(`👥 Reiniciando usuarios iniciales corporativos...`);
    seedInitialUsers(dbCtx.rawDb);
    console.log(`✅ Usuarios corporativos oficiales configurados (ADMIN, CAJERA, MESERO, PLANCHA, DESPACHO).`);

    // 8. Sembrar catálogo oficial de 27 productos con recetas exactas
    console.log(`🍔 Sembrando catálogo oficial con 27 productos y recetas exactas...`);
    seedCatalog(dbCtx.rawDb);
    console.log(`✅ Catálogo oficial establecido con éxito.`);

    console.log(`\n🎉 SISTEMA LISTO PARA PRODUCCIÓN EN EL FOOD TRUCK (CERO ERRORES).`);
    console.log(`=============================================================\n`);

    return {
      backupPath,
      ordersDeleted,
      couponsReset
    };
  } finally {
    dbCtx.rawDb.close();
  }
}

// Ejecución directa por CLI
const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
  process.argv[1].replace(/\\/g, '/').endsWith('reset-for-production.ts')
);

if (isMain) {
  resetForProduction().catch((err) => {
    console.error('❌ Error fatal durante restablecimiento a producción:', err);
    process.exit(1);
  });
}
