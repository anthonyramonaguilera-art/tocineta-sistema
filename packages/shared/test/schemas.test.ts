import { describe, it, expect } from 'vitest';
import {
  HealthResponseSchema,
  SystemHealthResponseSchema,
  EnvSchema,
  formatCaracasDateTime,
  CARACAS_TIMEZONE
} from '../src/index.js';

describe('Shared Schemas & Utils', () => {
  it('validates a valid HealthResponseSchema', () => {
    const valid = {
      status: 'ok',
      version: '0.1.0',
      db: 'wal_full',
      journalMode: 'wal',
      synchronous: 2,
      foreignKeys: 1,
      timestampUtcMs: Date.now(),
      localTimeCaracas: formatCaracasDateTime()
    };
    const parsed = HealthResponseSchema.parse(valid);
    expect(parsed.status).toBe('ok');
    expect(parsed.db).toBe('wal_full');
    expect(parsed.synchronous).toBe(2);
  });

  it('rejects invalid HealthResponseSchema if db is not wal_full or synchronous is wrong', () => {
    const invalid = {
      status: 'ok',
      version: '0.1.0',
      db: 'delete',
      journalMode: 'delete',
      synchronous: 1,
      foreignKeys: 1,
      timestampUtcMs: Date.now(),
      localTimeCaracas: 'now'
    };
    expect(() => HealthResponseSchema.parse(invalid)).toThrow();
  });

  it('validates SystemHealthResponseSchema with complete structure', () => {
    const data = {
      status: 'ok',
      version: '0.1.0',
      architecture: 'single_process',
      systemTime: {
        utcMs: Date.now(),
        localTimeCaracas: formatCaracasDateTime(),
        timezone: CARACAS_TIMEZONE
      },
      database: {
        status: 'connected',
        driver: 'better-sqlite3',
        path: './data/tocineta.db',
        sizeBytes: 1024,
        walSizeBytes: 0,
        pragmas: {
          journalMode: 'wal',
          synchronous: 2,
          foreignKeys: 1,
          busyTimeoutMs: 5000
        },
        lastSnapshot: null
      },
      system: {
        platform: 'win32',
        nodeVersion: 'v24.15.0',
        uptimeSec: 42,
        memory: {
          rssMb: 64,
          heapUsedMb: 32,
          heapTotalMb: 48
        },
        disk: {
          freeBytes: 100000000000,
          totalBytes: 500000000000,
          freeFormatted: '100.00 GB',
          totalFormatted: '500.00 GB',
          percentFree: 20
        }
      }
    };

    const parsed = SystemHealthResponseSchema.parse(data);
    expect(parsed.architecture).toBe('single_process');
    expect(parsed.database.pragmas.journalMode).toBe('wal');
    expect(parsed.database.pragmas.synchronous).toBe(2);
  });

  it('validates SystemHealthResponseSchema with custody and optimization fields (M10.2)', () => {
    const data = {
      status: 'ok',
      version: '0.1.0',
      architecture: 'single_process',
      systemTime: {
        utcMs: Date.now(),
        localTimeCaracas: formatCaracasDateTime(),
        timezone: CARACAS_TIMEZONE
      },
      database: {
        status: 'connected',
        driver: 'better-sqlite3',
        path: './data/tocineta.db',
        sizeBytes: 1024,
        walSizeBytes: 0,
        pragmas: {
          journalMode: 'wal',
          synchronous: 2,
          foreignKeys: 1,
          busyTimeoutMs: 5000
        },
        lastSnapshot: null
      },
      system: {
        platform: 'win32',
        nodeVersion: 'v24.15.0',
        uptimeSec: 42,
        memory: {
          rssMb: 64,
          heapUsedMb: 32,
          heapTotalMb: 48
        },
        disk: {
          freeBytes: 100000000000,
          totalBytes: 500000000000,
          freeFormatted: '100.00 GB',
          totalFormatted: '500.00 GB',
          percentFree: 20
        }
      },
      dryRun: {
        status: 'OK',
        snapshotVerified: 'pre-migrate-1792.db',
        auditChainValid: true,
        checkedAtMs: Date.now(),
        message: 'Simulacro exitoso'
      },
      usbVault: {
        connected: true,
        vaultPath: 'D:\\',
        percentUsed: 45,
        percentFree: 55,
        warning: null
      },
      ageKeys: {
        mode: 'PRODUCTION' as const,
        recipientsCount: 2,
        isProduction: true
      }
    };

    const parsed = SystemHealthResponseSchema.parse(data);
    expect(parsed.dryRun?.status).toBe('OK');
    expect(parsed.usbVault?.connected).toBe(true);
    expect(parsed.ageKeys?.mode).toBe('PRODUCTION');
  });

  it('parses environment with default values', () => {
    const env = EnvSchema.parse({});
    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.DB_PATH).toBe('./data/tocineta.db');
    expect(env.NODE_ENV).toBe('development');
  });

  it('formats dates in America/Caracas timezone', () => {
    const formatted = formatCaracasDateTime(new Date('2026-10-17T05:00:00Z'));
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(5);
  });
});
