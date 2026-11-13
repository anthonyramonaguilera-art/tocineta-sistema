import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  hasNativePrinting,
  printBase64OnDevice,
  printJobOnDevice,
  printJobsOnDevice,
  startTerminalHeartbeat,
  printPendingTerminalJobs,
  appendLineFeedsToBase64
} from '../../web/src/lib/mobile-print-bridge.js';
import {
  getTerminalId,
  getTerminalLabel,
  setTerminalLabel
} from '../../web/src/lib/terminal-identity.js';
import * as clientModule from '../../web/src/api/client.js';

describe('R2 — Mobile Print Bridge & Terminal Identity (@tocineta/web)', () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const storageImpl = {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = String(value);
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: vi.fn(() => {
        mockStorage = {};
      })
    };

    (globalThis as any).localStorage = storageImpl;

    const mockWindow: any = {
      localStorage: storageImpl,
      TocinetaNative: undefined,
      dispatchEvent: vi.fn()
    };

    globalThis.window = mockWindow;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
    vi.restoreAllMocks();
  });

  describe('1. Identidad de Terminal (terminal-identity.ts)', () => {
    it('genera un UUID sin guiones si no existe en localStorage y lo persiste', () => {
      const id1 = getTerminalId();
      expect(typeof id1).toBe('string');
      expect(id1.length).toBeGreaterThanOrEqual(16);
      expect(id1).not.toContain('-');

      // Segunda llamada devuelve el mismo id persistido
      const id2 = getTerminalId();
      expect(id2).toBe(id1);
    });

    it('getTerminalLabel y setTerminalLabel leen y escriben en tocineta_terminal_label', () => {
      expect(getTerminalLabel()).toBeNull();
      setTerminalLabel('Caja Móvil 01');
      expect(getTerminalLabel()).toBe('Caja Móvil 01');
    });

    it('apiFetch agrega el header X-Terminal-Id si no está presente', async () => {
      const termId = getTerminalId();
      let capturedHeaders: Headers | undefined;

      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn(async (_input: any, init?: RequestInit) => {
          capturedHeaders = init?.headers as Headers;
          return {
            status: 200,
            ok: true,
            json: async () => ({})
          } as unknown as Response;
        });

        await clientModule.apiFetch('/api/health');
        expect(capturedHeaders).toBeDefined();
        expect(capturedHeaders?.get('X-Terminal-Id')).toBe(termId);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('2. Sin la APK (window.TocinetaNative es undefined)', () => {
    it('hasNativePrinting() devuelve false', () => {
      expect(hasNativePrinting()).toBe(false);
    });

    it('printBase64OnDevice() devuelve error controlado sin lanzar', async () => {
      const res = await printBase64OnDevice('SGVsbG8=');
      expect(res.ok).toBe(false);
      expect(res.error).toBe('No hay impresora Bluetooth seleccionada');
    });

    it('startTerminalHeartbeat() devuelve una función no-op y no lanza ni envía requests', () => {
      const apiFetchSpy = vi.spyOn(clientModule, 'apiFetch');
      const cancel = startTerminalHeartbeat();
      expect(typeof cancel).toBe('function');
      cancel();
      expect(apiFetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('3. Con puente nativo (window.TocinetaNative presente)', () => {
    it('3.1 Éxito: printBase64OnDevice imprime con la impresora seleccionada', async () => {
      const printEscPosMock = vi.fn(async () => ({ success: true, bytesSent: 120 }));
      globalThis.window.TocinetaNative = {
        getCapabilities: vi.fn(async () => ({ bluetoothSpp: true })),
        getSelectedPrinter: vi.fn(async () => ({ name: 'POS-58-BT', mac: 'AA:BB:CC:DD:EE:FF' })),
        printEscPos: printEscPosMock
      };

      expect(hasNativePrinting()).toBe(true);

      const res = await printBase64OnDevice('SGVsbG8=');
      expect(res.ok).toBe(true);
      expect(printEscPosMock).toHaveBeenCalledWith({
        mac: 'AA:BB:CC:DD:EE:FF',
        base64: 'SGVsbG8='
      });
    });

    it('3.2 Fallo de impresora: getSelectedPrinter devuelve null', async () => {
      globalThis.window.TocinetaNative = {
        getCapabilities: vi.fn(async () => ({ bluetoothSpp: true })),
        getSelectedPrinter: vi.fn(async () => null),
        printEscPos: vi.fn()
      };

      const res = await printBase64OnDevice('SGVsbG8=');
      expect(res.ok).toBe(false);
      expect(res.error).toBe('No hay impresora Bluetooth seleccionada');
      expect(globalThis.window.TocinetaNative.printEscPos).not.toHaveBeenCalled();
    });

    it('3.3 Fallo de hardware en printEscPos: devuelve error sin lanzar', async () => {
      globalThis.window.TocinetaNative = {
        getCapabilities: vi.fn(async () => ({ bluetoothSpp: true })),
        getSelectedPrinter: vi.fn(async () => ({ name: 'POS-58', mac: '11:22:33:44:55:66' })),
        printEscPos: vi.fn(async () => ({ success: false, error: 'Socket SPP cerrado por hardware' }))
      };

      const res = await printBase64OnDevice('SGVsbG8=');
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Socket SPP cerrado por hardware');
    });

    it('3.4 Claim 409: si el claim responde 409 devuelve ok: true', async () => {
      globalThis.window.TocinetaNative = {
        getCapabilities: vi.fn(async () => ({ bluetoothSpp: true })),
        getSelectedPrinter: vi.fn(async () => ({ name: 'POS-58', mac: '11:22:33:44:55:66' })),
        printEscPos: vi.fn()
      };

      vi.spyOn(clientModule, 'apiFetch').mockImplementation(async (url: string) => {
        if (url.includes('/claim')) {
          return {
            status: 409,
            ok: false,
            json: async () => ({ error: 'CONFLICT', message: 'Ya reclamado' })
          } as unknown as Response;
        }
        return { status: 200, ok: true, json: async () => ({}) } as unknown as Response;
      });

      const res = await printJobOnDevice('job-409');
      expect(res.ok).toBe(true);
      expect(globalThis.window.TocinetaNative.printEscPos).not.toHaveBeenCalled();
    });

    it('3.5 Éxito completo de printJobOnDevice: claim -> print -> complete', async () => {
      const calls: string[] = [];
      const printEscPosMock = vi.fn(async () => {
        calls.push('printEscPos');
        return { success: true, bytesSent: 80 };
      });

      globalThis.window.TocinetaNative = {
        getCapabilities: vi.fn(async () => ({ bluetoothSpp: true })),
        getSelectedPrinter: vi.fn(async () => ({ name: 'POS-58', mac: '11:22:33:44:55:66' })),
        printEscPos: printEscPosMock
      };

      vi.spyOn(clientModule, 'apiFetch').mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/claim')) {
          calls.push('claim');
          return {
            status: 200,
            ok: true,
            json: async () => ({ id: 'job-100', payloadBase64: 'QUJD' })
          } as unknown as Response;
        }
        if (url.includes('/complete')) {
          calls.push(`complete:${init?.body}`);
          return { status: 200, ok: true, json: async () => ({ ok: true }) } as unknown as Response;
        }
        return { status: 200, ok: true, json: async () => ({}) } as unknown as Response;
      });

      const res = await printJobOnDevice('job-100');
      expect(res.ok).toBe(true);
      expect(calls[0]).toBe('claim');
      expect(calls[1]).toBe('printEscPos');
      expect(calls[2]).toContain('complete:{"ok":true}');
    });

    it('3.6 Serie de 3 trabajos con uno fallido (printJobsOnDevice): no se detiene y devuelve resultado por trabajo', async () => {
      // Mock de TocinetaNative donde el segundo trabajo falla
      const printEscPosMock = vi.fn(async (args: { mac: string; base64: string }) => {
        // Identificamos el trabajo fallido a través del contenido
        const decoded = Buffer.from(args.base64, 'base64').toString('ascii');
        if (decoded.includes('PAYLOAD_JOB_2')) {
          return { success: false, error: 'Papel agotado en trabajo 2' };
        }
        return { success: true, bytesSent: 64 };
      });

      globalThis.window.TocinetaNative = {
        getCapabilities: vi.fn(async () => ({ bluetoothSpp: true })),
        getSelectedPrinter: vi.fn(async () => ({ name: 'POS-58', mac: '11:22:33:44:55:66' })),
        printEscPos: printEscPosMock
      };

      vi.spyOn(clientModule, 'apiFetch').mockImplementation(async (url: string) => {
        if (url.includes('/claim')) {
          const match = url.match(/\/print-jobs\/([^/]+)\/claim/);
          const jId = match ? match[1] : 'unknown';
          const payload = Buffer.from(`PAYLOAD_${jId.toUpperCase()}`).toString('base64');
          return {
            status: 200,
            ok: true,
            json: async () => ({ id: jId, payloadBase64: payload })
          } as unknown as Response;
        }
        return { status: 200, ok: true, json: async () => ({ ok: true }) } as unknown as Response;
      });

      const startTime = Date.now();
      const results = await printJobsOnDevice(['job_1', 'job_2', 'job_3']);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ jobId: 'job_1', ok: true, error: undefined });
      expect(results[1]).toEqual({ jobId: 'job_2', ok: false, error: 'Papel agotado en trabajo 2' });
      expect(results[2]).toEqual({ jobId: 'job_3', ok: true, error: undefined });

      // Verificamos que se ejecutó printEscPos 3 veces
      expect(printEscPosMock).toHaveBeenCalledTimes(3);

      // Verificamos que hubo 2 pausas de al menos 400ms (job 1 -> job 2, job 2 -> job 3)
      expect(duration).toBeGreaterThanOrEqual(750);
    });

    it('3.7 Heartbeat periódico: envía datos a /api/terminals/heartbeat y permite cancelación', async () => {
      vi.useFakeTimers();
      try {
        const fetchCalls: Array<{ url: string; body: any }> = [];

        globalThis.window.TocinetaNative = {
          getCapabilities: vi.fn(async () => ({ bluetoothSpp: true })),
          getSelectedPrinter: vi.fn(async () => ({ name: 'POS-58-BT', mac: 'AA:BB:CC:DD:EE:FF' })),
          printEscPos: vi.fn()
        };

        setTerminalLabel('Terminal Barra');

        vi.spyOn(clientModule, 'apiFetch').mockImplementation(async (url: string, init?: RequestInit) => {
          fetchCalls.push({
            url,
            body: init?.body ? JSON.parse(init.body as string) : null
          });
          return { status: 200, ok: true, json: async () => ({ ok: true }) } as unknown as Response;
        });

        const cancel = startTerminalHeartbeat();

        // Esperamos que se procese el primer latido inmediato
        await vi.advanceTimersByTimeAsync(100);

        expect(fetchCalls.length).toBe(1);
        expect(fetchCalls[0].url).toBe('/api/terminals/heartbeat');
        expect(fetchCalls[0].body.terminalId).toBe(getTerminalId());
        expect(fetchCalls[0].body.label).toBe('Terminal Barra');
        expect(fetchCalls[0].body.btPrinter).toEqual({ name: 'POS-58-BT', mac: 'AA:BB:CC:DD:EE:FF' });
        expect(fetchCalls[0].body.capabilities).toEqual({ bluetoothSpp: true });

        // Avanzamos 30 segundos: se envía el segundo latido
        await vi.advanceTimersByTimeAsync(30000);
        expect(fetchCalls.length).toBe(2);

        // Cancelamos el latido
        cancel();

        // Avanzamos otros 60 segundos: no debe enviarse nada nuevo
        await vi.advanceTimersByTimeAsync(60000);
        expect(fetchCalls.length).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('3.8 appendLineFeedsToBase64 agrega saltos de línea ESC/POS (0x0A) al final', () => {
      const original = Buffer.from('TEST').toString('base64');
      const withFeeds = appendLineFeedsToBase64(original, 3);
      const decodedBuf = Buffer.from(withFeeds, 'base64');
      expect(decodedBuf.length).toBe(7); // 'TEST' (4) + 3 bytes (0x0A)
      expect(decodedBuf[4]).toBe(10);
      expect(decodedBuf[5]).toBe(10);
      expect(decodedBuf[6]).toBe(10);
    });

    it('3.9 startTerminalHeartbeat ejecuta callback onFirstHeartbeat una sola vez tras primer latido', async () => {
      vi.useFakeTimers();
      try {
        globalThis.window.TocinetaNative = {
          getCapabilities: vi.fn(async () => ({ bluetoothSpp: true })),
          getSelectedPrinter: vi.fn(async () => ({ name: 'POS-58-BT', mac: 'AA:BB:CC:DD:EE:FF' })),
          printEscPos: vi.fn()
        };

        vi.spyOn(clientModule, 'apiFetch').mockImplementation(async () => {
          return { status: 200, ok: true, json: async () => ({ ok: true }) } as unknown as Response;
        });

        const firstCallback = vi.fn();
        const cancel = startTerminalHeartbeat(firstCallback);

        await vi.advanceTimersByTimeAsync(100);
        expect(firstCallback).toHaveBeenCalledTimes(1);

        // Segundo latido no vuelve a invocar callback
        await vi.advanceTimersByTimeAsync(30000);
        expect(firstCallback).toHaveBeenCalledTimes(1);

        cancel();
      } finally {
        vi.useRealTimers();
      }
    });

    it('3.10 printPendingTerminalJobs consulta GET /api/terminals/me/print-jobs e imprime comandas primero y nota al final', async () => {
      globalThis.window.TocinetaNative = {
        getCapabilities: vi.fn(async () => ({ bluetoothSpp: true })),
        getSelectedPrinter: vi.fn(async () => ({ name: 'POS-58-BT', mac: 'AA:BB:CC:DD:EE:FF' })),
        printEscPos: vi.fn(async () => ({ success: true }))
      };

      const printedOrder: string[] = [];

      vi.spyOn(clientModule, 'apiFetch').mockImplementation(async (url: string) => {
        if (url === '/api/terminals/me/print-jobs') {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              data: [
                { id: 'job_nota_1', job_type: 'NOTA_ENTREGA', created_at_ms: 1000 },
                { id: 'job_cocina_1', job_type: 'TICKET_COCINA', created_at_ms: 1005 }
              ]
            })
          } as unknown as Response;
        }
        if (url.includes('/claim')) {
          const match = url.match(/\/api\/print-jobs\/(.*?)\/claim/);
          if (match) printedOrder.push(match[1]);
          return {
            status: 200,
            ok: true,
            json: async () => ({ payloadBase64: Buffer.from('TICKET').toString('base64') })
          } as unknown as Response;
        }
        return {
          status: 200,
          ok: true,
          json: async () => ({ ok: true })
        } as unknown as Response;
      });

      const count = await printPendingTerminalJobs();
      expect(count).toBe(2);
      // Comanda primero, nota al final
      expect(printedOrder).toEqual(['job_cocina_1', 'job_nota_1']);
    });
  });
});
