import type Database from 'better-sqlite3';
import { generateUuidV7, getDefaultPermissionsForRole } from '@tocineta/shared';
import { hashPin, validatePinFormat } from '../auth/pin.js';
import { hashPassword } from '../auth/seed-users.js';
import { appendAuditEvent } from '../audit/audit-service.js';
import { mapUserRow, type UserRole } from '../../db/schema.js';
import { getDatabaseContext } from '../../db/connection.js';

export interface CreateStaffUserInput {
  name: string;
  username: string;
  role: UserRole;
  pin: string;
  password?: string;
  cedula?: string;
  phone?: string;
  permissions?: string[];
  baseSalaryUsdCents?: number;
  frequency?: 'DIARIO' | 'SEMANAL' | 'QUINCENAL';
  authorizerUserId?: string;
}

export interface StaffUserItem {
  id: string;
  name: string;
  username: string | null;
  role: string;
  cedula: string | null;
  phone: string | null;
  approvalStatus: string;
  isActive: boolean;
  mustChangePin: boolean;
  permissions: string[];
  createdAtMs: number;
  payrollProfile?: {
    frequency: string;
    baseSalaryUsdCents: number;
    notes?: string | null;
  } | null;
}

/**
 * Listar trabajadores con sus permisos granulares y perfil de nómina
 */
export function listStaffUsers(rawDb: Database.Database): StaffUserItem[] {
  const rows = rawDb.prepare(`
    SELECT u.*, 
           p.frequency as payroll_frequency,
           p.base_salary_usd_cents as payroll_base_salary,
           p.notes as payroll_notes
    FROM users u
    LEFT JOIN staff_payroll_profiles p ON u.id = p.user_id
    ORDER BY 
      CASE u.role
        WHEN 'admin' THEN 1
        WHEN 'supervisor' THEN 2
        WHEN 'cajera' THEN 3
        WHEN 'mesonero' THEN 4
        WHEN 'cocinero' THEN 5
        ELSE 6
      END,
      u.name ASC
  `).all() as any[];

  return rows.map((r) => {
    const u = mapUserRow(r);
    let permissions: string[] = [];
    try {
      permissions = JSON.parse(r.permissions_json || '[]');
    } catch {
      permissions = [];
    }

    // Si no tiene permisos explícitos, reflejar los permisos por defecto de su rol
    if (permissions.length === 0) {
      permissions = getDefaultPermissionsForRole(u.role);
    }

    return {
      id: u.id,
      name: u.name,
      username: u.username,
      role: u.role,
      cedula: u.cedula || null,
      phone: u.phone || null,
      approvalStatus: u.approvalStatus,
      isActive: Boolean(u.isActive),
      mustChangePin: Boolean(u.mustChangePin),
      permissions,
      createdAtMs: u.createdAtMs,
      payrollProfile: r.payroll_frequency
        ? {
            frequency: r.payroll_frequency,
            baseSalaryUsdCents: r.payroll_base_salary || 0,
            notes: r.payroll_notes
          }
        : null
    };
  });
}

/**
 * Crear un empleado real con nombre, usuario único, rol, PIN y permisos
 */
