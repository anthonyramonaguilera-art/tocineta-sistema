import fs from 'node:fs';
import path from 'node:path';

const DEFECTS_FILE = path.resolve(process.cwd(), 'docs/r2/defects.json');
const HISTORY_FILE = path.resolve(process.cwd(), 'docs/r2/.defects-history.json');

function runStatus() {
  if (!fs.existsSync(DEFECTS_FILE)) {
    console.error(`[R2-STATUS] Archivo ${DEFECTS_FILE} no encontrado.`);
    process.exit(1);
  }

  const defects = JSON.parse(fs.readFileSync(DEFECTS_FILE, 'utf-8'));
  let history = {};
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch {}
  }

  console.log('\n========================================================================================');
  console.log('📊 TABLA OFICIAL DE DEFECTOS — RONDA 2 (TOCINETA)');
  console.log('========================================================================================');
  console.log('| ID   | Estado | Fase            | Título                                                |');
  console.log('|------|--------|-----------------|-------------------------------------------------------|');

  let greenCount = 0;
  let redCount = 0;
  let regressionDetected = false;
  const regressions = [];

  for (const d of defects) {
    const isGreen = d.estado === 'green';
    if (isGreen) greenCount++;
    else redCount++;

    const statusBadge = isGreen ? '🟢 GREEN' : '🔴 RED  ';
    const idPadded = d.id.padEnd(4);
    const fasePadded = (d.fase || '').padEnd(15);
    const tituloTrim = (d.titulo || '').slice(0, 53).padEnd(53);

    console.log(`| ${idPadded} | ${statusBadge} | ${fasePadded} | ${tituloTrim} |`);

    // Mecanismo "Ratchet": si antes estaba green y ahora está red, falla
    const previousState = history[d.id];
    if (previousState === 'green' && d.estado === 'red') {
      regressionDetected = true;
      regressions.push(d.id);
    }
  }

  console.log('========================================================================================');
  const total = defects.length;
  const greenPct = ((greenCount / total) * 100).toFixed(1);
  const redPct = ((redCount / total) * 100).toFixed(1);

  console.log(`📈 Resumen: ${total} Defectos | 🟢 Verdes: ${greenCount} (${greenPct}%) | 🔴 Rojos: ${redCount} (${redPct}%)`);
  console.log('========================================================================================\n');

  // Actualizar historial
  const currentHistory = {};
  for (const d of defects) {
    currentHistory[d.id] = d.estado;
  }
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(currentHistory, null, 2));

  if (regressionDetected) {
    console.error(`❌ REGRESIÓN DETECTADA: Los siguientes defectos estaban en VERDE y regresaron a ROJO: ${regressions.join(', ')}`);
    process.exit(1);
  }

  process.exit(0);
}

runStatus();
