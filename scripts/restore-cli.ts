import { restoreAndVerifyDatabase } from '../apps/server/src/modules/backups/restore-engine.js';

async function main() {
  const args = process.argv.slice(2);
  let backupPath: string | undefined;
  let privateKey: string | undefined;
  let targetPath: string | undefined;
  let dryRun = false;
  let jsonMode = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--backup' || arg === '-b') {
      backupPath = args[++i];
    } else if (arg === '--key' || arg === '-k') {
      privateKey = args[++i];
    } else if (arg === '--target' || arg === '-t') {
      targetPath = args[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--json') {
      jsonMode = true;
    }
  }

  if (!backupPath) {
    console.error('Error: Debe especificar la ruta del archivo de respaldo con --backup <ruta>');
    process.exit(1);
  }

  try {
    const result = await restoreAndVerifyDatabase({
      backupFilePath: backupPath,
      privateKey,
      targetDbPath: targetPath,
      dryRun
    });

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log('\n======================================================');
    console.log('   RESTAURACIÓN Y VERIFICACIÓN EXITOSA - TOCINETA SONRÍE');
    console.log('======================================================');
    console.log(`- Archivo origen:        ${backupPath}`);
    console.log(`- Integridad SQLite:     ${result.integrityCheck} (PRAGMA integrity_check)`);
    console.log(`- Cadena de Auditoría:   VÁLIDA (${result.auditChain.count} eslabones verificados)`);
    console.log(`- Hash de Cabeza:        ${result.auditChain.headHash}`);
    console.log(`- Órdenes registradas:   ${result.stats.ordersCount}`);
    console.log(`- Usuarios en sistema:   ${result.stats.usersCount}`);
    console.log(`- Destino restaurado:    ${result.targetDbPath}`);
    if (result.preRestoreBackupPath) {
      console.log(`- Copia preventiva ant:  ${result.preRestoreBackupPath}`);
    }
    console.log(`- Tiempo de operación:   ${(result.durationMs / 1000).toFixed(2)} segundos`);
    console.log('======================================================\n');
  } catch (err: any) {
    if (jsonMode) {
      console.error(JSON.stringify({ error: err.message }));
    } else {
      console.error('\n[ERROR DE RESTAURACIÓN]', err.message);
    }
    process.exit(1);
  }
}

main();
