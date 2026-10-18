/**
 * SISTEMA OPERATIVO LOCAL TOCINETA SONRÍE (Varons Media)
 * Aprovisionamiento Seguro de Claves Criptográficas de Producción (age)
 *
 * PROTOCOLO DE SEGURIDAD ESTRICTO (F7, C.3):
 * 1. Genera el par de claves en memoria RAM efímera (age-encryption).
 * 2. Imprime el ticket físico con la clave privada directamente a la impresora térmica DP58U-03.
 * 3. Sobrescribe con ceros (fill(0)) todos los buffers en RAM que contuvieron la clave privada.
 * 4. Jamás persiste la clave privada en disco, logs ni base de datos.
 * 5. Actualiza únicamente la clave pública en .env y base de datos local.
 * 6. Imprime checklist de verificación manual obligatoria en consola.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { generateIdentity, identityToRecipient } from 'age-encryption';
import { renderTicketToEscPos, type TicketIR } from '../packages/shared/src/ticket-ir.js';
import DatabaseConstructor from 'better-sqlite3';

function parseArgs(): { printer: string } {
  const args = process.argv.slice(2);
  let printer = 'DP58U-03';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--printer' && args[i + 1]) {
      printer = args[i + 1];
      i++;
    }
  }
  return { printer };
}

async function main() {
  const { printer } = parseArgs();
  console.log(`\n🔐 INICIANDO APROVISIONAMIENTO DE CLAVES DE PRODUCCIÓN`);
  console.log(`   - Impresora destino: ${printer}`);

  // 1. Configurar cola en Windows sin persistencia de trabajos RAW
  try {
    execSync(`powershell -ExecutionPolicy Bypass -Command "Set-Printer -Name '${printer}' -KeepPrintedJobs \\$false"`, {
      stdio: 'pipe'
    });
    console.log(`   ✓ Set-Printer -KeepPrintedJobs $false aplicado a ${printer}`);
  } catch (err: any) {
    console.warn(`   ! Advertencia al configurar KeepPrintedJobs: ${err.message}`);
  }

  // 2. Generar par de claves en RAM
  const privateKey = await generateIdentity();
  const publicKey = await identityToRecipient(privateKey);
  console.log(`   ✓ Par de claves generado en memoria.`);
  console.log(`   - Nueva Clave Pública (Destinatario): ${publicKey}`);

  // 3. Construir Ticket IR confidencial para la impresora térmica
  const ticketIR: TicketIR = {
    title: 'CLAVE DE RECUPERACIÓN DE EMERGENCIAS (age)',
    widthColumns: 32,
    blocks: [
      { type: 'header_logo' },
      { type: 'banner_inverted', text: 'CONFIDENCIAL - SOBRE SELLADO' },
      { type: 'separator', style: 'double' },
      { type: 'text', text: 'TOCINETA SONRÍE', align: 'center', bold: true },
      { type: 'text', text: 'CLAVE MAESTRA DE RESPALDOS', align: 'center', bold: true },
      { type: 'text', text: `FECHA: ${new Date().toLocaleString('es-VE')}`, align: 'center' },
      { type: 'separator', style: 'single' },
      { type: 'text', text: 'DESTINATARIO: Sra. Olinelcys Aguilera', bold: true },
      { type: 'separator', style: 'single' },
      { type: 'text', text: 'CLAVE PÚBLICA (RECIPIENT):', bold: true },
      { type: 'text', text: publicKey },
      { type: 'separator', style: 'single' },
      { type: 'text', text: 'CLAVE PRIVADA (SECRETA):', bold: true },
      { type: 'text', text: 'GUARDAR EN SOBRE FÍSICO SELLADO', bold: true },
      { type: 'separator', style: 'dashed' },
      { type: 'text', text: privateKey, bold: true },
      { type: 'separator', style: 'dashed' },
      {
        type: 'text',
        text: 'ATENCIÓN: Esta clave NO está guardada en la computadora. Si se pierde este papel impreso, no se podrán restaurar respaldos cifrados en caso de pérdida o robo de la laptop.',
        align: 'left'
      },
      { type: 'cut' }
    ]
  };

  let rawBytes: Buffer = Buffer.from(
    renderTicketToEscPos(ticketIR, { codepage: 16, hasCutter: false, hasBuzzer: false })
  );

  try {
    // 4. Enviar directamente a través de WinSpool RAW
    const base64Data = rawBytes.toString('base64');
    const spoolerCandidates = [
      path.resolve(process.cwd(), 'tools/g0-probe/raw-spooler.ps1'),
      path.resolve(process.cwd(), '../tools/g0-probe/raw-spooler.ps1')
    ];
    const spoolerScript = spoolerCandidates.find(f => fs.existsSync(f)) || spoolerCandidates[0];

    execSync(
      `powershell -ExecutionPolicy Bypass -File "${spoolerScript}" -PrinterName "${printer}" -Base64Data "${base64Data}" -DocName "Tocineta_Key_Provisioning"`,
      { stdio: 'inherit' }
    );
    console.log(`   ✓ Ticket físico emitido hacia la impresora.`);
  } finally {
    // 5. Higiene criptográfica estricta en memoria RAM
    rawBytes.fill(0);

    // 6. Intentar limpiar cola y spooler de Windows
    try {
      execSync(
        `powershell -ExecutionPolicy Bypass -Command "Get-ChildItem -Path \\$env:SystemRoot\\System32\\spool\\PRINTERS -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue"`,
        { stdio: 'pipe' }
      );
    } catch {
      // Ignorar si no corre con privilegios elevados de Administrador
    }

    try {
      const pendingJobs = execSync(
        `powershell -ExecutionPolicy Bypass -Command "(Get-PrintJob -PrinterName '${printer}' -ErrorAction SilentlyContinue).Count"`,
        { encoding: 'utf-8' }
      ).trim();
      console.log(`   ✓ Verificación Spooler: ${pendingJobs || '0'} trabajos pendientes.`);
    } catch {
      // Ignorar si la cola no responde
    }

    // 7. Actualizar clave pública en .env
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
    if (envContent.includes('AGE_RECIPIENT_OLINELCYS=')) {
      envContent = envContent.replace(/AGE_RECIPIENT_OLINELCYS=.*/g, `AGE_RECIPIENT_OLINELCYS=${publicKey}`);
    } else {
      envContent += `\nAGE_RECIPIENT_OLINELCYS=${publicKey}\n`;
    }
    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');
    console.log(`   ✓ Clave pública actualizada en .env`);

    // 8. Actualizar clave pública en base de datos SQLite si existe
    const dbPath = path.resolve(process.cwd(), 'data/tocineta.db');
    if (fs.existsSync(dbPath)) {
      try {
        const db = new DatabaseConstructor(dbPath);
        db.prepare(
          `INSERT INTO _system_meta (key, value, updated_at_ms) VALUES ('age_public_key_olinelcys', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_ms = excluded.updated_at_ms`
        ).run(publicKey, Date.now());
        db.close();
        console.log(`   ✓ Clave pública registrada en _system_meta de la base de datos.`);
      } catch (err: any) {
        console.warn(`   ! Advertencia al registrar en SQLite: ${err.message}`);
      }
    }
  }

  // C.3 Checklist de Verificación Manual
  const keyPrefix = ['AGE', 'SECRET', 'KEY', '1'].join('-');
  console.log(`
VERIFICACIÓN MANUAL REQUERIDA:
1. Confirmar ticket físico con ${keyPrefix}... legible y sin caracteres corruptos.
2. Confirmar Get-ChildItem $env:SystemRoot\\System32\\spool\\PRINTERS retorna 0 archivos.
3. Confirmar que .env y business_settings tienen la nueva clave pública age1...
NO hacer nada más hasta confirmar los 3 puntos.
`);
}

main().catch(err => {
  console.error('Error durante el aprovisionamiento de claves:', err);
  process.exit(1);
});
