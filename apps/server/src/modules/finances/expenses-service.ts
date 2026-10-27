import type Database from 'better-sqlite3';
import { generateUuidV7 } from '@tocineta/shared';

export interface ExpenseCategoryItem {
  id: string;
  name: string;
  isDefault: number;
  createdAtMs: number;
}

export interface CreateExpenseInput {
  locationId: string;
  jornadaId?: string;
  category: string;
  amountUsdCents: number;
  amountBsCents?: number;
  paymentMethod?: string;
  description: string;
  receiptPhotoPath?: string;
  isRecurring?: boolean;
  recurringInterval?: string;
  notes?: string;
  authorizedByUserId: string;
}

export interface ExpenseRecord {
  id: string;
  locationId: string;
  locationName?: string;
  jornadaId: string;
  category: string;
  amountUsdCents: number;
  amountBsCents: number;
  paymentMethod: string;
  description: string;
  authorizedByUserId: string;
  authorizedByName?: string;
  receiptPhotoPath: string | null;
  isRecurring: number;
  recurringInterval: string | null;
  notes: string | null;
  createdAtMs: number;
}

export interface ExpenseFilters {
  locationId?: string;
  startDateMs?: number;
  endDateMs?: number;
  category?: string;
  paymentMethod?: string;
}

/**
 * Obtener categorías de gastos activas
 */
export function getExpenseCategories(rawDb: Database.Database): ExpenseCategoryItem[] {
  return rawDb.prepare(`
    SELECT id, name, is_default as isDefault, created_at_ms as createdAtMs
    FROM expense_categories
    ORDER BY is_default DESC, name ASC
  `).all() as ExpenseCategoryItem[];
}

/**
 * Crear o asegurar existencia de una categoría de gasto
 */
export function createExpenseCategory(rawDb: Database.Database, name: string): ExpenseCategoryItem {
  const trimmed = name.trim().toUpperCase();
  if (!trimmed) {
    throw new Error('El nombre de la categoría no puede estar vacío');
  }

  const existing = rawDb.prepare('SELECT id, name, is_default as isDefault, created_at_ms as createdAtMs FROM expense_categories WHERE name = ?').get(trimmed) as ExpenseCategoryItem | undefined;
  if (existing) {
    return existing;
  }

  const id = `cat_exp_${generateUuidV7()}`;
  const now = Date.now();
  rawDb.prepare('INSERT INTO expense_categories (id, name, is_default, created_at_ms) VALUES (?, ?, 0, ?)').run(id, trimmed, now);
  return { id, name: trimmed, isDefault: 0, createdAtMs: now };
}

/**
 * Registrar un nuevo gasto operativo
 */
export function createExpense(rawDb: Database.Database, input: CreateExpenseInput): ExpenseRecord {
  if (input.amountUsdCents <= 0) {
    throw new Error('El monto del gasto debe ser mayor a cero');
  }

  // Buscar jornada activa para la sede si no se proporciona
  let targetJornadaId = input.jornadaId;
  if (!targetJornadaId) {
    const activeJornada = rawDb.prepare(`
      SELECT id FROM jornadas
      WHERE status = 'abierta' AND (location_id = ? OR location_id IS NULL)
      ORDER BY opened_at_ms DESC LIMIT 1
    `).get(input.locationId) as { id: string } | undefined;

    if (activeJornada) {
      targetJornadaId = activeJornada.id;
    } else {
      // Tomar la última jornada existente o fallback
      const lastJornada = rawDb.prepare('SELECT id FROM jornadas ORDER BY opened_at_ms DESC LIMIT 1').get() as { id: string } | undefined;
      targetJornadaId = lastJornada?.id || 'jornada_global';
    }
  }

  // Obtener tasa BCV actual para calcular Bs si no vino
  const rateRow = rawDb.prepare('SELECT rate_micro_bs FROM exchange_rates WHERE is_current = 1 ORDER BY created_at_ms DESC LIMIT 1').get() as any;
  const rateMicroBs = rateRow?.rate_micro_bs ?? 40_000_000;
  const amountBsCents = input.amountBsCents ?? Math.round((input.amountUsdCents * rateMicroBs) / 1_000_000);

  const id = `exp_${generateUuidV7()}`;
  const now = Date.now();
  const paymentMethod = input.paymentMethod || 'EFECTIVO_USD';
  const isRecurringInt = input.isRecurring ? 1 : 0;

  rawDb.prepare(`
    INSERT INTO operating_expenses (
      id, location_id, jornada_id, category, amount_usd_cents, amount_bs_cents,
      payment_method, description, authorized_by_user_id, receipt_photo_path,
      is_recurring, recurring_interval, notes, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.locationId,
    targetJornadaId,
    input.category.trim().toUpperCase(),
    input.amountUsdCents,
    amountBsCents,
    paymentMethod,
    input.description.trim(),
    input.authorizedByUserId,
    input.receiptPhotoPath || null,
    isRecurringInt,
    input.recurringInterval || null,
    input.notes ? input.notes.trim() : null,
    now
  );

  return {
    id,
    locationId: input.locationId,
    jornadaId: targetJornadaId,
    category: input.category.trim().toUpperCase(),
    amountUsdCents: input.amountUsdCents,
    amountBsCents,
    paymentMethod,
    description: input.description.trim(),
    authorizedByUserId: input.authorizedByUserId,
    receiptPhotoPath: input.receiptPhotoPath || null,
    isRecurring: isRecurringInt,
    recurringInterval: input.recurringInterval || null,
    notes: input.notes ? input.notes.trim() : null,
    createdAtMs: now
  };
}

/**
 * Listar gastos operativos con filtros
 */
export function listExpenses(rawDb: Database.Database, filters: ExpenseFilters = {}): ExpenseRecord[] {
  const conditions: string[] = ['1=1'];
  const params: any[] = [];

  if (filters.locationId) {
    conditions.push('oe.location_id = ?');
    params.push(filters.locationId);
  }
  if (filters.startDateMs) {
    conditions.push('oe.created_at_ms >= ?');
    params.push(filters.startDateMs);
  }
  if (filters.endDateMs) {
    conditions.push('oe.created_at_ms <= ?');
    params.push(filters.endDateMs);
  }
  if (filters.category) {
    conditions.push('oe.category = ?');
    params.push(filters.category.trim().toUpperCase());
  }
  if (filters.paymentMethod) {
    conditions.push('oe.payment_method = ?');
    params.push(filters.paymentMethod);
  }

  const query = `
    SELECT 
      oe.id,
      oe.location_id as locationId,
      l.name as locationName,
      oe.jornada_id as jornadaId,
      oe.category,
      oe.amount_usd_cents as amountUsdCents,
      oe.amount_bs_cents as amountBsCents,
      oe.payment_method as paymentMethod,
      oe.description,
      oe.authorized_by_user_id as authorizedByUserId,
      u.name as authorizedByName,
      oe.receipt_photo_path as receiptPhotoPath,
      oe.is_recurring as isRecurring,
      oe.recurring_interval as recurringInterval,
      oe.notes,
      oe.created_at_ms as createdAtMs
    FROM operating_expenses oe
    LEFT JOIN locations l ON oe.location_id = l.id
    LEFT JOIN users u ON oe.authorized_by_user_id = u.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY oe.created_at_ms DESC
  `;

  return rawDb.prepare(query).all(...params) as ExpenseRecord[];
}

/**
 * Eliminar gasto operativo
 */
export function deleteExpense(rawDb: Database.Database, id: string): boolean {
  const info = rawDb.prepare('DELETE FROM operating_expenses WHERE id = ?').run(id);
  return info.changes > 0;
}
