import { execFile } from 'node:child_process';

export function isSafePrinterName(n: string): boolean {
  if (typeof n !== 'string') return false;
  return /^[\p{L}\p{N} _.\-()]{1,128}$/u.test(n);
}

function runExecFile(file: string, args: string[], options: any): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout: String(stdout || ''), stderr: String(stderr || '') }));
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

export async function countTocinetaJobs(printerName: string): Promise<number> {
  if (process.platform !== 'win32' || process.env.PRINTER_DEV_SIMULATION === 'true') {
    return 0;
  }
  if (!isSafePrinterName(printerName)) {
    throw new Error('Nombre de impresora no válido');
  }

  try {
    const { stdout } = await runExecFile(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-PrintJob -PrinterName $env:TOC_PRINTER -ErrorAction SilentlyContinue | Where-Object { $_.DocumentName -like 'Tocineta_*' } | Measure-Object | ForEach-Object { $_.Count }"
      ],
      {
        timeout: 3000,
        env: { ...process.env, TOC_PRINTER: printerName }
      }
    );
    const count = parseInt(stdout.trim(), 10);
    return isNaN(count) ? 0 : count;
  } catch (err) {
    return 0;
  }
}

export async function purgeTocinetaJobs(printerName: string): Promise<void> {
  if (process.platform !== 'win32' || process.env.PRINTER_DEV_SIMULATION === 'true') {
    return;
  }
  if (!isSafePrinterName(printerName)) {
    throw new Error('Nombre de impresora no válido');
  }

  try {
    await runExecFile(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-PrintJob -PrinterName $env:TOC_PRINTER -ErrorAction SilentlyContinue | Where-Object { $_.DocumentName -like 'Tocineta_*' } | Remove-PrintJob -ErrorAction SilentlyContinue"
      ],
      {
        timeout: 3000,
        env: { ...process.env, TOC_PRINTER: printerName }
      }
    );
  } catch (err) {
    console.warn('[spooler-guard] Error purging print jobs:', err);
  }
}
