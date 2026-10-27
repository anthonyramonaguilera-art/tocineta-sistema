import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';

export interface PayableRecord {
  id: string;
  locationId: string;
  locationName: string;
  supplierId: string | null;
  supplierName: string;
  supplierRifPhone: string | null;
  invoiceNumber: string | null;
  paymentCondition: 'CONTADO' | 'CREDITO';
  status: 'PENDIENTE' | 'POR_VENCER' | 'VENCIDA' | 'PAGADA';
  totalUsdCents: number;
  totalBsCents: number;
  balanceOwedUsdCents: number;
  paidUsdCents: number;
  dueDateMs: number | null;
  isOverdue: boolean;
  isUpcomingDue: boolean; // Alerta <= 2 días
  daysUntilDue: number | null;
  notes: string | null;
  createdBy: string;
  createdAtMs: number;
}

export interface PayablePaymentInput {
  purchaseId: string;
  amountUsdCents: number;
  amountBsCents?: number;
  paymentMethod: string;
  referenceCode?: string;
  receiptPhotoPath?: string;
  notes?: string;
  paidBy: string;
}

export interface PayablePaymentRecord {
  id: string;
  purchaseId: string;
  supplierId: string;
  locationId: string;
  amountUsdCents: number;
  amountBsCents: number;
  exchangeRateMicroBs: number;
  paymentMethod: string;
  referenceCode: string | null;
  receiptPhotoPath: string | null;
  notes: string | null;
  paidBy: string;
  createdAtMs: number;
}

export interface PayableDetailReport {
  purchase: PayableRecord;
  items: Array<{
    id: string;
    supplyId: string;
    supplyName: string;
    quantity: number;
    unitCostUsdCents: number;
    subtotalUsdCents: number;
  }>;
  payments: PayablePaymentRecord[];
}

/**
 * Listar facturas de proveedores a crédito (Cuentas por Pagar) con alertas y filtros
 */
export function listPayables(
  rawDb: Database.Database,
  filters: { locationId?: string; supplierId?: string; status?: string; search?: string } = {}
): PayableRecord[] {
  const conditions: string[] = ["p.payment_condition = 'CREDITO'"];
  const params: any[] = [];
  const now = Date.now();
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;

  if (filters.locationId) {
    conditions.push('p.location_id = ?');
    params.push(filters.locationId);
  }
  if (filters.supplierId) {
    conditions.push('p.supplier_id = ?');
    params.push(filters.supplierId);
  }
  if (filters.search) {
    conditions.push('(s.name LIKE ? OR p.invoice_number LIKE ? OR p.notes LIKE ?)');
    const term = `%${filters.search.trim()}%`;
    params.push(term, term, term);
  }

  const query = `
    SELECT 
      p.id,
      p.location_id as locationId,
      l.name as locationName,
      p.supplier_id as supplierId,
      COALESCE(s.name, 'PROVEEDOR GENERAL') as supplierName,
      s.rif_phone as supplierRifPhone,
      p.invoice_number as invoiceNumber,
      p.payment_condition as paymentCondition,
      p.status,
      p.total_usd_cents as totalUsdCents,
      p.total_bs_cents as totalBsCents,
      p.balance_owed_usd_cents as balanceOwedUsdCents,
      (p.total_usd_cents - p.balance_owed_usd_cents) as paidUsdCents,
      p.due_date_ms as dueDateMs,
      p.notes,
      p.created_by as createdBy,
      p.created_at_ms as createdAtMs
    FROM purchases p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    LEFT JOIN locations l ON p.location_id = l.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY 
      CASE WHEN p.balance_owed_usd_cents > 0 THEN 0 ELSE 1 END ASC,
      p.due_date_ms ASC
  `;

  const rows = rawDb.prepare(query).all(...params) as any[];

  return rows.map(r => {
    const hasBalance = r.balanceOwedUsdCents > 0;
    const isOverdue = hasBalance && r.dueDateMs && r.dueDateMs < now;
    const diffMs = r.dueDateMs ? r.dueDateMs - now : null;
    const isUpcomingDue = hasBalance && diffMs !== null && diffMs >= 0 && diffMs <= twoDaysMs;
    const daysUntilDue = diffMs !== null ? Math.round(diffMs / (24 * 60 * 60 * 1000)) : null;

    let computedStatus: 'PENDIENTE' | 'POR_VENCER' | 'VENCIDA' | 'PAGADA' = 'PENDIENTE';
    if (!hasBalance) {
      computedStatus = 'PAGADA';
    } else if (isOverdue) {
      computedStatus = 'VENCIDA';
    } else if (isUpcomingDue) {
      computedStatus = 'POR_VENCER';
    } else {
      computedStatus = 'PENDIENTE';
    }

    return {
      ...r,
      status: computedStatus,
      isOverdue: Boolean(isOverdue),
      isUpcomingDue: Boolean(isUpcomingDue),
      daysUntilDue
    };
  }).filter(r => {
    if (!filters.status) return true;
    return r.status.toUpperCase() === filters.status.toUpperCase();
  });
}

