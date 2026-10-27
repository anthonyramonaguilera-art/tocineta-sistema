import React, { useState, useMemo, useEffect, useRef } from 'react';
import type { CashierOrder, CashierTender, CashierPaymentMethod } from './types.js';
import { usdToBsCents, generateUuidV7 } from '@tocineta/shared';
import { Banknote, Coins, Smartphone, CreditCard, CircleDollarSign, Landmark } from 'lucide-react';

interface MultiMethodCalculatorProps {
  order: CashierOrder;
  rateMicroBs: number;
  onPaymentSuccess: () => void;
}

const QUICK_USD_BILLS = [100, 500, 1000, 2000, 5000, 10000]; // en centavos: $1, $5, $10, $20, $50, $100

export const getPaymentMethodHumanLabel = (method: string): string => {
  const m = method.toLowerCase();
  switch (m) {
    case 'cash_usd':
      return '💵 Efectivo Dólares (USD)';
    case 'cash_bs':
      return '🇻🇪 Efectivo Bolívares (Bs)';
    case 'pago_movil':
      return '📱 Pago Móvil (Bs)';
    case 'ubii':
      return '💳 Punto de Venta Ubii (Bs)';
    case 'binance':
      return '🟡 Binance Pay (USD)';
    default:
      return method.toUpperCase();
  }
};

