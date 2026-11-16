import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const WEB_SRC = path.join(ROOT_DIR, 'apps', 'web', 'src');
const SERVER_SRC = path.join(ROOT_DIR, 'apps', 'server', 'src');

const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/u;
const HEX_REGEX = /#[0-9a-fA-F]{3,8}\b/i;

let errorCount = 0;

function report(file, line, message) {
  const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
  console.error(`[UI-GUARD ERROR] ${rel}:${line} - ${message}`);
  errorCount++;
}

function scanDir(dir, callback) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
        scanDir(fullPath, callback);
      }
    } else {
      callback(fullPath);
    }
  }
}

console.log('--- EJECUTANDO UI-GUARD (Reglas Estrictas de Sistema de Diseño) ---');

// 1. Check index.css and css files for !important
scanDir(WEB_SRC, file => {
  if (!file.endsWith('.css') && !file.endsWith('.tsx') && !file.endsWith('.ts')) return;
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('!important')) {
      report(file, idx + 1, 'Prohibido el uso de "!important".');
    }
  });
});

// Newly created or refactored files in Phase 1 & Phase 2 that MUST be <= 400 lines
const PHASE1_AND_2_SCREENS = [
  'apps/web/src/features/pos/usePosCart.ts',
  'apps/web/src/features/pos/Step1CustomerChannel.tsx',
  'apps/web/src/features/pos/Step2Catalog.tsx',
  'apps/web/src/features/pos/Step3Review.tsx',
  'apps/web/src/features/pos/PosWizardView.tsx',
  'apps/web/src/features/home/HomeView.tsx',
  'apps/web/src/features/access/AccessQrView.tsx',
  'apps/web/src/features/uikit/UiKitView.tsx',
  'apps/web/src/features/auth/LoginView.tsx',
  'apps/web/src/components/AppHeader.tsx',
  'apps/web/src/components/AppSidebar.tsx',
  'apps/web/src/features/cashier/PaymentWizard.tsx',
  'apps/web/src/features/cashier/PaymentWizardStep2.tsx',
  'apps/web/src/features/cashier/MultiMethodCalculator.tsx',
  'apps/web/src/features/cashier/CashierView.tsx',
  'apps/web/src/features/cashier/CashierOrdersTab.tsx',
  'apps/web/src/features/cashier/CashierSalesTab.tsx',
  'apps/web/src/features/cashier/CashierClosureWizard.tsx',
  'apps/web/src/features/cashier/CashierShiftOpeningModal.tsx',
  'apps/web/src/features/kds/KdsView.tsx',
  'apps/web/src/features/kds/KdsCard.tsx',
  'apps/web/src/components/ViewErrorBoundary.tsx',
  'apps/web/src/features/admin/ClientErrorsView.tsx',
  'apps/web/src/features/profitability/InventoryView.tsx',
  'apps/web/src/features/profitability/PurchasesView.tsx',
  'apps/web/src/features/profitability/RecipesView.tsx',
  'apps/web/src/features/profitability/WasteView.tsx',
  'apps/web/src/features/profitability/InitialSetupWizard.tsx',
  'apps/web/src/features/profitability/ProfitabilityDashboard.tsx',
  'apps/web/src/features/profitability/components/TransferModal.tsx',
  'apps/web/src/features/profitability/components/NewSupplyModal.tsx',
  'apps/web/src/features/profitability/components/CostVariationModal.tsx',
  'apps/web/src/features/profitability/components/NewPurchaseModal.tsx',
  'apps/web/src/features/profitability/components/PriceHistoryModal.tsx',
  'apps/web/src/features/profitability/components/RecipeEditorModal.tsx',
  'apps/web/src/features/profitability/components/SubRecipeEditorModal.tsx',
  'apps/web/src/features/profitability/components/WasteRegisterModal.tsx',
  'apps/web/src/features/profitability/components/StockCountModal.tsx',
  'apps/web/src/features/profitability/components/CsvDataImportCard.tsx',
  'apps/web/src/features/profitability/components/ResetProductionModals.tsx',
  'apps/web/src/features/delivery/DriverSettlementModal.tsx',
  'apps/web/src/features/delivery/DriverManagementTab.tsx',
  'apps/web/src/features/profitability/components/TransferModal.tsx',
  'apps/web/src/features/profitability/components/TransferDishEquivalentMode.tsx',
  'apps/web/src/features/profitability/components/TransferBatchesModal.tsx',
  'apps/web/src/features/profitability/components/DispatchNoteSuccessModal.tsx',
  'apps/web/src/features/profitability/components/ProductionModal.tsx',
  'apps/web/src/features/profitability/components/TransferInTransitTab.tsx',
  'apps/web/src/features/profitability/components/TransferLooseItemsSection.tsx',
  'apps/web/src/features/owner/OwnerDashboardView.tsx'
];

