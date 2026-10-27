import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';

export interface CreateReceivableInput {
  customerId: string;
  locationId: string;
  orderId?: string;
  concept: string;
  totalUsdCents: number;
  dueDateMs: number;
  notes?: string;
  createdBy: string;
}

export interface ReceivableRecord {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  customerIsPartner: number;
  locationId: string;
  locationName: string;
  orderId: string | null;
  concept: string;
  totalUsdCents: number;
  balanceUsdCents: number;
  paidUsdCents: number;
  dueDateMs: number;
  status: 'PENDIENTE' | 'PARCIAL' | 'PAGADA' | 'VENCIDA';
  isOverdue: boolean;
  notes: string | null;
  createdBy: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ReceivablePaymentInput {
  receivableId: string;
  amountUsdCents: number;
  amountBsCents?: number;
  paymentMethod: string;
  referenceCode?: string;
  receiptPhotoPath?: string;
  notes?: string;
  receivedBy: string;
}

export interface ReceivablePaymentRecord {
  id: string;
  receivableId: string;
  customerId: string;
  locationId: string;
  amountUsdCents: number;
  amountBsCents: number;
  exchangeRateMicroBs: number;
  paymentMethod: string;
  referenceCode: string | null;
  receiptPhotoPath: string | null;
  notes: string | null;
  receivedBy: string;
  createdAtMs: number;
}

/**
 * Crear cuenta por cobrar
 */
export function createReceivableAccount(
  rawDb: Database.Database,
  input: CreateReceivableInput
): ReceivableRecord {
  if (input.totalUsdCents <= 0) {
    throw new Error('El monto por cobrar debe ser mayor a cero');
  }

  const id = `rec_${generateUuidV7()}`;
  const now = Date.now();

  rawDb.transaction(() => {
    rawDb.prepare(`
      INSERT INTO receivable_accounts (
        id, customer_id, location_id, order_id, concept,
        total_usd_cents, balance_usd_cents, due_date_ms, status,
        notes, created_by, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?, ?)
    `).run(
      id,
      input.customerId,
      input.locationId,
      input.orderId || null,
      input.concept.trim(),
      input.totalUsdCents,
      input.totalUsdCents,
      input.dueDateMs,
      input.notes ? input.notes.trim() : null,
      input.createdBy,
      now,
      now
    );

    // Actualizar balance_receivable_usd_cents en tabla customers
    rawDb.prepare(`
      UPDATE customers
      SET balance_receivable_usd_cents = balance_receivable_usd_cents + ?
      WHERE id = ?
    `).run(input.totalUsdCents, input.customerId);
  })();

  return getReceivableDetail(rawDb, id);
}

/**
 * Listar cuentas por cobrar con filtros
 */
export function listReceivables(
  rawDb: Database.Database,
  filters: { locationId?: string; customerId?: string; status?: string; search?: string } = {}
): ReceivableRecord[] {
  const conditions: string[] = ['1=1'];
  const params: any[] = [];
  const now = Date.now();

  if (filters.locationId) {
    conditions.push('ra.location_id = ?');
    params.push(filters.locationId);
  }
  if (filters.customerId) {
    conditions.push('ra.customer_id = ?');
    params.push(filters.customerId);
  }
  if (filters.search) {
    conditions.push('(c.name LIKE ? OR ra.concept LIKE ? OR ra.notes LIKE ?)');
    const term = `%${filters.search.trim()}%`;
    params.push(term, term, term);
  }

  const query = `
    SELECT 
      ra.id,
      ra.customer_id as customerId,
      c.name as customerName,
      c.phone as customerPhone,
      c.is_partner as customerIsPartner,
      ra.location_id as locationId,
      l.name as locationName,
      ra.order_id as orderId,
      ra.concept,
      ra.total_usd_cents as totalUsdCents,
      ra.balance_usd_cents as balanceUsdCents,
      (ra.total_usd_cents - ra.balance_usd_cents) as paidUsdCents,
      ra.due_date_ms as dueDateMs,
      ra.status,
      ra.notes,
      ra.created_by as createdBy,
      ra.created_at_ms as createdAtMs,
      ra.updated_at_ms as updatedAtMs
    FROM receivable_accounts ra
    JOIN customers c ON ra.customer_id = c.id
    JOIN locations l ON ra.location_id = l.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY 
      CASE WHEN ra.balance_usd_cents > 0 THEN 0 ELSE 1 END ASC,
      ra.due_date_ms ASC
  `;

  const rows = rawDb.prepare(query).all(...params) as any[];

  return rows.map(r => {
    const isOverdue = r.balanceUsdCents > 0 && r.dueDateMs < now;
    let computedStatus = r.status;
    if (r.balanceUsdCents <= 0) {
      computedStatus = 'PAGADA';
    } else if (isOverdue) {
      computedStatus = 'VENCIDA';
    } else if (r.paidUsdCents > 0) {
      computedStatus = 'PARCIAL';
    }

    return {
      ...r,
      status: computedStatus,
      isOverdue
    };
  }).filter(r => {
    if (!filters.status) return true;
    return r.status.toUpperCase() === filters.status.toUpperCase();
  });
}

/**
 * Obtener detalle de una cuenta por cobrar
 */
export function getReceivableDetail(rawDb: Database.Database, id: string): ReceivableRecord {
  const now = Date.now();
  const r = rawDb.prepare(`
    SELECT 
      ra.id,
      ra.customer_id as customerId,
      c.name as customerName,
      c.phone as customerPhone,
      c.is_partner as customerIsPartner,
      ra.location_id as locationId,
      l.name as locationName,
      ra.order_id as orderId,
      ra.concept,
      ra.total_usd_cents as totalUsdCents,
      ra.balance_usd_cents as balanceUsdCents,
      (ra.total_usd_cents - ra.balance_usd_cents) as paidUsdCents,
      ra.due_date_ms as dueDateMs,
      ra.status,
      ra.notes,
      ra.created_by as createdBy,
      ra.created_at_ms as createdAtMs,
      ra.updated_at_ms as updatedAtMs
    FROM receivable_accounts ra
    JOIN customers c ON ra.customer_id = c.id
    JOIN locations l ON ra.location_id = l.id
    WHERE ra.id = ?
  `).get(id) as any;

  if (!r) {
    throw new Error(`Cuenta por cobrar '${id}' no encontrada`);
  }

  const isOverdue = r.balanceUsdCents > 0 && r.dueDateMs < now;
  let computedStatus = r.status;
  if (r.balanceUsdCents <= 0) {
    computedStatus = 'PAGADA';
  } else if (isOverdue) {
    computedStatus = 'VENCIDA';
  } else if (r.paidUsdCents > 0) {
    computedStatus = 'PARCIAL';
  }

  return {
    ...r,
    status: computedStatus,
    isOverdue
  };
}

/**
 * Registrar abono parcial o total a una cuenta por cobrar
 */
export function addReceivablePayment(
  rawDb: Database.Database,
  input: ReceivablePaymentInput
): { payment: ReceivablePaymentRecord; updatedAccount: ReceivableRecord } {
  if (input.amountUsdCents <= 0) {
    throw new Error('El monto del abono debe ser mayor a cero');
  }

  const account = rawDb.prepare(`
    SELECT id, customer_id, location_id, total_usd_cents, balance_usd_cents
    FROM receivable_accounts
    WHERE id = ?
  `).get(input.receivableId) as any;

  if (!account) {
    throw new Error(`Cuenta por cobrar '${input.receivableId}' no encontrada`);
  }

  if (input.amountUsdCents > account.balance_usd_cents) {
    throw new Error(
      `El abono ($${(input.amountUsdCents / 100).toFixed(2)}) supera el saldo pendiente ($${(account.balance_usd_cents / 100).toFixed(2)})`
    );
  }

  const rateRow = rawDb.prepare('SELECT rate_micro_bs FROM exchange_rates WHERE is_current = 1 ORDER BY created_at_ms DESC LIMIT 1').get() as any;
  const rateMicroBs = rateRow?.rate_micro_bs ?? 40_000_000;
  const amountBsCents = input.amountBsCents ?? Math.round((input.amountUsdCents * rateMicroBs) / 1_000_000);

  const paymentId = `pmt_${generateUuidV7()}`;
  const now = Date.now();

  const newBalance = account.balance_usd_cents - input.amountUsdCents;
  const newStatus = newBalance === 0 ? 'PAGADA' : 'PARCIAL';

  rawDb.transaction(() => {
    // 1. Insertar abono
    rawDb.prepare(`
      INSERT INTO receivable_payments (
        id, receivable_id, customer_id, location_id, amount_usd_cents,
        amount_bs_cents, exchange_rate_micro_bs, payment_method,
        reference_code, receipt_photo_path, notes, received_by, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      paymentId,
      account.id,
      account.customer_id,
      account.location_id,
      input.amountUsdCents,
      amountBsCents,
      rateMicroBs,
      input.paymentMethod,
      input.referenceCode || null,
      input.receiptPhotoPath || null,
      input.notes ? input.notes.trim() : null,
      input.receivedBy,
      now
    );

    // 2. Actualizar saldo en cuenta por cobrar
    rawDb.prepare(`
      UPDATE receivable_accounts
      SET balance_usd_cents = ?, status = ?, updated_at_ms = ?
      WHERE id = ?
    `).run(newBalance, newStatus, now, account.id);

    // 3. Actualizar balance general del cliente
    rawDb.prepare(`
      UPDATE customers
      SET balance_receivable_usd_cents = MAX(0, balance_receivable_usd_cents - ?)
      WHERE id = ?
    `).run(input.amountUsdCents, account.customer_id);
  })();

  const payment: ReceivablePaymentRecord = {
    id: paymentId,
    receivableId: account.id,
    customerId: account.customer_id,
    locationId: account.location_id,
    amountUsdCents: input.amountUsdCents,
    amountBsCents,
    exchangeRateMicroBs: rateMicroBs,
    paymentMethod: input.paymentMethod,
    referenceCode: input.referenceCode || null,
    receiptPhotoPath: input.receiptPhotoPath || null,
    notes: input.notes ? input.notes.trim() : null,
    receivedBy: input.receivedBy,
    createdAtMs: now
  };

  return {
    payment,
    updatedAccount: getReceivableDetail(rawDb, account.id)
  };
}

/**
 * Listar pagos de una cuenta por cobrar
 */
export function getReceivablePayments(
  rawDb: Database.Database,
  receivableId: string
): ReceivablePaymentRecord[] {
  return rawDb.prepare(`
    SELECT 
      id,
      receivable_id as receivableId,
      customer_id as customerId,
      location_id as locationId,
      amount_usd_cents as amountUsdCents,
      amount_bs_cents as amountBsCents,
      exchange_rate_micro_bs as exchangeRateMicroBs,
      payment_method as paymentMethod,
      reference_code as referenceCode,
      receipt_photo_path as receiptPhotoPath,
      notes,
      received_by as receivedBy,
      created_at_ms as createdAtMs
    FROM receivable_payments
    WHERE receivable_id = ?
    ORDER BY created_at_ms DESC
  `).all(receivableId) as ReceivablePaymentRecord[];
}

export {
  generateWhatsAppReminder,
  getCustomerStatement,
  type CustomerStatementReport
} from './receivables-statement.js';

