import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.js';
import type { CashierOrder, CashierOrderLine } from './types.js';
import { useMultiTabCashierGuard } from './useMultiTabCashierGuard.js';
import { MultiMethodCalculator } from './MultiMethodCalculator.js';
import { PrintAttentionModal } from './PrintAttentionModal.js';
import { TicketPreviewModal } from './TicketPreviewModal.js';
import { ApplyCouponModal } from '../coupons/ApplyCouponModal.js';
import { DriverSettlementModal } from '../delivery/DriverSettlementModal.js';
import { usdToBsCents } from '@tocineta/shared';
import {
  Truck,
  Banknote,
  Edit,
  Trash2,
  MousePointerClick,
  Printer,
  Undo2,
  RotateCw,
  Landmark,
  Zap,
  Receipt,
  Utensils,
  ShoppingBag,
  Gift
} from 'lucide-react';

export const CashierView: React.FC = () => {
  const { user } = useAuth();
  const { isBlocked, takeControl } = useMultiTabCashierGuard();

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [lastPaidOrderId, setLastPaidOrderId] = useState<string | null>(null);
  const [showCouponModal, setShowCouponModal] = useState<boolean>(false);
  const [showSettlementModal, setShowSettlementModal] = useState<boolean>(false);

  const [cashierTab, setCashierTab] = useState<'cobro' | 'ultimas_ventas'>('cobro');

  // Estados para Modificar Comanda
  const [editingOrder, setEditingOrder] = useState<CashierOrder | null>(null);
  const [editLines, setEditLines] = useState<Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPriceUsdCents: number;
    customInstructions?: string;
  }>>([]);
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [selectedAddProductId, setSelectedAddProductId] = useState<string>('');

  // Estados para Cancelar Comanda
  const [cancelingOrder, setCancelingOrder] = useState<CashierOrder | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('Cliente se arrepintió');
  const [isCanceling, setIsCanceling] = useState<boolean>(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Estado para modal de Salida de Caja Chica
  const [showExpenseModal, setShowExpenseModal] = useState<boolean>(false);
  const [expenseCategory, setExpenseCategory] = useState<string>('hielo_pan_insumos');
  const [expenseAmountUsd, setExpenseAmountUsd] = useState<string>('');
  const [expenseDesc, setExpenseDesc] = useState<string>('');
  const [expenseMsg, setExpenseMsg] = useState<string | null>(null);
  const [isSavingExpense, setIsSavingExpense] = useState<boolean>(false);

  // Estado para Anular / Reembolsar orden
  const [voidingOrder, setVoidingOrder] = useState<any | null>(null);
  const [voidPin, setVoidPin] = useState<string>('');
  const [voidReason, setVoidReason] = useState<string>('CLIENTE_ARREPENTIDO');
  const [voidError, setVoidError] = useState<string | null>(null);
  const [isVoiding, setIsVoiding] = useState<boolean>(false);

  // Helper para formatear desglose de línea de orden con modificadores y comboChildren
  const renderLineDescription = (line: CashierOrderLine) => {
    const qty = line.qty || line.quantity || 1;
    const price = (line.unit_price_usd_cents / 100).toFixed(2);

    const mods = (line.modifiers || []).map((m: any) => {
      const modName = m.ingredient_name || m.name || '';
      if (m.modifier_type === 'SIN') return `Sin ${modName}`;
      if (m.modifier_type === 'EXTRA') return `+ Extra ${modName}`;
      if (m.modifier_type === 'BARRA_LIBRE') return `+ Barra Libre: ${modName}`;
      return modName;
    }).filter(Boolean);

    const comboKids = line.comboChildren || line.combo_children || [];
    const comboStr = comboKids.length > 0
      ? ` [${comboKids.map((c: any) => {
          const kidMods = (c.modifiers || []).map((m: any) => (m.modifier_type === 'SIN' ? `Sin ${m.ingredient_name || m.name}` : (m.ingredient_name || m.name))).filter(Boolean);
          return kidMods.length > 0 ? `${c.product_name} (${kidMods.join(', ')})` : c.product_name;
        }).join(' + ')}]`
      : '';

    const notesStr = line.custom_instructions || line.notes ? ` — ${line.custom_instructions || line.notes}` : '';
    const modsStr = mods.length > 0 ? ` — ${mods.join(', ')}` : '';

    return (
      <div className="w-full">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-extrabold text-white leading-tight">
            {qty}x {line.product_name}
          </span>
          <span className="text-xs font-mono font-bold text-tocineta-yellow shrink-0">
            ${price}
          </span>
        </div>
        {(comboStr || modsStr || notesStr) && (
          <div className="text-[11px] text-tocineta-muted font-normal mt-0.5">
            {comboStr}{modsStr}{notesStr}
          </div>
        )}
      </div>
    );
  };

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
  const { data: ordersData, refetch: refetchOrders, isLoading: isLoadingOrders, isError } = useQuery<{
    success: boolean;
    orders: CashierOrder[];
  }>({
    queryKey: ['cashierOrders'],
    queryFn: async () => {
      const res = await fetch('/api/orders');
      if (!res.ok) {
        throw new Error('NETWORK_OR_SERVER_ERROR');
      }
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

  // Consultar últimas órdenes pagadas (para consulta, reimpresión y reembolso)
  const { data: paidOrdersData, refetch: refetchPaidOrders, isLoading: isLoadingPaid } = useQuery<{
    success: boolean;
    orders: CashierOrder[];
  }>({
    queryKey: ['paidOrders'],
    queryFn: async () => {
      const res = await fetch('/api/orders?status=pagado');
      if (!res.ok) return { success: false, orders: [] };
      return res.json();
    },
    refetchInterval: 10000
  });

  const paidOrders = paidOrdersData?.orders || [];

  // Consulta de catálogo POS para permitir añadir productos a una comanda en edición
  const { data: posMenuData } = useQuery<{
    success: boolean;
    categories: Array<{
      id: string;
      name: string;
      products: Array<{
        id: string;
        name: string;
        price_usd_cents: number;
      }>;
    }>;
  }>({
    queryKey: ['posMenu'],
    queryFn: async () => {
      const res = await fetch('/api/menu/pos');
      if (!res.ok) return { success: false, categories: [] };
      return res.json();
    }
  });

  const allAvailableProducts = useMemo(() => {
    return (posMenuData?.categories || []).flatMap(c => c.products || []);
  }, [posMenuData]);

  const handleOpenEditOrder = (order: CashierOrder, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingOrder(order);
    setEditError(null);
    setSelectedAddProductId('');
    setEditLines((order.lines || []).map(l => ({
      productId: l.product_id,
      productName: l.product_name,
      quantity: l.quantity || l.qty || 1,
      unitPriceUsdCents: l.unit_price_usd_cents,
      customInstructions: l.custom_instructions || l.notes || ''
    })));
  };

  const handleUpdateEditLineQty = (index: number, delta: number) => {
    setEditLines(prev => {
      const copy = [...prev];
      const target = copy[index];
      if (!target) return prev;
      const nextQty = target.quantity + delta;
      if (nextQty <= 0) {
        return copy.filter((_, i) => i !== index);
      }
      copy[index] = { ...target, quantity: nextQty };
      return copy;
    });
  };

  const handleRemoveEditLine = (index: number) => {
    setEditLines(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddProductToEdit = () => {
    if (!selectedAddProductId) return;
    const prod = allAvailableProducts.find(p => p.id === selectedAddProductId);
    if (!prod) return;

    setEditLines(prev => {
      const existingIdx = prev.findIndex(l => l.productId === prod.id);
      if (existingIdx >= 0) {
        const copy = [...prev];
        copy[existingIdx].quantity += 1;
        return copy;
      }
      return [
        ...prev,
        {
          productId: prod.id,
          productName: prod.name,
          quantity: 1,
          unitPriceUsdCents: prod.price_usd_cents
        }
      ];
    });
    setSelectedAddProductId('');
  };

  const handleSaveEditOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;
    if (editLines.length === 0) {
      setEditError('La orden debe tener al menos un producto. Si desea descartarla, use Cancelar Orden.');
      return;
    }
    setIsSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/orders/${editingOrder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: editingOrder.version ?? 1,
          lines: editLines.map(l => ({
            productId: l.productId,
            quantity: l.quantity,
            customInstructions: l.customInstructions
          }))
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessBanner(`✓ ¡Orden #${editingOrder.order_number} modificada exitosamente! Totales actualizados.`);
        setEditingOrder(null);
        refetchOrders();
      } else {
        setEditError(data.error || 'Error al actualizar orden.');
      }
    } catch {
      setEditError('Error de conexión al servidor.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleConfirmCancelOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelingOrder) return;
    setIsCanceling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/orders/${cancelingOrder.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessBanner(`✓ Orden #${cancelingOrder.order_number} cancelada exitosamente.`);
        setCancelingOrder(null);
        if (selectedOrderId === cancelingOrder.id) {
          setSelectedOrderId(null);
        }
        refetchOrders();
      } else {
        setCancelError(data.error || 'No se pudo cancelar la orden');
      }
    } catch {
      setCancelError('Error de conexión al servidor');
    } finally {
      setIsCanceling(false);
    }
  };

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountFloat = parseFloat(expenseAmountUsd);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      setExpenseMsg('Monto inválido');
      return;
    }
    if (!expenseDesc.trim()) {
      setExpenseMsg('Ingrese una descripción para el gasto');
      return;
    }
    setIsSavingExpense(true);
    setExpenseMsg(null);
    try {
      const amountUsdCents = Math.round(amountFloat * 100);
      const res = await fetch('/api/profitability/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: expenseCategory,
          amountUsdCents,
          description: expenseDesc
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setExpenseMsg('✓ Gasto registrado en caja chica exitosamente');
        setTimeout(() => {
          setShowExpenseModal(false);
          setExpenseAmountUsd('');
          setExpenseDesc('');
          setExpenseMsg(null);
        }, 1200);
      } else {
        setExpenseMsg(data.error || 'Error al registrar gasto');
      }
    } catch {
      setExpenseMsg('Error de conexión');
    } finally {
      setIsSavingExpense(false);
    }
  };

  const handleConfirmVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidingOrder || !voidPin) return;
    setIsVoiding(true);
    setVoidError(null);
    try {
      const res = await fetch(`/api/orders/${voidingOrder.id}/incident`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason_code: voidReason,
          responsible_area: 'cliente',
          resolution: 'void_paid',
          authorizer_pin: voidPin,
          refund_method: 'cash_usd'
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessBanner(`✓ Orden #${voidingOrder.order_number} anulada y reembolsada.`);
        setVoidingOrder(null);
        setVoidPin('');
        refetchOrders();
        refetchPaidOrders();
      } else {
        setVoidError(data.error || 'PIN o autorización inválida');
      }
    } catch {
      setVoidError('Error de conexión con el servidor');
    } finally {
      setIsVoiding(false);
    }
  };

  const handleOpenTicketForOrder = async (orderId: string) => {
    try {
      const res = await fetch(`/api/print-jobs?orderId=${orderId}&limit=1`);
      if (res.ok) {
        const d = await res.json();
        if (d.data?.length > 0) {
          setPreviewJobId(d.data[0].id);
          return;
        }
      }
      const jobRes = await fetch('/api/printing/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, jobType: 'receipt' })
      });
      if (jobRes.ok) {
        const jobData = await jobRes.json();
        if (jobData.job?.id) {
          setPreviewJobId(jobData.job.id);
        }
      }
    } catch (err) {
      console.error('Error al abrir ticket:', err);
    }
  };

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
            <Landmark className="w-6 h-6 text-tocineta-yellow" />
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
            onClick={() => setShowSettlementModal(true)}
            className="min-h-[46px] px-3.5 rounded-2xl bg-tocineta-bg border border-tocineta-yellow/60 hover:bg-tocineta-yellow hover:text-tocineta-bg text-xs font-black text-tocineta-yellow active:scale-95 transition-all flex items-center gap-1.5 shadow-md"
          >
            <Truck className="w-4 h-4" />
            <span>Liquidación Motorizados</span>
          </button>
          <button
            type="button"
            onClick={() => setShowExpenseModal(true)}
            className="min-h-[46px] px-3.5 rounded-2xl bg-rose-500/20 border border-rose-500/50 hover:bg-rose-500 hover:text-white text-xs font-black text-rose-300 active:scale-95 transition-all flex items-center gap-1.5 shadow-md"
          >
            <Banknote className="w-4 h-4" />
            <span>Salida Caja Chica</span>
          </button>
          <button
            type="button"
            onClick={() => {
              refetchOrders();
              refetchPaidOrders();
            }}
            className="min-h-[46px] px-3.5 rounded-2xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow text-xs font-bold text-white active:scale-95 transition-all flex items-center gap-1.5"
          >
            <RotateCw className="w-4 h-4" />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {/* SELECTOR DE PESTAÑAS DE CAJA */}
      <div className="flex items-center gap-2 border-b border-tocineta-border pb-3">
        <button
          type="button"
          onClick={() => setCashierTab('cobro')}
          className={`px-5 py-3 rounded-2xl font-black text-xs transition-all flex items-center gap-2 shadow-md ${
            cashierTab === 'cobro'
              ? 'bg-tocineta-yellow text-tocineta-bg ring-2 ring-tocineta-yellow/50'
              : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white'
          }`}
        >
          <Zap className="w-4 h-4" />
          <span>Órdenes Por Cobrar</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
            cashierTab === 'cobro' ? 'bg-black/20 text-tocineta-bg' : 'bg-tocineta-bg text-tocineta-yellow'
          }`}>
            {pendingOrders.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setCashierTab('ultimas_ventas');
            refetchPaidOrders();
          }}
          className={`px-5 py-3 rounded-2xl font-black text-xs transition-all flex items-center gap-2 shadow-md ${
            cashierTab === 'ultimas_ventas'
              ? 'bg-tocineta-yellow text-tocineta-bg ring-2 ring-tocineta-yellow/50'
              : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Últimas Ventas Cobradas</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
            cashierTab === 'ultimas_ventas' ? 'bg-black/20 text-tocineta-bg' : 'bg-tocineta-bg text-emerald-400'
          }`}>
            {paidOrders.length}
          </span>
        </button>
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

      {/* DISPOSICIÓN PRINCIPAL EN DOS COLUMNAS (COBRO) */}
      {cashierTab === 'cobro' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          
          {/* COLUMNA IZQUIERDA: COLA EN VIVO DE PEDIDOS POR COBRAR (5 COLS) */}
          <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-tocineta-muted">
              Órdenes Por Cobrar ({pendingOrders.length})
            </span>
            <span className="text-[11px] text-tocineta-muted">Mesoneros y Salón</span>
          </div>

          {isError ? (
            <div className="bg-rose-950/80 border-2 border-rose-500 rounded-3xl p-6 text-center space-y-3 shadow-xl">
              <span className="text-3xl block animate-bounce">⚠️</span>
              <p className="text-sm font-black text-rose-200">
                ⚠️ Sin conexión con el servidor local. Verifica la red Wi-Fi del Food Truck.
              </p>
              <p className="text-xs text-rose-300/80">
                No se pudo sincronizar la cola de comandas pendientes.
              </p>
              <button
                type="button"
                onClick={() => refetchOrders()}
                className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-black text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 flex items-center justify-center gap-2"
              >
                🔄 Reintentar conexión
              </button>
            </div>
          ) : isLoadingOrders ? (
            <div className="py-12 text-center text-tocineta-yellow">
              <span className="text-2xl animate-spin inline-block">⏳</span>
              <p className="text-xs font-bold mt-2">Cargando comandas en vivo...</p>
            </div>
          ) : !isError && !isLoadingOrders && pendingOrders.length === 0 ? (
            <div className="bg-tocineta-card border border-tocineta-border rounded-3xl p-8 text-center space-y-2">
              <span className="text-3xl block opacity-40">🎉</span>
              <p className="text-sm font-bold text-white">¡No hay pedidos por cobrar!</p>
              <p className="text-xs text-tocineta-muted">
                Todas las órdenes recibidas han sido cobradas o están en preparación.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[78vh] overflow-y-auto pr-1">
              {pendingOrders.map(o => {
                const isSelected = o.id === selectedOrderId;
                const bsAmount = usdToBsCents(o.total_to_collect_usd_cents, currentRateMicroBs);
                const platesCount = o.itemsCount || o.lines?.reduce((acc, l) => acc + (l.qty || l.quantity || 1), 0) || 1;
                return (
                  <div
                    key={o.id}
                    onClick={() => setSelectedOrderId(o.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedOrderId(o.id); }}
                    className={`w-full min-h-[58px] p-4 rounded-3xl border text-left transition-all flex flex-col justify-between gap-2 active:scale-98 shadow-md cursor-pointer ${
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
                          {platesCount} plato(s) • Mesonero: {o.created_by_name || 'Carlos'}
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
                      <span className="text-tocineta-muted uppercase tracking-wider font-semibold flex items-center gap-1">
                        {o.fulfillment_type === 'salon' ? (
                          <><Utensils className="w-3 h-3 text-tocineta-yellow" /> Salón</>
                        ) : o.fulfillment_type === 'delivery' ? (
                          <><Truck className="w-3 h-3 text-amber-400" /> Delivery</>
                        ) : (
                          <><ShoppingBag className="w-3 h-3 text-cyan-400" /> Para Llevar</>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded font-bold uppercase ${
                          o.payment_status === 'autorizado_sin_pago'
                            ? 'bg-purple-500/20 text-purple-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}>
                          {o.payment_status === 'autorizado_sin_pago' ? '⚠️ Deuda Abierta' : 'Por Cobrar'}
                        </span>
                      </div>
                    </div>

                    {/* Desglose de detalle de ítems de la orden (100% VISIBLE SIEMPRE POR DEFECTO) */}
                    <div className="mt-2 pt-2 border-t border-tocineta-border/40 space-y-1.5 w-full">
                      <span className="text-[10px] font-bold text-tocineta-muted block uppercase tracking-wider">
                        Detalle de ítems ({platesCount} platos):
                      </span>
                      {(o.lines && o.lines.length > 0) ? (
                        o.lines.map((line, idx) => (
                          <div key={line.id || idx} className="text-[11px] bg-tocineta-bg/80 p-2 rounded-xl border border-tocineta-border/40 text-white font-medium">
                            {renderLineDescription(line)}
                          </div>
                        ))
                      ) : (
                        <span className="italic text-[10px] text-tocineta-muted">Sin desglose disponible</span>
                      )}
                    </div>

                    {/* Botones de acción rápida: Modificar y Cancelar Orden */}
                    <div className="mt-2.5 pt-2.5 border-t border-tocineta-border/60 flex items-center gap-2 w-full">
                      <button
                        type="button"
                        onClick={(e) => handleOpenEditOrder(o, e)}
                        className="flex-1 min-h-[38px] px-3 rounded-xl bg-tocineta-card border border-tocineta-border hover:border-tocineta-yellow text-neutral-200 hover:text-tocineta-yellow text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95"
                      >
                        <Edit className="w-4 h-4" />
                        <span>Modificar</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancelingOrder(o);
                          setCancelError(null);
                          setCancelReason('Cliente se arrepintió');
                        }}
                        className="min-h-[38px] px-3 rounded-xl bg-rose-950/40 border border-rose-800/60 hover:bg-rose-900/60 text-rose-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95"
                        title="Cancelar Orden"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Cancelar</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* COLUMNA DERECHA: CALCULADORA MULTIMÉTODO Y BEBIDAS (7 COLS) */}
        <div className="lg:col-span-7 space-y-4">
          {selectedOrder ? (
            <>
              {/* DESGLOSE DETALLADO DE PRODUCTOS Y MODIFICADORES EN ENCABEZADO */}
              <div className="bg-tocineta-card border border-tocineta-border rounded-3xl p-4 space-y-2.5 shadow-md">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Utensils className="w-4 h-4 text-tocineta-yellow" />
                    <h4 className="text-xs font-black text-white uppercase tracking-wider">
                      Desglose de la Orden ({selectedOrder.itemsCount || selectedOrder.lines?.reduce((acc, l) => acc + (l.qty || l.quantity || 1), 0) || 1} platos)
                    </h4>
                  </div>
                  <span className="text-[11px] font-mono text-tocineta-muted">
                    {selectedOrder.lines?.length || 0} línea(s)
                  </span>
                </div>
                <div className="space-y-1.5">
                  {(selectedOrder.lines || []).map((line, idx) => (
                    <div key={line.id || idx} className="p-2.5 rounded-2xl bg-tocineta-bg border border-tocineta-border/60 text-xs text-white font-medium flex items-start justify-between gap-2">
                      <span>{renderLineDescription(line)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* BARRA INTERACTIVA DE CUPONES DUALES ("CUPONES PARA TI") */}
              <div className="bg-tocineta-card border border-tocineta-border rounded-3xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center">
                    <Gift className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-tocineta-muted block">
                      Cupones para ti:
                    </span>
                    <span className="text-xs font-black text-white">
                      {selectedOrder.discount_usd_cents > 0 ? (
                        <span className="text-emerald-400">
                          Cupón de Descuento: -${(selectedOrder.discount_usd_cents / 100).toFixed(2)} USD
                        </span>
                      ) : (selectedOrder.lines || []).some(l => l.line_role === 'COURTESY_ITEM') ? (
                        <span className="text-purple-300 font-bold">
                          [OBSEQUIO CUPÓN - $0.00] Activo en Comanda
                        </span>
                      ) : (
                        <span className="text-tocineta-muted">Ningún cupón aplicado a esta orden</span>
                      )}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowCouponModal(true)}
                  className="min-h-[44px] px-4 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-black text-xs transition-all active:scale-95 flex items-center gap-1.5 shadow-md shrink-0"
                >
                  <Gift className="w-4 h-4" />
                  <span>
                    {selectedOrder.discount_usd_cents > 0 || (selectedOrder.lines || []).some(l => l.line_role === 'COURTESY_ITEM')
                      ? 'Modificar Cupón'
                      : 'Aplicar Cupón'}
                  </span>
                </button>
              </div>

              {/* SI ES DELIVERY: FICHA OPERATIVA DE DESPACHO Y MOTORIZADO */}
              {selectedOrder.fulfillment_type === 'delivery' && (
                <div className="bg-amber-500/10 border-2 border-amber-500/30 rounded-3xl p-4 space-y-2.5 shadow-md text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Truck className="w-5 h-5 text-amber-400" />
                      <div>
                        <h4 className="font-black text-white text-sm">Ficha Operativa de Delivery</h4>
                        <span className="text-[11px] text-tocineta-muted">
                          Tarifa de Despacho: <strong className="text-tocineta-yellow font-mono">+${(selectedOrder.delivery_fee_usd_cents / 100).toFixed(2)}</strong>
                        </span>
                      </div>
                    </div>
                    {Boolean((selectedOrder as any).cash_collected_by_driver) && (
                      <span className="px-2.5 py-1 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-black uppercase flex items-center gap-1">
                        <Banknote className="w-3.5 h-3.5 text-amber-300" /> Efectivo en poder del motorizado
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] pt-1 border-t border-amber-500/20">
                    <div>
                      <span className="text-tocineta-muted block">Dirección de Entrega:</span>
                      <span className="text-white font-bold block">
                        {(selectedOrder as any).delivery_address || 'Dirección no indicada'}
                      </span>
                      {(selectedOrder as any).delivery_reference && (
                        <span className="text-amber-200/90 block italic mt-0.5">
                          Ref: {(selectedOrder as any).delivery_reference}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-tocineta-muted block">Cliente:</span>
                      <span className="text-white font-bold block">
                        {(selectedOrder as any).customer_name || 'Cliente'} 
                        {(selectedOrder as any).customer_phone ? ` (${(selectedOrder as any).customer_phone})` : ''}
                      </span>
                      <span className="text-tocineta-yellow block font-bold mt-1">
                        🛵 Motorizado: {(selectedOrder as any).driver_name || (selectedOrder as any).motorizado_name || 'Por asignar'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

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
              <MousePointerClick className="w-12 h-12 text-gray-500 mb-4 animate-bounce" />
              <h3 className="text-base font-black text-white">Selecciona una orden de la lista para cobrar</h3>
              <p className="text-xs text-tocineta-muted max-w-sm">
                Haz clic sobre cualquiera de las comandas pendientes a la izquierda para cargar la calculadora multimétodo, vuelto mixto y bebidas.
              </p>
            </div>
          )}
        </div>

      </div>
      ) : (
        /* VISTA DE ÚLTIMAS VENTAS COBRADAS */
        <div className="bg-tocineta-card border border-tocineta-border rounded-3xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <Receipt className="w-4 h-4 text-tocineta-yellow" /> Historial de Ventas Cobradas del Turno
              </h3>
              <p className="text-xs text-tocineta-muted mt-0.5">
                Consulta órdenes cobradas, reimprime tickets térmicos o procesa devoluciones/anulaciones autorizadas.
              </p>
            </div>
            <button
              type="button"
              onClick={() => refetchPaidOrders()}
              className="px-3.5 py-2 rounded-xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow text-xs font-bold text-white transition-all flex items-center gap-1.5"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Actualizar</span>
            </button>
          </div>

          {isLoadingPaid ? (
            <div className="py-12 text-center text-tocineta-yellow">
              <span className="text-2xl animate-spin inline-block">⏳</span>
              <p className="text-xs font-bold mt-2">Cargando últimas ventas cobradas...</p>
            </div>
          ) : paidOrders.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <span className="text-4xl block opacity-30">🧾</span>
              <p className="text-sm font-bold text-white">No hay ventas cobradas registradas aún</p>
              <p className="text-xs text-tocineta-muted">
                Las órdenes cobradas del turno aparecerán aquí para arqueo y reimpresión.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {paidOrders.map(order => {
                const totalUsd = (order.total_to_collect_usd_cents / 100).toFixed(2);
                const bsAmount = usdToBsCents(order.total_to_collect_usd_cents, currentRateMicroBs);
                const formattedBs = (bsAmount / 100).toLocaleString('es-VE', { minimumFractionDigits: 2 });
                const orderTimestamp = order.created_at_ms || (order as any).created_at;
                const timeStr = orderTimestamp ? new Date(orderTimestamp).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) : '';

                return (
                  <div
                    key={order.id}
                    className="p-4 rounded-2xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-border/80 flex flex-wrap items-center justify-between gap-4 transition-all"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-black text-sm">
                        ✓
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-base text-white">Orden #{order.order_number}</span>
                          <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-tocineta-card text-tocineta-yellow border border-tocineta-border">
                            {order.table_number || 'Mostrador'}
                          </span>
                          <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full uppercase">
                            Pagado
                          </span>
                        </div>
                        <p className="text-xs text-tocineta-muted mt-1">
                          {timeStr && <span>Hora: {timeStr} • </span>}
                          Mesonero: {order.created_by_name || 'Personal'} • {order.fulfillment_type === 'salon' ? '🍽️ Salón' : order.fulfillment_type === 'delivery' ? '🛵 Delivery' : '🛍️ Para Llevar'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <span className="text-base font-black font-mono text-tocineta-yellow block">
                          ${totalUsd}
                        </span>
                        <span className="text-xs text-tocineta-muted font-mono block">
                          {formattedBs} Bs
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenTicketForOrder(order.id)}
                          className="px-3 py-2 rounded-xl bg-tocineta-card border border-tocineta-border hover:border-tocineta-yellow text-xs font-bold text-white transition-all flex items-center gap-1.5 shadow active:scale-95"
                          title="Ver o Reimprimir Ticket Térmico"
                        >
                          <Printer className="w-4 h-4" />
                          <span>Reimprimir</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setVoidingOrder(order);
                            setVoidPin('');
                            setVoidError(null);
                          }}
                          className="px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 text-xs font-bold text-rose-300 transition-all flex items-center gap-1.5 shadow active:scale-95"
                          title="Anular venta y registrar reembolso"
                        >
                          <Undo2 className="w-4 h-4" />
                          <span>Anular / Reembolso</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL DE APLICAR CUPÓN */}
      {showCouponModal && selectedOrder && (
        <ApplyCouponModal
          isOpen={true}
          onClose={() => setShowCouponModal(false)}
          orderId={selectedOrder.id}
          orderNumber={selectedOrder.order_number}
          currentCouponId={(selectedOrder as any).coupon_id}
          currentDiscountCents={selectedOrder.discount_usd_cents}
          hasCourtesyLine={(selectedOrder.lines || []).some(l => l.line_role === 'COURTESY_ITEM')}
          onSuccess={() => {
            refetchOrders();
          }}
        />
      )}

      {/* MODAL DE LIQUIDACIÓN DE MOTORIZADOS */}
      {showSettlementModal && (
        <DriverSettlementModal
          isOpen={true}
          onClose={() => setShowSettlementModal(false)}
        />
      )}

      {/* MODAL ALERTA DE IMPRESORA CON FALLO */}
      <PrintAttentionModal onOpenTicketPreview={(jobId) => setPreviewJobId(jobId)} />

      {/* MODAL VISTA PREVIA DE TICKET TÉRMICO */}
      {previewJobId && (
        <TicketPreviewModal
          jobId={previewJobId}
          onClose={() => setPreviewJobId(null)}
        />
      )}

      {/* MODAL SALIDA CAJA CHICA */}
      {showExpenseModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in">
          <div className="bg-tocineta-card border border-rose-500/40 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-base text-white flex items-center gap-2">
                <Banknote className="w-5 h-5 text-rose-400" />
                <span>Salida de Efectivo (Caja Chica)</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowExpenseModal(false)}
                className="text-tocineta-muted hover:text-white text-xs font-bold"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-tocineta-muted">
              Registra pagos directos de insumos de emergencia (hielo, pan, recargas o transporte) tomados del fondo de caja.
            </p>

            <form onSubmit={handleSaveExpense} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-tocineta-muted block mb-1">
                  Categoría del Gasto:
                </label>
                <select
                  value={expenseCategory}
                  onChange={e => setExpenseCategory(e.target.value)}
                  className="w-full min-h-[46px] bg-tocineta-bg border border-tocineta-border rounded-xl px-4 text-xs font-bold text-white outline-none focus:border-tocineta-yellow"
                >
                  <option value="hielo_pan_insumos">🧊 Hielo / Pan / Insumos de Urgencia</option>
                  <option value="bebidas_emergencia">🥤 Bebidas / Refrescos Faltantes</option>
                  <option value="transporte">🛵 Transporte / Encomienda</option>
                  <option value="limpieza_mantenimiento">🧹 Limpieza y Mantenimiento</option>
                  <option value="otro">📦 Otro Gasto Menor</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-tocineta-muted block mb-1">
                  Monto Retirado ($ USD):
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="Ej: 5.00"
                  value={expenseAmountUsd}
                  onChange={e => setExpenseAmountUsd(e.target.value)}
                  className="w-full min-h-[46px] bg-tocineta-bg border border-tocineta-border rounded-xl px-4 text-sm font-mono font-bold text-white outline-none focus:border-rose-400"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-tocineta-muted block mb-1">
                  Descripción / Motivo del Gasto:
                </label>
                <textarea
                  rows={2}
                  required
                  placeholder="Ej: 2 bolsas de hielo compradas en la licorería de la esquina"
                  value={expenseDesc}
                  onChange={e => setExpenseDesc(e.target.value)}
                  className="w-full bg-tocineta-bg border border-tocineta-border rounded-xl p-3 text-xs text-white outline-none focus:border-rose-400 resize-none"
                />
              </div>

              {expenseMsg && (
                <p className={`text-xs font-bold ${expenseMsg.startsWith('✓') ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {expenseMsg}
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(false)}
                  className="w-1/3 min-h-[46px] rounded-xl bg-tocineta-bg border border-tocineta-border text-xs font-bold text-tocineta-muted hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingExpense}
                  className="w-2/3 min-h-[46px] rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs transition-all shadow-md active:scale-95 disabled:opacity-50"
                >
                  {isSavingExpense ? 'Registrando...' : 'Confirmar Egreso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL ANULAR / REEMBOLSAR ORDEN */}
      {voidingOrder && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in">
          <div className="bg-tocineta-card border border-rose-500 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="font-black text-base text-rose-300 flex items-center gap-2">
              <Undo2 className="w-5 h-5 text-rose-400" />
              <span>Anular Venta y Registrar Reembolso</span>
            </h3>
            <p className="text-xs text-tocineta-muted">
              Estás a punto de anular la <strong className="text-white">Orden #{voidingOrder.order_number}</strong> por un total de <strong className="text-tocineta-yellow">${(voidingOrder.total_to_collect_usd_cents / 100).toFixed(2)}</strong>.
            </p>

            <form onSubmit={handleConfirmVoid} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-tocineta-muted block mb-1">
                  Motivo de la Anulación:
                </label>
                <select
                  value={voidReason}
                  onChange={e => setVoidReason(e.target.value)}
                  className="w-full min-h-[46px] bg-tocineta-bg border border-tocineta-border rounded-xl px-4 text-xs font-bold text-white outline-none focus:border-rose-400"
                >
                  <option value="CLIENTE_ARREPENTIDO">Cliente se arrepintió / cancelación voluntaria</option>
                  <option value="ERROR_COMANDA">Error en la toma de comanda / cobro duplicado</option>
                  <option value="PRODUCTO_DEFECTUOSO">Reclamo / Producto no conforme</option>
                  <option value="OTRO">Otro motivo justificado</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-tocineta-muted block mb-1">
                  PIN de Autorización (Supervisor / Admin):
                </label>
                <input
                  type="password"
                  required
                  placeholder="Ingrese PIN..."
                  value={voidPin}
                  onChange={e => setVoidPin(e.target.value)}
                  className="w-full min-h-[46px] bg-tocineta-bg border border-tocineta-border rounded-xl px-4 text-sm font-mono font-bold text-white outline-none focus:border-rose-400"
                />
              </div>

              {voidError && (
                <p className="text-xs font-bold text-rose-400">
                  ⚠️ {voidError}
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setVoidingOrder(null)}
                  className="w-1/3 min-h-[46px] rounded-xl bg-tocineta-bg border border-tocineta-border text-xs font-bold text-tocineta-muted hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isVoiding || !voidPin}
                  className="w-2/3 min-h-[46px] rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs transition-all shadow-md active:scale-95 disabled:opacity-50"
                >
                  {isVoiding ? 'Anulando...' : 'Confirmar Anulación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL MODIFICAR COMANDA EN CAJA */}
      {editingOrder && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 animate-in fade-in">
          <div className="bg-[#12151D] border border-neutral-700/80 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div>
                <h3 className="font-black text-base text-white flex items-center gap-2">
                  <Edit className="w-5 h-5 text-tocineta-yellow" />
                  <span>Modificar Comanda #{editingOrder.order_number}</span>
                </h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {editingOrder.table_number} • Ajusta cantidades, elimina platos o agrega nuevos ítems.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingOrder(null)}
                className="w-8 h-8 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white flex items-center justify-center text-xs font-bold transition-all"
              >
                ✕
              </button>
            </div>

            {/* Lista de productos editables */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {editLines.length === 0 ? (
                <div className="py-8 text-center text-neutral-500 text-xs">
                  No hay productos en la comanda. Agrega al menos uno abajo.
                </div>
              ) : (
                editLines.map((line, idx) => {
                  const lineSubtotal = ((line.unitPriceUsdCents * line.quantity) / 100).toFixed(2);
                  return (
                    <div
                      key={idx}
                      className="p-3 rounded-2xl bg-neutral-900/90 border border-neutral-800 flex items-center justify-between gap-3 shadow-sm"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-extrabold text-sm text-white block truncate">
                          {line.productName}
                        </span>
                        <span className="text-xs font-mono text-neutral-400">
                          ${(line.unitPriceUsdCents / 100).toFixed(2)} c/u
                        </span>
                      </div>

                      {/* Controles de cantidad */}
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center bg-black/40 border border-neutral-700 rounded-xl overflow-hidden">
                          <button
                            type="button"
                            onClick={() => handleUpdateEditLineQty(idx, -1)}
                            className="w-8 h-8 flex items-center justify-center text-neutral-300 hover:text-white hover:bg-neutral-800 font-black text-sm active:scale-90"
                          >
                            -
                          </button>
                          <span className="w-8 text-center font-mono font-bold text-xs text-white">
                            {line.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUpdateEditLineQty(idx, 1)}
                            className="w-8 h-8 flex items-center justify-center text-neutral-300 hover:text-white hover:bg-neutral-800 font-black text-sm active:scale-90"
                          >
                            +
                          </button>
                        </div>

                        <span className="w-16 text-right font-mono font-black text-xs text-tocineta-yellow">
                          ${lineSubtotal}
                        </span>

                        <button
                          type="button"
                          onClick={() => handleRemoveEditLine(idx)}
                          className="w-8 h-8 rounded-xl bg-rose-950/30 border border-rose-800/40 text-rose-400 hover:bg-rose-900/50 hover:text-rose-200 flex items-center justify-center text-xs font-bold active:scale-90 transition-all"
                          title="Eliminar de la comanda"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Selector para agregar producto nuevo */}
            <div className="pt-2 border-t border-neutral-800 space-y-2">
              <label className="text-[11px] font-bold text-neutral-400 block">
                + Agregar producto del menú a la orden:
              </label>
              <div className="flex gap-2">
                <select
                  value={selectedAddProductId}
                  onChange={e => setSelectedAddProductId(e.target.value)}
                  className="flex-1 min-h-[42px] bg-neutral-900 border border-neutral-700 rounded-xl px-3 text-xs font-bold text-white outline-none focus:border-tocineta-yellow"
                >
                  <option value="">-- Seleccionar producto para añadir --</option>
                  {allAvailableProducts.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — ${(p.price_usd_cents / 100).toFixed(2)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!selectedAddProductId}
                  onClick={handleAddProductToEdit}
                  className="min-h-[42px] px-4 rounded-xl bg-tocineta-yellow text-neutral-950 font-black text-xs hover:bg-[#FFE600]/90 active:scale-95 transition-all disabled:opacity-40"
                >
                  + Añadir
                </button>
              </div>
            </div>

            {/* Recalculación en tiempo real */}
            {(() => {
              const newSubtotalCents = editLines.reduce((acc, l) => acc + (l.unitPriceUsdCents * l.quantity), 0);
              const newBsCents = usdToBsCents(newSubtotalCents, currentRateMicroBs);
              return (
                <div className="p-3 rounded-2xl bg-neutral-950 border border-neutral-800 flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
                    Nuevo Total Recalculado:
                  </span>
                  <div className="text-right">
                    <span className="text-base font-black font-mono text-tocineta-yellow block">
                      ${(newSubtotalCents / 100).toFixed(2)}
                    </span>
                    <span className="text-[11px] font-mono text-neutral-400 block">
                      {(newBsCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs
                    </span>
                  </div>
                </div>
              );
            })()}

            {editError && (
              <p className="text-xs font-bold text-rose-400">
                ⚠️ {editError}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditingOrder(null)}
                className="w-1/3 min-h-[46px] rounded-xl bg-neutral-900 border border-neutral-700 text-xs font-bold text-neutral-400 hover:text-white"
              >
                Descartar
              </button>
              <button
                type="button"
                disabled={isSavingEdit}
                onClick={handleSaveEditOrder}
                className="w-2/3 min-h-[46px] rounded-xl bg-tocineta-yellow text-neutral-950 font-black text-xs hover:bg-[#FFE600]/90 active:scale-95 transition-all shadow-lg shadow-[#FFE600]/10 disabled:opacity-50"
              >
                {isSavingEdit ? 'Guardando en cocina y caja...' : 'Guardar y Recalcular'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CANCELAR ORDEN ANTES DE COBRAR */}
      {cancelingOrder && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 animate-in fade-in">
          <div className="bg-[#12151D] border border-rose-800/60 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="font-black text-base text-rose-300 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-rose-400" />
              <span>Cancelar Orden #{cancelingOrder.order_number}</span>
            </h3>
            <p className="text-xs text-neutral-400">
              Esta comanda de <strong className="text-white">{cancelingOrder.table_number}</strong> por un total de <strong className="text-tocineta-yellow">${(cancelingOrder.total_to_collect_usd_cents / 100).toFixed(2)}</strong> será cancelada y retirada de la cola de cobro.
            </p>

            <form onSubmit={handleConfirmCancelOrder} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-neutral-400 block mb-1">
                  Motivo de la Cancelación:
                </label>
                <select
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  className="w-full min-h-[46px] bg-neutral-900 border border-neutral-700 rounded-xl px-4 text-xs font-bold text-white outline-none focus:border-rose-400"
                >
                  <option value="Cliente se arrepintió">Cliente se arrepintió / cancelación voluntaria</option>
                  <option value="Error en la comanda / duplicada">Error en la comanda / duplicada</option>
                  <option value="Demora en preparación">Demora en preparación / cliente se fue</option>
                  <option value="Otro motivo justificado">Otro motivo justificado</option>
                </select>
              </div>

              {cancelError && (
                <p className="text-xs font-bold text-rose-400">
                  ⚠️ {cancelError}
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCancelingOrder(null)}
                  className="w-1/3 min-h-[46px] rounded-xl bg-neutral-900 border border-neutral-700 text-xs font-bold text-neutral-400 hover:text-white"
                >
                  Atrás
                </button>
                <button
                  type="submit"
                  disabled={isCanceling}
                  className="w-2/3 min-h-[46px] rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs transition-all shadow-md active:scale-95 disabled:opacity-50"
                >
                  {isCanceling ? 'Cancelando...' : 'Confirmar Cancelación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
