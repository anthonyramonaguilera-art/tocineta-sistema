import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.js';
import type { CashierOrder } from './types.js';
import { useMultiTabCashierGuard } from './useMultiTabCashierGuard.js';
import { DrinksChecklist } from './DrinksChecklist.js';
import { MultiMethodCalculator } from './MultiMethodCalculator.js';
import { PrintAttentionModal } from './PrintAttentionModal.js';
import { TicketPreviewModal } from './TicketPreviewModal.js';
import { usdToBsCents } from '@tocineta/shared';

export const CashierView: React.FC = () => {
  const { user } = useAuth();
  const { isBlocked, takeControl } = useMultiTabCashierGuard();

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [lastPaidOrderId, setLastPaidOrderId] = useState<string | null>(null);

  // Estados de Apertura de Jornada
  const [showOpenModal, setShowOpenModal] = useState<boolean>(false);
  const [openRateStr, setOpenRateStr] = useState<string>('36.60');
  const [initialCashUsd, setInitialCashUsd] = useState<string>('50.00');
  const [initialCashBs, setInitialCashBs] = useState<string>('1830.00');

  // Consultar jornada activa
  const { data: jornadaData, refetch: refetchJornada } = useQuery<{ success: boolean; jornada: any }>({
    queryKey: ['currentJornada'],
    queryFn: async () => {
      const res = await fetch('/api/jornadas/current');
      if (!res.ok) return { success: false, jornada: null };
      return res.json();
    },
    refetchInterval: 10000
  });

  // Consultar órdenes por cobrar
  const { data: ordersData, refetch: refetchOrders, isLoading: isLoadingOrders } = useQuery<{
    success: boolean;
    orders: CashierOrder[];
  }>({
    queryKey: ['cashierOrders'],
    queryFn: async () => {
      const res = await fetch('/api/orders');
      if (!res.ok) return { success: false, orders: [] };
      return res.json();
    },
    refetchInterval: 5000
  });

  const currentRateMicroBs = jornadaData?.jornada?.current_rate_micro_bs || 36600000;

  // Filtrar órdenes pendientes de cobro
  const pendingOrders = (ordersData?.orders || []).filter(o =>
    o.payment_status === 'sin_pago' ||
    o.payment_status === 'parcial' ||
    o.payment_status === 'autorizado_sin_pago'
  );

  const selectedOrder = pendingOrders.find(o => o.id === selectedOrderId) || null;

  // Manejador de apertura de jornada
  const handleOpenJornada = async () => {
    try {
      const res = await fetch('/api/jornadas/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rateStr: openRateStr,
          initialCashUsdCents: Math.round(parseFloat(initialCashUsd || '0') * 100),
          initialCashBsCents: Math.round(parseFloat(initialCashBs || '0') * 100)
        })
      });
      if (res.ok) {
        setShowOpenModal(false);
        refetchJornada();
      }
    } catch (err) {
      console.error('Error al abrir jornada:', err);
    }
  };

  // Bloqueo multi-pestaña activo
  if (isBlocked) {
    return (
      <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
        <div className="bg-tocineta-card border-2 border-amber-500 rounded-3xl p-6 max-w-md w-full text-center space-y-4 shadow-2xl animate-in zoom-in-95">
          <span className="text-5xl block animate-bounce">⚠️</span>
          <h2 className="text-xl font-black text-white">Sesión de Caja Activa en Otra Pestaña</h2>
          <p className="text-xs text-tocineta-muted leading-relaxed">
            Para prevenir discrepancias en el arqueo de caja y dobles cobros, solo se permite una pestaña de Caja abierta simultáneamente en este equipo.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={takeControl}
              className="w-full min-h-[50px] rounded-2xl bg-tocineta-yellow text-tocineta-bg font-black text-sm hover:bg-tocineta-yellow-hover active:scale-95 transition-all shadow-lg"
            >
              Tomar el Control en Esta Pestaña
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      
      {/* BANNER DE ÉXITO */}
      {successBanner && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border-2 border-emerald-500/60 text-emerald-300 font-bold text-sm flex items-center justify-between shadow-lg animate-in fade-in">
          <div className="flex items-center gap-3">
            <span>{successBanner}</span>
            {lastPaidOrderId && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/print-jobs?orderId=${lastPaidOrderId}&limit=1`);
                    if (res.ok) {
                      const d = await res.json();
                      if (d.data?.length > 0) {
                        setPreviewJobId(d.data[0].id);
                      }
                    }
                  } catch (err) {
                    console.error('Error al obtener job:', err);
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all shadow active:scale-95 flex items-center gap-1.5"
              >
                <span>👁️</span> Ver Ticket
              </button>
            )}
          </div>
          <button
            onClick={() => setSuccessBanner(null)}
            className="text-xs font-bold px-2 py-1 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* CABECERA DE JORNADA Y ESTADO DE CAJA */}
      <div className="bg-tocineta-card border border-tocineta-border rounded-3xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-tocineta-yellow/10 border border-tocineta-yellow/30 flex items-center justify-center text-2xl">
            🏦
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-white">Módulo de Caja y Cuadre Financiero</h2>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                jornadaData?.jornada?.status === 'abierta'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              }`}>
                Jornada {jornadaData?.jornada?.status || 'Sin Apertura'}
              </span>
            </div>
            <p className="text-xs text-tocineta-muted mt-0.5">
              Cajera: <span className="text-white font-bold">{user?.name}</span> • Tasa BCV Oficial:{' '}
              <span className="text-tocineta-yellow font-mono font-bold">
                {(currentRateMicroBs / 1_000_000).toFixed(4)} Bs/$
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(!jornadaData?.jornada || jornadaData?.jornada?.status !== 'abierta') && (
            <button
              type="button"
              onClick={() => setShowOpenModal(true)}
              className="min-h-[46px] px-4 rounded-2xl bg-tocineta-yellow text-tocineta-bg font-black text-xs hover:bg-tocineta-yellow-hover active:scale-95 transition-all shadow-md"
            >
              + Abrir Jornada de Turno
            </button>
          )}
          <button
            type="button"
            onClick={() => refetchOrders()}
            className="min-h-[46px] px-3.5 rounded-2xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow text-xs font-bold text-white active:scale-95 transition-all"
          >
            🔄 Actualizar Cola
          </button>
        </div>
      </div>

      {/* MODAL DE APERTURA DE JORNADA */}
      {showOpenModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in">
          <div className="bg-tocineta-card border border-tocineta-border rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="font-black text-base text-white">Apertura Oficial de Jornada</h3>
            <p className="text-xs text-tocineta-muted">
              Confirme la tasa BCV oficial del turno y el fondo inicial disponible en gaveta.
            </p>

            <div className="space-y-3">
              <div>
                <span className="text-[11px] font-bold text-tocineta-muted block mb-1">
                  Tasa BCV del Día (Bs/$):
                </span>
                <input
                  type="text"
                  value={openRateStr}
                  onChange={e => setOpenRateStr(e.target.value)}
                  className="w-full min-h-[46px] bg-tocineta-bg border border-tocineta-border rounded-xl px-4 text-sm font-mono font-bold text-white outline-none focus:border-tocineta-yellow"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[11px] font-bold text-tocineta-muted block mb-1">
                    Fondo Inicial USD ($):
                  </span>
                  <input
                    type="number"
                    value={initialCashUsd}
                    onChange={e => setInitialCashUsd(e.target.value)}
                    className="w-full min-h-[46px] bg-tocineta-bg border border-tocineta-border rounded-xl px-4 text-sm font-mono font-bold text-white outline-none focus:border-tocineta-yellow"
                  />
                </div>
                <div>
                  <span className="text-[11px] font-bold text-tocineta-muted block mb-1">
                    Fondo Inicial Bs:
                  </span>
                  <input
                    type="number"
                    value={initialCashBs}
                    onChange={e => setInitialCashBs(e.target.value)}
                    className="w-full min-h-[46px] bg-tocineta-bg border border-tocineta-border rounded-xl px-4 text-sm font-mono font-bold text-white outline-none focus:border-tocineta-yellow"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowOpenModal(false)}
                className="w-1/3 min-h-[48px] rounded-xl bg-tocineta-bg border border-tocineta-border text-xs font-bold text-tocineta-muted hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleOpenJornada}
                className="w-2/3 min-h-[48px] rounded-xl bg-tocineta-yellow text-tocineta-bg font-black text-xs hover:bg-tocineta-yellow-hover"
              >
                Confirmar Apertura
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DISPOSICIÓN PRINCIPAL EN DOS COLUMNAS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        
        {/* COLUMNA IZQUIERDA: COLA EN VIVO DE PEDIDOS POR COBRAR (5 COLS) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-tocineta-muted">
              Órdenes Por Cobrar ({pendingOrders.length})
            </span>
            <span className="text-[11px] text-tocineta-muted">Mesoneros y Salón</span>
          </div>

          {isLoadingOrders ? (
            <div className="py-12 text-center text-tocineta-yellow">
              <span className="text-2xl animate-spin inline-block">⏳</span>
              <p className="text-xs font-bold mt-2">Cargando comandas en vivo...</p>
            </div>
          ) : pendingOrders.length === 0 ? (
            <div className="bg-tocineta-card border border-tocineta-border rounded-3xl p-8 text-center space-y-2">
              <span className="text-3xl block opacity-40">🎉</span>
              <p className="text-sm font-bold text-white">¡No hay pedidos pendientes de cobro!</p>
              <p className="text-xs text-tocineta-muted">
                Todas las órdenes recibidas han sido cobradas o están en preparación.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[78vh] overflow-y-auto pr-1">
              {pendingOrders.map(o => {
                const isSelected = o.id === selectedOrderId;
                const bsAmount = usdToBsCents(o.total_to_collect_usd_cents, currentRateMicroBs);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setSelectedOrderId(o.id)}
                    className={`w-full min-h-[58px] p-4 rounded-3xl border text-left transition-all flex flex-col justify-between gap-2 active:scale-98 shadow-md ${
                      isSelected
                        ? 'bg-tocineta-yellow/15 border-tocineta-yellow shadow-xl ring-2 ring-tocineta-yellow/30'
                        : 'bg-tocineta-card border-tocineta-border hover:border-tocineta-yellow/60'
                    }`}
                  >
                    <div className="flex items-start justify-between w-full">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-base text-white">Orden #{o.order_number}</span>
                          <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-tocineta-bg text-tocineta-yellow border border-tocineta-border">
                            {o.table_number}
                          </span>
                        </div>
                        <p className="text-[11px] text-tocineta-muted mt-0.5">
                          {o.lines?.length || 0} plato(s) • Mesonero: {o.created_by_name || 'Carlos'}
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="font-mono font-black text-base text-tocineta-yellow block">
                          ${(o.total_to_collect_usd_cents / 100).toFixed(2)}
                        </span>
                        <span className="text-[11px] text-tocineta-muted font-mono block">
                          {(bsAmount / 100).toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between w-full pt-2 border-t border-tocineta-border/60 text-[10px]">
                      <span className="text-tocineta-muted uppercase tracking-wider font-semibold">
                        {o.fulfillment_type === 'salon' ? '🍽️ Salón' : o.fulfillment_type === 'delivery' ? '🛵 Delivery' : '🛍️ Para Llevar'}
                      </span>
                      <span className={`px-2 py-0.5 rounded font-bold uppercase ${
                        o.payment_status === 'autorizado_sin_pago'
                          ? 'bg-purple-500/20 text-purple-300'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}>
                        {o.payment_status === 'autorizado_sin_pago' ? '⚠️ Deuda Abierta' : 'Por Cobrar'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* COLUMNA DERECHA: CALCULADORA MULTIMÉTODO Y BEBIDAS (7 COLS) */}
        <div className="lg:col-span-7 space-y-4">
          {selectedOrder ? (
            <>
              {/* CHECKLIST DE BEBIDAS EN NEVERA */}
              <DrinksChecklist lines={selectedOrder.lines || []} />

              {/* CALCULADORA MULTIMÉTODO INTERACTIVA */}
              <MultiMethodCalculator
                order={selectedOrder}
                rateMicroBs={currentRateMicroBs}
                onPaymentSuccess={() => {
                  const paidId = selectedOrder.id;
                  setSuccessBanner(`✓ ¡Orden #${selectedOrder.order_number} cobrada con éxito y despachada a cocina!`);
                  setLastPaidOrderId(paidId);
                  setSelectedOrderId(null);
                  refetchOrders();
                }}
              />
            </>
          ) : (
            <div className="bg-tocineta-card border border-tocineta-border rounded-3xl p-12 text-center space-y-3 min-h-[400px] flex flex-col items-center justify-center">
              <span className="text-5xl block opacity-30">👈</span>
              <h3 className="text-base font-black text-white">Selecciona una orden de la lista para cobrar</h3>
              <p className="text-xs text-tocineta-muted max-w-sm">
                Haz clic sobre cualquiera de las comandas pendientes a la izquierda para cargar la calculadora multimétodo, vuelto mixto y bebidas.
              </p>
            </div>
          )}
        </div>

      </div>

      {/* MODAL ALERTA DE IMPRESORA CON FALLO */}
      <PrintAttentionModal onOpenTicketPreview={(jobId) => setPreviewJobId(jobId)} />

      {/* MODAL VISTA PREVIA DE TICKET TÉRMICO */}
      {previewJobId && (
        <TicketPreviewModal
          jobId={previewJobId}
          onClose={() => setPreviewJobId(null)}
        />
      )}

    </div>
  );
};
