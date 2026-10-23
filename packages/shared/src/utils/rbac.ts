/**
 * Definición canónica de Permisos Granulares del Personal (Hito M20 C.3)
 */
export const STAFF_PERMISSIONS = {
  POS_TAKE_ORDERS: 'POS_TAKE_ORDERS',
  CASHIER_PAY: 'CASHIER_PAY',
  KDS_OPERATE: 'KDS_OPERATE',
  VOID_OR_REFUND: 'VOID_OR_REFUND',
  EDIT_MENU: 'EDIT_MENU',
  VIEW_PROFITABILITY: 'VIEW_PROFITABILITY',
  KDS_FORCE_COMPLETE: 'KDS_FORCE_COMPLETE'
} as const;

export type StaffPermission = (typeof STAFF_PERMISSIONS)[keyof typeof STAFF_PERMISSIONS];

export interface UserPermissionContext {
  role?: string | null;
  permissions?: string[] | null;
}

/**
 * Helper de autorización RBAC reutilizable para cobros y operaciones de caja.
 * Retorna true para 'cajera', 'supervisor', 'admin' O si el usuario cuenta con el permiso 'CASHIER_PAY'.
 */
export function canUserProcessPayments(
  userOrRole?: string | UserPermissionContext | null,
  explicitPermissions?: string[] | null
): boolean {
  if (!userOrRole) return false;

  let role = '';
  let permissions: string[] = [];

  if (typeof userOrRole === 'string') {
    role = userOrRole;
    if (explicitPermissions && Array.isArray(explicitPermissions)) {
      permissions = explicitPermissions;
    }
  } else {
    role = userOrRole.role || '';
    if (Array.isArray(userOrRole.permissions)) {
      permissions = userOrRole.permissions;
    } else if (explicitPermissions && Array.isArray(explicitPermissions)) {
      permissions = explicitPermissions;
    }
  }

  const normalized = role.toLowerCase().trim();
  if (normalized === 'cajera' || normalized === 'supervisor' || normalized === 'admin') {
    return true;
  }

  return permissions.includes(STAFF_PERMISSIONS.CASHIER_PAY);
}

/**
 * Verifica si un usuario tiene un permiso específico o si posee rol de administración total (admin / dueña).
 */
export function hasStaffPermission(
  userOrRole: string | UserPermissionContext | null | undefined,
  permission: string,
  explicitPermissions?: string[] | null
): boolean {
  if (!userOrRole) return false;

  let role = '';
  let permissions: string[] = [];

  if (typeof userOrRole === 'string') {
    role = userOrRole;
    if (explicitPermissions && Array.isArray(explicitPermissions)) {
      permissions = explicitPermissions;
    }
  } else {
    role = userOrRole.role || '';
    if (Array.isArray(userOrRole.permissions)) {
      permissions = userOrRole.permissions;
    } else if (explicitPermissions && Array.isArray(explicitPermissions)) {
      permissions = explicitPermissions;
    }
  }

  const normalized = role.toLowerCase().trim();
  // Bypass Total: La Dueña ('admin') posee acceso total en todos los módulos
  if (normalized === 'admin') {
    return true;
  }

  if (normalized === 'supervisor') {
    return true;
  }

  return permissions.includes(permission);
}
