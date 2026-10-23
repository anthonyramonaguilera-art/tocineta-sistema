import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.js';
import { PedagogicalGuideBanner } from '../../components/PedagogicalGuideBanner.js';
import {
  Users,
  UserCheck,
  Check,
  X,
  Loader2,
  AlertCircle,
  Crown,
  Trash2,
  ShoppingCart,
  Undo2,
  ClipboardList,
  TrendingUp,
  Bell
} from 'lucide-react';

interface StaffUser {
  id: string;
  name: string;
  role: 'admin' | 'supervisor' | 'cajera' | 'mesonero' | 'cocinero';
  cedula?: string;
  phone?: string;
  approval_status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  permissions?: string[];
  is_active?: number | boolean;
  isActive?: boolean;
}

const GRANULAR_PERMISSIONS = [
  { key: 'CASHIER_PAY', label: 'Cobrar en Caja', icon: ShoppingCart, desc: 'Permite procesar cobros y vuelto en Caja' },
  { key: 'VOID_OR_REFUND', label: 'Anular Órdenes', icon: Undo2, desc: 'Permite anular pedidos o aplicar devoluciones' },
  { key: 'EDIT_MENU', label: 'Editar Menú', icon: ClipboardList, desc: 'Permite cambiar precios y disponibilidad de platos' },
  { key: 'VIEW_PROFITABILITY', label: 'Ver Ganancias', icon: TrendingUp, desc: 'Permite ver márgenes y costos de ingredientes' },
] as const;

