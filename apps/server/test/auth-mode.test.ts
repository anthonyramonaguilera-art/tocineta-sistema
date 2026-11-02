import { describe, it, expect } from 'vitest';
import { describeAuthMode, shouldWarnProductionAudit, assertSafeStartup } from '../src/index.js';

describe('describeAuthMode', () => {
  it('devuelve mensaje estricto cuando ENFORCE_AUTH === "true"', () => {
    const result = describeAuthMode({ ENFORCE_AUTH: 'true' });
    expect(result).toBe('Autenticación: ESTRICTA (ENFORCE_AUTH=true)');
  });

  it('devuelve mensaje de auditoría cuando ENFORCE_AUTH no está definido o es distinto de "true"', () => {
    expect(describeAuthMode({})).toBe('Autenticación: MODO AUDITORÍA (no bloquea)');
    expect(describeAuthMode({ ENFORCE_AUTH: 'false' })).toBe('Autenticación: MODO AUDITORÍA (no bloquea)');
    expect(describeAuthMode({ ENFORCE_AUTH: undefined })).toBe('Autenticación: MODO AUDITORÍA (no bloquea)');
    expect(describeAuthMode({ ENFORCE_AUTH: '1' })).toBe('Autenticación: MODO AUDITORÍA (no bloquea)');
  });

  it('evalúa advertencia en producción cuando el modo es auditoría', () => {
    // Caso advertencia: producción y no estricto
    expect(shouldWarnProductionAudit({ NODE_ENV: 'production', ENFORCE_AUTH: 'false' })).toBe(true);
    expect(shouldWarnProductionAudit({ NODE_ENV: 'production' })).toBe(true);

    // Caso sin advertencia: producción pero estricto
    expect(shouldWarnProductionAudit({ NODE_ENV: 'production', ENFORCE_AUTH: 'true' })).toBe(false);

    // Caso sin advertencia: desarrollo o test
    expect(shouldWarnProductionAudit({ NODE_ENV: 'development', ENFORCE_AUTH: 'false' })).toBe(false);
    expect(shouldWarnProductionAudit({ NODE_ENV: 'test', ENFORCE_AUTH: 'false' })).toBe(false);
  });

  it('assertSafeStartup aborta en producción cuando ENFORCE_AUTH !== "true"', () => {
    expect(() => assertSafeStartup({ NODE_ENV: 'production', ENFORCE_AUTH: 'false' }))
      .toThrow('Servidor en producción con autenticación en MODO AUDITORÍA');
    expect(() => assertSafeStartup({ NODE_ENV: 'production' }))
      .toThrow('Servidor en producción con autenticación en MODO AUDITORÍA');
    expect(() => assertSafeStartup({ NODE_ENV: 'production', ENFORCE_AUTH: '1' }))
      .toThrow('Servidor en producción con autenticación en MODO AUDITORÍA');

    // No debe abortar cuando está en producción con ENFORCE_AUTH="true"
    expect(() => assertSafeStartup({ NODE_ENV: 'production', ENFORCE_AUTH: 'true' })).not.toThrow();

    // No debe abortar fuera de producción
    expect(() => assertSafeStartup({ NODE_ENV: 'development', ENFORCE_AUTH: 'false' })).not.toThrow();
    expect(() => assertSafeStartup({ NODE_ENV: 'test', ENFORCE_AUTH: 'false' })).not.toThrow();
  });
});
