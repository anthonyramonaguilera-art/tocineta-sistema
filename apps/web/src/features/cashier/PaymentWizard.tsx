import React, { useState, useMemo, useEffect } from 'react';
import type { CashierOrder, CashierTender, CashierPaymentMethod } from './types.js';
import { usdToBsCents, generateUuidV7 } from '@tocineta/shared';
import { Button, Card, Badge, Input, WizardLayout, Icon } from '../../ui/index.js';
import { PaymentWizardStep2 } from './PaymentWizardStep2.js';

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
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Pagos acumulados
  const [tenders, setTenders] = useState<CashierTender[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<CashierPaymentMethod>('cash_usd');
  const [amountInput, setAmountInput] = useState<string>('');
  const [referenceInput, setReferenceInput] = useState<string>('');

  // Vuelto mixto y sobrepago
  const [changeGivenUsdInput, setChangeGivenUsdInput] = useState<string>('');
  const [changeBsMethod] = useState<'cash_bs' | 'pago_movil'>('cash_bs');
  const [changeBsReference] = useState<string>('');
  const [overpaymentDisposition, setOverpaymentDisposition] = useState<'tip_in' | 'adjustment'>('tip_in');
  const [overpaymentReason] = useState<string>('');

  // Estados de validación y backend
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [supervisorPinRequired, setSupervisorPinRequired] = useState<boolean>(false);
  const [supervisorPin, setSupervisorPin] = useState<string>('');
  const [warningConfirmationRequired, setWarningConfirmationRequired] = useState<boolean>(false);

  // Cálculos de saldo blindados defensivamente
  const safeRate = Number.isSafeInteger(rateMicroBs) && rateMicroBs > 0
    ? rateMicroBs
    : Number.isSafeInteger(order?.rate_micro_bs) && (order.rate_micro_bs as number) > 0
      ? (order.rate_micro_bs as number)
      : 40_000_000;

  const totalUsdCents = Math.round(
    order.total_to_collect_usd_cents ?? (order as any).total_usd_cents ?? (order as any).totalCents ?? 0
  );
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

  // Desglose de vuelto entregado
  const { changeGivenUsdCents, changeGivenBsCents } = useMemo(() => {
    const givenUsd = Math.min(totalChangeUsdCents, Math.round(parseFloat(changeGivenUsdInput || '0') * 100));
    const remUsd = Math.max(0, totalChangeUsdCents - givenUsd);
    const givenBs = remUsd > 0 ? usdToBsCents(remUsd, safeRate) : 0;
    return { changeGivenUsdCents: givenUsd, changeGivenBsCents: givenBs };
  }, [totalChangeUsdCents, changeGivenUsdInput, safeRate]);

  const changeDeliveredUsdCents = changeGivenUsdCents;
  const changeDeliveredBsEquivalentUsdCents = changeGivenBsCents > 0 ? Math.round((changeGivenBsCents * 1_000_000) / safeRate) : 0;
  const unreturnedSurplusUsdCents = Math.max(0, totalChangeUsdCents - changeDeliveredUsdCents - changeDeliveredBsEquivalentUsdCents);

  useEffect(() => {
    if (totalChangeUsdCents > 0 && !changeGivenUsdInput) {
      setChangeGivenUsdInput((totalChangeUsdCents / 100).toFixed(2));
    }
  }, [totalChangeUsdCents]);

  const handleAddTender = (customAmountCents?: number, customMethod?: CashierPaymentMethod) => {
    const method = customMethod || selectedMethod;
    const isUsdMethod = method === 'cash_usd' || method === 'binance';
    const currency = isUsdMethod ? 'USD' : 'BS';

    let amountCents = customAmountCents;
    if (amountCents === undefined) {
      const parsed = parseFloat(amountInput.replace(',', '.'));
      if (isNaN(parsed) || parsed <= 0) return;
      amountCents = Math.round(parsed * 100);
    }
    if (amountCents <= 0) return;

    if (method === 'pago_movil' && referenceInput.trim().length < 4) {
      setErrorMessage('Pago móvil exige al menos los últimos 4 dígitos del comprobante');
      return;
    }

    if (method === 'credit' && !order.customer_name) {
      setErrorMessage('Para otorgar crédito la orden debe tener cliente registrado');
      return;
    }

    const usdEquivalentCents = isUsdMethod
      ? amountCents
      : Math.round((amountCents * 1_000_000) / rateMicroBs);

    setTenders(prev => [
      ...prev,
      {
        id: `ten_${generateUuidV7()}`,
        method,
        amountCents,
        currency,
        usdEquivalentCents,
        referenceCode: referenceInput.trim() || undefined
      }
    ]);

    setAmountInput('');
    setReferenceInput('');
    setErrorMessage(null);
  };

  const executePayment = async (overrideSupervisorPin?: string, overrideConfirmWarning?: boolean) => {
    setIsSubmitting(true);
    setErrorMessage(null);

    const tendersPayload = tenders.map(t => ({
      method: t.method,
      amountCents: t.amountCents,
      referenceCode: t.referenceCode?.trim() || (t.method === 'pago_movil' ? 'REF-PEND' : undefined)
    }));

    const changePayload = totalChangeUsdCents > 0 ? {
      method: changeBsMethod,
      changeUsdCents: changeGivenUsdCents,
      changeBsCents: changeGivenBsCents,
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
      body.overpaymentReason = overpaymentReason.trim() || undefined;
    }

    try {
      const res = await fetch(`/api/orders/${order.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.code === 'FRAUD_BLOCK_DUPLICATE_PAYMENT') {
          setSupervisorPinRequired(true);
          setErrorMessage(data.error);
          return;
        }
        if (data.code === 'FRAUD_WARN_DUPLICATE_REFERENCE') {
          setWarningConfirmationRequired(true);
          setErrorMessage(data.error);
          return;
        }
        throw new Error(data.error || 'Error al procesar cobro');
      }

      onPaymentSuccess();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Error de comunicación con el servidor');
    } finally {
      setIsSubmitting(false);
    }
  };

  const finalizeDisabledReason = useMemo(() => {
    if (tenders.length === 0) return 'No se ha ingresado ningún método de pago';
    if (remainingUsdCents > 0) return `Falta cubrir ${(remainingUsdCents / 100).toFixed(2)} USD para completar el total`;
    if (supervisorPinRequired && !supervisorPin.trim()) return 'Se requiere PIN de supervisor por alerta antifraude';
    return null;
  }, [tenders, remainingUsdCents, supervisorPinRequired, supervisorPin]);

  return (
    <div className="w-full">
      <WizardLayout
        currentStep={step}
        totalSteps={3}
        stepTitle={step === 1 ? 'Resumen de Orden' : step === 2 ? 'Método de Pago' : 'Vuelto y Cierre'}
        onBack={step > 1 ? () => setStep((step - 1) as any) : onCancel}
        onNext={
          step === 1
            ? () => setStep(2)
            : step === 2
            ? () => setStep(3)
            : () => executePayment()
        }
        nextLabel={step === 3 ? 'Finalizar e imprimir' : 'Siguiente'}
        isNextDisabled={step === 2 ? remainingUsdCents > 0 : step === 3 ? Boolean(finalizeDisabledReason) : false}
        isNextLoading={isSubmitting}
      >
        <div className="space-y-4 max-w-xl mx-auto">
          {errorMessage && (
            <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger flex items-center gap-2">
              <Icon name="AlertTriangle" className="w-4 h-4 shrink-0 text-danger" />
              <span>{errorMessage}</span>
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
                  <Badge variant="primary">{order.table_number ? `Mesa ${order.table_number}` : order.fulfillment_type}</Badge>
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

          {/* PASO 2: MÉTODOS DE PAGO CON NUMBERPAD Y BILLETES RÁPIDOS */}
          {step === 2 && (
            <PaymentWizardStep2
              selectedMethod={selectedMethod}
              onSelectMethod={m => { setSelectedMethod(m); setErrorMessage(null); }}
              remainingUsdCents={remainingUsdCents}
              remainingBsCents={remainingBsCents}
              onExactUsd={() => handleAddTender(remainingUsdCents, 'cash_usd')}
              onExactBs={() => handleAddTender(remainingBsCents, 'cash_bs')}
              onQuickBill={cents => handleAddTender(cents, 'cash_usd')}
              referenceInput={referenceInput}
              onChangeReference={setReferenceInput}
              amountInput={amountInput}
              onChangeAmount={setAmountInput}
              onAddTender={() => handleAddTender()}
              tenders={tenders}
              onRemoveTender={id => setTenders(prev => prev.filter(t => t.id !== id))}
            />
          )}

          {/* PASO 3: VUELTO Y CIERRE */}
          {step === 3 && (
            <div className="space-y-4 text-center">
              <Card variant="alt" className="p-6 space-y-4">
                <span className="text-xs font-bold uppercase tracking-wider text-ink-muted block">Vuelto a entregar al cliente</span>
                <div className="space-y-1">
                  <div className="text-4xl sm:text-5xl font-black text-primary font-mono tracking-tight">
                    ${(totalChangeUsdCents / 100).toFixed(2)}
                  </div>
                  <div className="text-lg sm:text-xl font-bold text-ink-muted font-mono">
                    {(totalChangeBsCents / 100).toFixed(2)} Bs
                  </div>
                </div>

                {totalChangeUsdCents > 0 && (
                  <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setChangeGivenUsdInput((totalChangeUsdCents / 100).toFixed(2))}
                    >
                      Entregar todo el vuelto en USD
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setChangeGivenUsdInput('0.00')}
                    >
                      Entregar todo el vuelto en Bolívares
                    </Button>
                  </div>
                )}
              </Card>

              {/* Manejo de propina / excedente */}
              {unreturnedSurplusUsdCents > 1 && (
                <Card variant="surface" className="p-4 text-left space-y-2">
                  <span className="text-xs font-bold text-warning uppercase">Excedente sin devolver (${(unreturnedSurplusUsdCents / 100).toFixed(2)})</span>
                  <div className="flex gap-2">
                    <Button
                      variant={overpaymentDisposition === 'tip_in' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => setOverpaymentDisposition('tip_in')}
                    >
                      Registrar como Propina
                    </Button>
                    <Button
                      variant={overpaymentDisposition === 'adjustment' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => setOverpaymentDisposition('adjustment')}
                    >
                      Ajuste de Caja
                    </Button>
                  </div>
                </Card>
              )}

              {/* Alerta de supervisor PIN ante fraude */}
              {supervisorPinRequired && (
                <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl space-y-2 text-left">
                  <span className="text-xs font-bold text-danger">Se requiere PIN de supervisor para autorizar referencia duplicada:</span>
                  <Input
                    type="password"
                    placeholder="PIN supervisor..."
                    value={supervisorPin}
                    onChange={e => setSupervisorPin(e.target.value)}
                    maxLength={6}
                  />
                </div>
              )}

              {/* Motivo visible si finalizar está inhabilitado */}
              {finalizeDisabledReason && (
                <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger text-center flex items-center justify-center gap-1.5">
                  <Icon name="AlertTriangle" className="w-4 h-4 shrink-0 text-danger" />
                  <span>{finalizeDisabledReason}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </WizardLayout>
    </div>
  );
};
