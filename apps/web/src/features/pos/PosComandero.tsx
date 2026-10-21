import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.js';
import type { PosMenuResponse, PosProduct } from '../../types/menu.js';
import type { CartItem, CustomizationModifier } from './types.js';
import { CustomizationModal } from './CustomizationModal.js';
import { ComboWizardModal } from './ComboWizardModal.js';
import { AuthorizeModal } from './AuthorizeModal.js';
import {
  saveOrderToOutbox,
  subscribeToOutboxCount,
  flushOutbox
} from './outbox.js';
import { generateUuidV7, createIdempotencyKey, usdToBsCents } from '@tocineta/shared';

interface ExistingOrder {
  id: string;
  order_number: number;
  table_number: string;
  fulfillment_type: string;
  payment_status: string;
  fulfillment_status: string;
  total_to_collect_usd_cents: number;
  version: number;
  created_at_ms: number;
  lines: any[];
}

export const PosComandero: React.FC = () => {
  const { currency, token } = useAuth();

  // Estados de catálogo y filtros
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Estado del Carrito / Nuevo Pedido
  const [cart, setCart] = useState<CartItem[]>([]);
  const [tableNumber, setTableNumber] = useState<string>('Mesa 1');
  const [fulfillmentType, setFulfillmentType] = useState<'salon' | 'para_llevar' | 'delivery'>('salon');
  const [deliveryTierCents, setDeliveryTierCents] = useState<number>(200);
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [deliveryAddress, setDeliveryAddress] = useState<string>('');
  const [deliveryReference, setDeliveryReference] = useState<string>('');
  const [motorizadoId, setMotorizadoId] = useState<string>('');
  const [cashCollectedByDriver, setCashCollectedByDriver] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('');
  const [couponCode, setCouponCode] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [statusNotification, setStatusNotification] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);

  // Estado de edición de orden existente (para Concurrencia Optimista)
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingOrderVersion, setEditingOrderVersion] = useState<number>(1);
  const [editingOrderNumber, setEditingOrderNumber] = useState<number | null>(null);

  // Estados de modales
  const [customizingProduct, setCustomizingProduct] = useState<PosProduct | null>(null);
  const [comboWizardProduct, setComboWizardProduct] = useState<PosProduct | null>(null);
  const [authorizingOrder, setAuthorizingOrder] = useState<ExistingOrder | null>(null);
  const [showOrdersList, setShowOrdersList] = useState<boolean>(false);

  // Estado del Outbox Offline (IndexedDB)
  const [outboxCount, setOutboxCount] = useState<number>(0);
  const [isFlushingOutbox, setIsFlushingOutbox] = useState<boolean>(false);

  // Suscripción a cambios del Outbox Offline
  useEffect(() => {
    const unsubscribe = subscribeToOutboxCount(count => {
      setOutboxCount(count);
    });
    return () => unsubscribe();
  }, []);

  // Consultar menú POS desde el backend
  const { data: menu, isLoading, error } = useQuery<PosMenuResponse>({
    queryKey: ['posMenu'],
    queryFn: async () => {
      const res = await fetch('/api/menu/pos');
      if (!res.ok) throw new Error('Error al consultar catálogo POS');
      return res.json();
    },
    staleTime: 5000
  });

  // Consultar órdenes abiertas/enviadas
  const { data: ordersData, refetch: refetchOrders } = useQuery<{ success: boolean; orders: ExistingOrder[] }>({
    queryKey: ['openOrders'],
    queryFn: async () => {
      const res = await fetch('/api/orders');
      if (!res.ok) return { success: false, orders: [] };
      return res.json();
    },
    refetchInterval: 6000
  });

  // Consultar repartidores activos
  const { data: driversData } = useQuery<{ success: boolean; drivers: Array<{ id: string; name: string; phone: string }> }>({
    queryKey: ['deliveryDrivers'],
    queryFn: async () => {
      const res = await fetch('/api/delivery/drivers');
      if (!res.ok) return { success: false, drivers: [] };
      return res.json();
    },
    staleTime: 30000
  });

  // Lista plana de productos
  const allProducts = useMemo(() => {
    if (!menu?.categories) return [];
    const list: (PosProduct & { categoryId: string; categoryName: string })[] = [];
    for (const cat of menu.categories) {
      for (const p of cat.products) {
        list.push({ ...p, categoryId: cat.id, categoryName: cat.name });
      }
    }
    return list;
  }, [menu]);

  // Productos filtrados por categoría y búsqueda
  const filteredProducts = useMemo(() => {
    return allProducts.filter(p => {
      const matchCat = selectedCategory === 'all' || p.categoryId === selectedCategory;
      const matchSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [allProducts, selectedCategory, searchTerm]);

  // Formateador de precios en USD o Bs
  const formatPrice = useCallback((usdCents: number) => {
    if (currency === 'BS' && menu?.rateMicroBs) {
      const bsCents = usdToBsCents(usdCents, menu.rateMicroBs);
      return `${(bsCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`;
    }
    return `$${(usdCents / 100).toFixed(2)}`;
  }, [currency, menu]);

  // Formato dual simultáneo USD + Bs para pie de carrito y botón flotante móvil (H-04)
  const formatDualPrice = useCallback((usdCents: number) => {
    const usdStr = `$${(usdCents / 100).toFixed(2)}`;
    const rate = menu?.rateMicroBs || 36600000;
    const bsCents = usdToBsCents(usdCents, rate);
    const bsStr = `Bs. ${(bsCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${usdStr} / ${bsStr}`;
  }, [menu]);

  // --------------------------------------------------------------------------
  // ACCIÓN RÁPIDA: AGREGAR PRODUCTO EN 1 TOQUE (< 1 SEGUNDO)
  // --------------------------------------------------------------------------
  const handleFastAddProduct = (product: PosProduct) => {
    if (!product.isAvailable) return;

    if (product.isCombo) {
      // Combos abren el asistente guiado
      setComboWizardProduct(product);
      return;
    }

    // Agregar producto simple instantáneamente con ingredientes normales
    const newItem: CartItem = {
      clientLineId: `cline_${generateUuidV7()}`,
      productId: product.id,
      productName: product.name,
      station: product.station,
      quantity: 1,
      unitPriceUsdCents: product.priceUsdCents,
      isCombo: false,
      modifiers: []
    };

    setCart(prev => [...prev, newItem]);
    setStatusNotification({
      type: 'success',
      message: `+1 ${product.name} agregado al pedido`
    });
    setTimeout(() => setStatusNotification(null), 2000);
  };

  // Abrir modal de personalización
  const handleOpenCustomization = (product: PosProduct) => {
    if (!product.isAvailable) return;
    setCustomizingProduct(product);
  };

  // Guardar producto personalizado desde el modal
  const handleSaveCustomization = (
    modifiers: CustomizationModifier[],
    customInstructions: string,
    extraPriceUsdCents: number
  ) => {
    if (!customizingProduct) return;

    const newItem: CartItem = {
      clientLineId: `cline_${generateUuidV7()}`,
      productId: customizingProduct.id,
      productName: customizingProduct.name,
      station: customizingProduct.station,
      quantity: 1,
      unitPriceUsdCents: customizingProduct.priceUsdCents + extraPriceUsdCents,
      isCombo: false,
      modifiers,
      customInstructions: customInstructions || undefined
    };

    setCart(prev => [...prev, newItem]);
    setCustomizingProduct(null);
    setStatusNotification({
      type: 'success',
      message: `+1 ${customizingProduct.name} personalizado agregado`
    });
    setTimeout(() => setStatusNotification(null), 2000);
  };

  // Modificar cantidad en carrito (+/-)
  const handleChangeQty = (clientLineId: string, delta: number) => {
    setCart(prev => {
      return prev
        .map(item => {
          if (item.clientLineId === clientLineId) {
            const nextQty = item.quantity + delta;
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[];
    });
  };

  // Limpiar carrito o cancelar edición
  const handleClearCart = () => {
    setCart([]);
    setEditingOrderId(null);
    setEditingOrderVersion(1);
    setEditingOrderNumber(null);
    setNotes('');
    setCouponCode('');
    setCustomerName('');
    setCustomerPhone('');
    setDeliveryAddress('');
    setDeliveryReference('');
    setMotorizadoId('');
    setCashCollectedByDriver(false);
  };

  // --------------------------------------------------------------------------
  // CÁLCULO DE TOTALES DEL PEDIDO
  // --------------------------------------------------------------------------
  const { subtotalCents, deliveryFeeCents, totalToCollectCents } = useMemo(() => {
    const subtotal = cart.reduce((sum, item) => sum + (item.unitPriceUsdCents * item.quantity), 0);
    const delivery = fulfillmentType === 'delivery' ? deliveryTierCents : 0;
    const total = subtotal + delivery;
    return {
      subtotalCents: subtotal,
      deliveryFeeCents: delivery,
      totalToCollectCents: total
    };
  }, [cart, fulfillmentType, deliveryTierCents]);

  // --------------------------------------------------------------------------
  // ENVÍO DE PEDIDO A CAJA CON IDEMPOTENCIA Y MANEJO OFFLINE / CONFLICTOS 409
  // --------------------------------------------------------------------------
  const handleSubmitOrder = async () => {
    if (cart.length === 0) return;

    setIsSubmitting(true);
    setStatusNotification(null);

    const idempotencyKey = createIdempotencyKey('order', generateUuidV7());

    // Estructurar líneas para el backend
    const linesPayload = cart.map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      flavorChoice: item.flavorChoice,
      customInstructions: item.customInstructions,
      modifiers: item.modifiers.map(m => ({
        ingredientId: m.ingredientId,
        ingredientName: m.ingredientName,
        modifierType: m.modifierType,
        extraPriceUsdCents: m.extraPriceUsdCents
      })),
      comboChildren: item.comboChildren?.map(child => ({
        productId: child.productId,
        quantity: child.quantity,
        flavorChoice: child.flavorChoice,
        customInstructions: child.customInstructions,
        modifiers: child.modifiers.map(m => ({
          ingredientId: m.ingredientId,
          ingredientName: m.ingredientName,
          modifierType: m.modifierType,
          extraPriceUsdCents: m.extraPriceUsdCents
        }))
      }))
    }));

    // Si estamos editando un pedido existente: usar PATCH con `version`
    if (editingOrderId) {
      try {
        const patchRes = await fetch(`/api/orders/${editingOrderId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            version: editingOrderVersion,
            tableNumber,
            fulfillmentType,
            deliveryFeeUsdCents: fulfillmentType === 'delivery' ? deliveryFeeCents : 0,
            customerName: fulfillmentType === 'delivery' ? (customerName.trim() || undefined) : undefined,
            customerPhone: fulfillmentType === 'delivery' ? (customerPhone.trim() || undefined) : undefined,
            deliveryAddress: fulfillmentType === 'delivery' ? (deliveryAddress.trim() || undefined) : undefined,
            deliveryReference: fulfillmentType === 'delivery' ? (deliveryReference.trim() || undefined) : undefined,
            motorizadoId: fulfillmentType === 'delivery' ? (motorizadoId || undefined) : undefined,
            notes,
            lines: linesPayload
          })
        });

        const patchData = await patchRes.json();

        if (patchRes.status === 409) {
          // CONFLICTO DETECTADO: Dos dispositivos editaron al mismo tiempo
          setStatusNotification({
            type: 'error',
            message: `⚠️ Conflicto de Concurrencia: La orden fue modificada por otro usuario (versión servidor: ${patchData.serverVersion || 'nueva'}). Se han recargado los datos para evitar sobreescritura.`
          });
          setEditingOrderVersion(patchData.serverVersion || (editingOrderVersion + 1));
          refetchOrders();
          return;
        }

        if (!patchRes.ok || !patchData.success) {
          throw new Error(patchData.error || 'Error al actualizar pedido');
        }

        setStatusNotification({
          type: 'success',
          message: `✓ Orden #${editingOrderNumber || patchData.order.order_number} actualizada con éxito (v${patchData.order.version})`
        });
        handleClearCart();
        refetchOrders();
      } catch (err: any) {
        setStatusNotification({
          type: 'error',
          message: `Error: ${err?.message || 'Fallo de conexión'}`
        });
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Creación de NUEVO pedido: POST /api/orders con clave de idempotencia
    const orderPayload = {
      tableNumber,
      fulfillmentType,
      notes: notes.trim() || undefined,
      deliveryFeeUsdCents: fulfillmentType === 'delivery' ? deliveryFeeCents : 0,
      customerName: fulfillmentType === 'delivery' ? (customerName.trim() || undefined) : undefined,
      customerPhone: fulfillmentType === 'delivery' ? (customerPhone.trim() || undefined) : undefined,
      deliveryAddress: fulfillmentType === 'delivery' ? (deliveryAddress.trim() || undefined) : undefined,
      deliveryReference: fulfillmentType === 'delivery' ? (deliveryReference.trim() || undefined) : undefined,
      motorizadoId: fulfillmentType === 'delivery' ? (motorizadoId || undefined) : undefined,
      cashCollectedByDriver: fulfillmentType === 'delivery' ? cashCollectedByDriver : false,
      couponCode: couponCode.trim() || undefined,
      lines: linesPayload
    };

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(orderPayload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error en el servidor al crear la orden');
      }

      setStatusNotification({
        type: 'success',
        message: `✓ Pedido enviado a Caja: Orden #${data.order.order_number} (${data.order.table_number})`
      });
      handleClearCart();
      refetchOrders();
    } catch (err: any) {
      // CAÍDA DE WI-FI O ERROR DE RED -> Guardar automáticamente en Outbox IndexedDB
      console.warn('Fallo de red al enviar pedido. Encolando en IndexedDB outbox_orders:', err);
      try {
        await saveOrderToOutbox({
          idempotencyKey,
          payload: orderPayload,
          token: token || undefined,
          createdAtMs: Date.now(),
          attempts: 1,
          lastError: err?.message || 'Error de conexión'
        });

        setStatusNotification({
          type: 'warning',
          message: '⚠️ Wi-Fi desconectado. Pedido encolado en IndexedDB con clave de idempotencia. Se enviará automáticamente al reconectar.'
        });
        handleClearCart();
      } catch (idbErr: any) {
        setStatusNotification({
          type: 'error',
          message: `Fallo al guardar en cola offline: ${idbErr?.message}`
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reintentar manualmente el Outbox
  const handleManualFlushOutbox = async () => {
    setIsFlushingOutbox(true);
    try {
      const { sent, failed } = await flushOutbox(token || undefined);
      if (sent > 0) {
        setStatusNotification({
          type: 'success',
          message: `✓ Se sincronizaron ${sent} pedido(s) pendientes de la cola offline.`
        });
        refetchOrders();
      } else if (failed > 0) {
        setStatusNotification({
          type: 'error',
          message: `No se pudieron sincronizar ${failed} pedido(s). Verifique la conexión con el Food Truck.`
        });
      }
    } finally {
      setIsFlushingOutbox(false);
    }
  };

  // Cargar una orden existente para editar
  const handleLoadOrderForEdit = (order: ExistingOrder) => {
    setEditingOrderId(order.id);
    setEditingOrderVersion(order.version);
    setEditingOrderNumber(order.order_number);
    setTableNumber(order.table_number);
    setFulfillmentType((order.fulfillment_type as any) || 'salon');

    // Mapear líneas existentes a formato CartItem
    const loadedCart: CartItem[] = (order.lines || [])
      .filter((l: any) => l.line_role !== 'COMBO_CHILD')
      .map((l: any) => ({
        clientLineId: `cline_${generateUuidV7()}`,
        productId: l.product_id,
        productName: l.product_name,
        station: l.station,
        quantity: l.quantity,
        unitPriceUsdCents: l.unit_price_usd_cents,
        isCombo: l.line_role === 'COMBO_PARENT',
        modifiers: (l.modifiers || []).map((m: any) => ({
          ingredientId: m.ingredient_id,
          ingredientName: m.ingredient_name,
          modifierType: m.modifier_type,
          extraPriceUsdCents: m.extra_price_usd_cents
        })),
        flavorChoice: l.flavor_choice,
        customInstructions: l.custom_instructions
      }));

    setCart(loadedCart);
    setShowOrdersList(false);
    setStatusNotification({
      type: 'warning',
      message: `Editando Orden #${order.order_number} (Versión ${order.version}). Recuerda guardar cambios.`
    });
  };

  if (isLoading) {
    return (
      <div className="py-24 text-center text-tocineta-yellow">
        <span className="text-4xl animate-spin inline-block">🍔</span>
        <p className="mt-4 text-sm font-black uppercase tracking-wider">Cargando Comandero Ultrarrápido...</p>
      </div>
    );
  }

  if (error || !menu || !menu.success) {
    return (
      <div className="p-8 bg-red-500/10 border border-red-500/30 rounded-3xl text-center text-red-400 max-w-lg mx-auto">
        <span className="text-3xl block mb-2">📡</span>
        <p className="font-black text-base">Error al conectar con el servidor local del Food Truck</p>
        <p className="text-xs text-tocineta-muted mt-2">
          Verifique que la laptop del servidor esté encendida y conectada al router Wi-Fi
        </p>
      </div>
    );
  }

  const categories = menu.categories || [];

  return (
    <div className="space-y-4">
      
      {/* BADGE DE OUTBOX OFFLINE (SI HAY PEDIDOS ESPERANDO WI-FI) */}
      {outboxCount > 0 && (
        <div className="bg-amber-500/20 border-2 border-amber-500/60 rounded-2xl p-3 flex items-center justify-between shadow-lg animate-pulse">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚠️</span>
            <div>
              <p className="text-xs font-black text-amber-300 uppercase tracking-wider">
                {outboxCount} {outboxCount === 1 ? 'pedido en cola esperando Wi-Fi' : 'pedidos en cola esperando Wi-Fi'}
              </p>
              <p className="text-[11px] text-amber-200/80">
                Guardados localmente en IndexedDB. Se sincronizarán automáticamente al volver la señal.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleManualFlushOutbox}
            disabled={isFlushingOutbox}
            className="min-h-[48px] px-4 rounded-xl bg-amber-500 text-black font-black text-xs hover:bg-amber-400 active:scale-95 transition-all flex items-center gap-1.5 shadow"
          >
            {isFlushingOutbox ? 'Sincronizando...' : '🔄 Sincronizar Ahora'}
          </button>
        </div>
      )}

      {/* NOTIFICACIÓN FLOTANTE / BANNER */}
      {statusNotification && (
        <div
          className={`p-3 rounded-2xl border text-xs font-bold flex items-center justify-between shadow-md transition-all ${
            statusNotification.type === 'success'
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
              : statusNotification.type === 'warning'
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
              : 'bg-red-500/15 border-red-500/40 text-red-300'
          }`}
        >
          <span>{statusNotification.message}</span>
          <button
            onClick={() => setStatusNotification(null)}
            className="text-xs font-bold opacity-70 hover:opacity-100 px-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* BARRA SUPERIOR: CATEGORÍAS, BUSCADOR Y BOTÓN VER ÓRDENES */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        {/* Pills de Categorías (Botones Táctiles) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 scrollbar-none">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`min-h-[48px] px-4 rounded-2xl text-xs font-black transition-all shrink-0 flex items-center justify-center ${
              selectedCategory === 'all'
                ? 'bg-tocineta-yellow text-tocineta-bg shadow-lg scale-102'
                : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white'
            }`}
          >
            Todos ({allProducts.length})
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`min-h-[48px] px-4 rounded-2xl text-xs font-black transition-all shrink-0 flex items-center justify-center ${
                selectedCategory === cat.id
                  ? 'bg-tocineta-yellow text-tocineta-bg shadow-lg scale-102'
                  : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white'
              }`}
            >
              {cat.name} ({cat.products.length})
            </button>
          ))}
        </div>

        {/* Buscador + Acceso a Órdenes Abiertas */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="🔍 Buscar plato..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full lg:w-56 min-h-[48px] bg-tocineta-card border border-tocineta-border rounded-2xl px-4 text-xs text-white placeholder-tocineta-muted focus:border-tocineta-yellow outline-none shadow-sm"
          />
          <button
            type="button"
            onClick={() => setShowOrdersList(prev => !prev)}
            className="min-h-[48px] px-3.5 rounded-2xl bg-tocineta-card border border-tocineta-border hover:border-tocineta-yellow text-xs font-bold text-white flex items-center gap-1.5 shrink-0 shadow-sm"
          >
            <span>📋</span>
            <span>Órdenes ({ordersData?.orders?.length || 0})</span>
          </button>
        </div>
      </div>

      {/* MODAL / DRAWER DE ÓRDENES ABIERTAS (PARA EDITAR O AUTORIZAR SIN PAGO) */}
      {showOrdersList && (
        <div className="bg-tocineta-card border border-tocineta-border rounded-3xl p-4 shadow-2xl space-y-3">
          <div className="flex items-center justify-between border-b border-tocineta-border pb-2">
            <div>
              <h3 className="font-black text-sm text-white">Órdenes Abiertas en Food Truck</h3>
              <p className="text-[11px] text-tocineta-muted">Selecciona una orden para editarla o autorizar despacho sin pago</p>
            </div>
            <button
              onClick={() => setShowOrdersList(false)}
              className="w-9 h-9 rounded-xl bg-tocineta-bg text-tocineta-muted hover:text-white flex items-center justify-center font-bold"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-y-auto">
            {ordersData?.orders?.length === 0 ? (
              <p className="text-xs text-tocineta-muted py-4 col-span-3 text-center">No hay órdenes abiertas en este momento.</p>
            ) : (
              ordersData?.orders?.map(o => (
                <div
                  key={o.id}
                  className="bg-tocineta-bg border border-tocineta-border rounded-2xl p-3 flex flex-col justify-between gap-2"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-black text-sm text-white">Orden #{o.order_number}</span>
                      <span className="text-xs text-tocineta-yellow font-bold block">{o.table_number}</span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-tocineta-border text-tocineta-muted">
                      v{o.version}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1 border-t border-tocineta-border">
                    <span className="font-mono font-bold text-white">
                      ${(o.total_to_collect_usd_cents / 100).toFixed(2)}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                      o.payment_status === 'autorizado_sin_pago'
                        ? 'bg-purple-500/20 text-purple-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}>
                      {o.payment_status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => handleLoadOrderForEdit(o)}
                      className="min-h-[44px] rounded-xl bg-tocineta-card border border-tocineta-border hover:border-tocineta-yellow text-[11px] font-bold text-white flex items-center justify-center"
                    >
                      ✏️ Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthorizingOrder(o);
                        setShowOrdersList(false);
                      }}
                      className="min-h-[44px] rounded-xl bg-purple-500/20 border border-purple-500/40 hover:bg-purple-500/30 text-[11px] font-bold text-purple-300 flex items-center justify-center"
                    >
                      🔑 Autorizar PIN
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* CONTENEDOR PRINCIPAL: CATÁLOGO TÁCTIL (IZQUIERDA) + CARRITO TÁCTIL (DERECHA) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        
        {/* GRILLA DE PRODUCTOS (8 COLS) */}
        <div className="lg:col-span-7 xl:col-span-8 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredProducts.map(product => {
            const isAvail = product.isAvailable;
            return (
              <div
                key={product.id}
                className={`bg-tocineta-card border rounded-3xl p-4 flex flex-col justify-between transition-all relative overflow-hidden shadow-md ${
                  isAvail
                    ? 'border-tocineta-border hover:border-tocineta-yellow/60'
                    : 'border-red-950/40 bg-red-950/10 opacity-60'
                }`}
              >
                {/* Banner Agotado */}
                {!isAvail && (
                  <div className="absolute top-3 right-3 bg-red-600 text-white text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full shadow">
                    Agotado
                  </div>
                )}

                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-tocineta-muted tracking-wider block">
                        {product.categoryName}
                      </span>
                      <h3 className="font-black text-base text-white leading-tight mt-0.5">
                        {product.name}
                      </h3>
                    </div>
                  </div>

                  {product.description && (
                    <p className="text-xs text-tocineta-muted mt-1.5 line-clamp-2">
                      {product.description}
                    </p>
                  )}
                </div>

                {/* Precios y Botones Táctiles de Acción (Mínimo 48x48px) */}
                <div className="mt-4 pt-3 border-t border-tocineta-border flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] text-tocineta-muted uppercase font-bold block">Precio:</span>
                    <span className="text-lg font-black text-tocineta-yellow font-mono">
                      {formatPrice(product.priceUsdCents)}
                    </span>
                  </div>

                  {isAvail && (
                    <div className="flex items-center gap-1.5">
                      {/* Botón Personalizar (Solo si no es combo) */}
                      {!product.isCombo && (
                        <button
                          type="button"
                          onClick={() => handleOpenCustomization(product)}
                          className="min-h-[48px] px-3 rounded-2xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow text-tocineta-muted hover:text-white font-bold text-xs active:scale-95 transition-all flex items-center gap-1 shadow"
                          title="Personalizar ingredientes (pan, salsas, extras)"
                        >
                          <span>⚙️</span>
                          <span className="hidden sm:inline">Modificar</span>
                        </button>
                      )}

                      {/* Botón Principal: 1 Toque para Agregar (< 1 Segundo) */}
                      <button
                        type="button"
                        onClick={() => handleFastAddProduct(product)}
                        className={`min-h-[48px] px-4 rounded-2xl font-black text-xs active:scale-95 transition-all flex items-center justify-center gap-1 shadow-lg ${
                          product.isCombo
                            ? 'bg-purple-500 text-white hover:bg-purple-600'
                            : 'bg-tocineta-yellow text-tocineta-bg hover:bg-tocineta-yellow-hover'
                        }`}
                      >
                        <span>{product.isCombo ? '✨ Armar' : '+ 1 Toque'}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* CARRITO Y COMANDERO TÁCTIL (4 COLS EN DESKTOP, STICKY) */}
        <div className="lg:col-span-5 xl:col-span-4 bg-tocineta-card border border-tocineta-border rounded-3xl p-4 shadow-2xl flex flex-col justify-between space-y-4 lg:sticky lg:top-4">
          
          {/* Cabecera del Carrito */}
          <div className="flex items-center justify-between border-b border-tocineta-border pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">🧾</span>
                <h3 className="font-black text-base text-white">
                  {editingOrderId ? `Editar Orden #${editingOrderNumber}` : 'Comanda Actual'}
                </h3>
              </div>
              {editingOrderId ? (
                <span className="text-[11px] text-amber-400 font-bold">
                  Concurrencia Optimista (v{editingOrderVersion})
                </span>
              ) : (
                <span className="text-[11px] text-tocineta-muted">
                  {cart.length} {cart.length === 1 ? 'producto seleccionado' : 'productos seleccionados'}
                </span>
              )}
            </div>

            {cart.length > 0 && (
              <button
                type="button"
                onClick={handleClearCart}
                className="min-h-[48px] px-3 py-2 text-xs text-tocineta-muted hover:text-red-400 font-bold rounded-xl hover:bg-red-500/10 flex items-center justify-center transition-all"
              >
                Limpiar
              </button>
            )}
          </div>

          {/* Selector Táctil de Mesa y Tipo de Pedido */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-tocineta-muted">
                Ubicación / Mesa:
              </span>
              <select
                value={tableNumber}
                onChange={e => setTableNumber(e.target.value)}
                className="bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-1.5 text-xs font-bold text-tocineta-yellow outline-none min-h-[42px]"
              >
                <option value="Mesa 1">Mesa 1</option>
                <option value="Mesa 2">Mesa 2</option>
                <option value="Mesa 3">Mesa 3</option>
                <option value="Mesa 4">Mesa 4</option>
                <option value="Mesa 5">Mesa 5</option>
                <option value="Mesa 6">Mesa 6</option>
                <option value="Mesa 7">Mesa 7</option>
                <option value="Mesa 8">Mesa 8</option>
                <option value="Mesa 9">Mesa 9</option>
                <option value="Mesa 10">Mesa 10</option>
                <option value="Barra Food Truck">Barra Food Truck</option>
                <option value="Para Llevar">Para Llevar</option>
              </select>
            </div>

            {/* Segmented Control de Modalidad de Despacho */}
            <div className="grid grid-cols-3 gap-1 bg-tocineta-bg p-1 rounded-2xl border border-tocineta-border">
              {(['salon', 'para_llevar', 'delivery'] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFulfillmentType(type)}
                  className={`min-h-[48px] rounded-xl text-xs font-bold transition-all flex items-center justify-center ${
                    fulfillmentType === type
                      ? 'bg-tocineta-yellow text-tocineta-bg shadow'
                      : 'text-tocineta-muted hover:text-white'
                  }`}
                >
                  {type === 'salon' ? '🍽️ Salón' : type === 'para_llevar' ? '🛍️ Llevar' : '🛵 Delivery'}
                </button>
              ))}
            </div>

            {/* Si es delivery: Panel Operativo de Despacho, Zonas y Motorizado */}
            {fulfillmentType === 'delivery' && (
              <div className="p-3 bg-tocineta-bg border border-tocineta-border rounded-2xl space-y-2.5">
                {/* 4 Botones Táctiles de Tarifa / Zona + Manual */}
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-tocineta-muted block mb-1">
                    Tarifa de Delivery (Fondo Motorizado):
                  </span>
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      { cents: 200, label: '+$2.00' },
                      { cents: 300, label: '+$3.00' },
                      { cents: 400, label: '+$4.00' },
                      { cents: 500, label: '+$5.00' }
                    ].map(t => (
                      <button
                        key={t.cents}
                        type="button"
                        onClick={() => setDeliveryTierCents(t.cents)}
                        className={`min-h-[48px] rounded-xl text-xs font-mono font-black transition-all ${
                          deliveryTierCents === t.cents
                            ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                            : 'bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Datos del Cliente */}
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Nombre del Cliente"
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    className="min-h-[40px] bg-tocineta-card border border-tocineta-border rounded-xl px-2.5 text-xs text-white placeholder-tocineta-muted outline-none focus:border-tocineta-yellow"
                  />
                  <input
                    type="text"
                    placeholder="Teléfono (ej: 0414...)"
                    value={customerPhone}
                    onChange={e => setCustomerPhone(e.target.value)}
                    className="min-h-[40px] bg-tocineta-card border border-tocineta-border rounded-xl px-2.5 text-xs text-white placeholder-tocineta-muted outline-none focus:border-tocineta-yellow font-mono"
                  />
                </div>

                {/* Dirección y Punto de Referencia */}
                <div className="space-y-1.5">
                  <input
                    type="text"
                    placeholder="Dirección exacta de entrega..."
                    value={deliveryAddress}
                    onChange={e => setDeliveryAddress(e.target.value)}
                    className="w-full min-h-[40px] bg-tocineta-card border border-tocineta-border rounded-xl px-2.5 text-xs text-white placeholder-tocineta-muted outline-none focus:border-tocineta-yellow"
                  />
                  <input
                    type="text"
                    placeholder="Punto de referencia (ej: Casa blanca frente a plaza)..."
                    value={deliveryReference}
                    onChange={e => setDeliveryReference(e.target.value)}
                    className="w-full min-h-[38px] bg-tocineta-card border border-tocineta-border rounded-xl px-2.5 text-[11px] text-white placeholder-tocineta-muted outline-none focus:border-tocineta-yellow"
                  />
                </div>

                {/* Selector de Motorizado */}
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-tocineta-muted block">
                    Motorizado Asignado:
                  </span>
                  <select
                    value={motorizadoId}
                    onChange={e => setMotorizadoId(e.target.value)}
                    className="w-full min-h-[42px] bg-tocineta-card border border-tocineta-border rounded-xl px-3 text-xs font-bold text-tocineta-yellow outline-none focus:border-tocineta-yellow"
                  >
                    <option value="">-- Sin asignar / Por despachar --</option>
                    {(driversData?.drivers || []).map(d => (
                      <option key={d.id} value={d.id}>
                        🛵 {d.name} ({d.phone})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Control de Efectivo en Mano del Motorizado */}
                <button
                  type="button"
                  onClick={() => setCashCollectedByDriver(prev => !prev)}
                  className={`w-full min-h-[42px] px-3 rounded-xl border text-left text-xs font-bold transition-all flex items-center justify-between ${
                    cashCollectedByDriver
                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                      : 'bg-tocineta-card border-tocineta-border text-tocineta-muted hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>💵</span>
                    <span className="text-[11px]">Cobrado en efectivo por el motorizado</span>
                  </div>
                  <span className="font-mono text-xs">
                    {cashCollectedByDriver ? '✓ SÍ (En mano)' : '✕ NO'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* LISTA DE ÍTEMS EN EL CARRITO (SCROLLABLE) */}
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {cart.length === 0 ? (
              <div className="py-10 text-center text-tocineta-muted">
                <span className="text-3xl block mb-2 opacity-40">🛒</span>
                <p className="text-xs font-bold">El pedido está vacío</p>
                <p className="text-[11px] mt-1">Toca cualquier producto a la izquierda para agregarlo en 1 toque</p>
              </div>
            ) : (
              cart.map(item => (
                <div
                  key={item.clientLineId}
                  className="bg-tocineta-bg border border-tocineta-border rounded-2xl p-3 space-y-1.5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-black text-sm text-white block">
                        {item.productName}
                      </span>
                      <span className="text-xs font-mono font-bold text-tocineta-yellow">
                        {formatPrice(item.unitPriceUsdCents)} c/u
                      </span>
                    </div>

                    {/* Controles Táctiles de Cantidad (+/-) (WCAG min 48x48px) */}
                    <div className="flex items-center gap-1.5 bg-tocineta-card border border-tocineta-border rounded-xl p-1">
                      <button
                        type="button"
                        onClick={() => handleChangeQty(item.clientLineId, -1)}
                        className="min-h-[48px] min-w-[48px] rounded-lg bg-tocineta-bg text-white hover:text-red-400 font-black text-lg flex items-center justify-center active:scale-95"
                      >
                        -
                      </button>
                      <span className="w-8 text-center font-mono font-black text-sm text-white">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleChangeQty(item.clientLineId, 1)}
                        className="min-h-[48px] min-w-[48px] rounded-lg bg-tocineta-yellow text-tocineta-bg font-black text-lg flex items-center justify-center active:scale-95"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Resumen de Modificadores (Pan, Salsas, Barra Libre, Extras) */}
                  {(item.modifiers.length > 0 || item.customInstructions || item.comboChildren) && (
                    <div className="pt-1.5 border-t border-tocineta-border/60 space-y-1">
                      {/* Modificadores simples */}
                      {item.modifiers.map((m, idx) => (
                        <span
                          key={idx}
                          className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded mr-1 mb-1 border ${
                            m.modifierType === 'SIN_INGREDIENTE'
                              ? 'bg-red-500/15 border-red-500/40 text-red-300'
                              : m.modifierType === 'POCO_INGREDIENTE'
                              ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                              : m.modifierType === 'BARRA_LIBRE'
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                              : 'bg-tocineta-yellow/15 border-tocineta-yellow/40 text-tocineta-yellow'
                          }`}
                        >
                          {m.modifierType === 'SIN_INGREDIENTE' ? `Sin ${m.ingredientName}` : m.modifierType === 'POCO_INGREDIENTE' ? `Poca ${m.ingredientName}` : `+ ${m.ingredientName}`}
                        </span>
                      ))}

                      {/* Instrucción especial (ej: Envuelta en Lechuga) */}
                      {item.customInstructions && (
                        <p className="text-[11px] text-amber-300 font-semibold italic">
                          "{item.customInstructions}"
                        </p>
                      )}

                      {/* Desglose de Hijos del Combo */}
                      {item.comboChildren && (
                        <div className="space-y-1 pl-2 border-l-2 border-purple-500/50 mt-1">
                          {item.comboChildren.map((ch, cIdx) => (
                            <div key={cIdx} className="text-[11px]">
                              <span className="font-bold text-white">• {ch.productName}</span>
                              {ch.modifiers.length > 0 && (
                                <span className="text-[10px] text-tocineta-muted block pl-2">
                                  ({ch.modifiers.map(m => m.ingredientName).join(', ')})
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* NOTA ADICIONAL Y CUPÓN */}
          <div className="space-y-2 pt-2 border-t border-tocineta-border">
            <input
              type="text"
              placeholder="Nota para la orden (ej: Servir primero las bebidas)..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full min-h-[44px] bg-tocineta-bg border border-tocineta-border rounded-xl px-3 text-xs text-white placeholder-tocineta-muted focus:border-tocineta-yellow outline-none"
            />
            <input
              type="text"
              placeholder="Código de Cupón (opcional)..."
              value={couponCode}
              onChange={e => setCouponCode(e.target.value.toUpperCase())}
              className="w-full min-h-[44px] bg-tocineta-bg border border-tocineta-border rounded-xl px-3 text-xs font-mono uppercase text-tocineta-yellow placeholder-tocineta-muted focus:border-tocineta-yellow outline-none"
            />
          </div>

          {/* TOTALES FINANCIEROS EN CENTAVOS EXACTOS (SIMULTÁNEO USD + Bs - H-04) */}
          <div className="p-3 bg-tocineta-bg border border-tocineta-border rounded-2xl space-y-1.5 font-mono text-xs">
            <div className="flex justify-between text-tocineta-muted">
              <span>Subtotal Alimentos:</span>
              <span>{formatDualPrice(subtotalCents)}</span>
            </div>
            {fulfillmentType === 'delivery' && (
              <div className="flex justify-between text-tocineta-muted">
                <span>Fondo Delivery Motorizado:</span>
                <span>{formatDualPrice(deliveryFeeCents)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm sm:text-base font-black text-white pt-1.5 border-t border-tocineta-border">
              <span>Total a Cobrar:</span>
              <span className="text-tocineta-yellow text-right">{formatDualPrice(totalToCollectCents)}</span>
            </div>
          </div>

          {/* BOTÓN GRANDE TÁCTIL: ENVIAR A CAJA (Mínimo 54px de alto) */}
          <button
            type="button"
            onClick={handleSubmitOrder}
            disabled={cart.length === 0 || isSubmitting}
            className="w-full min-h-[54px] rounded-2xl bg-tocineta-yellow text-tocineta-bg font-black text-base disabled:opacity-40 disabled:pointer-events-none hover:bg-tocineta-yellow-hover active:scale-95 transition-all flex items-center justify-center gap-2 shadow-xl"
          >
            {isSubmitting ? (
              <span className="animate-spin inline-block text-xl">⏳</span>
            ) : editingOrderId ? (
              <span>✓ Actualizar Pedido #{editingOrderNumber} (v{editingOrderVersion})</span>
            ) : (
              <span>🚀 Enviar a Caja ({tableNumber})</span>
            )}
          </button>

        </div>

      </div>

      {/* Botón Flotante Móvil del Comandero con Total Dual Simultáneo USD + Bs (H-04 / H-05) */}
      {cart.length > 0 && (
        <div className="lg:hidden fixed bottom-4 left-4 right-4 z-30">
          <button
            type="button"
            onClick={() => {
              const cartElem = document.getElementById('pos-cart-panel');
              cartElem?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="w-full min-h-[48px] bg-tocineta-yellow text-tocineta-bg font-black text-xs sm:text-sm px-4 py-3 rounded-2xl shadow-2xl flex items-center justify-between border-2 border-yellow-300 active:scale-98 transition-all"
          >
            <span className="flex items-center gap-2">
              <span>🛒</span>
              <span>Pedido ({cart.reduce((s, i) => s + i.quantity, 0)})</span>
            </span>
            <span className="font-mono text-right">
              {formatDualPrice(totalToCollectCents)}
            </span>
          </button>
        </div>
      )}

      {/* MODAL DE PERSONALIZACIÓN DE INGREDIENTES */}
      {customizingProduct && (
        <CustomizationModal
          isOpen={true}
          onClose={() => setCustomizingProduct(null)}
          product={customizingProduct}
          barraLibreList={menu?.barraLibreIngredients || []}
          paidExtrasList={menu?.paidExtras || []}
          onSave={handleSaveCustomization}
        />
      )}

      {/* MODAL DEL ASISTENTE GUIADO DE COMBOS */}
      {comboWizardProduct && (
        <ComboWizardModal
          isOpen={true}
          onClose={() => setComboWizardProduct(null)}
          combo={comboWizardProduct}
          allProducts={allProducts}
          barraLibreList={menu.barraLibreIngredients || []}
          onComplete={comboItem => {
            setCart(prev => [...prev, comboItem]);
            setStatusNotification({
              type: 'success',
              message: `✓ ${comboItem.productName} agregado al pedido`
            });
          }}
        />
      )}

      {/* MODAL DE AUTORIZACIÓN SIN PAGO (PIN ADMIN / SUPERVISOR) */}
      {authorizingOrder && (
        <AuthorizeModal
          isOpen={true}
          onClose={() => setAuthorizingOrder(null)}
          orderId={authorizingOrder.id}
          orderNumber={authorizingOrder.order_number}
          tableNumber={authorizingOrder.table_number}
          totalUsdCents={authorizingOrder.total_to_collect_usd_cents}
          onSuccess={() => {
            setStatusNotification({
              type: 'success',
              message: `✓ Orden #${authorizingOrder.order_number} autorizada sin pago y enviada a cocina`
            });
            refetchOrders();
          }}
        />
      )}

    </div>
  );
};
