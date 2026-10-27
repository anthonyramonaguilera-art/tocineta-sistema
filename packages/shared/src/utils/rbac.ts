/**
 * Definición canónica de Permisos Granulares del Personal (Fase 6 / Hito M20 C.3)
 */
export const STAFF_PERMISSIONS = {
  POS_TAKE_ORDERS: 'POS_TAKE_ORDERS',
  CASHIER_PAY: 'CASHIER_PAY',
  VOID_ORDER: 'VOID_ORDER',
  VOID_OR_REFUND: 'VOID_OR_REFUND',
  EDIT_MENU: 'EDIT_MENU',
  VIEW_COSTS: 'VIEW_COSTS',
  VIEW_PROFITABILITY: 'VIEW_PROFITABILITY',
  KDS_OPERATE: 'KDS_OPERATE',
  KDS_FORCE_COMPLETE: 'KDS_FORCE_COMPLETE'
} as const;

export type StaffPermission = (typeof STAFF_PERMISSIONS)[keyof typeof STAFF_PERMISSIONS];

export interface UserPermissionContext {
  role?: string | null;
  permissions?: string[] | null;
}

/**
 * Permisos por defecto asignados según el rol del trabajador
 */
export function getDefaultPermissionsForRole(role?: string | null): string[] {
  if (!role) return [];
  const normalized = role.toLowerCase().trim();
  switch (normalized) {
    case 'admin':
      return Object.values(STAFF_PERMISSIONS);
    case 'supervisor':
      return [
        STAFF_PERMISSIONS.POS_TAKE_ORDERS,
        STAFF_PERMISSIONS.CASHIER_PAY,
        STAFF_PERMISSIONS.VOID_ORDER,
        STAFF_PERMISSIONS.VOID_OR_REFUND,
        STAFF_PERMISSIONS.EDIT_MENU,
        STAFF_PERMISSIONS.VIEW_COSTS,
        STAFF_PERMISSIONS.VIEW_PROFITABILITY,
        STAFF_PERMISSIONS.KDS_OPERATE,
        STAFF_PERMISSIONS.KDS_FORCE_COMPLETE
      ];
    case 'cajera':
      return [STAFF_PERMISSIONS.POS_TAKE_ORDERS, STAFF_PERMISSIONS.CASHIER_PAY];
    case 'mesonero':
      return [STAFF_PERMISSIONS.POS_TAKE_ORDERS];
    case 'cocinero':
      return [STAFF_PERMISSIONS.KDS_OPERATE];
    case 'despachador':
      return [STAFF_PERMISSIONS.KDS_OPERATE];
    default:
      return [];
  }
}

/**
 * Verifica si un usuario tiene un permiso específico (por rol base o por permiso granular concedido).
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
  // La Dueña ('admin') posee acceso total en todos los módulos
  if (normalized === 'admin') {
    return true;
  }

  if (normalized === 'supervisor') {
    return true;
  }

  // Verificar en permisos explícitos del usuario
  if (permissions.includes(permission)) {
    return true;
  }

  // Compatibilidad entre VOID_ORDER y VOID_OR_REFUND
  if (permission === STAFF_PERMISSIONS.VOID_ORDER && permissions.includes(STAFF_PERMISSIONS.VOID_OR_REFUND)) {
    return true;
  }
  if (permission === STAFF_PERMISSIONS.VOID_OR_REFUND && permissions.includes(STAFF_PERMISSIONS.VOID_ORDER)) {
    return true;
  }

  // Permisos por defecto del rol
  const defaultRolePerms = getDefaultPermissionsForRole(normalized);
  return defaultRolePerms.includes(permission);
}

/**
 * Helper RBAC para cobros y operaciones de caja.
 */
export function canUserProcessPayments(
  userOrRole?: string | UserPermissionContext | null,
  explicitPermissions?: string[] | null
): boolean {
  return hasStaffPermission(userOrRole, STAFF_PERMISSIONS.CASHIER_PAY, explicitPermissions);
}

/**
 * Helper RBAC para anulación de órdenes o reembolsos.
 */
export function canUserVoidOrders(
  userOrRole?: string | UserPermissionContext | null,
  explicitPermissions?: string[] | null
): boolean {
  return hasStaffPermission(userOrRole, STAFF_PERMISSIONS.VOID_ORDER, explicitPermissions);
}

/**
 * Helper RBAC para edición de carta, recetas y precios.
 */
export function canUserEditMenu(
  userOrRole?: string | UserPermissionContext | null,
  explicitPermissions?: string[] | null
): boolean {
  return hasStaffPermission(userOrRole, STAFF_PERMISSIONS.EDIT_MENU, explicitPermissions);
}

/**
 * Helper RBAC para ver costos de insumos y mermas.
 */
export function canUserViewCosts(
  userOrRole?: string | UserPermissionContext | null,
  explicitPermissions?: string[] | null
): boolean {
  return hasStaffPermission(userOrRole, STAFF_PERMISSIONS.VIEW_COSTS, explicitPermissions);
}

/**
 * Helper RBAC para ver ganancias, márgenes y utilidad neta.
 */
export function canUserViewProfitability(
  userOrRole?: string | UserPermissionContext | null,
  explicitPermissions?: string[] | null
): boolean {
  return hasStaffPermission(userOrRole, STAFF_PERMISSIONS.VIEW_PROFITABILITY, explicitPermissions);
}

/**
 * Helper RBAC para toma de comandas en mostrador/mesas.
 */
export function canUserTakeOrders(
  userOrRole?: string | UserPermissionContext | null,
  explicitPermissions?: string[] | null
): boolean {
  return hasStaffPermission(userOrRole, STAFF_PERMISSIONS.POS_TAKE_ORDERS, explicitPermissions);
}

