import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';

export interface HomeOrder {
  id?: string;
  jornada_id?: string | null;
  fulfillment_status?: string | null;
  payment_status?: string | null;
  [key: string]: unknown;
}

export interface HomeCounters {
  cocina: number;
  caja: number;
  pedido: number;
}

export function useHomeCounters(orders: HomeOrder[] = []): HomeCounters {
  const { data: jornadaData } = useQuery<{
    success?: boolean;
    jornada?: { id: string; status?: string } | null;
  }>({
    queryKey: ['current-jornada'],
    queryFn: async () => {
      try {
        const res = await apiFetch('/api/jornadas/current');
        if (res.ok) {
          return res.json();
        }
      } catch {}
      return { success: false, jornada: null };
    },
    refetchInterval: 10000
  });

  const jornada = jornadaData?.jornada;

  if (!jornada?.id) {
    return { cocina: 0, caja: 0, pedido: 0 };
  }

  const activeOrders = orders.filter((o) => o.jornada_id === jornada.id);

  // Cocina: fulfillment_status === 'en_preparacion' ("nuevos en cocina")
  const cocina = activeOrders.filter(
    (o) => o.fulfillment_status === 'en_preparacion'
  ).length;

  // Caja: payment_status en ['sin_pago', 'parcial', 'autorizado_sin_pago'] y fulfillment_status NO en ['cerrado', 'anulado'] ("por cobrar")
  const unpaidPaymentStatuses = ['sin_pago', 'parcial', 'autorizado_sin_pago'];
  const excludedFulfillmentStatuses = ['cerrado', 'anulado'];
  const caja = activeOrders.filter(
    (o) =>
      Boolean(o.payment_status && unpaidPaymentStatuses.includes(o.payment_status)) &&
      (!o.fulfillment_status || !excludedFulfillmentStatuses.includes(o.fulfillment_status))
  ).length;

  // Pedido: fulfillment_status === 'listo' ("listos para entregar")
  const pedido = activeOrders.filter(
    (o) => o.fulfillment_status === 'listo'
  ).length;

  return { cocina, caja, pedido };
}
