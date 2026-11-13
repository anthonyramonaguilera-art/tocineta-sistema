import type Database from 'better-sqlite3';

export interface BtPrinterInfo {
  name: string;
  mac: string;
}

export interface TerminalCapabilities {
  bluetoothSpp: boolean;
}

export interface TerminalRegistration {
  lastSeenMs: number;
  label?: string;
  btPrinter?: BtPrinterInfo;
  capabilities: TerminalCapabilities;
}

export interface HeartbeatPayload {
  terminalId?: string;
  label?: string;
  btPrinter?: BtPrinterInfo;
  capabilities?: {
    bluetoothSpp?: boolean;
  };
}

export interface TerminalListItem {
  terminalId: string;
  label?: string;
  btPrinter?: BtPrinterInfo;
  lastSeenMs: number;
  alive: boolean;
}

/**
 * Registro en memoria de terminales activos y sus capacidades de hardware.
 */
export const terminalRegistry = new Map<string, TerminalRegistration>();

/**
 * Limpia el registro en memoria (útil para pruebas).
 */
export function clearTerminalRegistry(): void {
  terminalRegistry.clear();
}

/**
 * Registra o actualiza el latido de un terminal.
 * Si incluye btPrinter, hace upsert en la tabla printers.
 * Si cambia el label, actualiza también el nombre de la impresora asociada.
 */
export function recordHeartbeat(
  rawDb: Database.Database,
  terminalId: string,
  payload: HeartbeatPayload
): void {
  const existing = terminalRegistry.get(terminalId);
  const label = payload.label !== undefined ? payload.label : existing?.label;
  const btPrinter = payload.btPrinter !== undefined ? payload.btPrinter : existing?.btPrinter;
  const capabilities: TerminalCapabilities = {
    bluetoothSpp: payload.capabilities?.bluetoothSpp !== undefined
      ? Boolean(payload.capabilities.bluetoothSpp)
      : (existing?.capabilities?.bluetoothSpp ?? false)
  };

  terminalRegistry.set(terminalId, {
    lastSeenMs: Date.now(),
    label,
    btPrinter,
    capabilities
  });

  const labelPart = label && label.trim().length > 0 ? label.trim() : terminalId.slice(0, 6);
  const printerName = `Bluetooth ${labelPart}`;
  const printerId = `print_bt_${terminalId}`;

  if (payload.btPrinter) {
    rawDb.prepare(`
      INSERT INTO printers (
        id, name, connection_type, address, columns, codepage, has_cutter, has_buzzer, is_active, owner_terminal_id
      ) VALUES (
        ?, ?, 'CLIENT_BT', ?, 32, 16, 0, 0, 1, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        address = excluded.address,
        connection_type = 'CLIENT_BT',
        columns = excluded.columns,
        codepage = excluded.codepage,
        has_cutter = excluded.has_cutter,
        has_buzzer = excluded.has_buzzer,
        is_active = excluded.is_active,
        owner_terminal_id = excluded.owner_terminal_id
    `).run(printerId, printerName, payload.btPrinter.mac, terminalId);
  } else if (payload.label !== undefined) {
    rawDb.prepare(`
      UPDATE printers
      SET name = ?
      WHERE id = ? OR owner_terminal_id = ?
    `).run(printerName, printerId, terminalId);
  }
}

/**
 * Determina si un terminal está vivo: último latido reciente Y tiene btPrinter.
 */
export function isTerminalAlive(
  terminalId: string,
  nowMs: number = Date.now(),
  ttlMs: number = 90_000
): boolean {
  const reg = terminalRegistry.get(terminalId);
  if (!reg) return false;
  if (!reg.btPrinter || !reg.btPrinter.mac) return false;
  const diff = nowMs - reg.lastSeenMs;
  return diff <= ttlMs && diff >= -1000;
}

/**
 * Obtiene el ID de la impresora asociada a un terminal en la base de datos.
 */
export function getTerminalPrinterId(rawDb: Database.Database, terminalId: string): string | null {
  const printerId = `print_bt_${terminalId}`;
  const row = rawDb.prepare(`
    SELECT id FROM printers
    WHERE id = ? OR owner_terminal_id = ?
    ORDER BY (CASE WHEN id = ? THEN 0 ELSE 1 END)
    LIMIT 1
  `).get(printerId, terminalId, printerId) as { id: string } | undefined;

  return row ? row.id : null;
}

/**
 * Devuelve la lista de terminales registrados en memoria con su estado de actividad.
 */
export function listTerminals(nowMs: number = Date.now()): TerminalListItem[] {
  const list: TerminalListItem[] = [];
  for (const [terminalId, reg] of terminalRegistry.entries()) {
    list.push({
      terminalId,
      label: reg.label,
      btPrinter: reg.btPrinter,
      lastSeenMs: reg.lastSeenMs,
      alive: isTerminalAlive(terminalId, nowMs)
    });
  }
  return list;
}
