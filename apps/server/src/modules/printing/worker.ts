/**
 * SISTEMA OPERATIVO LOCAL TOCINETA SONRÍE (Varons Media)
 * Cola y Worker Interno de Impresión Asíncrona (M6)
 * 
 * - Concurrencia: 1 por impresora física (mutex por printerId).
 * - Timeout estricto: 4000 ms por trabajo.
 * - Transportes:
 *   - 'tcp' / 'TCP_9100': Socket TCP al puerto 9100 con timeout.
 *   - 'windows_raw' / 'SPOOLER_RAW_USB': Invoca raw-spooler.ps1 con -WindowStyle Hidden sin diálogos.
 * - Estados: 'en_cola' -> 'imprimiendo' -> 'impreso' | 'fallido' -> 'requiere_atencion' (tras 3 fallos).
 */

import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import type Database from 'better-sqlite3';
import {
  generateUuidV7,
  renderTicketToEscPos,
  type TicketIR,
  type EscPosConfig
} from '@tocineta/shared';
import { appendAuditEvent } from '../audit/audit-service.js';
import { publishDomainEvent } from '../events/event-bus.js';
import {
  loadOrderReceiptDataFromDb,
  buildReceiptTicketIR,
  buildKitchenTicketIRs,
  buildReprintTicketIR,
  buildRefireTicketIR
} from './templates.js';
import { verifyPin } from '../auth/pin.js';

export function authenticateByPin(
  rawDb: Database.Database,
  pin: string,
  userId?: string
): { authenticated: boolean; user?: { id: string; name: string; role: string } } {
  if (userId) {
    const u = rawDb.prepare('SELECT id, name, role, pin_salt, pin_hash FROM users WHERE id = ? AND is_active = 1').get(userId) as any;
    if (u && verifyPin(pin, u.pin_salt, u.pin_hash)) {
      return { authenticated: true, user: { id: u.id, name: u.name, role: u.role } };
    }
    return { authenticated: false };
  }

  const users = rawDb.prepare('SELECT id, name, role, pin_salt, pin_hash FROM users WHERE is_active = 1').all() as any[];
  for (const u of users) {
    if (verifyPin(pin, u.pin_salt, u.pin_hash)) {
      return { authenticated: true, user: { id: u.id, name: u.name, role: u.role } };
    }
  }
  return { authenticated: false };
}

export interface PrinterRow {
  id: string;
  name: string;
  connection_type: string;
  address: string;
  columns: number;
  codepage: number;
  has_cutter: number;
  has_buzzer: number;
  is_active: number;
}

export function getPrinterConfig(rawDb: Database.Database, printerId: string): EscPosConfig {
  try {
    const p = rawDb.prepare('SELECT codepage, has_cutter, has_buzzer FROM printers WHERE id = ?').get(printerId) as any;
    if (!p) return { codepage: 16, hasCutter: false, hasBuzzer: false };
    return {
      codepage: p.codepage ?? 16,
      hasCutter: Boolean(p.has_cutter),
      hasBuzzer: Boolean(p.has_buzzer)
    };
  } catch {
    return { codepage: 16, hasCutter: false, hasBuzzer: false };
  }
}

export interface PrintJobRow {
  id: string;
  printer_id: string;
  order_id: string | null;
  job_type: string;
  payload_bytes: Buffer;
  ticket_ir_json: string | null;
  station: string | null;
  status: 'en_cola' | 'imprimiendo' | 'impreso' | 'fallido' | 'requiere_atencion';
  error_message: string | null;
  attempts: number;
  max_attempts: number;
  reprint_count: number;
  reprint_reason: string | null;
  reprinted_by_user_id: string | null;
  created_at_ms: number;
  completed_at_ms: number | null;
}

// Ruta al script de PowerShell de WinSpool RAW
function resolveRawSpoolerScript(): string {
  const candidate1 = path.resolve(process.cwd(), 'tools/g0-probe/raw-spooler.ps1');
  if (fs.existsSync(candidate1)) return candidate1;

  const candidate2 = path.resolve(process.cwd(), '../../tools/g0-probe/raw-spooler.ps1');
  if (fs.existsSync(candidate2)) return candidate2;

  return candidate1;
}

// ============================================================================
// TRANSPORTES FÍSICOS: TCP 9100 Y WINDOWS RAW (SPOOLER)
// ============================================================================

