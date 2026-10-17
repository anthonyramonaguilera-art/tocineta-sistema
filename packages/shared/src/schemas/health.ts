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
    lastSnapshot: SnapshotInfoSchema.nullable()
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
  })
});

export type SystemHealthResponse = z.infer<typeof SystemHealthResponseSchema>;
