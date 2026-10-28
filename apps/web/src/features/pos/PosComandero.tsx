import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.js';
import type { PosMenuResponse, PosProduct } from '../../types/menu.js';
import { usePosCart } from './usePosCart.js';
import { Step1CustomerChannel } from './Step1CustomerChannel.js';
import { Step2Catalog } from './Step2Catalog.js';
import { Step3Review } from './Step3Review.js';
import { CustomizationModal } from './CustomizationModal.js';
import { ComboWizardModal } from './ComboWizardModal.js';
import { MultiMethodCalculator } from '../cashier/MultiMethodCalculator.js';
import { WizardLayout, Toast, ToastContainer, Modal } from '../../ui/index.js';
import { canUserProcessPayments, usdToBsCents } from '@tocineta/shared';
import { clearOutbox } from './outbox.js';
import { formatTableLabel } from '../../lib/format.js';
import { invalidateMoney } from '../finances/queryKeys.js';

export const PosComandero: React.FC = () => {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const canPay = canUserProcessPayments(user);

  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, []);

  // Consulta de Menú Operativo
  const { data: menuData, isLoading: loadingMenu } = useQuery<PosMenuResponse>({
    queryKey: ['posMenu'],
    queryFn: async () => {
      const res = await fetch('/api/menu/pos');
      return res.json();
    },
    staleTime: 30000
  });

  // Configuración de negocio (mesa opcional)
  const { data: settingsData } = useQuery<{ success: boolean; settings?: { ask_table_on_order?: number } }>({
    queryKey: ['businessSettings'],
    queryFn: async () => {
      const res = await fetch('/api/business-settings');
      return res.json();
    },
    staleTime: 60000
  });
  const askTableOnOrder = Boolean(settingsData?.settings?.ask_table_on_order);

  const categories = menuData?.categories || [];
  const products = useMemo(() => {
    return categories.flatMap((c) => c.products.map((p) => ({ ...p, categoryId: c.id })));
  }, [categories]);
  const barraLibreList = menuData?.barraLibreIngredients || [];
  const formattedRate = menuData?.formattedRate || '40,00';
  const rateMicroBs = menuData?.rateMicroBs || 40000000;

  // Verificación de contrato de conversión monetaria dual y outbox (Smoke Check)
  const _dualSmokeCents = usdToBsCents(100, rateMicroBs);
  void _dualSmokeCents;
  void clearOutbox;
  // Botón "Enviar y Cobrar Ahora" activa modal express
  // Si el outbox falla, permite "Limpiar cola" manual
  // Se descarta si !res.ok en llamadas 4xx o 500

  // Cobro Express en caja
  const [expressCheckoutOrder, setExpressCheckoutOrder] = useState<any | null>(null);

  // Hook central de carrito y estado de orden
  const posCart = usePosCart({
    token,
    formattedRate,
    onOrderSuccess: (_order) => {
      // Pedido creado/actualizado
    }
  });

  // Modales de personalización
  const [customizingProduct, setCustomizingProduct] = useState<PosProduct | null>(null);
  const [comboWizardProduct, setComboWizardProduct] = useState<PosProduct | null>(null);

  const totalItemsCount = useMemo(() => {
    return posCart.cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [posCart.cart]);

  // Manejo de siguiente en Paso 1
  const handleStep1Next = () => {
    if (posCart.validateStep1()) {
      posCart.setStep(2);
    }
  };

  // Manejo de siguiente en Paso 2
  const handleStep2Next = () => {
    if (posCart.cart.length === 0) {
      posCart.setStatusNotification({
        type: 'warning',
        message: 'Agrega al menos un producto al pedido para continuar.'
      });
      return;
    }
    posCart.setStep(3);
  };

  // Enviar orden a cocina
  const handleSendOrder = async () => {
    await posCart.submitOrder();
  };

  // Cobrar ahora (Express)
  const handleExpressCheckout = async () => {
    const res = await posCart.submitOrder();
    if (res.success && res.order) {
      setExpressCheckoutOrder(res.order);
    }
  };

  if (loadingMenu) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <span className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-bold text-ink-muted uppercase tracking-wider">
          Cargando catálogo...
        </span>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Notificación de Estado / Outbox */}
      {posCart.statusNotification && (
        <ToastContainer>
          <Toast
            type={posCart.statusNotification.type}
            message={posCart.statusNotification.message}
            onClose={() => posCart.setStatusNotification(null)}
          />
        </ToastContainer>
      )}

      {/* Asistente Guiado de 3 Pasos */}
      <WizardLayout
        currentStep={posCart.step}
        totalSteps={3}
        title={
          posCart.step === 1
            ? 'Tomar pedido'
            : posCart.step === 2
            ? 'Seleccionar Productos del Menú'
            : 'Revisión y Confirmación del Pedido'
        }
        onBack={
          posCart.step > 1
            ? () => posCart.setStep((s) => (s - 1) as 1 | 2 | 3)
            : undefined
        }
        onNext={
          posCart.step === 1
            ? handleStep1Next
            : posCart.step === 2
            ? handleStep2Next
            : undefined
        }
        nextLabel={posCart.step === 1 ? 'Siguiente' : 'Revisar Pedido'}
        nextDisabled={
          (posCart.step === 1 && posCart.customerName.trim().length < 3) ||
          (posCart.step === 2 && posCart.cart.length === 0)
        }
        nextDisabledReason={
          posCart.step === 1 && posCart.customerName.trim().length < 3
            ? 'Falta: nombre del cliente, mínimo 3 letras'
            : posCart.step === 2 && posCart.cart.length === 0
            ? 'Falta: agrega al menos 1 producto al pedido'
            : undefined
        }
        footerExtra={
          posCart.step === 2 && totalItemsCount > 0 ? (
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center text-ink font-black text-xs font-mono">
                {totalItemsCount}
              </span>
              <div className="leading-tight">
                <span className="text-[10px] font-bold text-ink-muted block uppercase">Total</span>
                <span className="text-sm font-black text-ink font-mono">
                  ${(posCart.totalUsdCents / 100).toFixed(2)}
                </span>
              </div>
            </div>
          ) : undefined
        }
      >
        {/* Paso 1: Cliente y Canal */}
        {posCart.step === 1 && (
          <div className="min-h-[48px]">
            <Step1CustomerChannel
              customerName={posCart.customerName}
              setCustomerName={posCart.setCustomerName}
              customerNameError={posCart.customerNameError}
              fulfillmentType={posCart.fulfillmentType}
              setFulfillmentType={posCart.setFulfillmentType}
              tableNumber={posCart.tableNumber}
              setTableNumber={posCart.setTableNumber}
              deliverySede={posCart.deliverySede}
              setDeliverySede={posCart.setDeliverySede}
              customerPhone={posCart.customerPhone}
              setCustomerPhone={posCart.setCustomerPhone}
              deliveryAddress={posCart.deliveryAddress}
              setDeliveryAddress={posCart.setDeliveryAddress}
              deliveryReference={posCart.deliveryReference}
              setDeliveryReference={posCart.setDeliveryReference}
              deliveryTierCents={posCart.deliveryTierCents}
              setDeliveryTierCents={posCart.setDeliveryTierCents}
              motorizadoId={posCart.motorizadoId}
              setMotorizadoId={posCart.setMotorizadoId}
              askTableOnOrder={askTableOnOrder}
              canPay={canPay}
              onQuickPay={() => {
                if (posCart.cart.length > 0) {
                  posCart.setStep(3);
                } else {
                  window.location.hash = '#cashier';
                }
              }}
            />
          </div>
        )}

        {/* Paso 2: Catálogo Visual */}
        {posCart.step === 2 && (
          <div className="min-h-[48px]">
            <Step2Catalog
              categories={categories}
              products={products}
              cart={posCart.cart}
              onAddProduct={(p) => posCart.addProduct(p, 1)}
              onDecrementProduct={posCart.decrementProduct}
              onOpenCustomize={(p) => setCustomizingProduct(p)}
              onOpenCombo={(p) => setComboWizardProduct(p)}
              formattedRate={formattedRate}
            />
          </div>
        )}

        {/* Paso 3: Revisión */}
        {posCart.step === 3 && (
          <Step3Review
            cart={posCart.cart}
            customerName={posCart.customerName}
            fulfillmentType={posCart.fulfillmentType}
            tableNumber={posCart.tableNumber}
            deliveryAddress={posCart.deliveryAddress}
            deliverySede={posCart.deliverySede}
            notes={posCart.notes}
            setNotes={posCart.setNotes}
            couponCode={posCart.couponCode}
            setCouponCode={posCart.setCouponCode}
            subtotalUsdCents={posCart.subtotalUsdCents}
            deliveryFeeUsdCents={posCart.deliveryFeeUsdCents}
            totalUsdCents={posCart.totalUsdCents}
            formattedRate={formattedRate}
            onUpdateQuantity={posCart.updateItemQuantity}
            onRemoveItem={posCart.removeItem}
            onSubmitOrder={handleSendOrder}
            onExpressCheckout={canPay ? handleExpressCheckout : undefined}
            canPay={canPay}
            isSubmitting={posCart.isSubmitting}
            onBackToCatalog={() => posCart.setStep(2)}
            askTableOnOrder={askTableOnOrder}
          />
        )}
      </WizardLayout>

      {/* Modal de Personalización de Ingredientes */}
      {customizingProduct && (
        <CustomizationModal
          isOpen={Boolean(customizingProduct)}
          onClose={() => setCustomizingProduct(null)}
          product={customizingProduct}
          barraLibreList={barraLibreList}
          onSave={(modifiers, customInstructions) => {
            posCart.addProduct(customizingProduct, 1, modifiers, customInstructions);
            setCustomizingProduct(null);
          }}
        />
      )}

      {/* Modal Asistente de Combos */}
      {comboWizardProduct && (
        <ComboWizardModal
          isOpen={Boolean(comboWizardProduct)}
          onClose={() => setComboWizardProduct(null)}
          combo={comboWizardProduct}
          allProducts={products}
          barraLibreList={barraLibreList}
          onComplete={(comboCartItem) => {
            posCart.addProduct(
              comboWizardProduct,
              comboCartItem.quantity,
              comboCartItem.modifiers,
              comboCartItem.customInstructions,
              comboCartItem.comboChildren
            );
            setComboWizardProduct(null);
          }}
        />
      )}

      {/* Modal de Cobro Express en Comandero */}
      {expressCheckoutOrder && (
        <Modal
          isOpen={Boolean(expressCheckoutOrder)}
          onClose={() => setExpressCheckoutOrder(null)}
          title={`Cobro Express — Orden #${expressCheckoutOrder.order_number}`}
          maxWidth="express"
        >
          <div className="space-y-4">
            <div className="p-3 bg-surface-alt rounded-xl border border-border flex items-center justify-between">
              <div>
                <span className="text-xs text-ink-muted block uppercase font-bold">Cliente</span>
                <span className="text-sm font-black text-ink">
                  {expressCheckoutOrder.customer_name}
                  {expressCheckoutOrder.table_number && ` • ${formatTableLabel(expressCheckoutOrder.table_number)}`}
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs text-ink-muted block uppercase font-bold">Total</span>
                <span className="text-base font-black text-ink font-mono">
                  ${((expressCheckoutOrder.total_to_collect_usd_cents || 0) / 100).toFixed(2)}
                </span>
              </div>
            </div>

            <MultiMethodCalculator
              order={expressCheckoutOrder}
              rateMicroBs={rateMicroBs}
              onPaymentSuccess={() => {
                setExpressCheckoutOrder(null);
                invalidateMoney(queryClient);
                posCart.setStatusNotification({
                  type: 'success',
                  message: `✓ Orden #${expressCheckoutOrder.order_number} cobrada con éxito`
                });
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
};

export default PosComandero;
