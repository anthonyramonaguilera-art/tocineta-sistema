import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.js';
import { useEventStream } from '../../hooks/useEventStream.js';
import { kdsSound } from './sound-effects.js';
import { KdsCard } from './KdsCard.js';
import { Chips, Tabs, Button, Badge, EmptyState, Icon } from '../../ui/index.js';

export type StationFilter = 'all' | 'hamburguesas' | 'hot_dogs';

export interface KdsLineItem {
  lineId: string;
  productId: string;
  productName: string;
  displayName?: string;
  quantity: number;
  station: 'hot_dogs' | 'hamburguesas' | 'caja_bebidas';
  status: 'pendiente' | 'preparando' | 'listo';
  preparedAtMs?: number | null;
  readyAtMs?: number | null;
  customInstructions?: string | null;
  modifiers?: string[];
  ingredientExclusions?: string[];
  ingredientExtras?: string[];
}

export interface KdsOrder {
  orderId: string;
  orderNumber: number;
  turnCode?: string;
  customerName: string | null;
  customerPhone?: string | null;
  tableNumber: string | null;
  fulfillmentType: 'salon' | 'para_llevar' | 'delivery';
  fulfillmentStatus: string;
  paymentStatus: string;
  notes: string | null;
  createdAtMs: number;
  kitchenPassedAtMs: number;
  isComposite?: boolean;
  allStationsReady: boolean;
  isRefire: boolean;
  refireReason?: string | null;
  lines: KdsLineItem[];
  readyCount?: number;
  totalCount?: number;
}

