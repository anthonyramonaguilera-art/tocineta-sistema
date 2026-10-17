import React, { useState, useMemo } from 'react';
import type { CashierOrder, CashierTender, CashierPaymentMethod } from './types.js';
import { usdToBsCents, generateUuidV7 } from '@tocineta/shared';

interface MultiMethodCalculatorProps {
  order: CashierOrder;
  rateMicroBs: number;
  onPaymentSuccess: () => void;
}

const QUICK_USD_BILLS = [100, 500, 1000, 2000, 5000, 10000]; // en centavos: $1, $5, $10, $20, $50, $100

export const MultiMethodCalculator: React.FC<MultiMethodCalculatorProps> = ({
  order,
  rateMicroBs,
  onPaymentSuccess
}) => {
  // Estado de los pagos ingresados
  const [tenders, setTenders] = useState<CashierTender[]>([]);

  // Método actualmente seleccionado para ingresar un pago
  const [selectedMethod, setSelectedMethod] = useState<CashierPaymentMethod>('cash_usd');
  const [amountInput, setAmountInput] = useState<string>('');
  const [referenceInput, setReferenceInput] = useState<string>('');

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

  // Vuelto total en USD
  const changeTotalUsdCents = Math.max(0, totalPaidUsdEquivalentCents - totalUsdCents);

  // Desglose de Vuelto Mixto
  const { changeGivenUsdCents, remChangeUsdCents, changeGivenBsCents } = useMemo(() => {
    const givenUsd = Math.min(changeTotalUsdCents, Math.round((parseFloat(changeGivenUsdInput || '0') * 100)));
    const remUsd = Math.max(0, changeTotalUsdCents - givenUsd);
    const givenBs = remUsd > 0 ? usdToBsCents(remUsd, rateMicroBs) : 0;
    return {
      changeGivenUsdCents: givenUsd,
      remChangeUsdCents: remUsd,
      changeGivenBsCents: givenBs
    };
  }, [changeTotalUsdCents, changeGivenUsdInput, rateMicroBs]);

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

    const newTender: CashierTender = {
      id: `ten_${generateUuidV7()}`,
      method,
      amountCents,
      currency,
      usdEquivalentCents,
      referenceCode: referenceInput.trim() || undefined
    };

    setTenders(prev => [...prev, newTender]);
    setAmountInput('');
    setReferenceInput('');
    setErrorMessage(null);
  };

  // Botón billete rápido USD
  const handleQuickBill = (cents: number) => {
    handleAddTender(cents, 'cash_usd');
  };

  // Botón pago exacto restante
  const handlePayExactRemaining = () => {
    if (remainingUsdCents <= 0) return;
    const isUsd = selectedMethod === 'cash_usd' || selectedMethod === 'binance';
    if (isUsd) {
      handleAddTender(remainingUsdCents, selectedMethod);
    } else {
      handleAddTender(remainingBsCents, selectedMethod);
    }
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
      referenceCode: t.referenceCode
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

    // Si hay sobrepago no cubierto por vuelto
    const totalDeliveredChangeUsdEq = changeGivenUsdCents + (changeGivenBsCents > 0 ? Math.round((changeGivenBsCents * 1_000_000) / rateMicroBs) : 0);
    if (changeTotalUsdCents > totalDeliveredChangeUsdEq) {
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
            <span className="text-lg font-bold text-white font-mono">
              / {(totalBsCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs
            </span>
          </div>
        </div>

        {/* SALDO RESTANTE */}
        <div className="text-left sm:text-right">
          <span className="text-[11px] font-bold uppercase tracking-wider text-tocineta-muted block">
            {remainingUsdCents > 0 ? 'Saldo Restante:' : 'Totalmente Cubierto:'}
          </span>
          <div className="text-xl font-black font-mono mt-0.5">
            {remainingUsdCents > 0 ? (
              <span className="text-red-400">
                ${(remainingUsdCents / 100).toFixed(2)} ({ (remainingBsCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2 }) } Bs)
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

      {/* BOTONES RÁPIDOS DE BILLETES USD ($1, $5, $10, $20, $50, $100, EXACTO) */}
      <div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-tocineta-muted block mb-2">
          💵 Billetes Rápidos en Efectivo USD:
        </span>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {QUICK_USD_BILLS.map(cents => (
            <button
              key={cents}
              type="button"
              onClick={() => handleQuickBill(cents)}
              className="min-h-[48px] rounded-2xl bg-tocineta-bg border border-tocineta-border hover:border-tocineta-yellow text-white font-mono font-black text-sm active:scale-95 transition-all flex items-center justify-center shadow"
            >
              ${cents / 100}
            </button>
          ))}
          <button
            type="button"
            onClick={handlePayExactRemaining}
            disabled={remainingUsdCents <= 0}
            className="min-h-[48px] rounded-2xl bg-tocineta-yellow/20 border border-tocineta-yellow text-tocineta-yellow font-black text-xs active:scale-95 transition-all flex items-center justify-center shadow col-span-4 sm:col-span-1 disabled:opacity-30 disabled:pointer-events-none"
          >
            Exacto
          </button>
        </div>
      </div>

      {/* SELECTOR DE MÉTODOS DE PAGO */}
      <div className="space-y-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-tocineta-muted block">
          💳 Selecciona Método de Pago a Ingresar:
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { id: 'cash_usd', label: '💵 Efectivo USD' },
            { id: 'cash_bs', label: '🇻🇪 Efectivo Bs' },
            { id: 'pago_movil', label: '📱 Pago Móvil' },
            { id: 'ubii', label: '💳 Punto Ubii' },
            { id: 'binance', label: '🟡 Binance Pay' }
          ].map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelectedMethod(m.id as CashierPaymentMethod)}
              className={`min-h-[48px] px-3 py-2 rounded-2xl text-xs font-black transition-all flex items-center justify-center text-center ${
                selectedMethod === m.id
                  ? 'bg-tocineta-yellow text-tocineta-bg shadow-lg scale-102'
                  : 'bg-tocineta-bg border border-tocineta-border text-tocineta-muted hover:text-white'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* DATOS OFICIALES DE BANESCO SI ES PAGO MÓVIL */}
        {selectedMethod === 'pago_movil' && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-xs text-emerald-300 flex items-center justify-between">
            <div>
              <span className="font-black block">Banesco Banco Universal (0134)</span>
              <span className="font-mono text-[11px]">Tel: 0424-9728209 • RIF: V-17040918-0</span>
            </div>
            <span className="text-lg">🏦</span>
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
              className="w-full min-h-[50px] bg-tocineta-bg border border-tocineta-border rounded-2xl px-4 text-base font-mono font-bold text-white placeholder-tocineta-muted focus:border-tocineta-yellow outline-none"
            />
          </div>

          {(selectedMethod === 'pago_movil' || selectedMethod === 'ubii' || selectedMethod === 'binance') && (
            <div className="relative w-full sm:w-48">
              <input
                type="text"
                placeholder="N° Referencia..."
                value={referenceInput}
                onChange={e => setReferenceInput(e.target.value)}
                className="w-full min-h-[50px] bg-tocineta-bg border border-tocineta-border rounded-2xl px-4 text-xs font-mono font-bold text-tocineta-yellow placeholder-tocineta-muted focus:border-tocineta-yellow outline-none"
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => handleAddTender()}
            disabled={!amountInput || parseFloat(amountInput) <= 0}
            className="min-h-[50px] px-6 rounded-2xl bg-tocineta-card border border-tocineta-yellow/60 hover:bg-tocineta-yellow hover:text-tocineta-bg text-tocineta-yellow font-black text-xs transition-all active:scale-95 disabled:opacity-30 disabled:pointer-events-none shrink-0 flex items-center justify-center gap-1.5 shadow"
          >
            <span>+ Agregar Pago</span>
          </button>
        </div>
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
                className="p-3 bg-tocineta-bg border border-tocineta-border rounded-2xl flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white uppercase">{t.method}</span>
                  {t.referenceCode && (
                    <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-tocineta-card text-tocineta-yellow border border-tocineta-border">
                      Ref: {t.referenceCode}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono font-black text-sm text-white">
                    {t.currency === 'USD' ? `$${(t.amountCents / 100).toFixed(2)}` : `${(t.amountCents / 100).toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTender(t.id)}
                    className="w-7 h-7 rounded-lg bg-tocineta-card hover:bg-red-500/20 text-tocineta-muted hover:text-red-400 font-bold flex items-center justify-center"
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
      {changeTotalUsdCents > 0 && (
        <div className="bg-amber-500/10 border-2 border-amber-500/30 rounded-3xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">💰</span>
              <div>
                <h4 className="text-sm font-black text-white">Control de Vuelto Mixto</h4>
                <p className="text-[11px] text-amber-200/80">
                  Total de vuelto a entregar: <span className="font-bold font-mono text-tocineta-yellow">${(changeTotalUsdCents / 100).toFixed(2)}</span>
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Vuelto en Efectivo USD */}
            <div>
              <span className="text-[11px] font-bold text-tocineta-muted block mb-1">
                Entregar en Dólares ($):
              </span>
              <input
                type="number"
                step="1"
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
                  className="w-full min-h-[44px] bg-tocineta-bg border border-tocineta-border rounded-xl px-3 font-mono text-xs text-white outline-none focus:border-tocineta-yellow mt-1"
                />
              )}
            </div>
          )}

          {/* CLASIFICACIÓN DE EXCEDENTE / PROPINA */}
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
                className="w-full min-h-[42px] bg-tocineta-bg border border-tocineta-border rounded-xl px-3 text-xs text-white outline-none mt-1"
              />
            )}
          </div>
        </div>
      )}

      {/* BOTÓN FINAL DE COBRO (MÍNIMO 54PX DE ALTO TÁCTIL) */}
      <button
        type="button"
        onClick={() => executePayment()}
        disabled={remainingUsdCents > 0 || isSubmitting}
        className="w-full min-h-[56px] rounded-2xl bg-tocineta-yellow text-tocineta-bg font-black text-base disabled:opacity-30 disabled:pointer-events-none hover:bg-tocineta-yellow-hover active:scale-95 transition-all flex items-center justify-center gap-2 shadow-2xl"
      >
        {isSubmitting ? (
          <span className="animate-spin text-xl inline-block">⏳</span>
        ) : (
          <span>✓ Finalizar Cobro y Despachar a Cocina</span>
        )}
      </button>

    </div>
  );
};