for (const relPath of PHASE1_AND_2_SCREENS) {
  const fullPath = path.join(ROOT_DIR, relPath);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf8');
    const lineCount = content.split('\n').length;
    if (lineCount > 400) {
      report(fullPath, lineCount, `El archivo nuevo/refactorizado excede las 400 líneas permitidas (${lineCount} líneas).`);
    }
  }
}

// 1b. Límite duro de 400 líneas para todo .tsx, no solo para PHASE1_AND_2_SCREENS.
// Los archivos que ya superaban el límite quedan congelados en scripts/ui-guard-baseline.json:
// no pueden crecer; si se reducen, el guard sugiere actualizar su techo (sin fallar).
const BASELINE_PATH = path.join(ROOT_DIR, 'scripts', 'ui-guard-baseline.json');

function toRepoRelPath(file) {
  return path.relative(ROOT_DIR, file).split(path.sep).join('/');
}

function loadSizeBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    report(BASELINE_PATH, 1, 'No existe scripts/ui-guard-baseline.json (baseline de archivos largos).');
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    const files = parsed && typeof parsed === 'object' ? parsed.files : null;
    if (!files || typeof files !== 'object' || Array.isArray(files)) {
      report(BASELINE_PATH, 1, 'El baseline de archivos largos no tiene un objeto "files" válido.');
      return null;
    }
    return files;
  } catch {
    report(BASELINE_PATH, 1, 'No se pudo leer scripts/ui-guard-baseline.json como JSON válido.');
    return null;
  }
}

const SIZE_BASELINE = loadSizeBaseline();

if (SIZE_BASELINE) {
  scanDir(WEB_SRC, file => {
    if (!file.endsWith('.tsx')) return;
    const rel = toRepoRelPath(file);
    if (PHASE1_AND_2_SCREENS.includes(rel)) return;

    const content = fs.readFileSync(file, 'utf8');
    const lineCount = content.split('\n').length;
    if (!Object.prototype.hasOwnProperty.call(SIZE_BASELINE, rel)) {
      if (lineCount > 400) {
        report(file, lineCount, `Archivo .tsx fuera de PHASE1_AND_2_SCREENS con ${lineCount} líneas (máximo 400). Extrae subcomponentes o regístralo en el baseline.`);
      }
      return;
    }

    const ceiling = SIZE_BASELINE[rel];
    if (!Number.isInteger(ceiling) || ceiling < 1) {
      report(BASELINE_PATH, 1, `Techo inválido para "${rel}" en scripts/ui-guard-baseline.json.`);
      return;
    }
    if (lineCount > ceiling) {
      report(file, lineCount, `El archivo congelado en el baseline creció de ${ceiling} a ${lineCount} líneas y no puede superar su techo.`);
    } else if (lineCount < ceiling) {
      const extra = lineCount <= 400 ? ' (o elimínalo del baseline: ya está bajo el límite)' : '';
      console.log(`[UI-GUARD] ${rel}: bajó de ${ceiling} a ${lineCount} líneas. Actualiza su techo en scripts/ui-guard-baseline.json${extra}.`);
    }
  });
}