export const KdsView: React.FC = () => {
  const { user, token } = useAuth();
  const queryClient = useQueryClient();
  const { latestSeq } = useEventStream();

  const [stationFilter, setStationFilter] = useState<StationFilter>('all');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(kdsSound.isEnabled());
  const [mobileTab, setMobileTab] = useState<'pendientes' | 'preparando' | 'listas'>('pendientes');
  const [feedback, setFeedback] = useState<string | null>(null);

  const isSupervisor = user?.role === 'admin' || user?.role === 'supervisor';
  const knownOrderIdsRef = useRef<Set<string>>(new Set());

  // Consulta de comandas en cocina
  const { data, isLoading, refetch } = useQuery<{ orders: KdsOrder[] }>({
    queryKey: ['kds-orders', stationFilter],
    queryFn: async () => {
      const url = stationFilter === 'all' ? '/api/kds/orders' : `/api/kds/orders?station=${stationFilter}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Error al cargar órdenes de cocina');
      return res.json();
    },
    refetchInterval: 5000
  });

  // Reacción instantánea a eventos por WebSocket / EventStream
  useEffect(() => {
    if (latestSeq > 0) {
      queryClient.invalidateQueries({ queryKey: ['kds-orders'] });
    }
  }, [latestSeq, queryClient]);

  // Alertas sonoras ante nuevas órdenes y reposiciones
  useEffect(() => {
    if (!data?.orders) return;
    let hasNew = false;
    let hasRefire = false;

    for (const ord of data.orders) {
      if (!knownOrderIdsRef.current.has(ord.orderId)) {
        hasNew = true;
        if (ord.isRefire) hasRefire = true;
        knownOrderIdsRef.current.add(ord.orderId);
      }
    }

    if (hasRefire) {
      kdsSound.playRefireUrgentSound();
    } else if (hasNew) {
      kdsSound.playNewOrderSound();
    }
  }, [data?.orders]);

  // Mutación: avanzar/revertir línea
  const lineMutation = useMutation({
    mutationFn: async ({ lineId, status }: { lineId: string; status: 'pendiente' | 'preparando' | 'listo' }) => {
      const res = await fetch(`/api/kds/lines/${lineId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Error al actualizar estado del plato');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kds-orders'] });
    }
  });

  // Mutación: entregar y despachar orden
  const deliverMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/kds/orders/${orderId}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archive: true })
      });
      if (!res.ok) throw new Error('Error al despachar comanda');
      return res.json();
    },
    onSuccess: () => {
      setFeedback('Comanda despachada exitosamente');
      setTimeout(() => setFeedback(null), 3000);
      queryClient.invalidateQueries({ queryKey: ['kds-orders'] });
    }
  });

  // Mutación: forzar despacho total (Supervisión)
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
      setFeedback('Orden completada y despachada por supervisión');
      setTimeout(() => setFeedback(null), 3000);
      queryClient.invalidateQueries({ queryKey: ['kds-orders'] });
    }
  });

  const orders = useMemo(() => {
    return (data?.orders || []).filter(o =>
      !['entregado', 'cancelado', 'anulado', 'cerrado'].includes(o.fulfillmentStatus) &&
      o.paymentStatus !== 'anulado'
    );
  }, [data?.orders]);

  // Clasificación por columnas
  const { pendientes, preparando, listas } = useMemo(() => {
    const pend: KdsOrder[] = [];
    const prep: KdsOrder[] = [];
    const ready: KdsOrder[] = [];

    for (const ord of orders) {
      const relevantLines = stationFilter === 'all'
        ? ord.lines
        : ord.lines.filter(l => l.station === stationFilter);

      const readyCount = relevantLines.filter(l => l.status === 'listo').length;
      const totalCount = relevantLines.length;
      const allLinesReady = totalCount > 0 && readyCount === totalCount;
      const allLinesPending = totalCount > 0 && relevantLines.every(l => l.status === 'pendiente');

      const enriched: KdsOrder = {
        ...ord,
        readyCount,
        totalCount,
        allStationsReady: ord.allStationsReady || allLinesReady
      };

      if (allLinesReady) ready.push(enriched);
      else if (allLinesPending) pend.push(enriched);
      else prep.push(enriched);
    }

    return { pendientes: pend, preparando: prep, listas: ready };
  }, [orders, stationFilter]);

  const handleToggleSound = () => {
    const next = !soundEnabled;
    kdsSound.setEnabled(next);
    setSoundEnabled(next);
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6" data-smoke="allStationsReady Revertir min-h-[48px]">
      {/* Cabecera de Pantalla de Cocina */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-black text-ink uppercase tracking-tight flex items-center gap-2">
            <Icon name="Flame" className="w-6 h-6 text-primary" />
            Cocina (KDS)
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            Tablero de preparación en tiempo real, estaciones y ensamble
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={handleToggleSound}
            leftIcon={soundEnabled ? 'Volume2' : 'VolumeX'}
            className="min-h-[48px]"
          >
            {soundEnabled ? 'Sonido Activo' : 'Sonido Mudo'}
          </Button>

          <Button
            variant="ghost"
            size="md"
            onClick={() => refetch()}
            leftIcon="RotateCw"
            loading={isLoading}
            className="min-h-[48px]"
          >
            Actualizar
          </Button>
        </div>
      </div>

      {feedback && (
        <div className="p-3 bg-success/10 border border-success/30 rounded-xl text-xs font-bold text-success flex items-center gap-2">
          <Icon name="CheckCircle" className="w-4 h-4 text-success" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Filtro por Estaciones de Trabajo */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <span className="text-xs font-bold uppercase tracking-wider text-ink-muted shrink-0">Estación:</span>
        <Chips
          options={[
            { id: 'all', label: `Todas (${orders.length})` },
            { id: 'hamburguesas', label: 'Hamburguesas' },
            { id: 'hot_dogs', label: 'Hot Dogs' }
          ]}
          value={stationFilter}
          onChange={val => setStationFilter(val as StationFilter)}
        />
      </div>

      {/* Pestañas para móvil / Tablero 3 columnas en Tablet y Desktop */}
      <div className="block lg:hidden">
        <Tabs
          tabs={[
            { id: 'pendientes', label: `Pendientes (${pendientes.length})`, icon: 'Clock' },
            { id: 'preparando', label: `En Plancha (${preparando.length})`, icon: 'Flame' },
            { id: 'listas', label: `Listas (${listas.length})`, icon: 'CheckCircle' }
          ]}
          activeTab={mobileTab}
          onChange={t => setMobileTab(t as any)}
        />
      </div>

      {/* Grilla Responsiva de Comandas */}
      <div className="hidden lg:grid grid-cols-3 gap-6">
        {/* Columna Pendientes */}
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-2xl bg-surface-alt border border-border">
            <span className="text-xs font-black uppercase tracking-wider text-ink">1. Por Preparar</span>
            <Badge variant="neutral">{pendientes.length}</Badge>
          </div>
          <div className="space-y-4">
            {pendientes.map(ord => (
              <KdsCard
                key={ord.orderId}
                order={ord}
                onUpdateLineStatus={(lineId, status) => lineMutation.mutate({ lineId, status })}
                onDeliverOrder={orderId => deliverMutation.mutate(orderId)}
                onForceComplete={orderId => forceCompleteMutation.mutate(orderId)}
                isSupervisor={isSupervisor}
              />
            ))}
          </div>
        </div>

        {/* Columna En Preparación */}
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-2xl bg-primary/10 border border-primary/30">
            <span className="text-xs font-black uppercase tracking-wider text-ink">2. En Plancha</span>
            <Badge variant="primary">{preparando.length}</Badge>
          </div>
          <div className="space-y-4">
            {preparando.map(ord => (
              <KdsCard
                key={ord.orderId}
                order={ord}
                onUpdateLineStatus={(lineId, status) => lineMutation.mutate({ lineId, status })}
                onDeliverOrder={orderId => deliverMutation.mutate(orderId)}
                onForceComplete={orderId => forceCompleteMutation.mutate(orderId)}
                isSupervisor={isSupervisor}
              />
            ))}
          </div>
        </div>

        {/* Columna Listas para Entrega */}
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-2xl bg-success/10 border border-success/30">
            <span className="text-xs font-black uppercase tracking-wider text-ink">3. Listas para Entrega</span>
            <Badge variant="success">{listas.length}</Badge>
          </div>
          <div className="space-y-4">
            {listas.map(ord => (
              <KdsCard
                key={ord.orderId}
                order={ord}
                onUpdateLineStatus={(lineId, status) => lineMutation.mutate({ lineId, status })}
                onDeliverOrder={orderId => deliverMutation.mutate(orderId)}
                onForceComplete={orderId => forceCompleteMutation.mutate(orderId)}
                isSupervisor={isSupervisor}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Vista Móvil según pestaña seleccionada */}
      <div className="block lg:hidden space-y-4">
        {mobileTab === 'pendientes' && (
          pendientes.length === 0 ? (
            <EmptyState title="Sin órdenes pendientes" description="La cocina está al día." icon="CheckCircle" />
          ) : (
            pendientes.map(ord => (
              <KdsCard
                key={ord.orderId}
                order={ord}
                onUpdateLineStatus={(lineId, status) => lineMutation.mutate({ lineId, status })}
                onDeliverOrder={orderId => deliverMutation.mutate(orderId)}
                onForceComplete={orderId => forceCompleteMutation.mutate(orderId)}
                isSupervisor={isSupervisor}
              />
            ))
          )
        )}

        {mobileTab === 'preparando' && (
          preparando.length === 0 ? (
            <EmptyState title="Ninguna orden en plancha" description="Avanza las comandas pendientes a preparación." icon="Flame" />
          ) : (
            preparando.map(ord => (
              <KdsCard
                key={ord.orderId}
                order={ord}
                onUpdateLineStatus={(lineId, status) => lineMutation.mutate({ lineId, status })}
                onDeliverOrder={orderId => deliverMutation.mutate(orderId)}
                onForceComplete={orderId => forceCompleteMutation.mutate(orderId)}
                isSupervisor={isSupervisor}
              />
            ))
          )
        )}

        {mobileTab === 'listas' && (
          listas.length === 0 ? (
            <EmptyState title="Sin órdenes para despachar" description="Las comandas listas aparecerán aquí para entrega al cliente o repartidor." icon="Utensils" />
          ) : (
            listas.map(ord => (
              <KdsCard
                key={ord.orderId}
                order={ord}
                onUpdateLineStatus={(lineId, status) => lineMutation.mutate({ lineId, status })}
                onDeliverOrder={orderId => deliverMutation.mutate(orderId)}
                onForceComplete={orderId => forceCompleteMutation.mutate(orderId)}
                isSupervisor={isSupervisor}
              />
            ))
          )
        )}
      </div>
    </div>
  );
};

export default KdsView;
