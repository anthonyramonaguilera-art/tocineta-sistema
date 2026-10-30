import { useState, useEffect, useMemo, useCallback } from 'react';
import type { CartItem, CustomizationModifier } from './types.js';
import type { PosProduct } from '../../types/menu.js';
import { generateUuidV7, createIdempotencyKey, usdToBsCents, parseRateToMicroBs } from '@tocineta/shared';
import { saveOrderToOutbox, subscribeToOutboxCount, flushOutbox } from './outbox.js';

export interface UsePosCartProps {
  token: string | null;
  formattedRate?: string;
  onOrderSuccess?: (order: any) => void;
}

export function usePosCart({ token, formattedRate = '40,00', onOrderSuccess }: UsePosCartProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Paso 1: Canal y Cliente
  const [customerName, setCustomerName] = useState<string>('');
  const [customerNameError, setCustomerNameError] = useState<string | null>(null);
  const [fulfillmentType, setFulfillmentType] = useState<'salon' | 'para_llevar' | 'delivery'>('salon');
  const [tableNumber, setTableNumber] = useState<string>('Mesa 1');
  const [deliverySede, setDeliverySede] = useState<string>(() => localStorage.getItem('tocineta_active_sede') || 'Sede B: Alta Vista');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [deliveryAddress, setDeliveryAddress] = useState<string>('');
  const [deliveryReference, setDeliveryReference] = useState<string>('');
  const [deliveryTierCents, setDeliveryTierCents] = useState<number>(200);
  const [motorizadoId, setMotorizadoId] = useState<string>('');
  const [cashCollectedByDriver, setCashCollectedByDriver] = useState<boolean>(false);

  // Paso 2: Carrito y Notas
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [couponCode, setCouponCode] = useState<string>('');

  // Edición de orden existente (optimistic concurrency)
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingOrderVersion, setEditingOrderVersion] = useState<number>(1);
  const [editingOrderNumber, setEditingOrderNumber] = useState<number | null>(null);

  // Estado de envío y outbox
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [outboxCount, setOutboxCount] = useState<number>(0);
  const [statusNotification, setStatusNotification] = useState<{
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
  } | null>(null);

  useEffect(() => {
    const unsub = subscribeToOutboxCount(setOutboxCount);
    return () => unsub();
  }, []);

  // Cálculos de totales
  const subtotalUsdCents = useMemo(() => {
    return cart.reduce((sum, item) => {
      const itemModifiersPrice = (item.modifiers || []).reduce((mSum, m) => mSum + (m.extraPriceUsdCents || 0), 0);
      return sum + (item.unitPriceUsdCents + itemModifiersPrice) * item.quantity;
    }, 0);
  }, [cart]);

  const deliveryFeeUsdCents = fulfillmentType === 'delivery' ? deliveryTierCents : 0;
  const totalUsdCents = subtotalUsdCents + deliveryFeeUsdCents;

  const rateMicro = useMemo(() => {
    try {
      return parseRateToMicroBs(formattedRate);
    } catch {
      return 40000000;
    }
  }, [formattedRate]);

  const subtotalBsCents = useMemo(() => usdToBsCents(subtotalUsdCents, rateMicro), [subtotalUsdCents, rateMicro]);
  const totalBsCents = useMemo(() => usdToBsCents(totalUsdCents, rateMicro), [totalUsdCents, rateMicro]);

  // Acciones sobre el carrito
  const addProduct = useCallback((product: PosProduct, quantity = 1, modifiers: CustomizationModifier[] = [], customInstructions?: string, comboChildren?: any[]) => {
    setCart((prev) => {
      // Si el ítem no tiene modificadores ni instrucciones ni es combo, intentamos agrupar
      if (!product.isCombo && modifiers.length === 0 && !customInstructions) {
        const existingIndex = prev.findIndex(
          (i) => i.productId === product.id && (!i.modifiers || i.modifiers.length === 0) && !i.customInstructions
        );
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = {
            ...next[existingIndex],
            quantity: next[existingIndex].quantity + quantity
          };
          return next;
        }
      }

      const newItem: CartItem = {
        clientLineId: generateUuidV7(),
        productId: product.id,
        productName: product.name,
        station: product.station,
        quantity,
        unitPriceUsdCents: product.priceUsdCents,
        isCombo: Boolean(product.isCombo),
        modifiers,
        customInstructions,
        comboChildren
      };
      return [...prev, newItem];
    });
  }, []);

  const decrementProduct = useCallback((productId: string) => {
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.productId === productId);
      if (idx < 0) return prev;
      if (prev[idx].quantity > 1) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity - 1 };
        return next;
      }
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const removeItem = useCallback((clientLineId: string) => {
    setCart((prev) => prev.filter((i) => i.clientLineId !== clientLineId));
  }, []);

  const updateItemQuantity = useCallback((clientLineId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(clientLineId);
      return;
    }
    setCart((prev) =>
      prev.map((i) => (i.clientLineId === clientLineId ? { ...i, quantity } : i))
    );
  }, [removeItem]);

  const clearCart = useCallback(() => {
    setCart([]);
    setCustomerName('');
    setCustomerNameError(null);
    setNotes('');
    setCouponCode('');
    setEditingOrderId(null);
    setEditingOrderVersion(1);
    setEditingOrderNumber(null);
    setStep(1);
  }, []);

  // Validación de Paso 1
  const validateStep1 = useCallback((): boolean => {
    const cleanName = customerName.trim();
    if (!cleanName || cleanName.length < 3) {
      setCustomerNameError('El nombre y apellido es obligatorio (mínimo 3 caracteres)');
      return false;
    }
    setCustomerNameError(null);
    return true;
  }, [customerName]);

  // Enviar orden a cocina / backend
  const submitOrder = useCallback(async (options?: { announce?: boolean }): Promise<{ success: boolean; order?: any; error?: string }> => {
    if (!validateStep1()) {
      setStep(1);
      return { success: false, error: 'Por favor completa el nombre del cliente' };
    }
    if (cart.length === 0) {
      return { success: false, error: 'El carrito está vacío' };
    }

    setIsSubmitting(true);
    setStatusNotification(null);

    const idempotencyKey = createIdempotencyKey('order');
    const linesPayload = cart.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      modifiers: item.modifiers || [],
      customInstructions: item.customInstructions || undefined,
      comboChildren: item.comboChildren || undefined
    }));

    const orderPayload = {
      tableNumber: fulfillmentType === 'salon' ? tableNumber : fulfillmentType === 'para_llevar' ? 'Para Llevar' : 'Delivery',
      fulfillmentType,
      notes: fulfillmentType === 'delivery'
        ? (notes.trim() ? `[${deliverySede}] ${notes.trim()}` : `[${deliverySede}]`)
        : (notes.trim() || undefined),
      deliveryFeeUsdCents: fulfillmentType === 'delivery' ? deliveryTierCents : 0,
      customerName: customerName.trim(),
      customerPhone: fulfillmentType === 'delivery' ? (customerPhone.trim() || undefined) : undefined,
      deliveryAddress: fulfillmentType === 'delivery' ? (deliveryAddress.trim() || undefined) : undefined,
      deliveryReference: fulfillmentType === 'delivery' ? (deliveryReference.trim() || undefined) : undefined,
      motorizadoId: fulfillmentType === 'delivery' ? (motorizadoId || undefined) : undefined,
      cashCollectedByDriver: fulfillmentType === 'delivery' ? cashCollectedByDriver : false,
      couponCode: couponCode.trim() || undefined,
      lines: linesPayload
    };

    try {
      // Si estamos editando una orden existente: PATCH /api/orders/:id con concurrencia optimista
      if (editingOrderId) {
        const res = await fetch(`/api/orders/${editingOrderId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            expectedVersion: editingOrderVersion,
            lines: linesPayload,
            notes: orderPayload.notes,
            tableNumber: orderPayload.tableNumber,
            fulfillmentType: orderPayload.fulfillmentType
          })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Error al actualizar pedido');
        }

        if (options?.announce !== false) {
          setStatusNotification({
            type: 'success',
            message: `✓ Pedido #${editingOrderNumber || ''} actualizado con éxito`
          });
        }
        clearCart();
        onOrderSuccess?.(data.order);
        return { success: true, order: data.order };
      }

      // Si es una NUEVA orden: POST /api/orders
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
        throw new Error(data.error || 'Error al crear pedido');
      }

      if (options?.announce !== false) {
        setStatusNotification({
          type: 'success',
          message: `✓ Pedido #${data.order?.order_number || ''} guardado. Pendiente de cobro`
        });
      }
      clearCart();
      onOrderSuccess?.(data.order);
      return { success: true, order: data.order };
    } catch (err: any) {
      // Revisa si es fallo de red para encolar en el outbox
      const isNetworkError =
        (typeof navigator !== 'undefined' && !navigator.onLine) ||
        err instanceof TypeError ||
        err?.message?.toLowerCase().includes('failed to fetch') ||
        err?.message?.toLowerCase().includes('network');

      if (isNetworkError && !editingOrderId) {
        try {
          await saveOrderToOutbox({
            idempotencyKey,
            payload: orderPayload,
            token: token || undefined,
            createdAtMs: Date.now(),
            attempts: 1,
            lastError: err.message
          });

          setStatusNotification({
            type: 'warning',
            message: 'Wi-Fi desconectado. Pedido guardado en cola offline. Se transmitirá automáticamente al reconectar.'
          });
          clearCart();
          return { success: true };
        } catch (outboxErr: any) {
          setStatusNotification({
            type: 'error',
            message: `Error al guardar en cola offline: ${outboxErr.message}`
          });
          return { success: false, error: outboxErr.message };
        }
      }

      setStatusNotification({
        type: 'error',
        message: err.message || 'Error al procesar el pedido'
      });
      return { success: false, error: err.message };
    } finally {
      setIsSubmitting(false);
    }
  }, [
    validateStep1,
    cart,
    editingOrderId,
    editingOrderVersion,
    editingOrderNumber,
    tableNumber,
    fulfillmentType,
    deliverySede,
    notes,
    deliveryTierCents,
    customerName,
    customerPhone,
    deliveryAddress,
    deliveryReference,
    motorizadoId,
    cashCollectedByDriver,
    couponCode,
    token,
    clearCart,
    onOrderSuccess
  ]);

  return {
    step,
    setStep,
    customerName,
    setCustomerName,
    customerNameError,
    setCustomerNameError,
    fulfillmentType,
    setFulfillmentType,
    tableNumber,
    setTableNumber,
    deliverySede,
    setDeliverySede,
    customerPhone,
    setCustomerPhone,
    deliveryAddress,
    setDeliveryAddress,
    deliveryReference,
    setDeliveryReference,
    deliveryTierCents,
    setDeliveryTierCents,
    motorizadoId,
    setMotorizadoId,
    cashCollectedByDriver,
    setCashCollectedByDriver,
    cart,
    notes,
    setNotes,
    couponCode,
    setCouponCode,
    editingOrderId,
    editingOrderNumber,
    isSubmitting,
    outboxCount,
    statusNotification,
    setStatusNotification,
    subtotalUsdCents,
    deliveryFeeUsdCents,
    totalUsdCents,
    subtotalBsCents,
    totalBsCents,
    addProduct,
    decrementProduct,
    removeItem,
    updateItemQuantity,
    clearCart,
    validateStep1,
    submitOrder,
    flushOutbox
  };
}
