import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.js';
import { useEventStream } from '../../hooks/useEventStream.js';
import { kdsSound } from './sound-effects.js';

export type StationFilter = 'all' | 'hamburguesas' | 'hot_dogs';

export interface KdsLineItem {
  lineId: string;
  productId: string;
  productName: string;
  displayName: string;
  quantity: number;
  station: 'hot_dogs' | 'hamburguesas' | 'caja_bebidas';
  status: 'pendiente' | 'preparando' | 'listo';
  preparedAtMs?: number | null;
  readyAtMs?: number | null;
  flavorChoice?: string | null;
  customInstructions?: string | null;
  modifiers: string[];
  barraLibreModifiers: string[];
  ingredientExclusions: string[];
  ingredientExtras: string[];
  criticalModifiers: string[];
}

export interface KdsOrder {
  orderId: string;
  orderNumber: number;
  turnCode: string;
  customerName: string | null;
  customerPhone: string | null;
  tableNumber: string | null;
  fulfillmentType: 'salon' | 'para_llevar' | 'delivery';
  fulfillmentStatus: 'en_preparacion' | 'listo' | 'entregado' | 'cerrado';
  paymentStatus: 'pagado' | 'autorizado_sin_pago' | 'sin_pago';
  notes: string | null;
  createdAtMs: number;
  kitchenPassedAtMs: number;
  stationStatusHotDogs: 'na' | 'pendiente' | 'en_preparacion' | 'listo';
  stationStatusHamburguesas: 'na' | 'pendiente' | 'en_preparacion' | 'listo';
  isComposite: boolean;
  missingStations: Array<'hot_dogs' | 'hamburguesas'>;
  allStationsReady: boolean;
  isRefire: boolean;
  refireReason?: string | null;
  lines: KdsLineItem[];
  readyCount?: number;
  totalCount?: number;
  aggregateStatus?: 'pendiente' | 'preparando' | 'listo';
}

// Hook de cronómetro en vivo con guardia H-12
function useLiveStopwatch(passedAtMs: number) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const safePassed = (!passedAtMs || passedAtMs <= 0 || isNaN(passedAtMs)) ? now : passedAtMs;
  const elapsedMs = Math.max(0, now - safePassed);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  // Semáforo de tiempos oficiales:
  // Verde: < 8 min (480s)
  // Amarillo: 8 a 12 min (480s a 720s)
  // Rojo pulsante: > 12 min (720s)
  let severity: 'green' | 'yellow' | 'red' = 'green';
  if (minutes >= 12) {
    severity = 'red';
  } else if (minutes >= 8) {
    severity = 'yellow';
  }

  return { formatted, severity, minutes };
}

// Componente para badge de cronómetro
const StopwatchBadge: React.FC<{ passedAtMs: number }> = ({ passedAtMs }) => {
  const { formatted, severity } = useLiveStopwatch(passedAtMs);

  if (severity === 'red') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-950/80 border border-red-500/80 text-red-400 font-mono font-black text-xs animate-pulse shadow-md shadow-red-950/50">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
        <span>⏱️ {formatted}</span>
      </div>
    );
  }

  if (severity === 'yellow') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-950/60 border border-amber-500/60 text-amber-300 font-mono font-bold text-xs shadow-sm">
        <span className="w-2 h-2 rounded-full bg-amber-400" />
        <span>⏱️ {formatted}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/50 border border-emerald-500/50 text-emerald-400 font-mono font-semibold text-xs">
      <span className="w-2 h-2 rounded-full bg-emerald-400" />
      <span>⏱️ {formatted}</span>
    </div>
  );
};