export const MultiMethodCalculator: React.FC<MultiMethodCalculatorProps> = ({
  order,
  rateMicroBs,
  onPaymentSuccess
}) => {
  // Estado de los pagos ingresados
  const [tenders, setTenders] = useState<CashierTender[]>([]);

  // Feedback táctil visual de billetes rápidos (H-07)
  const [activeQuickBill, setActiveQuickBill] = useState<number | null>(null);
  const [recentlyAddedTenderId, setRecentlyAddedTenderId] = useState<string | null>(null);

  // Método actualmente seleccionado para ingresar un pago
  const [selectedMethod, setSelectedMethod] = useState<CashierPaymentMethod>('cash_usd');
  const [amountInput, setAmountInput] = useState<string>('');
  const [referenceInput, setReferenceInput] = useState<string>('');
  const referenceInputRef = useRef<HTMLInputElement>(null);

  // Estado del vuelto mixto
  const [changeGivenUsdInput, setChangeGivenUsdInput] = useState<string>('');
  const [changeBsMethod, setChangeBsMethod] = useState<'cash_bs' | 'pago_movil'>('cash_bs');
  const [changeBsReference, setChangeBsReference] = useState<string>('');

  // Sobrepago / Propina
  const [overpaymentDisposition, setOverpaymentDisposition] = useState<'tip_in' | 'adjustment'>('tip_in');
  const [overpaymentReason, setOverpaymentReason] = useState<string>('');

  // Estado de antifraude y modales
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [supervisorPinRequired, setSupervisorPinRequired] = useState<boolean>(false);
  const [supervisorPin, setSupervisorPin] = useState<string>('');
  const [warningConfirmationRequired, setWarningConfirmationRequired] = useState<boolean>(false);

  // Cálculos de totales
  const totalUsdCents = order.total_to_collect_usd_cents;
  const totalBsCents = usdToBsCents(totalUsdCents, rateMicroBs);

  // Total pagado acumulado en USD y Bs
  const { totalPaidUsdEquivalentCents } = useMemo(() => {
    let usd = 0;
    let bs = 0;
    for (const t of tenders) {
      if (t.currency === 'USD') {
        usd += t.amountCents;
      } else {
        bs += t.amountCents;
      }
    }
    const bsEquivUsd = bs > 0 ? Math.round((bs * 1_000_000) / rateMicroBs) : 0;
    return {
      totalPaidUsdEquivalentCents: usd + bsEquivUsd
    };
  }, [tenders, rateMicroBs]);

  // Saldo restante
  const remainingUsdCents = Math.max(0, totalUsdCents - totalPaidUsdEquivalentCents);
  const remainingBsCents = remainingUsdCents > 0 ? usdToBsCents(remainingUsdCents, rateMicroBs) : 0;

  // Vuelto total en USD y Bs
  const totalChangeUsdCents = Math.max(0, totalPaidUsdEquivalentCents - totalUsdCents);
  const changeTotalUsdCents = totalChangeUsdCents;
  const totalChangeBsCents = totalChangeUsdCents > 0 ? usdToBsCents(totalChangeUsdCents, rateMicroBs) : 0;

  // Desglose de Vuelto Mixto
  const { changeGivenUsdCents, remChangeUsdCents, changeGivenBsCents } = useMemo(() => {
    const givenUsd = Math.min(totalChangeUsdCents, Math.round((parseFloat(changeGivenUsdInput || '0') * 100)));
    const remUsd = Math.max(0, totalChangeUsdCents - givenUsd);
    const givenBs = remUsd > 0 ? usdToBsCents(remUsd, rateMicroBs) : 0;
    return {
      changeGivenUsdCents: givenUsd,
      remChangeUsdCents: remUsd,
      changeGivenBsCents: givenBs
    };
  }, [totalChangeUsdCents, changeGivenUsdInput, rateMicroBs]);

  const changeDeliveredUsdCents = changeGivenUsdCents;
  const changeDeliveredBsEquivalentUsdCents = changeGivenBsCents > 0 ? Math.round((changeGivenBsCents * 1_000_000) / rateMicroBs) : 0;
  const unreturnedSurplusUsdCents = Math.max(0, totalChangeUsdCents - changeDeliveredUsdCents - changeDeliveredBsEquivalentUsdCents);

  // Sincroniza/resetea el input de vuelto en efectivo USD cuando cambie el vuelto total
  const [lastTotalChange, setLastTotalChange] = useState<number>(0);
  useEffect(() => {
    if (totalChangeUsdCents <= 0) {
      setChangeGivenUsdInput('');
      setLastTotalChange(0);
    } else if (lastTotalChange !== totalChangeUsdCents) {
      setChangeGivenUsdInput((totalChangeUsdCents / 100).toFixed(2));
      setLastTotalChange(totalChangeUsdCents);
    } else {
      const currentVal = Math.round(parseFloat(changeGivenUsdInput || '0') * 100);
      if (currentVal > totalChangeUsdCents) {
        setChangeGivenUsdInput((totalChangeUsdCents / 100).toFixed(2));
      }
    }
  }, [totalChangeUsdCents, lastTotalChange, changeGivenUsdInput]);

  // Agregar un tender
  const handleAddTender = (overrideAmountCents?: number, overrideMethod?: CashierPaymentMethod) => {
    const method = overrideMethod || selectedMethod;
    const isUsdMethod = method === 'cash_usd' || method === 'binance';
    const currency = isUsdMethod ? 'USD' : 'BS';

    let amountCents: number;
    if (overrideAmountCents !== undefined) {
      amountCents = overrideAmountCents;
    } else {
      const parsed = parseFloat(amountInput.replace(',', '.'));
      if (isNaN(parsed) || parsed <= 0) return;
      amountCents = Math.round(parsed * 100);
    }

    if (amountCents <= 0) return;

    const usdEquivalentCents = isUsdMethod
      ? amountCents
      : Math.round((amountCents * 1_000_000) / rateMicroBs);

    const newId = `ten_${generateUuidV7()}`;
    const newTender: CashierTender = {
      id: newId,
      method,
      amountCents,
      currency,
      usdEquivalentCents,
      referenceCode: referenceInput.trim() || undefined
    };

    setTenders(prev => [...prev, newTender]);
    setRecentlyAddedTenderId(newId);
    setTimeout(() => setRecentlyAddedTenderId(null), 500);

    setAmountInput('');
    setReferenceInput('');
    setErrorMessage(null);
  };

  // Botón billete rápido USD con feedback táctil (H-07)
  const handleQuickBill = (cents: number) => {
    setActiveQuickBill(cents);
    setTimeout(() => setActiveQuickBill(null), 200);

    const newId = `ten_${generateUuidV7()}`;
    const newTender: CashierTender = {
      id: newId,
      method: 'cash_usd',
      amountCents: cents,
      currency: 'USD',
      usdEquivalentCents: cents
    };

    setTenders(prev => [...prev, newTender]);
    setRecentlyAddedTenderId(newId);
    setTimeout(() => setRecentlyAddedTenderId(null), 500);

    setAmountInput('');
    setReferenceInput('');
    setErrorMessage(null);
  };


  // Remover un tender
  const handleRemoveTender = (id: string) => {
    setTenders(prev => prev.filter(t => t.id !== id));
  };

  // --------------------------------------------------------------------------
  // ENVIAR PAGO AL BACKEND
  // --------------------------------------------------------------------------
  const executePayment = async (overrideSupervisorPin?: string, overrideConfirmWarning?: boolean) => {
    setIsSubmitting(true);
    setErrorMessage(null);

    const tendersPayload = tenders.map(t => ({
      method: t.method,
      amountCents: t.amountCents,
      referenceCode: t.referenceCode?.trim() || (t.method === 'pago_movil' ? 'SIN-REF' : undefined)
    }));

    const changePayload = changeTotalUsdCents > 0 ? {
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

    // Si hay sobrepago no cubierto por vuelto (excedente real no devuelto al cliente)
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
      setErrorMessage(err?.message || 'Fallo de conexión');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-tocineta-card border border-tocineta-border rounded-3xl p-5 shadow-2xl space-y-5">
      
      {/* CABECERA: TOTALES EN GRANDE */}
      <div className="bg-tocineta-bg border border-tocineta-border rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-inner">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-tocineta-muted block">
            Total a Cobrar Orden #{order.order_number} ({order.table_number}):
          </span>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl font-black text-tocineta-yellow font-mono tracking-tight">
              ${(totalUsdCents / 100).toFixed(2)}
            </span>
            <span className="text-lg font-bold text-tocineta-text font-mono">
              / {(totalBsCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs
            </span>
          </div>
          {(order.discount_usd_cents > 0 || order.delivery_fee_usd_cents > 0) && (
            <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px] font-mono">
              <span className="text-tocineta-muted">
                Comida: ${(order.gross_food_subtotal_usd_cents / 100).toFixed(2)}
              </span>
              {order.discount_usd_cents > 0 && (
                <span className="text-emerald-400 font-bold">
                  • Cupón: -${(order.discount_usd_cents / 100).toFixed(2)}
                </span>
              )}
              {order.delivery_fee_usd_cents > 0 && (
                <span className="text-amber-400 font-bold">
                  • Delivery: +${(order.delivery_fee_usd_cents / 100).toFixed(2)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* SALDO RESTANTE */}
        <div className="text-left sm:text-right">
          <span className="text-[11px] font-bold uppercase tracking-wider text-tocineta-muted block">
            {remainingUsdCents > 0 ? 'Falta por Cobrar:' : 'Totalmente Cubierto:'}
          </span>
          <div className="text-xl font-black font-mono mt-0.5">
            {remainingUsdCents > 0 ? (
              <span className="text-red-400">
                Falta por cobrar: ${(remainingUsdCents / 100).toFixed(2)} USD ⇄ Bs. {(remainingBsCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            ) : (
              <span className="text-emerald-400">✓ $0.00</span>
            )}
          </div>
        </div>
      </div>

      {/* MENSAJE DE ERROR / ANTIFRAUDE */}
      {errorMessage && (
        <div className={`p-4 rounded-2xl border text-xs font-bold space-y-2 ${
          supervisorPinRequired
            ? 'bg-red-500/15 border-red-500/50 text-red-300'
            : warningConfirmationRequired
            ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
            : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
          <div className="flex items-center gap-2">
            <span className="text-lg">{supervisorPinRequired ? '🚫' : '⚠️'}</span>
            <p>{errorMessage}</p>
          </div>

          {/* Prompt de PIN de Supervisor para Nivel 1 */}
          {supervisorPinRequired && (
            <div className="pt-2 border-t border-red-500/30 flex items-center gap-2">
              <input
                type="password"
                placeholder="PIN Supervisor (6 dígitos)..."
                maxLength={6}
                value={supervisorPin}
                onChange={e => setSupervisorPin(e.target.value)}
                className="bg-tocineta-bg border border-red-500/50 rounded-xl px-3 py-2 text-white font-mono text-xs w-48 outline-none"
              />
              <button
                type="button"
                onClick={() => executePayment(supervisorPin, warningConfirmationRequired)}
                disabled={supervisorPin.length < 4 || isSubmitting}
                className="min-h-[40px] px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs transition-all active:scale-95"
              >
                Autorizar con PIN
              </button>
            </div>
          )}

          {/* Confirmación para Nivel 2 */}
          {warningConfirmationRequired && (
            <div className="pt-2 border-t border-amber-500/30 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setWarningConfirmationRequired(false);
                  setErrorMessage(null);
                }}
                className="min-h-[38px] px-3 rounded-xl bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => executePayment(supervisorPin, true)}
                className="min-h-[38px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-black text-xs transition-all active:scale-95 shadow"
              >
                ✓ Confirmar y Proceder con el Cobro
              </button>
            </div>
          )}
        </div>
      )}

      {/* BOTONES RÁPIDOS DE BILLETES USD ($1, $5, $10, $20, $50, $100, EXACTO USD) */}
      <div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-tocineta-muted flex items-center gap-1 mb-2">
          <Banknote className="w-3.5 h-3.5 text-tocineta-yellow" />
          <span>Billetes Rápidos en Efectivo USD:</span>
        </span>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {QUICK_USD_BILLS.map(cents => (
            <button
              key={cents}
              type="button"
              onClick={() => handleQuickBill(cents)}
              className={`denomination-btn bg-slate-100 hover:bg-amber-500 active:bg-amber-600 text-slate-900 hover:text-slate-950 border-2 border-slate-300 hover:border-amber-600 font-black text-base md:text-lg min-h-[52px] rounded-xl shadow-sm transition-all flex items-center justify-center font-mono cursor-pointer ${
                activeQuickBill === cents ? 'scale-95 ring-2 ring-amber-500 border-amber-600 bg-amber-200' : ''
              }`}
            >
              ${cents / 100}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleAddTender(remainingUsdCents, 'cash_usd')}
            disabled={remainingUsdCents <= 0}
            className="bg-amber-100 hover:bg-amber-500 text-amber-950 hover:text-slate-950 border-2 border-amber-500 font-black min-h-[52px] rounded-xl px-3 shadow-sm transition-all active:scale-95 flex items-center justify-center col-span-4 sm:col-span-1 disabled:opacity-40 disabled:pointer-events-none text-center text-xs md:text-sm cursor-pointer"
          >
            Exacto USD (${(remainingUsdCents / 100).toFixed(2)})
          </button>
        </div>
      </div>

      {/* SELECTOR DE MÉTODOS DE PAGO */}
      <div className="space-y-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-tocineta-muted flex items-center gap-1">
          <CreditCard className="w-3.5 h-3.5 text-tocineta-yellow" />
          <span>Selecciona Método de Pago a Ingresar:</span>
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { id: 'cash_usd', label: 'Efectivo USD', icon: Banknote },
            { id: 'cash_bs', label: 'Efectivo Bs', icon: Coins },
            { id: 'pago_movil', label: 'Pago Móvil', icon: Smartphone },
            { id: 'ubii', label: 'Punto Ubii', icon: CreditCard },
            { id: 'binance', label: 'Binance Pay', icon: CircleDollarSign }
          ].map(m => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedMethod(m.id as CashierPaymentMethod)}
                className={`min-h-[48px] px-3 py-2 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-1.5 text-center ${
                  selectedMethod === m.id
                    ? 'bg-tocineta-yellow text-tocineta-bg shadow-lg scale-102'
                    : 'bg-tocineta-bg border border-tocineta-border text-tocineta-muted hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>

        {/* DATOS OFICIALES DE BANESCO SI ES PAGO MÓVIL */}
        {selectedMethod === 'pago_movil' && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-xs text-emerald-300 flex items-center justify-between">
            <div>
              <span className="font-black block">Banesco Banco Universal (0134)</span>
              <span className="font-mono text-[11px]">Tel: 0424-9728209 • RIF: V-17040918-0</span>
            </div>
            <Landmark className="w-5 h-5 text-emerald-400" />
          </div>
        )}

        {/* INPUT DE MONTO Y REFERENCIA */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder={
                selectedMethod === 'cash_usd' || selectedMethod === 'binance'
                  ? 'Monto en Dólares ($)...'
                  : 'Monto en Bolívares (Bs)...'
              }
              value={amountInput}
              onChange={e => setAmountInput(e.target.value)}
              className="w-full min-h-[50px] bg-tocineta-bg border border-tocineta-border rounded-2xl px-4 text-base font-mono font-bold text-tocineta-text placeholder-tocineta-muted focus:border-tocineta-yellow outline-none"
            />
          </div>

          {(selectedMethod === 'pago_movil' || selectedMethod === 'ubii' || selectedMethod === 'binance') && (
            <div className="relative w-full sm:w-64">
              <input
                ref={referenceInputRef}
                type="text"
                placeholder="N° Referencia (4 a 6 dígitos - Opcional)"
                value={referenceInput}
                onChange={e => setReferenceInput(e.target.value)}
                className="w-full min-h-[50px] bg-tocineta-bg border border-tocineta-border rounded-2xl px-4 text-xs font-mono font-bold text-tocineta-yellow placeholder-tocineta-muted focus:border-tocineta-yellow outline-none"
              />
            </div>
          )}

          {(() => {
            const hasAmount = Boolean(amountInput && parseFloat(amountInput) > 0);
            return (
              <button
                type="button"
                onClick={() => handleAddTender()}
                disabled={!hasAmount}
                className={
                  hasAmount
                    ? "btn-solid-dark bg-slate-900 hover:bg-slate-800 text-white font-black min-h-[52px] px-5 rounded-xl shadow-md transition-all active:scale-95 shrink-0 flex items-center justify-center gap-1.5 cursor-pointer text-sm"
                    : "bg-slate-200 text-slate-600 border border-slate-300 font-bold min-h-[52px] px-5 rounded-xl cursor-not-allowed shrink-0 flex items-center justify-center gap-1.5 opacity-60 text-sm"
                }
                style={hasAmount ? { backgroundColor: '#0F172A', color: '#FFFFFF' } : undefined}
              >
                <span>+ Agregar Pago</span>
              </button>
            );
          })()}
        </div>

        {/* Botón Exacto Bs. explícito para métodos en Bolívares (H-06 / M19) */}
        {(selectedMethod === 'cash_bs' || selectedMethod === 'pago_movil' || selectedMethod === 'ubii') && remainingBsCents > 0 && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => {
                handleAddTender(remainingBsCents, selectedMethod);
                if (selectedMethod === 'pago_movil') {
                  setTimeout(() => {
                    referenceInputRef.current?.focus();
                  }, 50);
                }
              }}
              className="bg-amber-100 hover:bg-amber-500 text-amber-950 hover:text-slate-950 border-2 border-amber-500 font-black min-h-[52px] rounded-xl px-4 shadow-sm transition-all active:scale-95 flex items-center justify-center gap-2 text-xs md:text-sm cursor-pointer"
            >
              <span>🇻🇪</span>
              <span>
                {selectedMethod === 'pago_movil'
                  ? `Exacto Bs. Pago Móvil: Bs. ${(remainingBsCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2 })} (Equiv. $${(remainingUsdCents / 100).toFixed(2)} USD)`
                  : selectedMethod === 'ubii'
                  ? `Exacto Bs. Ubii: Bs. ${(remainingBsCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2 })} (Equiv. $${(remainingUsdCents / 100).toFixed(2)} USD)`
                  : `Exacto Bs. Efectivo: Bs. ${(remainingBsCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2 })} (Equiv. $${(remainingUsdCents / 100).toFixed(2)} USD)`}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* LISTA DE PAGOS AGREGADOS */}
      {tenders.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-tocineta-border">
          <span className="text-[11px] font-bold uppercase tracking-wider text-tocineta-muted block">
            Pagos Recibidos para esta Orden:
          </span>
          <div className="space-y-1.5">
            {tenders.map(t => (
              <div
                key={t.id}
                className={`p-3 border rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2 transition-colors duration-300 ${
                  recentlyAddedTenderId === t.id
                    ? 'bg-[#FFE600]/20 border-[#FFE600]'
                    : 'bg-tocineta-bg border-tocineta-border'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-slate-900 dark:text-white text-xs md:text-sm">
                    {getPaymentMethodHumanLabel(t.method)}
                  </span>
                  {(t.method === 'pago_movil' || t.method === 'ubii' || t.method === 'binance') && (
                    <input
                      type="text"
                      placeholder="Ref (Opcional)"
                      value={t.referenceCode ?? ''}
                      onChange={e => {
                        const val = e.target.value;
                        setTenders(prev => prev.map(item => item.id === t.id ? { ...item, referenceCode: val } : item));
                      }}
                      className="px-2 py-1 rounded font-mono text-xs bg-tocineta-card text-tocineta-yellow border border-tocineta-border focus:border-tocineta-yellow outline-none w-36"
                    />
                  )}
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-3">
                  <span className="font-mono font-black text-sm text-slate-900 dark:text-white">
                    {t.currency === 'USD'
                      ? `$${(t.amountCents / 100).toFixed(2)}`
                      : `Bs. ${(t.amountCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2 })} (Equivale a $${(t.usdEquivalentCents / 100).toFixed(2)} USD)`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTender(t.id)}
                    className="w-7 h-7 rounded-lg bg-tocineta-card hover:bg-red-500/20 text-tocineta-muted hover:text-red-400 font-bold flex items-center justify-center shrink-0"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SECCIÓN DE VUELTO MIXTO (SI HAY SOBREPAGO) */}
      {totalChangeUsdCents > 0 && (
        <div className="bg-amber-500/10 border-2 border-amber-500/30 rounded-3xl p-4 space-y-4">
          <div className="bg-[#0B0D11]/80 border border-[#FFE600]/40 rounded-2xl p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-inner">
            <div className="flex items-center gap-2.5">
              <Coins className="w-8 h-8 text-[#FFE600]" />
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-tocineta-muted block">
                  Vuelto Total Exacto a Entregar:
                </span>
                <div className="text-2xl font-black text-[#FFE600] font-mono leading-tight">
                  ${(totalChangeUsdCents / 100).toFixed(2)} USD
                  <span className="text-base text-white/90 font-bold ml-2">
                    (Bs. {(totalChangeBsCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* BOTONES RÁPIDOS DE ENTREGA DE VUELTO EN BS O USD */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setChangeGivenUsdInput('0.00')}
              className="min-h-[48px] px-3.5 rounded-2xl bg-emerald-500/20 border border-emerald-500 text-emerald-300 hover:bg-emerald-500 hover:text-black font-black text-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow text-center"
            >
              <span>🇻🇪</span>
              <span>
                Entregar todo el vuelto en Bolívares (Bs. {(totalChangeBsCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setChangeGivenUsdInput((totalChangeUsdCents / 100).toFixed(2))}
              className="min-h-[48px] px-3.5 rounded-2xl bg-tocineta-yellow/20 border border-tocineta-yellow text-tocineta-yellow hover:bg-tocineta-yellow hover:text-tocineta-bg font-black text-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow text-center"
            >
              <span>💵</span>
              <span>
                Entregar todo el vuelto en USD (${(totalChangeUsdCents / 100).toFixed(2)})
              </span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Vuelto en Efectivo USD */}
            <div>
              <span className="text-[11px] font-bold text-tocineta-muted block mb-1">
                Vuelto en Efectivo USD ($):
              </span>
              <input
                type="number"
                step="0.01"
                placeholder="Ej: 6.00"
                value={changeGivenUsdInput}
                onChange={e => setChangeGivenUsdInput(e.target.value)}
                className="w-full min-h-[48px] bg-tocineta-bg border border-tocineta-border rounded-xl px-4 font-mono font-bold text-white text-sm outline-none focus:border-tocineta-yellow"
              />
            </div>

            {/* Remanente automático en Bolívares */}
            <div className="p-3 bg-tocineta-bg border border-tocineta-border rounded-2xl flex flex-col justify-between">
              <span className="text-[11px] font-bold text-tocineta-muted">
                Resto en Bolívares (Tasa Oficial):
              </span>
              <span className="text-lg font-black text-tocineta-yellow font-mono">
                {(changeGivenBsCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs
              </span>
              <span className="text-[10px] text-tocineta-muted">
                Eq. a ${(remChangeUsdCents / 100).toFixed(2)} USD
              </span>
            </div>
          </div>

          {/* Autocompletado inteligente / confirmación de vuelto cubierto */}
          {unreturnedSurplusUsdCents <= 1 ? (
            <div className="p-3 bg-emerald-500/15 border border-emerald-500/40 rounded-2xl text-xs font-bold text-emerald-300 flex items-center gap-2">
              <span>✓</span>
              <span>
                ${(changeGivenUsdCents / 100).toFixed(2)} en Efectivo USD + Bs. {(changeGivenBsCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} en Bolívares = Vuelto Exacto Cubierto ✓
              </span>
            </div>
          ) : (
            <div className="p-3 bg-amber-500/15 border border-amber-500/40 rounded-2xl text-xs font-bold text-amber-300 flex items-center justify-between">
              <span>⚠️ Vuelto retenido como excedente o propina: ${(unreturnedSurplusUsdCents / 100).toFixed(2)} USD</span>
            </div>
          )}

          {/* Modalidad de entrega del remanente en Bolívares */}
          {changeGivenBsCents > 0 && (
            <div className="space-y-2 pt-2 border-t border-amber-500/20">
              <span className="text-[11px] font-bold text-tocineta-muted block">
                Método de Entrega del Vuelto en Bs:
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setChangeBsMethod('cash_bs')}
                  className={`min-h-[42px] px-4 rounded-xl text-xs font-bold transition-all ${
                    changeBsMethod === 'cash_bs'
                      ? 'bg-tocineta-yellow text-tocineta-bg shadow'
                      : 'bg-tocineta-bg border border-tocineta-border text-tocineta-muted'
                  }`}
                >
                  🇻🇪 Efectivo Bs
                </button>
                <button
                  type="button"
                  onClick={() => setChangeBsMethod('pago_movil')}
                  className={`min-h-[42px] px-4 rounded-xl text-xs font-bold transition-all ${
                    changeBsMethod === 'pago_movil'
                      ? 'bg-tocineta-yellow text-tocineta-bg shadow'
                      : 'bg-tocineta-bg border border-tocineta-border text-tocineta-muted'
                  }`}
                >
                  📱 Pago Móvil al Cliente
                </button>
              </div>

              {changeBsMethod === 'pago_movil' && (
                <input
                  type="text"
                  placeholder="N° Referencia del Pago Móvil de Vuelto..."
                  value={changeBsReference}
                  onChange={e => setChangeBsReference(e.target.value)}
                  className="w-full min-h-[44px] bg-tocineta-bg border border-tocineta-border rounded-xl px-3 font-mono text-xs text-tocineta-text outline-none focus:border-tocineta-yellow mt-1"
                />
              )}
            </div>
          )}

          {/* CLASIFICACIÓN DE EXCEDENTE / PROPINA (SOLO SI unreturnedSurplusUsdCents > 1) */}
          {unreturnedSurplusUsdCents > 1 && (
            <div className="space-y-1.5 pt-2 border-t border-amber-500/20">
              <span className="text-[11px] font-bold text-tocineta-muted block">
                Destino de Excedente / Propina (si el cliente no retira todo el vuelto):
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOverpaymentDisposition('tip_in')}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold transition-all ${
                    overpaymentDisposition === 'tip_in'
                      ? 'bg-emerald-500 text-white shadow'
                      : 'bg-tocineta-bg border border-tocineta-border text-tocineta-muted'
                  }`}
                >
                  🎉 Propina para Equipo
                </button>
                <button
                  type="button"
                  onClick={() => setOverpaymentDisposition('adjustment')}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold transition-all ${
                    overpaymentDisposition === 'adjustment'
                      ? 'bg-amber-500 text-black shadow'
                      : 'bg-tocineta-bg border border-tocineta-border text-tocineta-muted'
                  }`}
                >
                  ⚖️ Ajuste / Redondeo
                </button>
              </div>
              {overpaymentDisposition === 'adjustment' && (
                <input
                  type="text"
                  placeholder="Motivo del ajuste..."
                  value={overpaymentReason}
                  onChange={e => setOverpaymentReason(e.target.value)}
                  className="w-full min-h-[42px] bg-tocineta-bg border border-tocineta-border rounded-xl px-3 text-xs text-tocineta-text outline-none mt-1"
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* BOTÓN FINAL DE COBRO (MÍNIMO 56PX DE ALTO TÁCTIL) */}
      {remainingUsdCents === 0 ? (
        <button
          type="button"
          onClick={() => executePayment()}
          disabled={isSubmitting}
          className="btn-solid-emerald w-full min-h-[56px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-lg shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
          style={{ backgroundColor: '#059669', color: '#FFFFFF' }}
        >
          {isSubmitting ? (
            <span className="animate-spin text-xl inline-block">⏳</span>
          ) : (
            <span>✓ Finalizar Cobro y Despachar a Cocina</span>
          )}
        </button>
      ) : (
        <button
          type="button"
          disabled={true}
          className="w-full min-h-[56px] rounded-xl bg-slate-200 text-slate-700 border-2 border-slate-300 font-extrabold text-base cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
        >
          <span>Falta cubrir ${(remainingUsdCents / 100).toFixed(2)} USD para finalizar</span>
        </button>
      )}

    </div>
  );
};