export async function sendTcpEscPos(
  host: string,
  port = 9100,
  payload: Buffer,
  timeoutMs = 4000
): Promise<{ bytesSent: number; latencyMs: number }> {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let finished = false;

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      // Si la impresora soporta DLE EOT para estado, podría consultarse aquí:
      // socket.write(Buffer.from([0x10, 0x04, 0x01]));
      socket.write(payload, () => {
        setTimeout(() => {
          socket.end();
          if (!finished) {
            finished = true;
            resolve({
              bytesSent: payload.length,
              latencyMs: Date.now() - startTime
            });
          }
        }, 100);
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      if (!finished) {
        finished = true;
        reject(new Error(`Timeout de conexión TCP a ${host}:${port} (${timeoutMs} ms)`));
      }
    });

    socket.on('error', (err) => {
      if (!finished) {
        finished = true;
        reject(new Error(`Error TCP en ${host}:${port}: ${err.message}`));
      }
    });

    socket.on('close', () => {
      if (!finished) {
        finished = true;
        resolve({
          bytesSent: payload.length,
          latencyMs: Date.now() - startTime
        });
      }
    });

    socket.connect(port, host);
  });
}

export async function sendWindowsRawEscPos(
  printerName: string,
  payload: Buffer,
  docName = 'TocinetaSonrie_Ticket',
  timeoutMs = 4000
): Promise<{ bytesWritten: number }> {
  if (process.platform !== 'win32' || process.env.PRINTER_DEV_SIMULATION === 'true') {
    return { bytesWritten: payload.length };
  }

  const tempFile = path.join(os.tmpdir(), `tocineta_raw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.bin`);
  const psScript = resolveRawSpoolerScript();

  try {
    await fsp.writeFile(tempFile, payload);

    return await new Promise((resolve, reject) => {
      const child = execFile(
        'powershell',
        [
          '-WindowStyle', 'Hidden',
          '-NoProfile',
          '-ExecutionPolicy', 'Bypass',
          '-File', psScript,
          '-PrinterName', printerName,
          '-FilePath', tempFile,
          '-DocName', docName
        ],
        { timeout: timeoutMs },
        (err, stdout, stderr) => {
          if (err) {
            try {
              const match = (stderr + ' ' + stdout).match(/\{.*?"Success"\s*:\s*false.*?\}/s);
              if (match) {
                const parsed = JSON.parse(match[0]);
                return reject(new Error(parsed.ErrorMessage || err.message));
              }
            } catch {
              // fallback
            }
            return reject(new Error(stderr.trim() || stdout.trim() || err.message));
          }

          try {
            const parsed = JSON.parse(stdout.trim());
            resolve({ bytesWritten: parsed.BytesWritten ?? payload.length });
          } catch {
            resolve({ bytesWritten: payload.length });
          }
        }
      );

      // Si supera el timeout, child process se detiene
      child.on('error', (err) => reject(err));
    });
  } finally {
    await fsp.unlink(tempFile).catch(() => {});
  }
}

// ============================================================================
// WORKER DE IMPRESIÓN ASÍNCRONO
// ============================================================================

export class PrintingWorker {
  private rawDb: Database.Database;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private activeLocks = new Map<string, boolean>();
  public mockTransports = false;
  public mockFailures = new Set<string>();

  constructor(rawDb: Database.Database, options?: { mockTransports?: boolean }) {
    this.rawDb = rawDb;
    this.mockTransports = options?.mockTransports ?? (process.env.NODE_ENV === 'test');
  }

  public start(pollIntervalMs = 1500) {
    if (this.intervalTimer) return;
    this.intervalTimer = setInterval(() => {
      this.processQueue().catch((err) => {
        console.error('[PrintingWorker] Error procesando cola:', err);
      });
    }, pollIntervalMs);
  }

  public stop() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  public trigger() {
    setImmediate(() => {
      this.processQueue().catch((err) => {
        console.error('[PrintingWorker] Error en trigger:', err);
      });
    });
  }

