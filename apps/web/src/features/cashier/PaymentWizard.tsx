import React, { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CashierOrder, CashierTender } from './types.js';
import type { CashierPaymentMethod } from './payment-labels.js';
import { usdToBsCents, generateUuidV7, getMethodCurrency } from '@tocineta/shared';
import { Card, Badge, WizardLayout, Icon, Button } from '../../ui/index.js';
import { PaymentWizardStep2 } from './PaymentWizardStep2.js';
import { PaymentWizardStep3 } from './PaymentWizardStep3.js';
import { formatTableLabel } from '../../lib/format.js';
import { invalidateMoney } from '../finances/queryKeys.js';
import { apiFetch } from '../../api/client.js';
import { resolveChangeState } from './change-state.js';

export interface PaymentWizardProps {
  order: CashierOrder;
  rateMicroBs: number;
  onPaymentSuccess: () => void;
  onCancel?: () => void;
  userRole?: string;
}

export const PaymentWizard: React.FC<PaymentWizardProps> = ({
  order,
  rateMicroBs,
  onPaymentSuccess,
  onCancel,
  userRole: _userRole = 'cajera'
}) => {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Pagos acumulados
  const [tenders, setTenders] = useState<CashierTender[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<CashierPaymentMethod>('cash_usd');
  const [amountInput, setAmountInput] = useState<string>('');
  const [referenceInput, setReferenceInput] = useState<string>('');

  // Vuelto mixto y sobrepago
  const [changeOverride, setChangeOverride] = useState<{ usdCents: number; bsCents: number } | null>(null);
  const [changeBsMethod, setChangeBsMethod] = useState<string>('cash_bs');
  const [changeBsReference, setChangeBsReference] = useState<string>('');
  const [overpaymentDisposition, setOverpaymentDisposition] = useState<'tip_in' | 'adjustment'>('tip_in');

  // Estados de validación y backend
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [blockingError, setBlockingError] = useState<string | null>(null);
  const [supervisorPinRequired, setSupervisorPinRequired] = useState<boolean>(false);
  const [supervisorPin, setSupervisorPin] = useState<string>('');
  const [warningConfirmationRequired, setWarningConfirmationRequired] = useState<boolean>(false);

  // Cálculos de saldo blindados defensivamente
  const safeRate = Number.isSafeInteger(rateMicroBs) && rateMicroBs > 0
    ? rateMicroBs
    : Number.isSafeInteger(order?.rate_micro_bs) && (order.rate_micro_bs as number) > 0
      ? (order.rate_micro_bs as number)
      : 40_000_000;

  const totalUsdCents = order.total_to_collect_usd_cents || 0;
  const totalBsCents = totalUsdCents > 0 ? usdToBsCents(totalUsdCents, safeRate) : 0;

  const { totalPaidUsdEquivalentCents } = useMemo(() => {
    let usd = 0;
    let bs = 0;
    for (const t of tenders) {
      if (t.currency === 'USD') usd += t.amountCents;
      else bs += t.amountCents;
    }
    const bsEquivUsd = bs > 0 ? Math.round((bs * 1_000_000) / safeRate) : 0;
    return { totalPaidUsdEquivalentCents: usd + bsEquivUsd };
  }, [tenders, safeRate]);

  const remainingUsdCents = Math.max(0, totalUsdCents - totalPaidUsdEquivalentCents);
  const remainingBsCents = remainingUsdCents > 0 ? usdToBsCents(remainingUsdCents, safeRate) : 0;
  const totalChangeUsdCents = Math.max(0, totalPaidUsdEquivalentCents - totalUsdCents);
  const totalChangeBsCents = totalChangeUsdCents > 0 ? usdToBsCents(totalChangeUsdCents, safeRate) : 0;

  const { givenUsdCents, givenBsCents, unreturnedSurplusUsdCents } = useMemo(() => {
    return resolveChangeState({
      totalUsdCents,
      tenders,
      rateMicroBs: safeRate,
      override: changeOverride
    });
  }, [totalUsdCents, tenders, safeRate, changeOverride]);

  const handleAddTender = (customAmountCents?: number, customMethod?: CashierPaymentMethod) => {
    const method = customMethod || selectedMethod;
    const isUsdMethod = getMethodCurrency(method) === 'USD';
    const currency = isUsdMethod ? 'USD' : 'BS';

    let amountCents = customAmountCents;
    if (amountCents === undefined) {
      const parsed = parseFloat(amountInput.replace(',', '.'));
      if (isNaN(parsed) || parsed <= 0) return;
      amountCents = Math.round(parsed * 100);
    }
    if (amountCents <= 0) return;

    const usdEquivalentCents = isUsdMethod
      ? amountCents
      : Math.round((amountCents * 1_000_000) / safeRate);

    setTenders(prev => [
      ...prev,
      {
        id: `ten_${generateUuidV7()}`,
        method: method as any,
        amountCents,
        currency,
        usdEquivalentCents,
        referenceCode: referenceInput.trim() || undefined
      }
    ]);

    setChangeOverride(null);
    setAmountInput('');
    setReferenceInput('');
    setErrorMessage(null);
  };

  const executePayment = async (overrideSupervisorPin?: string, overrideConfirmWarning?: boolean) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    setBlockingError(null);

    const tendersPayload = tenders.map(t => ({
      method: t.method,
      amountCents: t.amountCents,
      referenceCode: t.referenceCode?.trim() || (t.method === 'pago_movil' ? 'REF-PEND' : undefined)
    }));

    const changePayload = totalChangeUsdCents > 0 ? {
      method: changeBsMethod,
      changeUsdCents: givenUsdCents,
      changeBsCents: givenBsCents,
      referenceCode: changeBsReference.trim() || undefined
    } : undefined;

    const body: any = {
      tenders: tendersPayload,
      changeOutputs: changePayload,
      supervisorPin: overrideSupervisorPin || (supervisorPin.trim() || undefined),
      confirmWarning: overrideConfirmWarning || warningConfirmationRequired
    };

    if (unreturnedSurplusUsdCents > 1) {
      body.overpaymentDisposition = overpaymentDisposition;
    }

    try {
      const res = await apiFetch(`/api/orders/${order.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        // El servidor manda el mensaje humano y los flags del siguiente paso.
        const serverMessage: string = data.message || data.error || 'Error al procesar cobro';

        if (data.requiresSupervisorPin) setSupervisorPinRequired(true);
        if (data.requiresConfirmation) setWarningConfirmationRequired(true);

        const alreadyPaid =
          data.code === 'ORDER_ALREADY_PAID' || /ya fue cobrada previamente/i.test(serverMessage);
        if (alreadyPaid) {
          setBlockingError(
            'Esta orden ya está registrada como pagada: cierra esta ventana y actualiza la lista. No reintentes el cobro.'
          );
        }

        setErrorMessage(serverMessage);
        return;
      }

      await invalidateMoney(queryClient);
      onPaymentSuccess();
    } catch (err: any) {
      const isTransportError = err instanceof TypeError || err instanceof SyntaxError;
      setErrorMessage(
        isTransportError
          ? 'Error de comunicación con el servidor'
          : err?.message || 'Error de comunicación con el servidor'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const finalizeDisabledReason = useMemo(() => {
    if (blockingError) return blockingError;
    if (tenders.length === 0) return 'No se ha ingresado ningún método de pago';
    if (remainingUsdCents > 0) return `Falta cubrir ${(remainingUsdCents / 100).toFixed(2)} USD para completar el total`;
    if (supervisorPinRequired && !supervisorPin.trim()) return 'Se requiere PIN de supervisor por alerta antifraude';
    return null;
  }, [blockingError, tenders, remainingUsdCents, supervisorPinRequired, supervisorPin]);

  return (
    <div className="w-full">
      <WizardLayout
        currentStep={step}
        totalSteps={3}
        stepTitle={step === 1 ? 'Resumen de Orden' : step === 2 ? 'Método de Pago' : 'Vuelto y Cierre'}
        onBack={step > 1 ? () => {
          setChangeOverride(null);
          setStep((step - 1) as any);
        } : onCancel}
        onNext={
          step === 1
            ? () => setStep(2)
            : step === 2
            ? () => setStep(3)
            : () => executePayment()
        }
        nextLabel={
          step === 3
            ? warningConfirmationRequired
              ? 'Confirmar y cobrar'
              : 'Finalizar e imprimir'
            : 'Siguiente'
        }
        isNextDisabled={step === 2 ? remainingUsdCents > 0 : step === 3 ? Boolean(finalizeDisabledReason) : false}
        nextDisabledReason={step === 3 ? finalizeDisabledReason ?? undefined : undefined}
        isNextLoading={isSubmitting}
      >
        <div className="space-y-4 max-w-xl mx-auto">
          {errorMessage && (
            <div
              role="alert"
              aria-live="assertive"
              className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger flex items-start gap-2"
            >
              <Icon name="AlertTriangle" className="w-4 h-4 shrink-0 text-danger mt-0.5" />
              <div className="space-y-1 min-w-0">
                <span className="block break-words">{errorMessage}</span>
                {supervisorPinRequired && (
                  <span className="block text-[11px] font-bold">
                    Siguiente paso: ingresa el PIN de supervisor en el Paso 3 y vuelve a finalizar.
                  </span>
                )}
                {warningConfirmationRequired && (
                  <span className="block text-[11px] font-bold">
                    Siguiente paso: revisa la advertencia y pulsa «Confirmar y cobrar».
                  </span>
                )}
                {blockingError && onCancel && (
                  <>
                    <span className="block text-[11px] font-bold">
                      Siguiente paso: cierra esta ventana y actualiza la lista de órdenes.
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onCancel()}
                      className="mt-1 min-h-[48px]"
                    >
                      Cerrar ventana
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* PASO 1: RESUMEN DE LA ORDEN */}
          {step === 1 && (
            <div className="space-y-4">
              <Card variant="alt" className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs text-ink-muted uppercase tracking-wider block font-bold">Orden #{order.order_number}</span>
                    <h3 className="text-lg font-black text-ink">{order.customer_name || 'Cliente de Mostrador'}</h3>
                  </div>
                  <Badge variant="primary">{order.table_number ? formatTableLabel(order.table_number) : order.fulfillment_type}</Badge>
                </div>
                <div className="pt-2 border-t border-border flex items-baseline justify-between">
                  <span className="text-sm font-bold text-ink-muted">Total a Cobrar:</span>
                  <div className="text-right">
                    <span className="text-2xl font-black text-primary font-mono">${(totalUsdCents / 100).toFixed(2)}</span>
                    <span className="text-xs text-ink-muted block font-mono">{(totalBsCents / 100).toFixed(2)} Bs</span>
                  </div>
                </div>
              </Card>

              <Card variant="surface" className="p-4 space-y-2 max-h-60 overflow-y-auto">
                <span className="text-xs font-bold uppercase tracking-wider text-ink-muted block">Platos en la orden</span>
                {order.lines.map((l, idx) => (
                  <div key={idx} className="flex justify-between items-center text-sm border-b border-border/50 py-1.5 last:border-0">
                    <span className="text-ink font-medium">{l.qty || l.quantity}x {l.product_name}</span>
                    <span className="font-mono text-ink-muted">${(l.subtotal_usd_cents / 100).toFixed(2)}</span>
                  </div>
                ))}
              </Card>
            </div>
          )}

          {/* PASO 2: MÉTODOS DE PAGO */}
          {step === 2 && (
            <PaymentWizardStep2
              selectedMethod={selectedMethod}
              onSelectMethod={m => { setSelectedMethod(m); setErrorMessage(null); }}
              remainingUsdCents={remainingUsdCents}
              remainingBsCents={remainingBsCents}
              onExact={() => {
                const isUsd = getMethodCurrency(selectedMethod) === 'USD';
                handleAddTender(isUsd ? remainingUsdCents : remainingBsCents, selectedMethod);
              }}
              onQuickBill={cents => handleAddTender(cents, 'cash_usd')}
              referenceInput={referenceInput}
              onChangeReference={setReferenceInput}
              amountInput={amountInput}
              onChangeAmount={setAmountInput}
              onAddTender={() => handleAddTender()}
              tenders={tenders}
              onRemoveTender={id => {
                setTenders(prev => prev.filter(t => t.id !== id));
                setChangeOverride(null);
              }}
            />
          )}

          {/* PASO 3: VUELTO Y CIERRE */}
          {step === 3 && (
            <PaymentWizardStep3
              totalUsdCents={totalUsdCents}
              totalBsCents={totalBsCents}
              tenders={tenders}
              rateMicroBs={safeRate}
              totalChangeUsdCents={totalChangeUsdCents}
              totalChangeBsCents={totalChangeBsCents}
              changeGivenUsdCents={givenUsdCents}
              changeGivenBsCents={givenBsCents}
              onChangeSplit={(usd, bs) => {
                setChangeOverride({ usdCents: usd, bsCents: bs });
              }}
              changeBsMethod={changeBsMethod}
              onChangeBsMethod={setChangeBsMethod}
              changeBsReference={changeBsReference}
              onChangeBsReference={setChangeBsReference}
              unreturnedSurplusUsdCents={unreturnedSurplusUsdCents}
              overpaymentDisposition={overpaymentDisposition}
              onChangeOverpaymentDisposition={setOverpaymentDisposition}
              supervisorPinRequired={supervisorPinRequired}
              supervisorPin={supervisorPin}
              onChangeSupervisorPin={setSupervisorPin}
              finalizeDisabledReason={finalizeDisabledReason}
            />
          )}
        </div>
      </WizardLayout>
    </div>
  );
};
