import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { KdsOrder } from './KdsView.js';

interface UseKdsActionsProps {
  token?: string | null;
}

export function useKdsActions({ token }: UseKdsActionsProps = {}) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<string | null>(null);

  // Mutación: avanzar o revertir plato individual
  const lineMutation = useMutation({
    mutationFn: async ({ lineId, status }: { lineId: string; status: 'pendiente' | 'preparando' | 'listo' }) => {
      const res = await fetch(`/api/kds/lines/${lineId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Error al actualizar plato');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kds-orders'] });
    }
  });

  // Mutación: despachar orden lista
  const deliverMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/kds/orders/${orderId}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archive: true })
      });
      if (!res.ok) throw new Error('Error al despachar orden');
      return res.json();
    },
    onSuccess: () => {
      setFeedback('Comanda despachada exitosamente');
      setTimeout(() => setFeedback(null), 3000);
      queryClient.invalidateQueries({ queryKey: ['kds-orders'] });
    }
  });

  // Mutación: forzar despacho (Supervisión)
  const forceCompleteMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/kds/orders/${orderId}/force-complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({})
      });
      if (!res.ok) throw new Error('Error al forzar despacho');
      return res.json();
    },
    onSuccess: () => {
      setFeedback('Orden completada por supervisión');
      setTimeout(() => setFeedback(null), 3000);
      queryClient.invalidateQueries({ queryKey: ['kds-orders'] });
    }
  });

  // 1 toque: pasar toda la orden a preparación ("Empezar")
  const startOrderPreparation = useCallback(
    async (order: KdsOrder) => {
      const pendingLines = order.lines.filter((l) => l.status === 'pendiente');
      for (const line of pendingLines) {
        await lineMutation.mutateAsync({ lineId: line.lineId, status: 'preparando' });
      }
    },
    [lineMutation]
  );

  // 1 toque: marcar toda la comanda lista
  const markOrderAllReady = useCallback(
    async (order: KdsOrder) => {
      const nonReadyLines = order.lines.filter((l) => l.status !== 'listo');
      for (const line of nonReadyLines) {
        await lineMutation.mutateAsync({ lineId: line.lineId, status: 'listo' });
      }
    },
    [lineMutation]
  );

  return {
    feedback,
    setFeedback,
    updateLineStatus: (lineId: string, status: 'pendiente' | 'preparando' | 'listo') =>
      lineMutation.mutate({ lineId, status }),
    deliverOrder: (orderId: string) => deliverMutation.mutate(orderId),
    forceComplete: (orderId: string) => forceCompleteMutation.mutate(orderId),
    startOrderPreparation,
    markOrderAllReady,
    isDelivering: deliverMutation.isPending
  };
}