  /**
   * Procesa la cola de trabajos pendientes ('en_cola')
   */
  public async processQueue(): Promise<void> {
    if (this.isRunning || !this.rawDb.open) return;
    this.isRunning = true;

    try {
      // Buscar trabajos pendientes
      const pendingJobs = this.rawDb.prepare(`
        SELECT pj.*, p.connection_type, p.address, p.name as printer_name
        FROM print_jobs pj
        JOIN printers p ON pj.printer_id = p.id
        WHERE pj.status = 'en_cola'
        ORDER BY pj.created_at_ms ASC
        LIMIT 10
      `).all() as Array<PrintJobRow & { connection_type: string; address: string; printer_name: string }>;

      for (const job of pendingJobs) {
        // Concurrencia 1 por impresora física
        if (this.activeLocks.get(job.printer_id)) {
          continue;
        }

        this.activeLocks.set(job.printer_id, true);
        try {
          await this.executePrintJob(job);
        } finally {
          this.activeLocks.delete(job.printer_id);
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Ejecuta un trabajo individual con timeout estricto de 4000ms
   */
  public async executePrintJob(
    job: PrintJobRow & { connection_type: string; address: string; printer_name: string }
  ): Promise<void> {
    if (!this.rawDb.open) return;
    // 1. Transición de estado a 'imprimiendo'
    this.rawDb.prepare(`
      UPDATE print_jobs 
      SET status = 'imprimiendo', attempts = attempts + 1
      WHERE id = ? AND status = 'en_cola'
    `).run(job.id);

    try {
      // 2. Enviar por el transporte físico correspondiente
      const connType = job.connection_type.toLowerCase();
      const isSimulated =
        this.mockTransports ||
        Boolean(job.address && job.address.startsWith('mock:')) ||
        process.env.PRINTER_DEV_SIMULATION === 'true' ||
        (process.platform !== 'win32' && (connType === 'windows_raw' || connType === 'spooler_raw_usb'));

      if (isSimulated) {
        // Modo simulado para tests, desarrollo o macOS sin impresoras físicas Windows
        if (this.mockFailures.has(job.id) || this.mockFailures.has(job.printer_id)) {
          throw new Error('Fallo simulado de hardware térmico (papel atascado)');
        }
        // Simular latencia de hardware de 10ms
        await new Promise((r) => setTimeout(r, 10));
      } else {
        const payload = Buffer.isBuffer(job.payload_bytes)
          ? job.payload_bytes
          : Buffer.from(job.payload_bytes);

        if (connType === 'windows_raw' || connType === 'spooler_raw_usb') {
          // Usar prioritariamente el nombre de la impresora registrado en base de datos para WinSpool
          const printerTarget = job.printer_name || job.address;
          await sendWindowsRawEscPos(printerTarget, payload, `Tocineta_${job.job_type}`, 4000);
        } else if (connType === 'tcp' || connType === 'tcp_9100') {
          const [host, portStr] = (job.address || '').split(':');
          const port = portStr ? parseInt(portStr, 10) : 9100;
          await sendTcpEscPos(host, port, payload, 4000);
        } else {
          throw new Error(`Tipo de conexión desconocido: ${job.connection_type}`);
        }
      }

      // 3. Éxito: Marcar 'impreso'
      if (!this.rawDb.open) return;
      const completedAt = Date.now();
      this.rawDb.prepare(`
        UPDATE print_jobs
        SET status = 'impreso', completed_at_ms = ?, error_message = NULL
        WHERE id = ?
      `).run(completedAt, job.id);

      publishDomainEvent(this.rawDb, {
        eventType: 'PRINT_JOB_PRINTED',
        entityId: job.id,
        payload: {
          jobId: job.id,
          orderId: job.order_id,
          printerId: job.printer_id,
          jobType: job.job_type,
          status: 'impreso',
          completedAtMs: completedAt
        }
      });
    } catch (err: any) {
      if (!this.rawDb.open) return;
      const errorMsg = err.message || 'Error de impresión desconocido';
      const updatedJob = this.rawDb.prepare('SELECT attempts, max_attempts FROM print_jobs WHERE id = ?').get(job.id) as {
        attempts: number;
        max_attempts: number;
      };

      const attempts = updatedJob?.attempts ?? job.attempts + 1;
      const maxAttempts = updatedJob?.max_attempts ?? 3;

      if (attempts >= maxAttempts) {
        // Tras 3 fallos consecutivos pasa a 'requiere_atencion'
        this.rawDb.prepare(`
          UPDATE print_jobs
          SET status = 'requiere_atencion', error_message = ?
          WHERE id = ?
        `).run(errorMsg, job.id);

        publishDomainEvent(this.rawDb, {
          eventType: 'PRINT_JOB_ATTENTION_REQUIRED',
          entityId: job.id,
          payload: {
            jobId: job.id,
            orderId: job.order_id,
            printerId: job.printer_id,
            printerName: job.printer_name,
            jobType: job.job_type,
            errorMessage: errorMsg,
            attempts,
            status: 'requiere_atencion'
          }
        });
      } else {
        // Reintentará en el siguiente ciclo
        this.rawDb.prepare(`
          UPDATE print_jobs
          SET status = 'en_cola', error_message = ?
          WHERE id = ?
        `).run(errorMsg, job.id);
      }
    }
  }
}

// ============================================================================
// FUNCIONES DE ENCOLADO ATÓMICO Y GESTIÓN DE TRABAJOS DE IMPRESIÓN
// ============================================================================

export interface EnqueueOrderPrintJobsResult {
  cajaJobId: string;
  kitchenJobIds: string[];
}

/**
 * Encola atómicamente los trabajos de impresión al cobrar una orden.
 * Toma < 50 ms en base de datos; la respuesta HTTP no espera al cabezal térmico.
 */
export function enqueueOrderPrintJobs(
  rawDb: Database.Database,
  orderId: string
): EnqueueOrderPrintJobsResult {
  const now = Date.now();
  const { order, lines, kitchenLines } = loadOrderReceiptDataFromDb(rawDb, orderId);

  // 1. Generar Nota de Entrega para Caja (TicketIR y Buffer ESC/POS)
  const receiptIR = buildReceiptTicketIR(order, lines);
  const cajaConfig = getPrinterConfig(rawDb, 'print_caja_usb');
  const receiptBytes = Buffer.from(renderTicketToEscPos(receiptIR, cajaConfig));

  const cajaJobId = `pjob_${generateUuidV7()}`;
  rawDb.prepare(`
    INSERT INTO print_jobs (
      id, printer_id, order_id, job_type, payload_bytes,
      ticket_ir_json, station, status, attempts, created_at_ms
    ) VALUES (?, 'print_caja_usb', ?, 'NOTA_ENTREGA', ?, ?, 'caja', 'en_cola', 0, ?)
  `).run(cajaJobId, orderId, receiptBytes, JSON.stringify(receiptIR), now);

  // 2. Generar Comandas de Cocina por Estación
  const kitchenIRs = buildKitchenTicketIRs({ order, kitchenLines });
  const kitchenJobIds: string[] = [];
  const cocinaConfig = getPrinterConfig(rawDb, 'print_cocina');

  for (const kIR of kitchenIRs) {
    const kJobId = `pjob_${generateUuidV7()}`;
    const kBytes = Buffer.from(renderTicketToEscPos(kIR, cocinaConfig));
    const station = kIR.title?.toLowerCase().includes('hot dog') ? 'hot_dogs' : 'hamburguesas';

    rawDb.prepare(`
      INSERT INTO print_jobs (
        id, printer_id, order_id, job_type, payload_bytes,
        ticket_ir_json, station, status, attempts, created_at_ms
      ) VALUES (?, 'print_cocina', ?, 'TICKET_COCINA', ?, ?, ?, 'en_cola', 0, ?)
    `).run(kJobId, orderId, kBytes, JSON.stringify(kIR), station, now);

    kitchenJobIds.push(kJobId);
  }

  return {
    cajaJobId,
    kitchenJobIds
  };
}

/**
 * Reimpresión manual: exige motivo y PIN de cajera, supervisor o admin (rechaza cocinero)
 */
export interface ReprintJobInput {
  jobId: string;
  pin: string;
  reason: string;
}

export function reprintPrintJob(
  rawDb: Database.Database,
  input: ReprintJobInput
): { success: boolean; newJobId: string } {
  // 1. Validar PIN
  const auth = authenticateByPin(rawDb, input.pin);
  if (!auth.authenticated || !auth.user) {
    throw new Error('PIN inválido para autorizar reimpresión');
  }

  // Bloqueado para cocinero: solo cajera, supervisor o admin
  if (auth.user.role === 'cocinero') {
    throw new Error('Rol no autorizado para reimprimir tickets (cocinero no permitido)');
  }

  const job = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(input.jobId) as PrintJobRow | undefined;
  if (!job) {
    throw new Error(`Trabajo de impresión ${input.jobId} no encontrado`);
  }

  if (!job.ticket_ir_json) {
    throw new Error('El trabajo original no posee especificación Ticket IR para reimpresión');
  }

  const originalIR = JSON.parse(job.ticket_ir_json) as TicketIR;
  const newReprintCount = (job.reprint_count || 0) + 1;
  const reprintedIR = buildReprintTicketIR(originalIR, newReprintCount, input.reason, auth.user.name);
  const pConfig = getPrinterConfig(rawDb, job.printer_id);
  const newBytes = Buffer.from(renderTicketToEscPos(reprintedIR, pConfig));

  const now = Date.now();
  const newJobId = `pjob_${generateUuidV7()}`;

  rawDb.prepare(`
    INSERT INTO print_jobs (
      id, printer_id, order_id, job_type, payload_bytes,
      ticket_ir_json, station, status, attempts, reprint_count,
      reprint_reason, reprinted_by_user_id, created_at_ms
    ) VALUES (?, ?, ?, 'REIMPRESION', ?, ?, ?, 'en_cola', 0, ?, ?, ?, ?)
  `).run(
    newJobId,
    job.printer_id,
    job.order_id,
    newBytes,
    JSON.stringify(reprintedIR),
    job.station,
    newReprintCount,
    input.reason,
    auth.user.id,
    now
  );

  appendAuditEvent(rawDb, {
    actorUserId: auth.user.id,
    action: 'PRINT_JOB_REPRINTED',
    entityType: 'print_job',
    entityId: newJobId,
    payload: {
      originalJobId: job.id,
      reprintCount: newReprintCount,
      reason: input.reason
    }
  });

  return { success: true, newJobId };
}

/**
 * Resolver estado 'requiere_atencion': 'mark_printed' o 'retry_now'
 */
export function resolveAttentionJob(
  rawDb: Database.Database,
  jobId: string,
  action: 'mark_printed' | 'retry_now'
): { success: boolean; status: string } {
  const job = rawDb.prepare('SELECT * FROM print_jobs WHERE id = ?').get(jobId) as PrintJobRow | undefined;
  if (!job) {
    throw new Error(`Trabajo de impresión ${jobId} no encontrado`);
  }

  const now = Date.now();
  if (action === 'mark_printed') {
    rawDb.prepare(`
      UPDATE print_jobs
      SET status = 'impreso', completed_at_ms = ?, error_message = NULL
      WHERE id = ?
    `).run(now, jobId);
    return { success: true, status: 'impreso' };
  } else {
    rawDb.prepare(`
      UPDATE print_jobs
      SET status = 'en_cola', attempts = 0, error_message = NULL
      WHERE id = ?
    `).run(jobId);
    return { success: true, status: 'en_cola' };
  }
}

/**
 * Reposición urgente sin cobro (Re-fire)
 */
export function createRefirePrintJob(
  rawDb: Database.Database,
  orderId: string,
  reason: string,
  pin: string
): { success: boolean; newJobId: string } {
  const auth = authenticateByPin(rawDb, pin);
  if (!auth.authenticated || !auth.user) {
    throw new Error('PIN inválido para autorizar reposición urgente');
  }

  const { order, kitchenLines } = loadOrderReceiptDataFromDb(rawDb, orderId);
  const refireIR = buildRefireTicketIR(order, kitchenLines, reason);
  const cocinaConfig = getPrinterConfig(rawDb, 'print_cocina');
  const refireBytes = Buffer.from(renderTicketToEscPos(refireIR, cocinaConfig));

  const now = Date.now();
  const newJobId = `pjob_${generateUuidV7()}`;

  rawDb.prepare(`
    INSERT INTO print_jobs (
      id, printer_id, order_id, job_type, payload_bytes,
      ticket_ir_json, station, status, attempts, created_at_ms
    ) VALUES (?, 'print_cocina', ?, 'REPOSICION_COCINA', ?, ?, 'cocina', 'en_cola', 0, ?)
  `).run(newJobId, orderId, refireBytes, JSON.stringify(refireIR), now);

  // Reactivar orden y líneas en KDS
  rawDb.prepare(`
    UPDATE orders
    SET fulfillment_status = 'en_preparacion',
        station_status_hot_dogs = CASE WHEN station_status_hot_dogs = 'na' THEN 'na' ELSE 'en_preparacion' END,
        station_status_hamburguesas = CASE WHEN station_status_hamburguesas = 'na' THEN 'na' ELSE 'en_preparacion' END,
        updated_at_ms = ?
    WHERE id = ?
  `).run(now, orderId);

  rawDb.prepare(`
    UPDATE order_lines
    SET status = 'pendiente',
        prepared_at_ms = NULL,
        ready_at_ms = NULL
    WHERE order_id = ? AND line_role IN ('STANDARD', 'COMBO_CHILD', 'COURTESY_ITEM') AND station != 'caja_bebidas'
  `).run(orderId);

  appendAuditEvent(rawDb, {
    actorUserId: auth.user.id,
    action: 'KITCHEN_REFIRE_CREATED',
    entityType: 'order',
    entityId: orderId,
    payload: {
      newJobId,
      reason
    }
  });

  publishDomainEvent(rawDb, {
    eventType: 'KDS_ORDER_REFIRE',
    entityId: orderId,
    payload: {
      orderId,
      orderNumber: order.orderNumber,
      reason,
      isRefire: true
    }
  });

  return { success: true, newJobId };
}
