import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRoutePolicy, isRoleAllowed } from '../src/config/route-policy.js';
import { sanitizeUrl, safeReqSerializer } from '../src/plugins/auth-guard.js';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const ROUTE_RE = /(?:fastify|app|server|instance)\.(get|post|patch|put|delete)(?:<[^>]*>)?\(\s*(['"`])(\/[^'"`]*)\2/g;

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTsFiles(full, acc);
    else if (entry.name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

describe('R2 ROUTE_POLICY', () => {
  it('toda ruta declarada en src tiene una regla explícita (cero rutas sin clasificar)', () => {
    const unmatched: string[] = [];
    let total = 0;
    for (const file of collectTsFiles(SRC_DIR)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(ROUTE_RE)) {
        total++;
        const concrete = m[3].replace(/:[A-Za-z0-9_]+/g, 'x1');
        if (!resolveRoutePolicy(m[1].toUpperCase(), concrete).matched) {
          unmatched.push(`${m[1].toUpperCase()} ${m[3]}  (${path.relative(SRC_DIR, file)})`);
        }
      }
    }
    expect(total).toBeGreaterThan(200);
    expect(unmatched).toEqual([]);
  });

  it('clasifica correctamente las rutas críticas', () => {
    const lvl = (m: string, u: string) => resolveRoutePolicy(m, u).level;
    expect(lvl('POST', '/api/fase3/setup-wizard/init-prod')).toBe('ADMIN');
    expect(lvl('POST', '/api/fase3/setup-wizard/seed-demo')).toBe('ADMIN');
    expect(lvl('POST', '/api/orders/o1/pay')).toBe('CASHIER_PLUS');
    expect(lvl('POST', '/api/print-jobs/j1/release')).toBe('CASHIER_PLUS');
    expect(lvl('POST', '/api/auth/login')).toBe('PUBLIC');
    expect(lvl('GET', '/ws?token=abc')).toBe('ANY_SESSION');
    expect(lvl('GET', '/assets/index-abc.js')).toBe('PUBLIC');
    expect(lvl('OPTIONS', '/api/orders')).toBe('PUBLIC');
  });

  it('matriz de roles reales: mesonero/cocinero/despachador no cobran ni administran', () => {
    for (const role of ['mesonero', 'cocinero', 'despachador']) {
      expect(isRoleAllowed('CASHIER_PLUS', role)).toBe(false);
      expect(isRoleAllowed('ADMIN_SUPERVISOR', role)).toBe(false);
      expect(isRoleAllowed('ADMIN', role)).toBe(false);
      expect(isRoleAllowed('ANY_SESSION', role)).toBe(true);
    }
    expect(isRoleAllowed('CASHIER_PLUS', 'cajera')).toBe(true);
    expect(isRoleAllowed('ADMIN', 'supervisor')).toBe(false);
    expect(isRoleAllowed('ADMIN', 'admin')).toBe(true);
  });

  it('sanitizeUrl y el serializer de logs eliminan el token de /ws', () => {
    expect(sanitizeUrl('/ws?token=SECRETO&x=1')).toBe('/ws');
    const out = safeReqSerializer({ method: 'GET', url: '/ws?token=SECRETO', headers: { host: 'x' }, ip: '1.1.1.1' });
    expect(JSON.stringify(out)).not.toContain('SECRETO');
  });
});
