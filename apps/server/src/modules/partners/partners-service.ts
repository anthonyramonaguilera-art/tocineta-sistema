import type Database from 'better-sqlite3';
import { usdToBsCents, formatMicroBsToRate } from '@tocineta/shared';
import { ensureBusinessSettingsDefensive } from '../../db/business-settings.js';

export interface CreatePartnerInput {
  name: string;
  docId?: string;
  phone?: string;
  email?: string;
  sharePercentage: number;
  notes?: string;
}

export interface RegisterTransactionInput {
  partnerId: string;
  type: 'APORTE' | 'RETIRO_UTILIDADES' | 'REPARTO_DIVIDENDOS';
  amountUsdCents: number;
  paymentMethod?: string;
  notes?: string;
}

/**
 * Verifica si el módulo de socios está activo en business_settings
 */
export function isPartnersModuleEnabled(rawDb: Database.Database): boolean {
  const settings = ensureBusinessSettingsDefensive(rawDb);
  return Boolean(settings.partners_module_enabled);
}

/**
 * Obtiene la tasa BCV vigente
 */
function getCurrentRate(rawDb: Database.Database): number {
  const rateRow = rawDb.prepare(`
    SELECT rate_micro_bs FROM exchange_rates WHERE is_current = 1 ORDER BY created_at_ms DESC LIMIT 1
  `).get() as { rate_micro_bs: number } | undefined;
  return rateRow?.rate_micro_bs ?? 40_000_000;
}

/**
 * Listado de socios con sus totales acumulados y saldo actual
 */
export function listPartners(rawDb: Database.Database) {
  const isEnabled = isPartnersModuleEnabled(rawDb);
  if (!isEnabled) {
    return { enabled: false, partners: [], summary: { totalPartners: 0, totalCapitalUsdCents: 0, totalWithdrawnUsdCents: 0 } };
  }

  const partners = rawDb.prepare(`
    SELECT * FROM business_partners WHERE is_active = 1 ORDER BY share_percentage DESC, name ASC
  `).all() as any[];

  let totalCapitalUsdCents = 0;
  let totalWithdrawnUsdCents = 0;
  let totalBalanceUsdCents = 0;
  let totalShares = 0;

  const formatted = partners.map(p => {
    totalCapitalUsdCents += p.total_capital_contributed_usd_cents;
    totalWithdrawnUsdCents += p.total_withdrawn_usd_cents;
    totalBalanceUsdCents += p.current_balance_usd_cents;
    totalShares += p.share_percentage;

    return {
      ...p,
      sharePercentageFormatted: `${p.share_percentage}%`
    };
  });

  return {
    enabled: true,
    partners: formatted,
    summary: {
      totalPartners: partners.length,
      totalShares,
      totalCapitalUsdCents,
      totalWithdrawnUsdCents,
      totalBalanceUsdCents
    }
  };
}

/**
 * Detalle de un socio con su historial de transacciones
 */
export function getPartnerById(rawDb: Database.Database, id: string) {
  const partner = rawDb.prepare('SELECT * FROM business_partners WHERE id = ?').get(id) as any;
  if (!partner) return null;

  const transactions = rawDb.prepare(`
    SELECT t.*, u.name as registered_by_name
    FROM partner_transactions t
    LEFT JOIN users u ON t.registered_by_user_id = u.id
    WHERE t.partner_id = ?
    ORDER BY t.created_at_ms DESC
  `).all(id) as any[];

  return {
    ...partner,
    transactions: transactions.map(t => ({
      ...t,
      amountBsCents: usdToBsCents(t.amount_usd_cents, t.rate_micro_bs),
      rateFormatted: formatMicroBsToRate(t.rate_micro_bs)
    }))
  };
}

/**
 * Registrar o crear nuevo socio
 */
export function createPartner(rawDb: Database.Database, input: CreatePartnerInput) {
  const now = Date.now();
  const id = `partner_${now}_${Math.random().toString(36).substring(2, 7)}`;

  // Validar porcentaje total
  const sumRow = rawDb.prepare('SELECT SUM(share_percentage) as total FROM business_partners WHERE is_active = 1').get() as { total: number };
  const currentTotal = sumRow?.total ?? 0;
  if (currentTotal + input.sharePercentage > 100.01) {
    throw new Error(`La suma de porcentajes de socios excede el 100% (actual: ${currentTotal}%, intentando sumar: ${input.sharePercentage}%)`);
  }

  rawDb.prepare(`
    INSERT INTO business_partners (
      id, name, doc_id, phone, email, share_percentage,
      total_capital_contributed_usd_cents, total_withdrawn_usd_cents, current_balance_usd_cents,
      is_active, notes, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 1, ?, ?, ?)
  `).run(
    id, input.name.trim(), input.docId?.trim() || (input as any).dni?.trim() || null, input.phone?.trim() || null,
    input.email?.trim() || null, input.sharePercentage, input.notes?.trim() || null,
    now, now
  );

  return getPartnerById(rawDb, id);
}

/**
 * Actualizar socio
 */
