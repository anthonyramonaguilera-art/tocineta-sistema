import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Icon, Button } from '../../ui/index.js';
import { getOutboxCount, subscribeToOutboxCount } from '../pos/outbox.js';
import { DispatchNoteSuccessModal, type DispatchNoteInfo } from '../profitability/components/DispatchNoteSuccessModal.js';

export const OwnerDashboardView: React.FC = () => {
  const queryClient = useQueryClient();
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [outboxCount, setOutboxCount] = useState(0);
  const [selectedNote, setSelectedNote] = useState<DispatchNoteInfo | null>(null);

  // 1. Monitoreo de Conexión y Cola Outbox en Vivo
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const unsubscribe = subscribeToOutboxCount((count) => {
      setOutboxCount(count);
    });

    getOutboxCount().then(setOutboxCount).catch(() => {});

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, []);

  // 2. Conexión WebSocket para Actualización en Tiempo Real
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;

    const connectWs = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Si es un evento de negocio, refrescar métricas
          if (data.eventType || data.event) {
            queryClient.invalidateQueries({ queryKey: ['fase4OwnerDashboard'] });
          }
        } catch {}
      };

      ws.onclose = () => {
        reconnectTimeout = setTimeout(connectWs, 3000);
      };
    };

    connectWs();

    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [queryClient]);

  // 3. Consulta de Datos del Dashboard
  const { data: dashData, isLoading, refetch } = useQuery<{
    success: boolean;
    dashboard: any;
  }>({
    queryKey: ['fase4OwnerDashboard'],
    queryFn: async () => {
      const res = await fetch('/api/fase4/owner-dashboard');
      return res.json();
    },
    refetchInterval: 10000
  });

  const dashboard = dashData?.dashboard;
  const sales = dashboard?.salesByLocation || [];
  const cash = dashboard?.cashByLocation || [];
  const lowStock = dashboard?.lowStockAlerts || [];
  const transfers = dashboard?.recentTransfers || [];
  const receivables = dashboard?.pendingReceivables || { totalPendingUsdCents: 0, pendingOrdersCount: 0, ordersByLocation: {} };

  // Totales consolidados de venta hoy
  const totalNetUsd = sales.reduce((acc: number, s: any) => acc + (s.netSalesUsdCents || 0), 0);
  const totalOrdersCount = sales.reduce((acc: number, s: any) => acc + (s.totalOrders || 0), 0);

  const handleOpenTransferDetail = async (transferId: string) => {
    try {
      const res = await fetch(`/api/fase4/transfers?limit=100`);
      const data = await res.json();
      const trf = data.transfers?.find((t: any) => t.id === transferId);
      if (trf) {
        setSelectedNote({
          id: trf.id,
          dispatchNoteCode: trf.dispatch_note_code,
          fromLocationId: trf.from_location_id,
          toLocationId: trf.to_location_id,
          status: trf.status,
          items: trf.items || [],
          totalCostUsdCents: trf.total_cost_usd_cents,
          notes: trf.notes
        });
      }
    } catch {}
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 animate-in fade-in pb-16">
      {/* Barra Superior con Indicador de Dispositivo */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-3xl bg-surface border border-border shadow-xs">
        <div>
          <span className="text-[10px] font-black tracking-widest uppercase text-primary block">
            SUPERVISIÓN EJECUTIVA EN VIVO
          </span>
          <h2 className="text-lg font-black text-ink uppercase tracking-tight">
            Panel de la Dueña — TOCINETA
          </h2>
        </div>

        {/* Indicador por dispositivo y estado de jornada */}
        <div className="flex items-center gap-2 flex-wrap">
          {dashboard?.isJornadaOpen && dashboard?.jornadaOpenedAtMs ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-primary/10 border border-primary/30 text-ink">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span>Jornada abierta desde {new Date(dashboard.jornadaOpenedAtMs).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-surface-alt border border-border text-ink-muted">
              <span className="w-2 h-2 rounded-full bg-border" />
              <span>Jornada cerrada</span>
            </div>
          )}

          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
              isOnline
                ? 'bg-success/10 border-success/30 text-success'
                : 'bg-danger/10 border-danger/30 text-danger'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-success animate-pulse' : 'bg-danger'}`} />
            <span>{isOnline ? 'En línea' : 'Sin conexión'}</span>
            <span className="text-ink-muted">·</span>
            <span>{outboxCount} {outboxCount === 1 ? 'pedido en cola' : 'pedidos en cola'}</span>
          </div>

          <button
            type="button"
            onClick={() => refetch()}
            className="p-2 rounded-xl border border-border bg-surface-alt hover:bg-surface text-ink text-xs font-bold"
            title="Refrescar métricas"
          >
            <Icon name="RefreshCw" size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Tarjeta Destacada: Consolidado Total Hoy */}
      <div className="p-5 rounded-3xl bg-primary text-primary-contrast shadow-md flex items-center justify-between">
        <div>
          <span className="text-xs font-bold opacity-80 uppercase tracking-wider block">
            Ventas Consolidadas de Hoy (Ambas Sedes)
          </span>
          <div className="text-3xl font-black tracking-tight mt-1">
            ${(totalNetUsd / 100).toFixed(2)}
          </div>
          <span className="text-xs opacity-90 block mt-1">
            {totalOrdersCount} órdenes despachadas hoy
          </span>
        </div>
        <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center">
          <Icon name="TrendingUp" size={24} />
        </div>
      </div>

      {/* Sección 1: Ventas de Hoy por Sede */}
      <div className="space-y-3">
        <h3 className="text-xs font-black text-ink uppercase tracking-wider flex items-center gap-1.5">
          <Icon name="Store" size={16} className="text-primary" />
          <span>Ventas de Hoy por Sede</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sales.map((s: any) => (
            <div key={s.locationId} className="p-4 rounded-3xl bg-surface border border-border shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-black text-sm text-ink">{s.locationName}</h4>
                  <span className="text-[11px] text-ink-muted">{s.totalOrders} órdenes facturadas</span>
                </div>
                <div className="text-right">
                  <div className="font-black text-base text-ink">
                    ${((s.netSalesUsdCents || 0) / 100).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-ink-muted font-bold">
                    Bs {((s.netSalesBsCents || 0) / 100).toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-center text-[11px] pt-2 border-t border-border">
                <div className="p-1.5 rounded-xl bg-surface-alt">
                  <span className="text-ink-muted block text-[9px] uppercase font-bold">Salón</span>
                  <span className="font-black text-ink">{s.salonOrdersCount}</span>
                </div>
                <div className="p-1.5 rounded-xl bg-surface-alt">
                  <span className="text-ink-muted block text-[9px] uppercase font-bold">Llevar</span>
                  <span className="font-black text-ink">{s.takeoutOrdersCount}</span>
                </div>
                <div className="p-1.5 rounded-xl bg-surface-alt">
                  <span className="text-ink-muted block text-[9px] uppercase font-bold">Delivery</span>
                  <span className="font-black text-ink">{s.deliveryOrdersCount}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sección 2: Caja y Disponibilidad por Sede */}
      <div className="space-y-3">
        <h3 className="text-xs font-black text-ink uppercase tracking-wider flex items-center gap-1.5">
          <Icon name="DollarSign" size={16} className="text-primary" />
          <span>Caja y Efectivo por Sede</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {cash.map((c: any) => (
            <div key={c.locationId} className="p-4 rounded-3xl bg-surface border border-border shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-black text-xs text-ink">{c.locationName}</span>
                <Badge variant={c.hasOpenSession ? 'success' : 'neutral'} size="sm">
                  {c.hasOpenSession ? 'Caja activa' : 'Caja cerrada'}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                <div className="p-2 rounded-xl bg-surface-alt">
                  <span className="text-ink-muted block text-[10px] uppercase font-bold">Efectivo USD</span>
                  <span className="font-black text-ink text-sm">${((c.cashUsdCents || 0) / 100).toFixed(2)}</span>
                </div>
                <div className="p-2 rounded-xl bg-surface-alt">
                  <span className="text-ink-muted block text-[10px] uppercase font-bold">Efectivo Bs</span>
                  <span className="font-black text-ink text-sm">Bs {((c.cashBsCents || 0) / 100).toFixed(2)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sección 3: Cuentas por Cobrar */}
      <div className="p-4 rounded-3xl bg-surface border border-border shadow-xs flex items-center justify-between">
        <div>
          <span className="text-[10px] font-black text-ink-muted uppercase tracking-wider block">
            Cuentas por Cobrar (Pendientes de Cobro)
          </span>
          <div className="font-black text-lg text-ink mt-0.5">
            ${((receivables.totalPendingUsdCents || 0) / 100).toFixed(2)}
          </div>
          <span className="text-xs text-ink-muted block">
            {receivables.pendingOrdersCount} órdenes esperando cobro
          </span>
        </div>
        <Badge variant={receivables.pendingOrdersCount > 0 ? 'warning' : 'success'} size="md">
          {receivables.pendingOrdersCount > 0 ? 'Cobro Pendiente' : 'Al Día'}
        </Badge>
      </div>

      {/* Sección 4: Alertas de Stock Bajo Crítico */}
      <div className="space-y-3">
        <h3 className="text-xs font-black text-ink uppercase tracking-wider flex items-center gap-1.5">
          <Icon name="AlertTriangle" size={16} className="text-warning" />
          <span>Alertas de Stock Bajo Crítico ({lowStock.length})</span>
        </h3>

        {lowStock.length === 0 ? (
          <div className="p-4 rounded-2xl bg-surface-alt border border-border text-center text-xs text-ink-muted">
            Todos los insumos tienen niveles óptimos de inventario.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
            {lowStock.map((ls: any, i: number) => (
              <div
                key={i}
                className="p-3 rounded-2xl bg-surface border border-warning/30 flex items-center justify-between text-xs shadow-xs"
              >
                <div>
                  <div className="font-bold text-ink">{ls.supplyName}</div>
                  <div className="text-[10px] text-ink-muted">{ls.locationName}</div>
                </div>
                <div className="text-right">
                  <span className="font-black text-danger">{ls.currentStock} {ls.unit}</span>
                  <span className="text-[10px] text-ink-muted block">Mín: {ls.minimumStock} {ls.unit}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sección 5: Envíos Recientes entre Sedes */}
      <div className="space-y-3">
        <h3 className="text-xs font-black text-ink uppercase tracking-wider flex items-center gap-1.5">
          <Icon name="Truck" size={16} className="text-primary" />
          <span>Envíos Recientes entre Sedes</span>
        </h3>

        {transfers.length === 0 ? (
          <div className="p-4 rounded-2xl bg-surface-alt border border-border text-center text-xs text-ink-muted">
            No hay transferencias registradas recientemente.
          </div>
        ) : (
          <div className="space-y-2">
            {transfers.map((trf: any) => (
              <div
                key={trf.id}
                className="p-3.5 rounded-2xl bg-surface border border-border flex items-center justify-between text-xs shadow-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-black text-ink">{trf.dispatchNoteCode}</span>
                    <Badge variant={trf.status === 'COMPLETADO' || trf.status === 'RECIBIDO' ? 'success' : 'warning'} size="sm">
                      {trf.status}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-ink-muted mt-0.5 flex items-center gap-1">
                    <span>{trf.fromLocationName}</span>
                    <Icon name="ArrowRight" size={10} className="text-ink-muted" />
                    <span>{trf.toLocationName}</span>
                    <span>· {trf.itemsCount} insumos</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpenTransferDetail(trf.id)}
                >
                  Ver / Compartir
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal para ver comprobante y compartir por WhatsApp */}
      <DispatchNoteSuccessModal
        isOpen={Boolean(selectedNote)}
        onClose={() => setSelectedNote(null)}
        note={selectedNote}
      />
    </div>
  );
};
