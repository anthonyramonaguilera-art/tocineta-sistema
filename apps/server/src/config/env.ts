import { EnvSchema, type EnvConfig } from '@tocineta/shared';

export function loadEnv(): EnvConfig {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Error de validación en variables de entorno:', result.error.format());
    throw new Error('Configuración de entorno inválida');
  }
  return result.data;
}

export const env = loadEnv();
