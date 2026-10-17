import { z } from 'zod';

export const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DB_PATH: z.string().default('./data/tocineta.db'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')
});

export type EnvConfig = z.infer<typeof EnvSchema>;
