/**
 * Helper de autorización RBAC reutilizable para cobros y operaciones de caja.
 * Retorna true únicamente para 'cajera', 'supervisor' y 'admin'.
 */
export function canUserProcessPayments(role?: string | null): boolean {
  if (!role) return false;
  const normalized = role.toLowerCase().trim();
  return normalized === 'cajera' || normalized === 'supervisor' || normalized === 'admin';
}
