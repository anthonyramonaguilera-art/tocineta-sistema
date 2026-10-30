import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('R2 — UI Print Wiring & Source Contracts Test', () => {
  const webSrcDir = path.resolve(__dirname, '../../web/src');

  it('1) PosComandero.tsx and CashierOrdersTab.tsx import PostPaymentPrintModal and pass token', () => {
    const posPath = path.join(webSrcDir, 'features/pos/PosComandero.tsx');
    const cashierOrdersPath = path.join(webSrcDir, 'features/cashier/CashierOrdersTab.tsx');

    const posContent = fs.readFileSync(posPath, 'utf8');
    const cashierContent = fs.readFileSync(cashierOrdersPath, 'utf8');

    expect(posContent).toContain('PostPaymentPrintModal');
    expect(posContent).toContain('token');

    expect(cashierContent).toContain('PostPaymentPrintModal');
    expect(cashierContent).toContain('token');
  });

  it('2) PostPaymentPrintPanel.tsx contains Authorization, no jobs.length === 0 with onClose, and queries without fixed status=pending', () => {
    const panelPath = path.join(webSrcDir, 'features/cashier/PostPaymentPrintPanel.tsx');
    const content = fs.readFileSync(panelPath, 'utf8');

    expect(content).toContain('Authorization');
    expect(content).not.toContain('status=pending');
    // Should not auto-close on jobs.length === 0
    expect(content).not.toMatch(/jobs\.length\s*===\s*0.*onClose/s);
  });

  it('3) usePosCart.ts contains announce option', () => {
    const cartPath = path.join(webSrcDir, 'features/pos/usePosCart.ts');
    const content = fs.readFileSync(cartPath, 'utf8');

    expect(content).toContain('announce');
  });
});
