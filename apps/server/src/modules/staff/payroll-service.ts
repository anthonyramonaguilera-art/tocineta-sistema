import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';
import { getDatabaseContext } from '../../db/connection.js';
import { previewSettlement, executeSettlement } from './settlement-service.js';
import { generateSettlementPdf as genPdf } from './payroll-pdf.js';

export { previewSettlement, executeSettlement } from './settlement-service.js';
export { generateSettlementPdf } from './payroll-pdf.js';

export interface PayrollSettings {
  payrollEnabled: boolean;
  fixedDinnerEnabled: boolean;
  fixedDinnerCostUsdCents: number;
}

export interface PayrollAdjustmentInput {
  userId: string;
  type: 'BONO' | 'ADELANTO';
  amountUsdCents: number;
  amountBsCents?: number;
  concept: string;
  createdByUserId: string;
}

export interface StaffConsumptionInput {
  userId: string;
  orderId?: string;
  concept: string;
  amountUsdCents: number;
  isFixedDinner?: boolean;
}

export interface SettlementInput {
  userId: string;
  periodStartMs: number;
  periodEndMs: number;
  frequency: 'DIARIO' | 'SEMANAL' | 'QUINCENAL';
  baseSalaryUsdCents: number;
  chargedConsumptionIds: string[];
  forgivenConsumptionIds: string[];
  paymentMethod: string;
  notes?: string;
  settledByUserId: string;
  rateMicroBs?: number;
}

/**
 * Obtener configuración global de nómina
 */
export function getPayrollSettings(rawDb: Database.Database): PayrollSettings {
  const row = rawDb.prepare(`
    SELECT payroll_enabled, fixed_dinner_enabled, fixed_dinner_cost_usd_cents
    FROM business_settings
    WHERE id = 'default'
  `).get() as any;

  return {
    payrollEnabled: Boolean(row?.payroll_enabled ?? 1),
    fixedDinnerEnabled: Boolean(row?.fixed_dinner_enabled ?? 1),
    fixedDinnerCostUsdCents: row?.fixed_dinner_cost_usd_cents ?? 250
  };
}

/**
 * Actualizar configuración global de nómina
 */
export function updatePayrollSettings(
  rawDb: Database.Database,
  settings: Partial<PayrollSettings>
): PayrollSettings {
  const current = getPayrollSettings(rawDb);
  const updated: PayrollSettings = {
    payrollEnabled: settings.payrollEnabled !== undefined ? settings.payrollEnabled : current.payrollEnabled,
    fixedDinnerEnabled: settings.fixedDinnerEnabled !== undefined ? settings.fixedDinnerEnabled : current.fixedDinnerEnabled,
    fixedDinnerCostUsdCents: settings.fixedDinnerCostUsdCents !== undefined ? settings.fixedDinnerCostUsdCents : current.fixedDinnerCostUsdCents
  };

  rawDb.prepare(`
    UPDATE business_settings
    SET payroll_enabled = ?, fixed_dinner_enabled = ?, fixed_dinner_cost_usd_cents = ?, updated_at_ms = ?
    WHERE id = 'default'
  `).run(
    updated.payrollEnabled ? 1 : 0,
    updated.fixedDinnerEnabled ? 1 : 0,
    updated.fixedDinnerCostUsdCents,
    Date.now()
  );

  return updated;
}

/**
 * Obtener o configurar perfil de nómina por empleado
 */
export function getPayrollProfile(rawDb: Database.Database, userId: string) {
  return rawDb.prepare(`
    SELECT * FROM staff_payroll_profiles WHERE user_id = ?
  `).get(userId) as any;
}