export function createStaffUser(
  rawDb: Database.Database,
  input: CreateStaffUserInput
): StaffUserItem {
  const name = input.name.trim();
  const username = input.username.trim().toLowerCase();
  const pin = input.pin.trim();

  if (!name || name.length < 2) {
    throw new Error('El nombre real del empleado es obligatorio (mínimo 2 caracteres)');
  }

  if (!username || !/^[a-z0-9_.-]{3,30}$/.test(username)) {
    throw new Error('El nombre de usuario debe tener entre 3 y 30 caracteres alfanuméricos');
  }

  // Verificar unicidad de username
  const existing = rawDb.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(username);
  if (existing) {
    throw new Error(`El nombre de usuario '${username}' ya está en uso`);
  }

  const formatCheck = validatePinFormat(pin, input.role);
  if (!formatCheck.valid) {
    throw new Error(formatCheck.error || 'Formato de PIN inválido');
  }

  const { hash: pinHash, salt: pinSalt } = hashPin(pin);
  const passwordToUse = input.password?.trim() || `${pin}123`;
  const { hash: passwordHash, salt: passwordSalt } = hashPassword(passwordToUse);

  const permissions = Array.isArray(input.permissions) && input.permissions.length > 0
    ? input.permissions
    : getDefaultPermissionsForRole(input.role);

  const newUserId = `usr_${generateUuidV7()}`;
  const now = Date.now();

  const tx = rawDb.transaction(() => {
    rawDb.prepare(`
      INSERT INTO users (
        id, name, username, role, pin_hash, pin_salt, pin_length,
        password_hash, password_salt, must_change_pin, is_active,
        failed_attempts, lockout_stage, locked_until_ms, cedula, phone,
        approval_status, permissions_json, default_location_id,
        created_at_ms, updated_at_ms
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, 0, 1,
        0, 0, NULL, ?, ?,
        'APPROVED', ?, 'loc_alta_vista',
        ?, ?
      )
    `).run(
      newUserId,
      name,
      username,
      input.role,
      pinHash,
      pinSalt,
      pin.length,
      passwordHash,
      passwordSalt,
      input.cedula?.trim() || null,
      input.phone?.trim() || null,
      JSON.stringify(permissions),
      now,
      now
    );

    // Crear perfil de nómina inicial si se especificó salario base
    if (input.baseSalaryUsdCents !== undefined && input.baseSalaryUsdCents >= 0) {
      const profileId = `payprof_${generateUuidV7()}`;
      rawDb.prepare(`
        INSERT INTO staff_payroll_profiles (
          id, user_id, frequency, base_salary_usd_cents, notes, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        profileId,
        newUserId,
        input.frequency || 'SEMANAL',
        input.baseSalaryUsdCents,
        'Perfil inicial creado con el usuario',
        now,
        now
      );
    }

    appendAuditEvent(rawDb, {
      actorUserId: input.authorizerUserId || null,
      action: 'STAFF_USER_CREATED',
      entityType: 'user',
      entityId: newUserId,
      payload: { name, username, role: input.role, permissions }
    });
  });

  tx();

  return {
    id: newUserId,
    name,
    username,
    role: input.role,
    cedula: input.cedula || null,
    phone: input.phone || null,
    approvalStatus: 'APPROVED',
    isActive: true,
    mustChangePin: false,
    permissions,
    createdAtMs: now,
    payrollProfile: input.baseSalaryUsdCents !== undefined
      ? {
          frequency: input.frequency || 'SEMANAL',
          baseSalaryUsdCents: input.baseSalaryUsdCents,
          notes: 'Perfil inicial creado con el usuario'
        }
      : null
  };
}

/**
 * Modificar permisos de un trabajador
 */
export function updateStaffPermissions(
  rawDb: Database.Database,
  userId: string,
  permissions: string[],
  authorizerUserId?: string
): { success: boolean; permissions: string[] } {
  const targetUser = rawDb.prepare('SELECT id, name, role FROM users WHERE id = ?').get(userId) as any;
  if (!targetUser) {
    throw new Error('Usuario no encontrado');
  }

  const permissionsJson = JSON.stringify(permissions);
  const now = Date.now();

  rawDb.prepare(`
    UPDATE users SET permissions_json = ?, updated_at_ms = ? WHERE id = ?
  `).run(permissionsJson, now, userId);

  appendAuditEvent(rawDb, {
    actorUserId: authorizerUserId || null,
    action: 'STAFF_PERMISSIONS_UPDATED',
    entityType: 'user',
    entityId: userId,
    payload: { permissions, updatedBy: authorizerUserId }
  });

  return { success: true, permissions };
}

/**
 * Modificar rol de un trabajador
 */
export function updateStaffRole(
  rawDb: Database.Database,
  userId: string,
  newRole: UserRole,
  authorizerUserId?: string
): { success: boolean; role: string } {
  const targetUser = rawDb.prepare('SELECT id, name, role FROM users WHERE id = ?').get(userId) as any;
  if (!targetUser) {
    throw new Error('Usuario no encontrado');
  }

  if (targetUser.id === 'usr_admin' && newRole !== 'admin') {
    throw new Error('No se puede cambiar el rol del Administrador principal');
  }

  const now = Date.now();
  rawDb.prepare('UPDATE users SET role = ?, updated_at_ms = ? WHERE id = ?').run(newRole, now, userId);

  appendAuditEvent(rawDb, {
    actorUserId: authorizerUserId || null,
    action: 'STAFF_ROLE_UPDATED',
    entityType: 'user',
    entityId: userId,
    payload: { previousRole: targetUser.role, newRole, updatedBy: authorizerUserId }
  });

  return { success: true, role: newRole };
}

/**
 * Dar de baja o eliminar un trabajador
 */
export function deleteOrDeactivateStaffUser(
  rawDb: Database.Database,
  userId: string,
  authorizerUserId?: string
): { success: boolean; message: string } {
  const targetUser = rawDb.prepare('SELECT id, name, role FROM users WHERE id = ?').get(userId) as any;
  if (!targetUser) {
    throw new Error('Usuario no encontrado');
  }

  if (targetUser.id === 'usr_admin' || targetUser.role === 'admin') {
    throw new Error('No se puede eliminar al Administrador principal');
  }

  const now = Date.now();
  rawDb.prepare('UPDATE sessions SET revoked_at_ms = ? WHERE user_id = ?').run(now, userId);

  try {
    rawDb.prepare('DELETE FROM users WHERE id = ?').run(userId);
  } catch {
    // Si tiene constraints de FKs en órdenes o auditoría, desactivar de forma limpia
    rawDb.prepare(`
      UPDATE users 
      SET is_active = 0, approval_status = 'REJECTED', updated_at_ms = ? 
      WHERE id = ?
    `).run(now, userId);
  }

  appendAuditEvent(rawDb, {
    actorUserId: authorizerUserId || null,
    action: 'STAFF_USER_DELETED',
    entityType: 'user',
    entityId: userId,
    payload: { name: targetUser.name, role: targetUser.role }
  });

  return { success: true, message: `Usuario ${targetUser.name} dado de baja exitosamente` };
}

export class UsersService {
  static async listStaff() {
    return listStaffUsers(getDatabaseContext().rawDb);
  }
  static async createEmployee(input: {
    name: string;
    username?: string;
    role: UserRole;
    pin: string;
    password?: string;
    cedula?: string;
    phone?: string;
    permissions?: string[];
    createdByUser?: string;
    salaryScheme?: 'DIARIO' | 'SEMANAL' | 'QUINCENAL';
    baseSalaryUsdCents?: number;
  }) {
    const rawDb = getDatabaseContext().rawDb;
    const username = input.username?.trim() || input.name.trim().toLowerCase().replace(/\s+/g, '.');
    return createStaffUser(rawDb, {
      name: input.name,
      username,
      role: input.role,
      pin: input.pin,
      password: input.password,
      cedula: input.cedula,
      phone: input.phone,
      permissions: input.permissions,
      baseSalaryUsdCents: input.baseSalaryUsdCents,
      frequency: input.salaryScheme,
      authorizerUserId: input.createdByUser
    });
  }
  static async approveWorker(id: string, role?: UserRole, permissions?: string[], authorizerUserId?: string) {
    const rawDb = getDatabaseContext().rawDb;
    const now = Date.now();
    const effectiveRole = role || 'mesonero';
    const effectivePerms = permissions || getDefaultPermissionsForRole(effectiveRole);
    rawDb.prepare(`
      UPDATE users
      SET approval_status = 'APPROVED', is_active = 1, role = ?, permissions_json = ?, updated_at_ms = ?
      WHERE id = ?
    `).run(effectiveRole, JSON.stringify(effectivePerms), now, id);
    appendAuditEvent(rawDb, {
      actorUserId: authorizerUserId || null,
      action: 'USER_APPROVED',
      entityType: 'user',
      entityId: id,
      payload: { role: effectiveRole, permissions: effectivePerms, approvedBy: authorizerUserId }
    });
    return rawDb.prepare('SELECT id, name, username, role, cedula, phone, approval_status, is_active, permissions_json FROM users WHERE id = ?').get(id);
  }
  static async updatePermissions(id: string, permissions: string[], role?: UserRole, authorizerUserId?: string) {
    const rawDb = getDatabaseContext().rawDb;
    if (role) updateStaffRole(rawDb, id, role, authorizerUserId);
    updateStaffPermissions(rawDb, id, permissions, authorizerUserId);
    return rawDb.prepare('SELECT id, name, username, role, cedula, phone, approval_status, is_active, permissions_json FROM users WHERE id = ?').get(id);
  }
  static async updateRole(id: string, role: UserRole, authorizerUserId?: string) {
    return updateStaffRole(getDatabaseContext().rawDb, id, role, authorizerUserId);
  }
  static async deleteOrDeactivate(id: string, authorizerUserId?: string) {
    return deleteOrDeactivateStaffUser(getDatabaseContext().rawDb, id, authorizerUserId);
  }
}