export function updatePartner(rawDb: Database.Database, id: string, input: Partial<CreatePartnerInput>) {
  const existing = rawDb.prepare('SELECT * FROM business_partners WHERE id = ?').get(id) as any;
  if (!existing) throw new Error('Socio no encontrado');

  const now = Date.now();
  const name = input.name ? input.name.trim() : existing.name;
  const docId = input.docId !== undefined ? (input.docId?.trim() || null) : existing.doc_id;
  const phone = input.phone !== undefined ? (input.phone?.trim() || null) : existing.phone;
  const email = input.email !== undefined ? (input.email?.trim() || null) : existing.email;
  const sharePercentage = input.sharePercentage !== undefined ? input.sharePercentage : existing.share_percentage;
  const notes = input.notes !== undefined ? (input.notes?.trim() || null) : existing.notes;

  rawDb.prepare(`
    UPDATE business_partners
    SET name = ?, doc_id = ?, phone = ?, email = ?, share_percentage = ?, notes = ?, updated_at_ms = ?
    WHERE id = ?
  `).run(name, docId, phone, email, sharePercentage, notes, now, id);

  return getPartnerById(rawDb, id);
}

/**
 * Registrar aporte de capital o retiro a cuenta de utilidades
 */
export function registerPartnerTransaction(
  rawDb: Database.Database,
  input: RegisterTransactionInput,
  userId: string
) {
  const partner = rawDb.prepare('SELECT * FROM business_partners WHERE id = ?').get(input.partnerId) as any;
  if (!partner) throw new Error('Socio no encontrado');
  if (input.amountUsdCents <= 0) throw new Error('El monto debe ser mayor a cero');

  const now = Date.now();
  const txId = `ptx_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const rateMicroBs = getCurrentRate(rawDb);
  const amountBsCents = usdToBsCents(input.amountUsdCents, rateMicroBs);

  return rawDb.transaction(() => {
    // 1. Insertar transacción
    rawDb.prepare(`
      INSERT INTO partner_transactions (
        id, partner_id, type, amount_usd_cents, amount_bs_cents,
        rate_micro_bs, payment_method, notes, registered_by_user_id, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      txId, input.partnerId, input.type, input.amountUsdCents, amountBsCents,
      rateMicroBs, input.paymentMethod || 'EFECTIVO_USD', input.notes?.trim() || null,
      userId, now
    );

    // 2. Actualizar saldos del socio
    if (input.type === 'APORTE') {
      rawDb.prepare(`
        UPDATE business_partners
        SET total_capital_contributed_usd_cents = total_capital_contributed_usd_cents + ?,
            current_balance_usd_cents = current_balance_usd_cents + ?,
            updated_at_ms = ?
        WHERE id = ?
      `).run(input.amountUsdCents, input.amountUsdCents, now, input.partnerId);
    } else if (input.type === 'RETIRO_UTILIDADES') {
      rawDb.prepare(`
        UPDATE business_partners
        SET total_withdrawn_usd_cents = total_withdrawn_usd_cents + ?,
            current_balance_usd_cents = current_balance_usd_cents - ?,
            updated_at_ms = ?
        WHERE id = ?
      `).run(input.amountUsdCents, input.amountUsdCents, now, input.partnerId);
    } else if (input.type === 'REPARTO_DIVIDENDOS') {
      rawDb.prepare(`
        UPDATE business_partners
        SET current_balance_usd_cents = current_balance_usd_cents + ?,
            updated_at_ms = ?
        WHERE id = ?
      `).run(input.amountUsdCents, now, input.partnerId);
    }

    return getPartnerById(rawDb, input.partnerId);
  })();
}

/**
 * Reparto masivo de dividendos por porcentaje oficial
 */
export function distributeProfitsEquitably(
  rawDb: Database.Database,
  totalDividendUsdCents: number,
  notes: string | undefined,
  userId: string
) {
  if (totalDividendUsdCents <= 0) throw new Error('El monto a repartir debe ser mayor a cero');

  const partners = rawDb.prepare('SELECT * FROM business_partners WHERE is_active = 1').all() as any[];
  if (partners.length === 0) throw new Error('No hay socios registrados para el reparto');

  const now = Date.now();
  const rateMicroBs = getCurrentRate(rawDb);

  return rawDb.transaction(() => {
    const distributions: any[] = [];

    for (const p of partners) {
      if (p.share_percentage <= 0) continue;
      const shareAmountUsdCents = Math.round((totalDividendUsdCents * p.share_percentage) / 100);
      const shareAmountBsCents = usdToBsCents(shareAmountUsdCents, rateMicroBs);
      const txId = `ptx_${now}_${p.id.substring(0, 8)}_${Math.random().toString(36).substring(2, 5)}`;

      rawDb.prepare(`
        INSERT INTO partner_transactions (
          id, partner_id, type, amount_usd_cents, amount_bs_cents,
          rate_micro_bs, payment_method, notes, registered_by_user_id, created_at_ms
        ) VALUES (?, ?, 'REPARTO_DIVIDENDOS', ?, ?, ?, 'DIVIDENDO_ACREDITADO', ?, ?, ?)
      `).run(
        txId, p.id, shareAmountUsdCents, shareAmountBsCents, rateMicroBs,
        notes || `Reparto de dividendos (${p.share_percentage}%)`, userId, now
      );

      rawDb.prepare(`
        UPDATE business_partners
        SET current_balance_usd_cents = current_balance_usd_cents + ?,
            updated_at_ms = ?
        WHERE id = ?
      `).run(shareAmountUsdCents, now, p.id);

      distributions.push({
        partnerId: p.id,
        partnerName: p.name,
        sharePercentage: p.share_percentage,
        amountUsdCents: shareAmountUsdCents,
        amountBsCents: shareAmountBsCents
      });
    }

    return {
      success: true,
      totalDistributedUsdCents: totalDividendUsdCents,
      distributions
    };
  })();
}