export function upsertPayrollProfile(
  rawDb: Database.Database,
  userId: string,
  data: { frequency: 'DIARIO' | 'SEMANAL' | 'QUINCENAL'; baseSalaryUsdCents: number; notes?: string }
) {
  const existing = getPayrollProfile(rawDb, userId);
  const now = Date.now();

  if (existing) {
    rawDb.prepare(`
      UPDATE staff_payroll_profiles
      SET frequency = ?, base_salary_usd_cents = ?, notes = ?, updated_at_ms = ?
      WHERE user_id = ?
    `).run(data.frequency, data.baseSalaryUsdCents, data.notes || null, now, userId);
  } else {
    rawDb.prepare(`
      INSERT INTO staff_payroll_profiles (id, user_id, frequency, base_salary_usd_cents, notes, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(`payprof_${generateUuidV7()}`, userId, data.frequency, data.baseSalaryUsdCents, data.notes || null, now, now);
  }

  return getPayrollProfile(rawDb, userId);
}

/**
 * Registrar ajuste (Bono o Adelanto)
 */
export function addPayrollAdjustment(rawDb: Database.Database, input: PayrollAdjustmentInput) {
  const id = `adj_${generateUuidV7()}`;
  const now = Date.now();

  rawDb.prepare(`
    INSERT INTO staff_payroll_adjustments (
      id, user_id, type, amount_usd_cents, amount_bs_cents, concept, created_by_user_id, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.userId,
    input.type,
    input.amountUsdCents,
    input.amountBsCents || 0,
    input.concept.trim(),
    input.createdByUserId,
    now
  );

  return { id, ...input, createdAtMs: now };
}

/**
 * Listar ajustes pendientes de liquidación
 */
export function listPayrollAdjustments(rawDb: Database.Database, userId: string, unsettledOnly = true) {
  const query = unsettledOnly
    ? 'SELECT * FROM staff_payroll_adjustments WHERE user_id = ? AND settlement_id IS NULL ORDER BY created_at_ms ASC'
    : 'SELECT * FROM staff_payroll_adjustments WHERE user_id = ? ORDER BY created_at_ms DESC';
  return rawDb.prepare(query).all(userId) as any[];
}

/**
 * Registrar consumo de empleado o cena fija
 */
export function addStaffConsumption(rawDb: Database.Database, input: StaffConsumptionInput) {
  const id = `cons_${generateUuidV7()}`;
  const now = Date.now();
  const isDinner = input.isFixedDinner ? 1 : 0;
  const settings = getPayrollSettings(rawDb);

  const initialStatus = (isDinner === 1 && settings.fixedDinnerEnabled) ? 'PERDONADO' : 'PENDIENTE';

  rawDb.prepare(`
    INSERT INTO staff_consumptions (
      id, user_id, order_id, concept, amount_usd_cents, is_fixed_dinner, status, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.userId,
    input.orderId || null,
    input.concept.trim(),
    input.amountUsdCents,
    isDinner,
    initialStatus,
    now
  );

  return { id, ...input, status: initialStatus, createdAtMs: now };
}

/**
 * Listar consumos de empleado
 */
export function listStaffConsumptions(rawDb: Database.Database, userId: string, unsettledOnly = true) {
  const query = unsettledOnly
    ? 'SELECT * FROM staff_consumptions WHERE user_id = ? AND settlement_id IS NULL ORDER BY created_at_ms ASC'
    : 'SELECT * FROM staff_consumptions WHERE user_id = ? ORDER BY created_at_ms DESC';
  return rawDb.prepare(query).all(userId) as any[];
}

export class PayrollService {
  static async getPayrollSettings() {
    return getPayrollSettings(getDatabaseContext().rawDb);
  }
  static async updatePayrollSettings(settings: Partial<PayrollSettings>) {
    return updatePayrollSettings(getDatabaseContext().rawDb, settings);
  }
  static async getProfile(userId: string) {
    return getPayrollProfile(getDatabaseContext().rawDb, userId);
  }
  static async upsertProfile(data: { userId: string; salaryScheme: 'DIARIO' | 'SEMANAL' | 'QUINCENAL'; baseSalaryUsdCents: number; fixedDinnerAllowed?: boolean }) {
    return upsertPayrollProfile(getDatabaseContext().rawDb, data.userId, {
      frequency: data.salaryScheme,
      baseSalaryUsdCents: data.baseSalaryUsdCents
    });
  }
  static async createAdjustment(input: { userId: string; adjustmentType: 'BONO' | 'ADELANTO'; amountUsdCents: number; reason: string; createdByUserId: string }) {
    return addPayrollAdjustment(getDatabaseContext().rawDb, {
      userId: input.userId,
      type: input.adjustmentType,
      amountUsdCents: input.amountUsdCents,
      concept: input.reason,
      createdByUserId: input.createdByUserId
    });
  }
  static async getPendingAdjustments(userId: string) {
    return listPayrollAdjustments(getDatabaseContext().rawDb, userId, true);
  }
  static async recordConsumption(input: { userId: string; itemDescription: string; amountUsdCents?: number; isFixedDinner?: boolean; orderId?: string; recordedByUserId: string }) {
    return addStaffConsumption(getDatabaseContext().rawDb, {
      userId: input.userId,
      orderId: input.orderId,
      concept: input.itemDescription,
      amountUsdCents: input.amountUsdCents || 0,
      isFixedDinner: input.isFixedDinner
    });
  }
  static async getPendingConsumptions(userId: string) {
    return listStaffConsumptions(getDatabaseContext().rawDb, userId, true);
  }
  static async calculateSettlementPreview(input: { userId: string; periodStartMs: number; periodEndMs: number; chargedConsumptionIds: string[] }) {
    const preview = previewSettlement(getDatabaseContext().rawDb, input.userId);
    const charged = preview.additionalConsumptions.filter(c => input.chargedConsumptionIds.includes(c.id));
    const chargedUsd = charged.reduce((acc, c) => acc + c.amount_usd_cents, 0);
    const netUsdCents = preview.baseSalaryUsdCents + preview.totalBonusesUsdCents - preview.totalAdvancesUsdCents - chargedUsd;
    return {
      ...preview,
      chargedConsumptionsUsdCents: chargedUsd,
      netUsdCents
    };
  }
  static async executeSettlement(input: { userId: string; periodStartMs: number; periodEndMs: number; chargedConsumptionIds: string[]; notes?: string; processedByUserId: string }) {
    const preview = previewSettlement(getDatabaseContext().rawDb, input.userId);
    const forgivenIds = preview.additionalConsumptions
      .filter(c => !input.chargedConsumptionIds.includes(c.id))
      .map(c => c.id);

    return executeSettlement(getDatabaseContext().rawDb, {
      userId: input.userId,
      periodStartMs: input.periodStartMs,
      periodEndMs: input.periodEndMs,
      frequency: preview.frequency as any,
      baseSalaryUsdCents: preview.baseSalaryUsdCents,
      chargedConsumptionIds: input.chargedConsumptionIds,
      forgivenConsumptionIds: forgivenIds,
      paymentMethod: 'EFECTIVO_USD',
      notes: input.notes,
      settledByUserId: input.processedByUserId
    });
  }
  static async listSettlements(userId?: string) {
    const rawDb = getDatabaseContext().rawDb;
    const query = userId
      ? 'SELECT s.*, u.name as user_name FROM staff_payroll_settlements s JOIN users u ON s.user_id = u.id WHERE s.user_id = ? ORDER BY s.created_at_ms DESC'
      : 'SELECT s.*, u.name as user_name FROM staff_payroll_settlements s JOIN users u ON s.user_id = u.id ORDER BY s.created_at_ms DESC';
    return userId ? rawDb.prepare(query).all(userId) : rawDb.prepare(query).all();
  }
  static async generateSettlementPdf(settlementId: string): Promise<Buffer> {
    return genPdf(getDatabaseContext().rawDb, settlementId);
  }
}
