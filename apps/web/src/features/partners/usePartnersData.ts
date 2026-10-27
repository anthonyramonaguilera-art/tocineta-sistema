import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BusinessPartner, PartnersSummary } from './types.js';

export function usePartnersList() {
  return useQuery<{
    success: boolean;
    enabled: boolean;
    partners: BusinessPartner[];
    summary: PartnersSummary;
  }>({
    queryKey: ['businessPartners'],
    queryFn: async () => {
      const res = await fetch('/api/partners');
      if (!res.ok) throw new Error('Error al cargar socios');
      return res.json();
    },
    staleTime: 5000
  });
}

export function usePartnerDetail(id: string | null) {
  return useQuery<{ success: boolean; partner: BusinessPartner }>({
    queryKey: ['businessPartner', id],
    queryFn: async () => {
      if (!id) throw new Error('ID requerido');
      const res = await fetch(`/api/partners/${id}`);
      if (!res.ok) throw new Error('Error al cargar detalle de socio');
      return res.json();
    },
    enabled: Boolean(id)
  });
}

export function useCreatePartner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name: string; docId?: string; phone?: string; email?: string; sharePercentage: number; notes?: string }) => {
      const res = await fetch('/api/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al crear socio');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businessPartners'] });
    }
  });
}

export function useRegisterPartnerTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { partnerId: string; type: 'APORTE' | 'RETIRO_UTILIDADES'; amountUsdCents: number; paymentMethod?: string; notes?: string }) => {
      const res = await fetch('/api/partners/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al registrar transacción');
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['businessPartners'] });
      queryClient.invalidateQueries({ queryKey: ['businessPartner', variables.partnerId] });
    }
  });
}

export function useDistributeProfits() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { totalDividendUsdCents: number; notes?: string }) => {
      const res = await fetch('/api/partners/distribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al repartir utilidades');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businessPartners'] });
    }
  });
}

export function useTogglePartnersModule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch('/api/partners/toggle-module', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      if (!res.ok) throw new Error('Error al cambiar estado del módulo');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businessPartners'] });
    }
  });
}