export const StaffManagementView: React.FC = () => {
  const { token, user: activeUser } = useAuth();
  const queryClient = useQueryClient();

  const [pendingRoles, setPendingRoles] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<{ users?: StaffUser[]; staff?: StaffUser[] }>({
    queryKey: ['adminUsers'],
    queryFn: async () => {
      const res = await fetch('/api/admin/users', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error('Error al cargar la lista de personal');
      return res.json();
    }
  });

  const staffList: StaffUser[] = data?.staff || data?.users || [];

  const approveMutation = useMutation({
    mutationFn: async ({ userId, role, status = 'APPROVED' }: { userId: string; role: string; status?: string }) => {
      const res = await fetch(`/api/admin/users/${userId}/approve`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ role, status })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al procesar la aprobación');
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
      setSuccessMessage(
        variables.status === 'REJECTED'
          ? 'Solicitud de empleado rechazada'
          : '¡Empleado aprobado con éxito! Ya puede iniciar sesión.'
      );
      setTimeout(() => setSuccessMessage(null), 4000);
    }
  });

  const updatePermissionsMutation = useMutation({
    mutationFn: async ({ userId, permissions }: { userId: string; permissions: string[] }) => {
      const res = await fetch(`/api/admin/users/${userId}/permissions`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ permissions })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al actualizar permisos');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
      setSuccessMessage('Permisos actualizados correctamente en tiempo real');
      setTimeout(() => setSuccessMessage(null), 3000);
    }
  });

  const changeRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ role })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || 'Error al cambiar rol');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
      setSuccessMessage('Rol de trabajador actualizado exitosamente');
      setTimeout(() => setSuccessMessage(null), 3000);
    }
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || 'Error al eliminar usuario');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
      setSuccessMessage('Trabajador dado de baja del sistema exitosamente');
      setTimeout(() => setSuccessMessage(null), 3500);
    }
  });

  const pendingStaff = staffList.filter(
    u => (u.approval_status === 'PENDING' || u.approvalStatus === 'PENDING')
  );

  const activeStaff = staffList.filter(
    u => (u.approval_status === 'APPROVED' || u.approvalStatus === 'APPROVED' || (!u.approval_status && !u.approvalStatus))
  );

  const handleTogglePermission = (targetUser: StaffUser, permKey: string) => {
    const current = new Set(targetUser.permissions || []);
    if (current.has(permKey)) {
      current.delete(permKey);
    } else {
      current.add(permKey);
    }
    updatePermissionsMutation.mutate({
      userId: targetUser.id,
      permissions: Array.from(current)
    });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Banner Pedagógico Sin Jerga */}
      <PedagogicalGuideBanner
        title="Guía de Mi Equipo y Permisos"
        description="Aquí la Sra. Olinelcys puede aprobar a los nuevos empleados con 1 solo toque y decidir quién tiene permiso para cobrar en caja, anular pedidos o ver ganancias."
        storageKey="tocineta_guide_staff"
      />

      {/* Encabezado Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-tocineta-border pb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              👥 Mi Equipo y Permisos
            </h1>
            <p className="text-xs sm:text-sm text-tocineta-muted">
              Control de acceso para trabajadores del Food Truck
            </p>
          </div>
        </div>

        {activeUser?.role === 'admin' && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold self-start sm:self-auto">
            <span>👑</span> Modo Dueña Activo
          </div>
        )}
      </div>

      {successMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-fade-in">
          <Check className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12 gap-3 text-tocineta-muted">
          <Loader2 className="w-6 h-6 animate-spin text-tocineta-yellow" />
          <span className="text-sm font-semibold">Cargando datos del equipo...</span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>Error de conexión al cargar la lista de trabajadores.</span>
        </div>
      )}

      {/* SECCIÓN 1: Solicitudes Pendientes de Aprobación */}
      <section className="bg-tocineta-card border border-tocineta-border rounded-2xl p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between border-b border-tocineta-border/60 pb-3">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold text-white tracking-wide">
              Solicitudes Pendientes de Aprobación
            </h2>
          </div>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
            {pendingStaff.length} pendientes
          </span>
        </div>

        {pendingStaff.length === 0 ? (
          <div className="py-6 text-center text-tocineta-muted text-xs sm:text-sm">
            ✅ No hay solicitudes pendientes. Todo el equipo está al día.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            {pendingStaff.map(member => {
              const selectedRole = pendingRoles[member.id] || member.role || 'mesonero';
              return (
                <div
                  key={member.id}
                  className="p-4 rounded-xl border border-amber-500/30 bg-amber-950/10 space-y-3 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-white text-base">{member.name}</h3>
                      <span className="text-[11px] font-mono bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-md border border-amber-500/30 font-semibold">
                        NUEVO REGISTRO
                      </span>
                    </div>
                    <div className="text-xs text-tocineta-muted mt-1 space-y-0.5">
                      {member.cedula && <div>Cédula: <span className="text-neutral-200 font-mono font-medium">{member.cedula}</span></div>}
                      {member.phone && <div>Teléfono: <span className="text-neutral-200 font-mono font-medium">{member.phone}</span></div>}
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-tocineta-border/40">
                    <label className="text-xs font-semibold text-neutral-300 block">
                      Asignar Cargo / Rol:
                    </label>
                    <select
                      value={selectedRole}
                      onChange={e => setPendingRoles(prev => ({ ...prev, [member.id]: e.target.value }))}
                      className="w-full bg-neutral-900 border border-tocineta-border rounded-xl px-3 py-2 text-xs font-bold text-white focus:border-tocineta-yellow outline-none min-h-[44px]"
                    >
                      <option value="mesonero">🍔 Mesonero (Comandero)</option>
                      <option value="cajera">💵 Cajera (Caja y Cobro)</option>
                      <option value="cocinero">🍳 Cocinero (Plancha / KDS)</option>
                      <option value="supervisor">⭐ Supervisor</option>
                    </select>

                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => approveMutation.mutate({ userId: member.id, role: selectedRole, status: 'APPROVED' })}
                        disabled={approveMutation.isPending}
                        className="flex-1 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow disabled:opacity-50"
                      >
                        <UserCheck className="w-4 h-4" />
                        <span>✓ Aprobar Acceso al Equipo</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => approveMutation.mutate({ userId: member.id, role: selectedRole, status: 'REJECTED' })}
                        disabled={approveMutation.isPending}
                        title="Rechazar solicitud"
                        className="min-h-[44px] px-3.5 bg-neutral-800 hover:bg-red-950 text-neutral-400 hover:text-red-400 border border-neutral-700 hover:border-red-500/50 rounded-xl text-xs font-bold transition disabled:opacity-50 flex items-center justify-center"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SECCIÓN 2: Mi Equipo Activo y Matriz Dinámica de Permisos */}
      <section className="bg-tocineta-card border border-tocineta-border rounded-2xl p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between border-b border-tocineta-border/60 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🛡️</span>
            <h2 className="text-base font-bold text-white tracking-wide">
              Mi Equipo Activo y Permisos Táctiles
            </h2>
          </div>
          <span className="text-xs text-tocineta-muted">
            {activeStaff.length} trabajadores activos
          </span>
        </div>

        <div className="space-y-4">
          {activeStaff.map(member => {
            const isOwner = member.role === 'admin';
            const userPerms = new Set(member.permissions || []);

            return (
              <div
                key={member.id}
                className="p-4 rounded-xl border border-tocineta-border bg-neutral-900/40 hover:border-neutral-700 transition space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-neutral-800 border border-neutral-700 flex items-center justify-center font-bold text-base text-tocineta-yellow">
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white text-sm sm:text-base">
                          {member.name}
                        </h3>
                        {isOwner && (
                          <span className="inline-flex items-center gap-1 text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded font-bold tracking-wide uppercase">
                            <Crown className="w-3 h-3" />
                            DUEÑA
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-tocineta-muted flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">{member.role}</span>
                        {member.cedula && <span>• Cédula: {member.cedula}</span>}
                      </div>
                    </div>
                  </div>

                  {isOwner ? (
                    <div className="text-xs text-amber-300/80 italic font-medium">
                      Administración Total
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <select
                        value={member.role}
                        onChange={e => changeRoleMutation.mutate({ userId: member.id, role: e.target.value })}
                        disabled={changeRoleMutation.isPending}
                        className="bg-neutral-800 border border-neutral-700 text-white rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:border-tocineta-yellow outline-none min-h-[38px]"
                      >
                        <option value="mesonero">🍔 Mesonero</option>
                        <option value="cajera">💵 Cajera</option>
                        <option value="cocinero">🍳 Cocinero</option>
                        <option value="supervisor">⭐ Supervisor</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`¿Estás seguro de que deseas dar de baja a ${member.name}? Ya no podrá ingresar al sistema.`)) {
                            deleteUserMutation.mutate(member.id);
                          }
                        }}
                        disabled={deleteUserMutation.isPending}
                        className="px-2.5 py-1.5 rounded-lg bg-red-950/60 border border-red-800/80 hover:bg-red-900 text-red-300 hover:text-white text-xs font-bold transition flex items-center gap-1.5 shadow min-h-[38px]"
                        title="Eliminar / Dar de Baja"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span className="hidden sm:inline">Dar de Baja</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Checkboxes de Permisos Granulares */}
                {!isOwner && (
                  <div className="pt-2 border-t border-neutral-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {GRANULAR_PERMISSIONS.map(p => {
                      const hasPerm = userPerms.has(p.key) || member.role === 'admin' || (p.key === 'CASHIER_PAY' && (member.role === 'cajera' || member.role === 'supervisor'));
                      const isDefaultRolePerm = (p.key === 'CASHIER_PAY' && (member.role === 'cajera' || member.role === 'supervisor'));

                      return (
                        <button
                          key={p.key}
                          type="button"
                          disabled={updatePermissionsMutation.isPending || isDefaultRolePerm}
                          onClick={() => handleTogglePermission(member, p.key)}
                          className={`min-h-[44px] px-3 py-2 rounded-xl border text-left text-xs font-bold transition flex items-center justify-between gap-2 ${
                            hasPerm
                              ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                              : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-white'
                          } ${isDefaultRolePerm ? 'opacity-70 cursor-not-allowed' : ''}`}
                        >
                          <div>
                            <div className="leading-tight flex items-center gap-1.5">
                              <p.icon className="w-3.5 h-3.5 shrink-0 opacity-80" />
                              <span>{p.label}</span>
                            </div>
                            {isDefaultRolePerm && (
                              <div className="text-[10px] text-neutral-500 font-normal">Por rol ({member.role})</div>
                            )}
                          </div>
                          <div
                            className={`w-5 h-5 rounded-md flex items-center justify-center border shrink-0 transition ${
                              hasPerm
                                ? 'bg-amber-500 border-amber-400 text-black'
                                : 'border-neutral-700 bg-neutral-800'
                            }`}
                          >
                            {hasPerm && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default StaffManagementView;
