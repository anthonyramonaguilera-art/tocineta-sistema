import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { appendAuditEvent } from '../audit/audit-service.js';
import {
  getPayrollSettings,
  getPayrollProfile,
  listPayrollAdjustments,
  listStaffConsumptions,
  type SettlementInput
} from './payroll-service.js';

/**
 * Previsualización de liquidación antes de emitir
 */
export function previewSettlement(rawDb: Database.Database, userId: string) {
  const user = rawDb.prepare('SELECT id, name, role FROM users WHERE id = ?').get(userId) as any;
  if (!user) throw new Error('Usuario no encontrado');

  const profile = getPayrollProfile(rawDb, userId);
  const baseSalaryUsdCents = profile?.base_salary_usd_cents || 0;
  const frequency = profile?.frequency || 'SEMANAL';

  const adjustments = listPayrollAdjustments(rawDb, userId, true);
  const bonuses = adjustments.filter(a => a.type === 'BONO');
  const advances = adjustments.filter(a => a.type === 'ADELANTO');

  const totalBonusesUsdCents = bonuses.reduce((acc, b) => acc + b.amount_usd_cents, 0);
  const totalAdvancesUsdCents = advances.reduce((acc, a) => acc + a.amount_usd_cents, 0);

  const consumptions = listStaffConsumptions(rawDb, userId, true);
  const fixedDinners = consumptions.filter(c => c.is_fixed_dinner === 1);
  const additionalConsumptions = consumptions.filter(c => c.is_fixed_dinner === 0);

  const settings = getPayrollSettings(rawDb);

  return {
    user: { id: user.id, name: user.name, role: user.role },
    frequency,
    baseSalaryUsdCents,
    bonuses,
    totalBonusesUsdCents,
    advances,
    totalAdvancesUsdCents,
    fixedDinners,
    fixedDinnersCount: fixedDinners.length,
    fixedDinnerCostUsdCents: settings.fixedDinnerCostUsdCents,
    additionalConsumptions
  };
}

/**
 * Ejecutar liquidación de nómina con selección de consumos a cobrar o perdonar
 * Fórmula Canónica: Neto = Base + Bonos - Adelantos - Consumos Adicionales Cobrados
 */
export function executeSettlement(rawDb: Database.Database, input: SettlementInput) {
  const preview = previewSettlement(rawDb, input.userId);
  const now = Date.now();
  const settlementId = `settle_${generateUuidV7()}`;

  const rateMicroBs = input.rateMicroBs || 40_000_000;
  const exchangeRate = rateMicroBs / 1_000_000;

  const chargedConsumptions = preview.additionalConsumptions.filter(c =>
    input.chargedConsumptionIds.includes(c.id)
  );
  const forgivenConsumptions = preview.additionalConsumptions.filter(c =>
    input.forgivenConsumptionIds.includes(c.id)
  );

  const consumptionsChargedUsdCents = chargedConsumptions.reduce((acc, c) => acc + c.amount_usd_cents, 0);
  const consumptionsForgivenUsdCents = forgivenConsumptions.reduce((acc, c) => acc + c.amount_usd_cents, 0);

  const netUsdCents = input.baseSalaryUsdCents + preview.totalBonusesUsdCents - preview.totalAdvancesUsdCents - consumptionsChargedUsdCents;
  const netBsCents = Math.round(netUsdCents * exchangeRate);

  const settings = getPayrollSettings(rawDb);
  const fixedDinnerTotalCost = preview.fixedDinnersCount * settings.fixedDinnerCostUsdCents;

  const tx = rawDb.transaction(() => {
    if (preview.fixedDinnersCount > 0 && settings.fixedDinnerEnabled && fixedDinnerTotalCost > 0) {
      rawDb.prepare(`
        INSERT INTO operating_expenses (
          id, location_id, jornada_id, category, amount_usd_cents,
          amount_bs_cents, payment_method, description, authorized_by_user_id, created_at_ms
        ) VALUES (?, 'loc_alta_vista', 'jor_activa', 'ALIMENTACION_PERSONAL', ?, ?, 'INTERNO', ?, ?, ?)
      `).run(
        `exp_dinner_${generateUuidV7()}`,
        fixedDinnerTotalCost,
        Math.round(fixedDinnerTotalCost * exchangeRate),
        `Cenas del personal (${preview.fixedDinnersCount} cenas) - ${preview.user.name}`,
        input.settledByUserId,
        now
      );
    }

    rawDb.prepare(`
      INSERT INTO staff_payroll_settlements (
        id, user_id, period_start_ms, period_end_ms, frequency, base_salary_usd_cents,
        bonuses_usd_cents, advances_usd_cents, consumptions_charged_usd_cents,
        consumptions_forgiven_usd_cents, fixed_dinner_count, fixed_dinner_cost_usd_cents,
        net_usd_cents, net_bs_cents, rate_micro_bs, payment_method, notes,
        settled_by_user_id, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      settlementId,
      input.userId,
      input.periodStartMs,
      input.periodEndMs,
      input.frequency,
      input.baseSalaryUsdCents,
      preview.totalBonusesUsdCents,
      preview.totalAdvancesUsdCents,
      consumptionsChargedUsdCents,
      consumptionsForgivenUsdCents,
      preview.fixedDinnersCount,
      fixedDinnerTotalCost,
      netUsdCents,
      netBsCents,
      rateMicroBs,
      input.paymentMethod,
      input.notes || null,
      input.settledByUserId,
      now
    );

    for (const adj of [...preview.bonuses, ...preview.advances]) {
      rawDb.prepare(`
        UPDATE staff_payroll_adjustments SET settlement_id = ? WHERE id = ?
      `).run(settlementId, adj.id);
    }

    for (const c of chargedConsumptions) {
      rawDb.prepare(`
        UPDATE staff_consumptions SET settlement_id = ?, status = 'COBRADO' WHERE id = ?
      `).run(settlementId, c.id);
    }
    for (const c of forgivenConsumptions) {
      rawDb.prepare(`
        UPDATE staff_consumptions SET settlement_id = ?, status = 'PERDONADO' WHERE id = ?
      `).run(settlementId, c.id);
    }
    for (const d of preview.fixedDinners) {
      rawDb.prepare(`
        UPDATE staff_consumptions SET settlement_id = ?, status = 'PERDONADO' WHERE id = ?
      `).run(settlementId, d.id);
    }

    appendAuditEvent(rawDb, {
      actorUserId: input.settledByUserId,
      action: 'STAFF_PAYROLL_SETTLED',
      entityType: 'payroll_settlement',
      entityId: settlementId,
      payload: {
        userId: input.userId,
        userName: preview.user.name,
        netUsdCents,
        baseSalaryUsdCents: input.baseSalaryUsdCents,
        bonusesUsdCents: preview.totalBonusesUsdCents,
        advancesUsdCents: preview.totalAdvancesUsdCents,
        consumptionsChargedUsdCents
      }
    });
  });

  tx();

  return {
    settlementId,
    userId: input.userId,
    userName: preview.user.name,
    netUsdCents,
    netBsCents,
    rateMicroBs,
    baseSalaryUsdCents: input.baseSalaryUsdCents,
    bonusesUsdCents: preview.totalBonusesUsdCents,
    advancesUsdCents: preview.totalAdvancesUsdCents,
    consumptionsChargedUsdCents,
    consumptionsForgivenUsdCents,
    fixedDinnerCount: preview.fixedDinnersCount,
    fixedDinnerCostUsdCents: fixedDinnerTotalCost,
    createdAtMs: now
  };
}