/**
 * Obtener detalle completo de una cuenta por pagar
 */
export function getPayableDetail(rawDb: Database.Database, purchaseId: string): PayableDetailReport {
  const payables = listPayables(rawDb);
  const purchase = payables.find(p => p.id === purchaseId);
  if (!purchase) {
    throw new Error(`Cuenta por pagar '${purchaseId}' no encontrada`);
  }

  const items = rawDb.prepare(`
    SELECT 
      pi.id,
      pi.supply_id as supplyId,
      si.name as supplyName,
      pi.quantity,
      pi.unit_cost_usd_cents as unitCostUsdCents,
      pi.subtotal_usd_cents as subtotalUsdCents
    FROM purchase_items pi
    JOIN supply_items si ON pi.supply_id = si.id
    WHERE pi.purchase_id = ?
  `).all(purchaseId) as any[];

  const payments = rawDb.prepare(`
    SELECT 
      id,
      purchase_id as purchaseId,
      supplier_id as supplierId,
      location_id as locationId,
      amount_usd_cents as amountUsdCents,
      amount_bs_cents as amountBsCents,
      exchange_rate_micro_bs as exchangeRateMicroBs,
      payment_method as paymentMethod,
      reference_code as referenceCode,
      receipt_photo_path as receiptPhotoPath,
      notes,
      paid_by as paidBy,
      created_at_ms as createdAtMs
    FROM payable_payments
    WHERE purchase_id = ?
    ORDER BY created_at_ms DESC
  `).all(purchaseId) as PayablePaymentRecord[];

  return {
    purchase,
    items,
    payments
  };
}

/**
 * Registrar abono a una factura de proveedor por pagar
 */
export function addPayablePayment(
  rawDb: Database.Database,
  input: PayablePaymentInput
): { payment: PayablePaymentRecord; updatedPayable: PayableRecord } {
  if (input.amountUsdCents <= 0) {
    throw new Error('El monto del abono al proveedor debe ser mayor a cero');
  }

  const purchase = rawDb.prepare(`
    SELECT id, supplier_id, location_id, total_usd_cents, balance_owed_usd_cents
    FROM purchases
    WHERE id = ?
  `).get(input.purchaseId) as any;

  if (!purchase) {
    throw new Error(`Factura de compra '${input.purchaseId}' no encontrada`);
  }

  if (input.amountUsdCents > purchase.balance_owed_usd_cents) {
    throw new Error(
      `El abono ($${(input.amountUsdCents / 100).toFixed(2)}) supera el saldo pendiente ($${(purchase.balance_owed_usd_cents / 100).toFixed(2)})`
    );
  }

  const rateRow = rawDb.prepare('SELECT rate_micro_bs FROM exchange_rates WHERE is_current = 1 ORDER BY created_at_ms DESC LIMIT 1').get() as any;
  const rateMicroBs = rateRow?.rate_micro_bs ?? 40_000_000;
  const amountBsCents = input.amountBsCents ?? Math.round((input.amountUsdCents * rateMicroBs) / 1_000_000);

  const paymentId = `paypmt_${generateUuidV7()}`;
  const now = Date.now();
  const newBalance = purchase.balance_owed_usd_cents - input.amountUsdCents;
  const newStatus = newBalance === 0 ? 'PAGADA' : 'PARCIAL';

  rawDb.transaction(() => {
    // 1. Insertar abono a proveedor
    rawDb.prepare(`
      INSERT INTO payable_payments (
        id, purchase_id, supplier_id, location_id, amount_usd_cents,
        amount_bs_cents, exchange_rate_micro_bs, payment_method,
        reference_code, receipt_photo_path, notes, paid_by, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      paymentId,
      purchase.id,
      purchase.supplier_id || 'prov_general',
      purchase.location_id,
      input.amountUsdCents,
      amountBsCents,
      rateMicroBs,
      input.paymentMethod,
      input.referenceCode || null,
      input.receiptPhotoPath || null,
      input.notes ? input.notes.trim() : null,
      input.paidBy,
      now
    );

    // 2. Actualizar saldo en compras
    rawDb.prepare(`
      UPDATE purchases
      SET balance_owed_usd_cents = ?, status = ?
      WHERE id = ?
    `).run(newBalance, newStatus, purchase.id);
  })();

  const payment: PayablePaymentRecord = {
    id: paymentId,
    purchaseId: purchase.id,
    supplierId: purchase.supplier_id || 'prov_general',
    locationId: purchase.location_id,
    amountUsdCents: input.amountUsdCents,
    amountBsCents,
    exchangeRateMicroBs: rateMicroBs,
    paymentMethod: input.paymentMethod,
    referenceCode: input.referenceCode || null,
    receiptPhotoPath: input.receiptPhotoPath || null,
    notes: input.notes ? input.notes.trim() : null,
    paidBy: input.paidBy,
    createdAtMs: now
  };

  const payables = listPayables(rawDb);
  const updatedPayable = payables.find(p => p.id === purchase.id)!;

  return {
    payment,
    updatedPayable
  };
}
