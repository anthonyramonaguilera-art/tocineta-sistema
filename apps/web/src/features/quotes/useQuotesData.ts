import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { EventQuotation, CreateQuotePayload } from './types.js';

export function useQuotesList() {
  return useQuery<{ success: boolean; quotes: EventQuotation[] }>({
    queryKey: ['eventQuotes'],
    queryFn: async () => {
      const res = await fetch('/api/quotes');
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
      const res = await fetch(`/api/quotes/${id}`);
      if (!res.ok) throw new Error('Error al cargar detalle de cotización');
      return res.json();
    },
    enabled: Boolean(id)
  });
}

export function useMenuProducts() {
  return useQuery<any[]>({
    queryKey: ['activeProductsForQuotes'],
    queryFn: async () => {
      const res = await fetch('/api/products');
      if (!res.ok) {
        // Fallback a menu pos si falla
        const fallback = await fetch('/api/menu/pos');
        if (!fallback.ok) return [];
        const data = await fallback.json();
        return data.products || [];
      }
      const data = await res.json();
      return (data.products || data || []).filter((p: any) => p.is_active !== 0 && !p.is_combo);
    },
    staleTime: 30000
  });
}

export function useCreateQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateQuotePayload) => {
      const res = await fetch('/api/quotes', {
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
      const res = await fetch(`/api/quotes/${id}/reserve`, {
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
      const res = await fetch(`/api/quotes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar cotización');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventQuotes'] });
    }
  });
}
