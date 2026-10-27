import type Database from 'better-sqlite3';
import {
  getReceivableDetail,
  listReceivables,
  type ReceivableRecord,
  type ReceivablePaymentRecord
} from './receivables-service.js';

export interface CustomerStatementReport {
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  totalOwedUsdCents: number;
  totalPaidUsdCents: number;
  currentBalanceUsdCents: number;
  accounts: ReceivableRecord[];
  payments: ReceivablePaymentRecord[];
}

/**
 * Generar recordatorio prellenado para WhatsApp
 */
export function generateWhatsAppReminder(
  rawDb: Database.Database,
  receivableId: string
): { message: string; url: string; customerPhone: string | null } {
  const account = getReceivableDetail(rawDb, receivableId);
  const balanceUsd = (account.balanceUsdCents / 100).toFixed(2);
  const dateFormatted = new Date(account.dueDateMs).toLocaleDateString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  const message = `Hola ${account.customerName}, le saludamos de TOCINETA. Le recordamos cordialmente que tiene un saldo pendiente de $${balanceUsd} USD correspondiente a "${account.concept}", con fecha límite el ${dateFormatted}. Quedamos atentos para registrar su abono o pago. ¡Muchas gracias!`;

  let cleanPhone = (account.customerPhone || '').replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = `58${cleanPhone.slice(1)}`;
  } else if (!cleanPhone.startsWith('58') && cleanPhone.length === 10) {
    cleanPhone = `58${cleanPhone}`;
  }

  const url = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;

  return {
    message,
    url,
    customerPhone: account.customerPhone
  };
}

/**
 * Obtener Estado de Cuenta completo de un cliente
 */
export function getCustomerStatement(
  rawDb: Database.Database,
  customerId: string
): CustomerStatementReport {
  const customer = rawDb.prepare('SELECT id, name, phone FROM customers WHERE id = ?').get(customerId) as any;
  if (!customer) {
    throw new Error(`Cliente '${customerId}' no encontrado`);
  }

  const accounts = listReceivables(rawDb, { customerId });
  const payments = rawDb.prepare(`
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
    WHERE customer_id = ?
    ORDER BY created_at_ms DESC
  `).all(customerId) as ReceivablePaymentRecord[];

  const totalOwed = accounts.reduce((acc, a) => acc + a.totalUsdCents, 0);
  const totalPaid = payments.reduce((acc, p) => acc + p.amountUsdCents, 0);
  const currentBalance = accounts.reduce((acc, a) => acc + a.balanceUsdCents, 0);

  return {
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phone,
    totalOwedUsdCents: totalOwed,
    totalPaidUsdCents: totalPaid,
    currentBalanceUsdCents: currentBalance,
    accounts,
    payments
  };
}
