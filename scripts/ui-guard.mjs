import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const WEB_SRC = path.join(ROOT_DIR, 'apps', 'web', 'src');

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
  'apps/web/src/features/admin/ClientErrorsView.tsx'
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
  });
});

if (errorCount > 0) {
  console.error(`\n✖ UI-GUARD FALLÓ con ${errorCount} violaciones.`);
  process.exit(1);
} else {
  console.log('✓ UI-GUARD: Todas las reglas semánticas y de gobernanza pasaron con éxito.');
  process.exit(0);
}
