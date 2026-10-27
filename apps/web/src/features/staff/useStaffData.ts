import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.js';
import type { StaffUser, PayrollSettings, TipPool } from './types.js';

export function useStaffData() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  // 1. Lista de personal
  const staffQuery = useQuery<StaffUser[]>({
    queryKey: ['staffList'],
    queryFn: async () => {
      const res = await fetch('/api/admin/users', { headers });
      if (!res.ok) throw new Error('Error al cargar la lista de personal');
      const data = await res.json();
      return data.users || data.staff || [];
    }
  });

  // 2. Configuración de nómina
  const payrollSettingsQuery = useQuery<PayrollSettings>({
    queryKey: ['payrollSettings'],
    queryFn: async () => {
      const res = await fetch('/api/staff/payroll/settings', { headers });
      if (!res.ok) throw new Error('Error al cargar ajustes de nómina');
      const data = await res.json();
      return data.settings;
    }
  });

  // 3. Pool de propinas abierto
  const tipPoolQuery = useQuery<TipPool>({
    queryKey: ['tipPoolOpen'],
    queryFn: async () => {
      const res = await fetch('/api/staff/tips/pool?locationId=loc_alta_vista', { headers });
      if (!res.ok) throw new Error('Error al cargar pool de propinas');
      const data = await res.json();
      return data.pool;
    }
  });

  // Mutaciones
  const createEmployeeMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      username?: string;
      role: string;
      pin: string;
      salaryScheme?: string;
      baseSalaryUsdCents?: number;
    }) => {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al crear trabajador');
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staffList'] })
  });

  const updatePermissionsMutation = useMutation({
    mutationFn: async ({ userId, permissions }: { userId: string; permissions: string[] }) => {
      const res = await fetch(`/api/admin/users/${userId}/permissions`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ permissions })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al actualizar permisos');
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staffList'] })
  });

  const deleteEmployeeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al dar de baja al empleado');
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staffList'] })
  });

  const updatePayrollSettingsMutation = useMutation({
    mutationFn: async (settings: Partial<PayrollSettings>) => {
      const res = await fetch('/api/staff/payroll/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify(settings)
      });
      if (!res.ok) throw new Error('Error al guardar ajustes de nómina');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payrollSettings'] })
  });

  const addAdjustmentMutation = useMutation({
    mutationFn: async (payload: {
      userId: string;
      adjustmentType: 'BONO' | 'ADELANTO';
      amountUsdCents: number;
      reason: string;
    }) => {
      const res = await fetch('/api/staff/payroll/adjustments', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Error al registrar ajuste');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payrollAdjustments'] })
  });

  const addConsumptionMutation = useMutation({
    mutationFn: async (payload: {
      userId: string;
      itemDescription: string;
      amountUsdCents?: number;
      isFixedDinner?: boolean;
    }) => {
      const res = await fetch('/api/staff/consumptions', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Error al registrar consumo');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staffConsumptions'] })
  });

  const addTipMutation = useMutation({
    mutationFn: async (payload: {
      tipPoolId?: string;
      amountUsdCents: number;
      amountBsCents: number;
    }) => {
      const res = await fetch('/api/staff/tips/pool', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, locationId: 'loc_alta_vista' })
      });
      if (!res.ok) throw new Error('Error al agregar propina al pool');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tipPoolOpen'] })
  });

  const closeTipPoolMutation = useMutation({
    mutationFn: async (payload: {
      tipPoolId: string;
      splitMode: 'EQUAL' | 'HOURS';
      participants: { userId: string; hoursWorked?: number }[];
    }) => {
      const res = await fetch('/api/staff/tips/close', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al cerrar pool de propinas');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tipPoolOpen'] });
      queryClient.invalidateQueries({ queryKey: ['tipPoolsHistory'] });
    }
  });

  return {
    staffList: staffQuery.data || [],
    isLoadingStaff: staffQuery.isLoading,
    payrollSettings: payrollSettingsQuery.data,
    tipPool: tipPoolQuery.data,
    createEmployeeMutation,
    updatePermissionsMutation,
    deleteEmployeeMutation,
    updatePayrollSettingsMutation,
    addAdjustmentMutation,
    addConsumptionMutation,
    addTipMutation,
    closeTipPoolMutation,
    headers
  };
}
