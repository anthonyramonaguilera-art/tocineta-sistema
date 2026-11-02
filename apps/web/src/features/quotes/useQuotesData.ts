import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { EventQuotation, CreateQuotePayload } from './types.js';
import { apiFetch } from '../../api/client';

export function useQuotesList() {
  return useQuery<{ success: boolean; quotes: EventQuotation[] }>({
    queryKey: ['eventQuotes'],
    queryFn: async () => {
      const res = await apiFetch('/api/quotes');
      if (!res.ok) throw new Error('Error al cargar cotizaciones');
      return res.json();
    },
    staleTime: 5000
  });
}

export function useQuoteDetail(id: string | null) {
  return useQuery<{ success: boolean; quotation: EventQuotation }>({
    queryKey: ['eventQuote', id],
    queryFn: async () => {
      if (!id) throw new Error('ID requerido');
      const res = await apiFetch(`/api/quotes/${id}`);
      if (!res.ok) throw new Error('Error al cargar detalle de cotización');
      return res.json();
    },
    enabled: Boolean(id)
  });
}

export function useMenuProducts() {
  return useQuery<Array<{ id: string; name: string; price_usd_cents: number }>>({
    queryKey: ['activeProductsForQuotes'],
    queryFn: async () => {
      const res = await apiFetch('/api/menu/pos');
      if (!res.ok) return [];
      const data = await res.json();
      const categories: Array<{ products?: Array<any> }> = data.categories || [];
      return categories
        .flatMap((c) => c.products || [])
        .filter((p: any) => p.isAvailable && !p.isCombo)
        .map((p: any) => ({
          id: p.id,
          name: p.name,
          price_usd_cents: p.priceUsdCents
        }));
    },
    staleTime: 30000
  });
}

export function useCreateQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateQuotePayload) => {
      const res = await apiFetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al crear cotización');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventQuotes'] });
    }
  });
}

export function useConvertToReservation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/quotes/${id}/reserve`, {
        method: 'POST'
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al convertir en reserva');
      }
      return res.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['eventQuotes'] });
      queryClient.invalidateQueries({ queryKey: ['eventQuote', id] });
    }
  });
}

export function useDeleteQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/quotes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar cotización');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventQuotes'] });
    }
  });
}
