import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isSafePrinterName, countTocinetaJobs, purgeTocinetaJobs } from '../src/modules/printing/spooler-guard.js';
import { sendWindowsRawEscPos, resetLastOkAtForTest } from '../src/modules/printing/worker.js';

const execFileMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: any[]) => execFileMock(...args)
}));

describe('R2 Spooler Guard & Robust Printing Tests', () => {
  const originalPlatform = process.platform;
  const originalSim = process.env.PRINTER_DEV_SIMULATION;

  beforeEach(() => {
    vi.clearAllMocks();
    resetLastOkAtForTest();
    delete process.env.PRINTER_DEV_SIMULATION;
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
    if (originalSim !== undefined) {
      process.env.PRINTER_DEV_SIMULATION = originalSim;
    } else {
      delete process.env.PRINTER_DEV_SIMULATION;
    }
  });

  it('(d) isSafePrinterName validation', () => {
    expect(isSafePrinterName('POS-80 (copy 1)')).toBe(true);
    expect(isSafePrinterName('Printer_A')).toBe(true);
    expect(isSafePrinterName("x'; Remove-Item")).toBe(false);
    expect(isSafePrinterName('a$(b)')).toBe(false);
    expect(isSafePrinterName('printer`backtick')).toBe(false);
    expect(isSafePrinterName('')).toBe(false);
  });

  it('(c) outside win32 does not call execFile', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    });
    const count = await countTocinetaJobs('POS-80');
    expect(count).toBe(0);
    await purgeTocinetaJobs('POS-80');
    const res = await sendWindowsRawEscPos('POS-80', Buffer.from('test'));
    expect(res.bytesWritten).toBe(4);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('(a) main execFile failure calls purge with TOC_PRINTER in env', async () => {
    execFileMock.mockImplementation((cmd, args, opts, callback) => {
      if (typeof opts === 'function') {
        callback = opts;
      }
      const cmdStr = JSON.stringify(args);
      if (cmdStr.includes('Measure-Object')) {
        callback(null, '0', '');
      } else if (cmdStr.includes('Remove-PrintJob')) {
        callback(null, '', '');
      } else {
        callback(new Error('Printer offline'), '', '');
      }
    });

    await expect(sendWindowsRawEscPos('POS-80', Buffer.from('hello'))).rejects.toThrow(
      'No se pudo imprimir. Revise la impresora.'
    );

    const removeCalls = execFileMock.mock.calls.filter((call: any[]) =>
      JSON.stringify(call[1]).includes('Remove-PrintJob')
    );
    expect(removeCalls.length).toBeGreaterThan(0);
    expect(removeCalls[0][2].env.TOC_PRINTER).toBe('POS-80');
  });

  it('(b) count >= 3 triggers purge BEFORE sending', async () => {
    const callOrder: string[] = [];
    execFileMock.mockImplementation((cmd, args, opts, callback) => {
      if (typeof opts === 'function') {
        callback = opts;
      }
      const cmdStr = JSON.stringify(args);
      if (cmdStr.includes('Measure-Object')) {
        callOrder.push('count');
        callback(null, '3', '');
      } else if (cmdStr.includes('Remove-PrintJob')) {
        callOrder.push('purge');
        callback(null, '', '');
      } else {
        callOrder.push('send');
        callback(null, JSON.stringify({ BytesWritten: 5 }), '');
      }
    });

    await sendWindowsRawEscPos('POS-80', Buffer.from('hello'));

    expect(callOrder).toEqual(['count', 'purge', 'send']);
  });

  it('(e) idle >5 min prepends 1B 40 to payload, <5 min does not', async () => {
    let capturedPayload1: Buffer | null = null;
    let capturedPayload2: Buffer | null = null;

    execFileMock.mockImplementation((cmd, args, opts, callback) => {
      if (typeof opts === 'function') {
        callback = opts;
      }
      const cmdStr = JSON.stringify(args);
      if (cmdStr.includes('Measure-Object')) {
        callback(null, '0', '');
      } else {
        const filePathIdx = args.indexOf('-FilePath');
        if (filePathIdx !== -1) {
          const filePath = args[filePathIdx + 1];
          const content = require('node:fs').readFileSync(filePath);
          if (!capturedPayload1) {
            capturedPayload1 = content;
          } else {
            capturedPayload2 = content;
          }
        }
        callback(null, JSON.stringify({ BytesWritten: 10 }), '');
      }
    });

    await sendWindowsRawEscPos('POS-80', Buffer.from('data'));
    expect(capturedPayload1![0]).toBe(0x1b);
    expect(capturedPayload1![1]).toBe(0x40);

    await sendWindowsRawEscPos('POS-80', Buffer.from('data'));
    expect(capturedPayload2![0]).not.toBe(0x1b);
  });

  it('(f) short error message for timeout', async () => {
    execFileMock.mockImplementation((cmd, args, opts, callback) => {
      if (typeof opts === 'function') {
        callback = opts;
      }
      const cmdStr = JSON.stringify(args);
      if (cmdStr.includes('Measure-Object')) {
        callback(null, '0', '');
      } else if (cmdStr.includes('Remove-PrintJob')) {
        callback(null, '', '');
      } else {
        const timeoutErr: any = new Error('Operation timed out');
        timeoutErr.killed = true;
        callback(timeoutErr, '', '');
      }
    });

    await expect(sendWindowsRawEscPos('POS-80', Buffer.from('test'))).rejects.toThrow(
      'La impresora no responde. Revise cable y encendido.'
    );
  });
});