export const KdsView: React.FC = () => {
  const { user, token } = useAuth();
  const queryClient = useQueryClient();
  const { latestSeq } = useEventStream();
  const [stationFilter, setStationFilter] = useState<StationFilter>('all');
  const [soundActive, setSoundActive] = useState<boolean>(kdsSound.isEnabled());
  const [mobileTab, setMobileTab] = useState<'pendiente' | 'preparando' | 'listo'>('pendiente');
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const isGodModeUser = user?.role === 'admin' || user?.role === 'supervisor' || Boolean(user?.permissions?.includes('KDS_FORCE_COMPLETE'));

  const knownOrderIdsRef = useRef<Set<string>>(new Set());

  // Consulta de órdenes activas en KDS
  const { data, isLoading, isError, refetch } = useQuery<{ orders: KdsOrder[] }>({
    queryKey: ['kdsOrders', stationFilter],
    queryFn: async () => {
      const url = stationFilter === 'all' ? '/api/kds/orders' : `/api/kds/orders?station=${stationFilter}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Error al cargar órdenes de cocina');
      return res.json();
    },
    refetchInterval: 6000
  });

  // Reaccionar a eventos de WebSocket para refresco instantáneo en < 1 segundo
  useEffect(() => {
    if (latestSeq > 0) {
      queryClient.invalidateQueries({ queryKey: ['kdsOrders'] });
    }
  }, [latestSeq, queryClient]);

  // Alertas sonoras al recibir nuevas órdenes o reposiciones
  useEffect(() => {
    if (!data?.orders) return;

    let hasNewOrder = false;
    let hasRefireOrder = false;

    for (const ord of data.orders) {
      if (!knownOrderIdsRef.current.has(ord.orderId)) {
        hasNewOrder = true;
        if (ord.isRefire) {
          hasRefireOrder = true;
        }
        knownOrderIdsRef.current.add(ord.orderId);
      }
    }

    if (hasRefireOrder) {
      kdsSound.playRefireUrgentSound();
    } else if (hasNewOrder) {
      kdsSound.playNewOrderSound();
    }
  }, [data?.orders]);

  // Mutación: avanzar estado de línea
  const updateLineMutation = useMutation({
    mutationFn: async ({ lineId, status }: { lineId: string; status: 'pendiente' | 'preparando' | 'listo' }) => {
      const res = await fetch(`/api/kds/lines/${lineId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error al cambiar estado de línea');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kdsOrders'] });
    }
  });

  // Mutación: entregar comanda
  const deliverOrderMutation = useMutation({
    mutationFn: async ({ orderId, archive }: { orderId: string; archive?: boolean }) => {
      const res = await fetch(`/api/kds/orders/${orderId}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archive })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error al entregar comanda');
      }
      return res.json();
    },
    onSuccess: () => {
      setFeedbackMessage('✓ Comanda entregada y despachada exitosamente');
      setTimeout(() => setFeedbackMessage(null), 3500);
      queryClient.invalidateQueries({ queryKey: ['kdsOrders'] });
    }
  });

  // Mutación: Forzar Despacho Total (Super-Operadora / God Mode)
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
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Error al forzar despacho total');
      }
      return res.json();
    },
    onSuccess: () => {
      setFeedbackMessage('⚡ Orden despachada por completo con éxito');
      setTimeout(() => setFeedbackMessage(null), 3500);
      queryClient.invalidateQueries({ queryKey: ['kdsOrders'] });
    }
  });

  const orders = data?.orders || [];

  // Clasificación de órdenes en las 3 columnas del tablero KDS
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

      const enrichedOrd: KdsOrder = {
        ...ord,
        readyCount,
        totalCount,
        aggregateStatus: allLinesReady ? 'listo' : (allLinesPending ? 'pendiente' : 'preparando')
      };

      if (allLinesReady) {
        ready.push(enrichedOrd);
      } else if (allLinesPending) {
        pend.push(enrichedOrd);
      } else {
        prep.push(enrichedOrd);
      }
    }

    return { pendientes: pend, preparando: prep, listas: ready };
  }, [orders, stationFilter]);

  const toggleSound = () => {
    const newState = kdsSound.toggle();
    setSoundActive(newState);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] bg-tocineta-bg text-white select-none">
      {/* Barra Superior KDS: Filtros de Estación, Controles y Alertas */}
      <div className="bg-tocineta-card border-b border-tocineta-border px-4 py-3 shrink-0 shadow-md">
        {feedbackMessage && (
          <div className="mb-2 p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 font-bold text-xs flex items-center justify-between animate-fade-in shadow">
            <span>{feedbackMessage}</span>
            <button onClick={() => setFeedbackMessage(null)} className="text-emerald-400 hover:text-white text-sm font-black ml-2">✕</button>
          </div>
        )}
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Título y Selector de Estación */}
          <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xl">🍳</span>
              <h1 className="text-base sm:text-lg font-black tracking-wide text-white">KDS COCINA</h1>
            </div>

            {/* Selector de Filtro de Vista */}
            <div className="flex items-center bg-tocineta-bg p-1 rounded-xl border border-tocineta-border">
              <button
                onClick={() => setStationFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  stationFilter === 'all'
                    ? 'bg-tocineta-yellow text-tocineta-bg shadow-sm'
                    : 'text-tocineta-muted hover:text-white'
                }`}
              >
                🥓 Todas las Estaciones
              </button>
              <button
                onClick={() => setStationFilter('hamburguesas')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  stationFilter === 'hamburguesas'
                    ? 'bg-tocineta-yellow text-tocineta-bg shadow-sm'
                    : 'text-tocineta-muted hover:text-white'
                }`}
              >
                🍔 Plancha / Burgers
              </button>
              <button
                onClick={() => setStationFilter('hot_dogs')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  stationFilter === 'hot_dogs'
                    ? 'bg-tocineta-yellow text-tocineta-bg shadow-sm'
                    : 'text-tocineta-muted hover:text-white'
                }`}
              >
                🌭 Hot Dogs
              </button>
            </div>
          </div>

          {/* Botones de Control: Sonido, Refresco y Resumen */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleSound}
              title={soundActive ? 'Silenciar Alertas' : 'Activar Alertas de Audio'}
              className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
                soundActive
                  ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                  : 'bg-zinc-800/80 border-zinc-700 text-zinc-400'
              }`}
            >
              <span>{soundActive ? '🔊' : '🔇'}</span>
              <span className="hidden sm:inline">{soundActive ? 'Sonido ON' : 'Silencio'}</span>
            </button>

            <button
              onClick={() => refetch()}
              className="p-2 rounded-xl bg-tocineta-bg border border-tocineta-border text-tocineta-muted hover:text-white transition-colors"
              title="Refrescar Comandas"
            >
              🔄
            </button>
          </div>
        </div>

        {/* Pestañas para Pantallas Pequeñas (Celulares) */}
        <div className="flex md:hidden gap-1 mt-3 pt-2 border-t border-tocineta-border/50">
          <button
            onClick={() => setMobileTab('pendiente')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold text-center transition-all ${
              mobileTab === 'pendiente'
                ? 'bg-zinc-700 text-white shadow-sm'
                : 'text-tocineta-muted bg-tocineta-bg'
            }`}
          >
            Pendientes ({pendientes.length})
          </button>
          <button
            onClick={() => setMobileTab('preparando')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold text-center transition-all ${
              mobileTab === 'preparando'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-tocineta-muted bg-tocineta-bg'
            }`}
          >
            En Preparación ({preparando.length})
          </button>
          <button
            onClick={() => setMobileTab('listo')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold text-center transition-all ${
              mobileTab === 'listo'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-tocineta-muted bg-tocineta-bg'
            }`}
          >
            Listas ({listas.length})
          </button>
        </div>
      </div>

      {/* Tablero Kanban de 3 Columnas: PENDIENTE | EN PREPARACIÓN | LISTO PARA ENTREGAR */}
      <div className="flex-1 overflow-x-auto p-3 sm:p-4">
        {isLoading && orders.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-tocineta-muted gap-3">
            <div className="text-3xl animate-bounce">🥓</div>
            <div className="text-sm">Cargando comandas activas...</div>
          </div>
        ) : isError ? (
          <div className="h-full flex flex-col items-center justify-center text-red-400 gap-3">
            <div className="text-2xl">⚠️</div>
            <div className="text-sm">Error de conexión al servidor Fastify</div>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 bg-red-900/40 border border-red-500/50 rounded-xl text-xs font-bold"
            >
              Reintentar
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full min-w-[320px]">
            {/* COLUMNA 1: PENDIENTE */}
            <div
              className={`flex flex-col bg-zinc-900/60 rounded-2xl border border-zinc-800 overflow-hidden ${
                mobileTab !== 'pendiente' ? 'hidden md:flex' : 'flex'
              }`}
            >
              <div className="px-4 py-2.5 bg-zinc-800/80 border-b border-zinc-700/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-zinc-400" />
                  <span className="font-black text-xs uppercase tracking-wider text-zinc-300">
                    PENDIENTE
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-200 text-xs font-mono font-bold">
                  {pendientes.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {pendientes.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-xs text-zinc-500 font-medium">
                    Sin comandas pendientes
                  </div>
                ) : (
                  pendientes.map(ord => (
                    <OrderCard
                      key={ord.orderId}
                      order={ord}
                      stationFilter={stationFilter}
                      onUpdateLine={(lineId, st) => updateLineMutation.mutate({ lineId, status: st })}
                      onDeliver={(orderId) => deliverOrderMutation.mutate({ orderId })}
                      canForceComplete={isGodModeUser}
                      onForceComplete={(orderId) => forceCompleteMutation.mutate(orderId)}
                    />
                  ))
                )}
              </div>
            </div>

            {/* COLUMNA 2: EN PREPARACIÓN */}
            <div
              className={`flex flex-col bg-amber-950/20 rounded-2xl border border-amber-900/40 overflow-hidden ${
                mobileTab !== 'preparando' ? 'hidden md:flex' : 'flex'
              }`}
            >
              <div className="px-4 py-2.5 bg-amber-900/40 border-b border-amber-800/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                  <span className="font-black text-xs uppercase tracking-wider text-amber-200">
                    EN PREPARACIÓN
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-amber-800 text-amber-100 text-xs font-mono font-bold">
                  {preparando.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {preparando.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-xs text-zinc-500 font-medium">
                    Sin comandas en preparación
                  </div>
                ) : (
                  preparando.map(ord => (
                    <OrderCard
                      key={ord.orderId}
                      order={ord}
                      stationFilter={stationFilter}
                      onUpdateLine={(lineId, st) => updateLineMutation.mutate({ lineId, status: st })}
                      onDeliver={(orderId) => deliverOrderMutation.mutate({ orderId })}
                      canForceComplete={isGodModeUser}
                      onForceComplete={(orderId) => forceCompleteMutation.mutate(orderId)}
                    />
                  ))
                )}
              </div>
            </div>

            {/* COLUMNA 3: LISTO PARA ENTREGAR */}
            <div
              className={`flex flex-col bg-emerald-950/20 rounded-2xl border border-emerald-900/40 overflow-hidden ${
                mobileTab !== 'listo' ? 'hidden md:flex' : 'flex'
              }`}
            >
              <div className="px-4 py-2.5 bg-emerald-900/40 border-b border-emerald-800/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <span className="font-black text-xs uppercase tracking-wider text-emerald-200">
                    LISTO PARA ENTREGAR
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-emerald-800 text-emerald-100 text-xs font-mono font-bold">
                  {listas.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {listas.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-xs text-zinc-500 font-medium">
                    Sin comandas listas por entregar
                  </div>
                ) : (
                  listas.map(ord => (
                    <OrderCard
                      key={ord.orderId}
                      order={ord}
                      stationFilter={stationFilter}
                      onUpdateLine={(lineId, st) => updateLineMutation.mutate({ lineId, status: st })}
                      onDeliver={(orderId) => deliverOrderMutation.mutate({ orderId })}
                      canForceComplete={false}
                      onForceComplete={(orderId) => forceCompleteMutation.mutate(orderId)}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Tarjeta individual de orden para el cocinero
interface OrderCardProps {
  order: KdsOrder;
  stationFilter: StationFilter;
  onUpdateLine: (lineId: string, status: 'pendiente' | 'preparando' | 'listo') => void;
  onDeliver: (orderId: string) => void;
  canForceComplete?: boolean;
  onForceComplete?: (orderId: string) => void;
}

const OrderCard: React.FC<OrderCardProps> = ({
  order,
  stationFilter,
  onUpdateLine,
  onDeliver,
  canForceComplete,
  onForceComplete
}) => {
  const visibleLines = stationFilter === 'all'
    ? order.lines
    : order.lines.filter(l => l.station === stationFilter);

  const readyCount = visibleLines.filter(l => l.status === 'listo').length;
  const totalCount = visibleLines.length;
  const allVisibleReady = visibleLines.length > 0 && visibleLines.every(l => l.status === 'listo');

  // Tipo de entrega tag
  const fulfillmentTag = () => {
    switch (order.fulfillmentType) {
      case 'salon':
        return `🍽️ Salón ${order.tableNumber ? `(${order.tableNumber})` : ''}`;
      case 'para_llevar':
        return '🥡 Para Llevar';
      case 'delivery':
        return '🛵 Delivery';
      default:
        return order.fulfillmentType;
    }
  };

  return (
    <div
      className={`rounded-2xl border transition-all duration-200 shadow-md ${
        order.isRefire
          ? 'bg-rose-950/40 border-rose-500 shadow-rose-950/50'
          : allVisibleReady
          ? 'bg-emerald-950/30 border-emerald-500/60'
          : 'bg-zinc-800/80 border-zinc-700/80 hover:border-zinc-600'
      }`}
    >
      {/* Banner de Reposición Urgente Sin Cobro */}
      {order.isRefire && (
        <div className="bg-rose-600 px-3 py-1.5 rounded-t-2xl text-white font-black text-[11px] tracking-wider uppercase flex items-center justify-between animate-pulse">
          <span>🚨 REPOSICIÓN URGENTE SIN COBRO 🚨</span>
          <span className="text-[10px] font-normal opacity-90">{order.refireReason || ''}</span>
        </div>
      )}

      {/* Cabecera de la Comanda: Turno Gigante, Contador de Platos y Cronómetro */}
      <div className="p-3 border-b border-zinc-700/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Turno Gigante T-023 */}
          <div className="px-2.5 py-1 rounded-xl bg-tocineta-yellow text-tocineta-bg font-black text-base sm:text-lg font-mono tracking-wider shadow-sm">
            {order.turnCode}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-zinc-300">#{order.orderNumber}</span>
              {/* Contador de avance: X/Y platos listos */}
              <span className="px-2 py-0.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs font-mono font-bold text-amber-300">
                {readyCount}/{totalCount} platos listos
              </span>
            </div>
            <div className="text-[11px] text-tocineta-muted font-medium">{fulfillmentTag()}</div>
          </div>
        </div>

        {/* Cronómetro en vivo con guardia H-12 */}
        <StopwatchBadge
          passedAtMs={
            !order.kitchenPassedAtMs || order.kitchenPassedAtMs <= 0 || isNaN(order.kitchenPassedAtMs)
              ? (order.createdAtMs && order.createdAtMs > 0 ? order.createdAtMs : Date.now())
              : order.kitchenPassedAtMs
          }
        />
      </div>

      {/* Indicador de Estación Compuesta y Coordinación de Cocina */}
      {order.isComposite && (
        <div className="px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800 flex items-center justify-between text-[11px]">
          <span className="text-zinc-400">Pedido con varios platos:</span>
          {order.missingStations.length === 0 ? (
            <span className="text-emerald-400 font-bold">✅ Todas las estaciones listas</span>
          ) : order.missingStations.includes('hot_dogs') && !order.missingStations.includes('hamburguesas') ? (
            <span className="text-amber-400 font-bold bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800">
              ⚠️ Esperar Hot Dogs
            </span>
          ) : order.missingStations.includes('hamburguesas') && !order.missingStations.includes('hot_dogs') ? (
            <span className="text-amber-400 font-bold bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800">
              ⚠️ Esperar Hamburguesas
            </span>
          ) : (
            <span className="text-zinc-400">Ambas estaciones preparando</span>
          )}
        </div>
      )}

      {/* Datos del Cliente si existen */}
      {(order.customerName || order.notes) && (
        <div className="px-3 py-1 bg-zinc-900/40 text-[11px] text-zinc-400 border-b border-zinc-800/60">
          {order.customerName && <span className="font-semibold text-zinc-300">Cliente: {order.customerName} </span>}
          {order.notes && <span className="text-amber-300 font-medium">• Nota: {order.notes}</span>}
        </div>
      )}

      {/* Lista de Líneas de Preparación con control individual */}
      <div className="p-3 space-y-2.5">
        {visibleLines.map(line => (
          <div
            key={line.lineId}
            className={`p-2.5 rounded-xl border transition-all ${
              line.status === 'listo'
                ? 'bg-emerald-950/30 border-emerald-500/40 opacity-75'
                : line.status === 'preparando'
                ? 'bg-amber-950/30 border-amber-500/50'
                : 'bg-zinc-900/60 border-zinc-700/60'
            }`}
          >
            {/* Título de la línea, badge individual y botón táctil */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-extrabold text-sm text-white">
                    {line.quantity}x {line.productName}
                  </span>
                  {/* Badge de estado individual */}
                  {line.status === 'pendiente' && (
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono font-bold text-[10px] uppercase border border-zinc-700">
                      [PENDIENTE]
                    </span>
                  )}
                  {line.status === 'preparando' && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 font-mono font-bold text-[10px] uppercase border border-amber-500">
                      [PREPARANDO]
                    </span>
                  )}
                  {line.status === 'listo' && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 font-mono font-bold text-[10px] uppercase border border-emerald-500">
                      [LISTO]
                    </span>
                  )}
                </div>
                {line.flavorChoice && (
                  <div className="text-xs font-bold text-amber-300 mt-0.5">
                    ({line.flavorChoice})
                  </div>
                )}
              </div>

              {/* Botones táctiles de acción individual por línea (min-h-[48px] y Revertir - H-09) */}
              <div className="shrink-0 flex items-center gap-1.5">
                {line.status === 'pendiente' && (
                  <button
                    type="button"
                    onClick={() => onUpdateLine(line.lineId, 'preparando')}
                    className="min-h-[48px] px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-amber-500 hover:bg-amber-400 text-black shadow-sm transition-all active:scale-95 flex items-center justify-center"
                  >
                    [▶ Empezar]
                  </button>
                )}

                {line.status === 'preparando' && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onUpdateLine(line.lineId, 'listo')}
                      className="min-h-[48px] px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-black shadow-sm transition-all active:scale-95 flex items-center justify-center"
                    >
                      [✓ Listo]
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateLine(line.lineId, 'pendiente')}
                      className="min-h-[48px] px-2.5 py-2 rounded-xl text-[11px] font-bold text-zinc-400 hover:text-white bg-zinc-800 border border-zinc-700 hover:border-zinc-500 transition-all active:scale-95 flex items-center justify-center"
                      title="Revertir a Pendiente"
                    >
                      ↺ Revertir
                    </button>
                  </div>
                )}

                {line.status === 'listo' && (
                  <div className="flex items-center gap-1.5">
                    <span className="min-h-[48px] px-3 py-2 rounded-xl text-xs font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-500/40 flex items-center gap-1">
                      ✓ Plato Listo
                    </span>
                    <button
                      type="button"
                      onClick={() => onUpdateLine(line.lineId, 'preparando')}
                      className="min-h-[48px] px-2.5 py-2 rounded-xl text-[11px] font-bold text-zinc-400 hover:text-amber-300 bg-zinc-800 border border-zinc-700 hover:border-amber-500/50 transition-all active:scale-95 flex items-center justify-center"
                      title="Revertir a Preparando"
                    >
                      ↺ Revertir
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Modificadores Críticos (Alto Contraste: Rojo / Ámbar) */}
            {line.criticalModifiers.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {line.criticalModifiers.map((mod, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/30 border border-rose-500 text-rose-200 font-black text-xs tracking-wide uppercase shadow-sm"
                  >
                    <span>⚠️</span>
                    <span>{mod}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Extras y Barra Libre */}
            {line.barraLibreModifiers.length > 0 && (
              <div className="mt-1.5 text-xs text-amber-300 font-semibold">
                + AGREGAR (Barra Libre): {line.barraLibreModifiers.join(', ')}
              </div>
            )}
            {line.ingredientExtras.length > 0 && (
              <div className="mt-1 text-xs text-emerald-300 font-semibold">
                {line.ingredientExtras.join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pie de la tarjeta: Botón general [🚀 Despachar / Entregar Orden] evaluando allStationsReady (H-03) */}
      <div className="p-3 pt-0">
        {allVisibleReady && (!order.allStationsReady || (order.missingStations && order.missingStations.length > 0)) ? (
          <div className="w-full min-h-[48px] py-2.5 px-3 rounded-xl bg-amber-950/40 border border-amber-500/50 text-amber-300 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 text-center cursor-not-allowed shadow">
            <span>✓ Estación completada (esperando otras estaciones)</span>
          </div>
        ) : (
          <button
            type="button"
            disabled={!allVisibleReady || !order.allStationsReady}
            onClick={() => allVisibleReady && order.allStationsReady && onDeliver(order.orderId)}
            className={`w-full min-h-[48px] py-2.5 rounded-xl font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all ${
              allVisibleReady && order.allStationsReady
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/60 active:scale-[0.98] cursor-pointer'
                : 'bg-zinc-800 text-zinc-500 border border-zinc-700/60 opacity-60 cursor-not-allowed'
            }`}
          >
            <span>🚀</span>
            <span>Despachar / Entregar Orden</span>
          </button>
        )}

        {/* Botón God Mode: [⚡ Despachar Orden Completa] (Columnas 1 y 2) */}
        {canForceComplete && (
          <button
            type="button"
            title="Forzar Despacho Total"
            aria-label="Forzar Despacho Total"
            onClick={() => onForceComplete?.(order.orderId)}
            className="w-full min-h-[48px] mt-2 py-2.5 px-3 rounded-xl font-black text-xs uppercase tracking-wider bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black shadow-lg shadow-amber-950/40 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>⚡</span>
            <span>Despachar Orden Completa</span>
          </button>
        )}
      </div>
    </div>
  );
};
