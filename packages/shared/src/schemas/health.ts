import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  db: z.literal('wal_full'),
  journalMode: z.string(),
  synchronous: z.number(),
  foreignKeys: z.number(),
  timestampUtcMs: z.number(),
  localTimeCaracas: z.string()
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const SnapshotInfoSchema = z.object({
  filename: z.string(),
  createdAtIso: z.string(),
  sizeBytes: z.number()
});

export type SnapshotInfo = z.infer<typeof SnapshotInfoSchema>;

export const DryRunInfoSchema = z.object({
  status: z.string(),
  snapshotVerified: z.string().nullable(),
  auditChainValid: z.boolean().nullable(),
  checkedAtMs: z.number().nullable(),
  message: z.string().optional(),
  error: z.string().optional()
});

export type DryRunInfo = z.infer<typeof DryRunInfoSchema>;

export const UsbVaultInfoSchema = z.object({
  connected: z.boolean(),
  vaultPath: z.string().nullable(),
  percentUsed: z.number().nullable(),
  percentFree: z.number().nullable(),
  warning: z.string().nullable()
});

export type UsbVaultInfo = z.infer<typeof UsbVaultInfoSchema>;

export const AgeKeysCustodySchema = z.object({
  mode: z.enum(['PRODUCTION', 'DEVELOPMENT']),
  recipientsCount: z.number(),
  isProduction: z.boolean()
});

export type AgeKeysCustody = z.infer<typeof AgeKeysCustodySchema>;

export const SystemHealthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  architecture: z.literal('single_process'),
  systemTime: z.object({
    utcMs: z.number(),
    localTimeCaracas: z.string(),
    timezone: z.string()
  }),
  database: z.object({
    status: z.literal('connected'),
    driver: z.literal('better-sqlite3'),
    path: z.string(),
    sizeBytes: z.number(),
    walSizeBytes: z.number(),
    pragmas: z.object({
      journalMode: z.string(),
      synchronous: z.number(),
      foreignKeys: z.number(),
      busyTimeoutMs: z.number()
    }),
    lastSnapshot: SnapshotInfoSchema.nullable(),
    auditChain: z.object({
      valid: z.boolean(),
      count: z.number(),
      headHash: z.string().nullable()
    }).optional()
  }),
  system: z.object({
    platform: z.string(),
    nodeVersion: z.string(),
    uptimeSec: z.number(),
    memory: z.object({
      rssMb: z.number(),
      heapUsedMb: z.number(),
      heapTotalMb: z.number()
    }),
    disk: z.object({
      freeBytes: z.number(),
      totalBytes: z.number(),
      freeFormatted: z.string(),
      totalFormatted: z.string(),
      percentFree: z.number()
    })
  }),
  dryRun: DryRunInfoSchema.optional(),
  usbVault: UsbVaultInfoSchema.optional(),
  ageKeys: AgeKeysCustodySchema.optional()
});

export type SystemHealthResponse = z.infer<typeof SystemHealthResponseSchema>;