// 2. Check TSX files for Hex Colors, text-white/bg-black outside ui/, and Emojis
scanDir(WEB_SRC, file => {
  if (!file.endsWith('.tsx')) return;
  const isInsideUi = file.replace(/\\/g, '/').includes('/apps/web/src/ui/');
  const isPhase1File = PHASE1_AND_2_SCREENS.some(p => file.replace(/\\/g, '/').endsWith(p));

  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  lines.forEach((l, idx) => {
    // Check for Emojis in TSX
    if (isPhase1File && EMOJI_REGEX.test(l)) {
      report(file, idx + 1, 'Prohibido usar emojis como íconos. Use componentes lucide-react.');
    }

    // Check for Hex colors in TSX
    if (isPhase1File && HEX_REGEX.test(l)) {
      // Exclude legitimate svg paths or test identifiers if any
      const trimmed = l.trim();
      if (!trimmed.startsWith('//') && !trimmed.startsWith('/*')) {
        report(file, idx + 1, 'Prohibido el uso de colores hexadecimales en TSX. Use variables semánticas o tokens.');
      }
    }

    // Check for text-white or bg-black outside src/ui/
    if (!isInsideUi && isPhase1File) {
      if (/\btext-white\b/.test(l)) {
        report(file, idx + 1, 'Prohibido "text-white" fuera de src/ui/. Use tokens semánticos (text-ink, text-primary-ink, etc.).');
      }
      if (/\bbg-black\b/.test(l)) {
        report(file, idx + 1, 'Prohibido "bg-black" fuera de src/ui/. Use tokens semánticos (bg-surface, bg-surface-alt, etc.).');
      }
    }

    // Check for fixed palette colors outside src/ui/
    if (!isInsideUi) {
      if (/\b(bg|text|border)-(red|blue|green|emerald|amber|yellow|orange|gray|slate|zinc)-\d{2,3}\b/.test(l)) {
        report(file, idx + 1, 'Color de paleta fija: usa tokens semanticos');
      }
    }
  });
});

// 3. Check for forbidden words in apps/web/src and apps/server/src according to AGENTS.md
const FORBIDDEN_WORDS_REGEX = /\b(Olinelcys|Anthony|Carlos|Andrea|Miguel|Jos[eé]|Valery|Treinta|Sonr[ií]e|God Mode|Modo Dios|Varons)\b/i;

for (const srcDir of [WEB_SRC, SERVER_SRC]) {
  scanDir(srcDir, file => {
    const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
    // Exclude applied migration files
    if (rel.includes('apps/server/src/db/migrations/')) return;
    // Exclude legacy migration cleanup script
    if (rel.endsWith('apps/server/src/modules/auth/seed-users.ts')) return;

    // Check filename
    const baseName = path.basename(file);
    if (FORBIDDEN_WORDS_REGEX.test(baseName)) {
      report(file, 1, `Nombre de archivo contiene palabra prohibida: "${baseName}".`);
    }

    if (!file.endsWith('.ts') && !file.endsWith('.tsx') && !file.endsWith('.json') && !file.endsWith('.html') && !file.endsWith('.css')) return;

    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((l, idx) => {
      const match = l.match(FORBIDDEN_WORDS_REGEX);
      if (match) {
        report(file, idx + 1, `Uso de marca o nombre prohibido según AGENTS.md: "${match[0]}".`);
      }
    });
  });
}

if (errorCount > 0) {
  console.error(`\n✖ UI-GUARD FALLÓ con ${errorCount} violaciones.`);
  process.exit(1);
} else {
  console.log('✓ UI-GUARD: Todas las reglas semánticas y de gobernanza pasaron con éxito.');
  process.exit(0);
}
