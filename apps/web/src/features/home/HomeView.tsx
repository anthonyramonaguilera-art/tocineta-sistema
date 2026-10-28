import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Button, Badge, Money, Icon } from '../../ui/index.js';
import type { TabType } from '../../App.js';

interface HomeViewProps {
  onNavigate: (tab: TabType) => void;
  formattedRate?: string;
  userName?: string;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onNavigate,
  formattedRate = '40,00',
  userName = 'Administrador'
}) => {
  // Consultar resumen en vivo de Cierre Z y ventas del día
  const { data: summaryRes } = useQuery<{
    success: boolean;
    summary?: any;
  }>({
    queryKey: ['homeSummary'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/reports/z-report/summary');
        if (res.ok) {
          return res.json();
        }
      } catch {}
      return { success: false };
    },
    refetchInterval: 15000
  });

  // Consultar listado de órdenes del día para métricas complementarias
  const { data: ordersRes } = useQuery<{
    success: boolean;
    orders?: any[];
  }>({
    queryKey: ['homeOrders'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/orders');
        if (res.ok) {
          return res.json();
        }
      } catch {}
      return { success: false, orders: [] };
    },
    refetchInterval: 15000
  });

  const orders = ordersRes?.orders || [];
  const zSummary = summaryRes?.summary;

  // Cálculos reales sin inventar datos
  const totalOrders = zSummary?.totalOrdersCount ?? zSummary?.ordersCount ?? orders.length;

  const totalSalesUsdCents = zSummary?.totalSalesUsdCents ?? zSummary?.grossSalesUsdCents ??
    orders
      .filter((o: any) => o.payment_status === 'pagado')
      .reduce((sum: number, o: any) => sum + (o.total_usd_cents || 0), 0);

  const expectedCashUsdCents = zSummary?.expectedCashUsdCents ?? zSummary?.cashUsdCents ?? 0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Saludo y Estado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface p-5 rounded-2xl border border-border shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-ink tracking-tight">
              Panel Principal
            </h1>
            <Badge variant="primary">ADMIN</Badge>
          </div>
          <p className="text-xs text-ink-muted mt-1">
            Bienvenido, <span className="font-bold text-ink">{userName}</span>. Vista ejecutiva del turno y operaciones en vivo.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="px-3 py-1.5 rounded-xl bg-surface-alt border border-border flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-xs font-bold text-ink">Sistema Operativo</span>
          </div>
        </div>
      </div>

      {/* Tarjetas Grandes de Acción */}
      <div>
        <h2 className="text-xs font-black text-ink-muted uppercase tracking-wider mb-3 px-1">
          Accesos Operativos Rápidos
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
          {/* 1. Tomar Pedido */}
          <Card
            variant="surface"
            onClick={() => onNavigate('pos')}
            className="p-5 flex flex-col justify-between min-h-[140px] hover:border-primary transition-all group border-2"
          >
            <div className="flex items-start justify-between">
              <div className="p-3 rounded-2xl bg-primary/20 border border-primary/30 text-ink group-hover:scale-105 transition-transform">
                <Icon name="ShoppingBag" size={26} />
              </div>
              <Badge variant="neutral">Comandero</Badge>
            </div>
            <div>
              <h3 className="font-black text-base text-ink mt-3">Tomar Pedido</h3>
              <p className="text-xs text-ink-muted mt-0.5">
                Mostrador, Mesas y Delivery con catálogo visual
              </p>
            </div>
          </Card>

          {/* 2. Cocina KDS */}
          <Card
            variant="surface"
            onClick={() => onNavigate('kds')}
            className="p-5 flex flex-col justify-between min-h-[140px] hover:border-primary transition-all group border-2"
          >
            <div className="flex items-start justify-between">
              <div className="p-3 rounded-2xl bg-brand-orange/20 border border-brand-orange/30 text-ink group-hover:scale-105 transition-transform">
                <Icon name="Flame" size={26} />
              </div>
              <Badge variant="neutral">KDS</Badge>
            </div>
            <div>
              <h3 className="font-black text-base text-ink mt-3">Plancha y Cocina</h3>
              <p className="text-xs text-ink-muted mt-0.5">
                Comandas en tiempo real y despacho de órdenes
              </p>
            </div>
          </Card>

          {/* 3. Caja y Cierre */}
          <Card
            variant="surface"
            onClick={() => onNavigate('cashier')}
            className="p-5 flex flex-col justify-between min-h-[140px] hover:border-primary transition-all group border-2"
          >
            <div className="flex items-start justify-between">
              <div className="p-3 rounded-2xl bg-success/20 border border-success/30 text-ink group-hover:scale-105 transition-transform">
                <Icon name="DollarSign" size={26} />
              </div>
              <Badge variant="neutral">Caja</Badge>
            </div>
            <div>
              <h3 className="font-black text-base text-ink mt-3">Caja y Cierre</h3>
              <p className="text-xs text-ink-muted mt-0.5">
                Cobros mixtos, vuelto y arqueo de jornada Z
              </p>
            </div>
          </Card>
        </div>
      </div>

      {/* Números del Día */}
      <div>
        <h2 className="text-xs font-black text-ink-muted uppercase tracking-wider mb-3 px-1">
          Números del Día (Datos Reales)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {/* Ventas de Hoy */}
          <Card variant="alt" className="p-4 sm:p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink-muted uppercase">Ventas de Hoy</span>
              <div className="p-2 rounded-xl bg-surface text-ink border border-border">
                <Icon name="TrendingUp" size={16} />
              </div>
            </div>
            <div className="pt-1">
              <Money
                cents={totalSalesUsdCents}
                rate={formattedRate}
                size="lg"
              />
            </div>
          </Card>

          {/* Pedidos Procesados */}
          <Card variant="alt" className="p-4 sm:p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink-muted uppercase">Pedidos del Día</span>
              <div className="p-2 rounded-xl bg-surface text-ink border border-border">
                <Icon name="Receipt" size={16} />
              </div>
            </div>
            <div className="pt-1">
              <span className="text-2xl font-black text-ink tracking-tight font-mono">
                {totalOrders}
              </span>
              <span className="text-xs text-ink-muted block mt-0.5">órdenes registradas</span>
            </div>
          </Card>

          {/* Efectivo Esperado en Caja */}
          <Card variant="alt" className="p-4 sm:p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink-muted uppercase">Efectivo en Caja</span>
              <div className="p-2 rounded-xl bg-surface text-ink border border-border">
                <Icon name="Banknote" size={16} />
              </div>
            </div>
            <div className="pt-1">
              <Money
                cents={expectedCashUsdCents}
                rate={formattedRate}
                size="lg"
              />
            </div>
          </Card>
        </div>
      </div>

      {/* Enlaces Rápidos a Configuración */}
      <div className="pt-2 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onNavigate('finances')}
          leftIcon={<Icon name="CircleDollarSign" size={15} />}
        >
          Finanzas
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onNavigate('menu-admin')}
          leftIcon={<Icon name="Utensils" size={15} />}
        >
          Administrar Carta y Precios
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onNavigate('quotes')}
          leftIcon={<Icon name="Calculator" size={15} />}
        >
          Cotizador Eventos
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onNavigate('partners')}
          leftIcon={<Icon name="Handshake" size={15} />}
        >
          Socios
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onNavigate('settings')}
          leftIcon={<Icon name="Settings" size={15} />}
        >
          Configuración Negocio
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onNavigate('health')}
          leftIcon={<Icon name="Cpu" size={15} />}
        >
          Salud y Hardware
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            window.location.hash = '#acceso';
          }}
          leftIcon={<Icon name="QrCode" size={15} />}
        >
          Código QR de Acceso Móvil
        </Button>
      </div>
    </div>
  );
};

export default HomeView;
