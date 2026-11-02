import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EnvSchema } from '@tocineta/shared';

describe('P-4: .env.example en la raíz del repositorio', () => {
  const rootEnvExamplePath = path.resolve(__dirname, '../../../.env.example');

  it('1) El archivo .env.example existe en la raíz del repositorio', () => {
    expect(fs.existsSync(rootEnvExamplePath)).toBe(true);
  });

  it('2) Parsea las variables y es aceptado por EnvSchema.safeParse', () => {
    const content = fs.readFileSync(rootEnvExamplePath, 'utf8');
    const lines = content.split('\n');
    const parsedEnv: Record<string, string> = {};

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx !== -1) {
        const key = line.slice(0, eqIdx).trim();
        const value = line.slice(eqIdx + 1).trim();
        parsedEnv[key] = value;
      }
    }

    const result = EnvSchema.safeParse(parsedEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3000);
      expect(result.data.HOST).toBe('0.0.0.0');
      expect(result.data.NODE_ENV).toBe('production');
      expect(result.data.DB_PATH).toBe('./data/tocineta.db');
      expect(result.data.LOG_LEVEL).toBe('info');
    }

    // ENFORCE_AUTH debe ser explícitamente 'true'
    expect(parsedEnv.ENFORCE_AUTH).toBe('true');
  });

  it('3) No contiene claves o secretos reales ("age1" ni "AGE-SECRET")', () => {
    const content = fs.readFileSync(rootEnvExamplePath, 'utf8');
    expect(content).not.toContain('age1');
    expect(content).not.toContain('AGE-SECRET');
  });
});
