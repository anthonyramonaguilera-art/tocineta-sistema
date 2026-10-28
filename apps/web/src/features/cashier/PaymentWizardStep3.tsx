import React, { useState, useEffect } from 'react';
import { Card, Button, Input, Icon } from '../../ui/index.js';
import type { CashierTender } from './types.js';
import {
  splitChangeByUsd,
  splitChangeByBs,
  validateChangeSplit
} from '@tocineta/shared';

interface PaymentWizardStep3Props {
  totalUsdCents: number;
  totalBsCents: number;
  tenders: CashierTender[];
  rateMicroBs: number;
  totalChangeUsdCents: number;
  totalChangeBsCents: number;
  changeGivenUsdCents: number;
  changeGivenBsCents: number;
  onChangeSplit: (usdCents: number, bsCents: number) => void;
  changeBsMethod: string;
  onChangeBsMethod: (m: string) => void;
  changeBsReference: string;
  onChangeBsReference: (ref: string) => void;
  unreturnedSurplusUsdCents: number;
  overpaymentDisposition: 'tip_in' | 'adjustment';
  onChangeOverpaymentDisposition: (d: 'tip_in' | 'adjustment') => void;
  supervisorPinRequired: boolean;
  supervisorPin: string;
  onChangeSupervisorPin: (pin: string) => void;
  finalizeDisabledReason: string | null;
}

export const PaymentWizardStep3: React.FC<PaymentWizardStep3Props> = ({
  totalUsdCents,
  totalBsCents,
  tenders,
  rateMicroBs,
  totalChangeUsdCents,
  totalChangeBsCents,
  changeGivenUsdCents,
  changeGivenBsCents,
  onChangeSplit,
  changeBsMethod,
  onChangeBsMethod,
  changeBsReference,
  onChangeBsReference,
  unreturnedSurplusUsdCents,
  overpaymentDisposition,
  onChangeOverpaymentDisposition,
  supervisorPinRequired,
  supervisorPin,
  onChangeSupervisorPin,
  finalizeDisabledReason
}) => {
  const [splitMode, setSplitMode] = useState<'all_usd' | 'all_bs' | 'mixed'>(
    changeGivenUsdCents > 0 && changeGivenBsCents > 0
      ? 'mixed'
      : changeGivenBsCents > 0
      ? 'all_bs'
      : 'all_usd'
  );

  const [inputUsd, setInputUsd] = useState<string>((changeGivenUsdCents / 100).toFixed(2));
  const [inputBs, setInputBs] = useState<string>((changeGivenBsCents / 100).toFixed(2));

  // Actualiza los valores cuando cambia el split externamente
  useEffect(() => {
    setInputUsd((changeGivenUsdCents / 100).toFixed(2));
    setInputBs((changeGivenBsCents / 100).toFixed(2));
  }, [changeGivenUsdCents, changeGivenBsCents]);

  const handleSelectAllUsd = () => {
    setSplitMode('all_usd');
    onChangeSplit(totalChangeUsdCents, 0);
  };

  const handleSelectAllBs = () => {
    setSplitMode('all_bs');
    const split = splitChangeByUsd(totalChangeUsdCents, 0, rateMicroBs);
    onChangeSplit(0, split.bsGivenCents);
  };

  const handleSelectMixed = () => {
    setSplitMode('mixed');
    // Por defecto en mixto: mitad o lo que ya esté
    if (changeGivenUsdCents === 0 && changeGivenBsCents === 0) {
      const halfUsd = Math.floor(totalChangeUsdCents / 2);
      const split = splitChangeByUsd(totalChangeUsdCents, halfUsd, rateMicroBs);
      onChangeSplit(split.usdGivenCents, split.bsGivenCents);
    }
  };

  const handleChangeInputUsd = (val: string) => {
    setInputUsd(val);
    const parsed = Math.round(parseFloat(val || '0') * 100);
    const split = splitChangeByUsd(totalChangeUsdCents, parsed, rateMicroBs);
    onChangeSplit(split.usdGivenCents, split.bsGivenCents);
    setInputBs((split.bsGivenCents / 100).toFixed(2));
  };

  const handleChangeInputBs = (val: string) => {
    setInputBs(val);
    const parsed = Math.round(parseFloat(val || '0') * 100);
    const split = splitChangeByBs(totalChangeUsdCents, parsed, rateMicroBs);
    onChangeSplit(split.usdGivenCents, split.bsGivenCents);
    setInputUsd((split.usdGivenCents / 100).toFixed(2));
  };

  const validation = validateChangeSplit(
    totalChangeUsdCents,
    changeGivenUsdCents,
    changeGivenBsCents,
    rateMicroBs
  );

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      {/* 1. Resumen de Pago: Total y Métodos Recibidos */}
      <Card variant="alt" className="p-4 space-y-3">
        <div className="flex justify-between items-baseline border-b border-border/60 pb-2">
          <span className="text-xs uppercase font-bold text-ink-muted tracking-wider">Total de la orden</span>
          <div className="text-right">
            <span className="text-xl font-black text-ink font-mono">${(totalUsdCents / 100).toFixed(2)}</span>
            <span className="text-xs text-ink-muted block font-mono">{(totalBsCents / 100).toFixed(2)} Bs</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-bold text-ink-muted uppercase tracking-wider block">Dinero recibido</span>
          {tenders.map((t, idx) => (
            <div key={idx} className="flex justify-between items-center text-xs bg-surface p-2 rounded-lg border border-border/50">
              <span className="font-bold text-ink uppercase">
                {t.method.replace(/_/g, ' ')} {t.referenceCode ? `(#${t.referenceCode})` : ''}
              </span>
              <span className="font-mono font-bold text-ink">${(t.amountCents / 100).toFixed(2)}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* 2. Control de Vuelto */}
      {totalChangeUsdCents === 0 ? (
        <Card variant="surface" className="p-6 text-center space-y-2 border-success/30 bg-success/5">
          <div className="w-12 h-12 mx-auto rounded-full bg-success/20 flex items-center justify-center text-success">
            <Icon name="CheckCircle2" className="w-7 h-7 text-success" />
          </div>
          <h3 className="text-base font-black text-ink uppercase">Pago exacto, sin vuelto</h3>
          <p className="text-xs text-ink-muted">El dinero recibido cubre con exactitud el total adeudado.</p>
        </Card>
      ) : (
        <Card variant="alt" className="p-4 sm:p-6 space-y-4">
          <div className="text-center space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-muted block">Vuelto a entregar</span>
            <div data-testid="change-amount" className="change-display text-4xl sm:text-5xl font-black text-primary font-mono tracking-tight">
              ${(totalChangeUsdCents / 100).toFixed(2)}
            </div>
            <div className="text-base sm:text-lg font-bold text-ink-muted font-mono">
              {(totalChangeBsCents / 100).toFixed(2)} Bs
            </div>
          </div>

          {/* Selector de modo de entrega */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className={`p-2 rounded-xl text-xs font-bold border transition-colors ${
                splitMode === 'all_usd'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface text-ink border-border hover:bg-surface-hover'
              }`}
              onClick={handleSelectAllUsd}
            >
              Todo en USD
            </button>
            <button
              type="button"
              className={`p-2 rounded-xl text-xs font-bold border transition-colors ${
                splitMode === 'all_bs'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface text-ink border-border hover:bg-surface-hover'
              }`}
              onClick={handleSelectAllBs}
            >
              Todo en Bs
            </button>
            <button
              type="button"
              className={`p-2 rounded-xl text-xs font-bold border transition-colors ${
                splitMode === 'mixed'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface text-ink border-border hover:bg-surface-hover'
              }`}
              onClick={handleSelectMixed}
            >
              Vuelto Mixto
            </button>
          </div>

          {/* Panel de Vuelto Mixto */}
          {splitMode === 'mixed' && (
            <div className="p-4 bg-surface rounded-2xl border border-border space-y-3">
              <span className="text-xs font-black uppercase text-ink-muted block tracking-wider">
                Distribución de Vuelto Mixto
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-ink-muted block mb-1">Entregar en USD ($):</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max={(totalChangeUsdCents / 100).toFixed(2)}
                    value={inputUsd}
                    onChange={e => handleChangeInputUsd(e.target.value)}
                    className="font-mono text-base font-bold"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-ink-muted block mb-1">Entregar en Bs:</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={inputBs}
                    onChange={e => handleChangeInputBs(e.target.value)}
                    className="font-mono text-base font-bold"
                  />
                </div>
              </div>

              {/* Indicador de cuadre del vuelto */}
              {validation.isValid ? (
                <div className="p-2 bg-success/10 border border-success/30 rounded-xl text-xs font-bold text-success flex items-center justify-center gap-1.5">
                  <Icon name="CheckCircle2" className="w-4 h-4 text-success" />
                  <span>
                    Vuelto exacto: ${(changeGivenUsdCents / 100).toFixed(2)} USD + {(changeGivenBsCents / 100).toFixed(2)} Bs
                  </span>
                </div>
              ) : (
                <div className="p-2 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger flex items-center justify-center gap-1.5">
                  <Icon name="AlertTriangle" className="w-4 h-4 text-danger" />
                  <span>
                    {validation.differenceUsdCents < 0
                      ? `Faltan $${(Math.abs(validation.differenceUsdCents) / 100).toFixed(2)} para completar el vuelto`
                      : `Excede por $${(validation.differenceUsdCents / 100).toFixed(2)}`}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Vía de entrega para los Bolívares */}
          {changeGivenBsCents > 0 && (
            <div className="p-3 bg-surface rounded-xl border border-border space-y-2 text-left">
              <span className="text-xs font-bold text-ink-muted block">Método de entrega de los Bolívares:</span>
              <div className="flex gap-2">
                <Button
                  variant={changeBsMethod === 'cash_bs' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => onChangeBsMethod('cash_bs')}
                >
                  Efectivo Bs
                </Button>
                <Button
                  variant={changeBsMethod === 'pago_movil' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => onChangeBsMethod('pago_movil')}
                >
                  Pago Móvil
                </Button>
              </div>

              {changeBsMethod === 'pago_movil' && (
                <div className="pt-1">
                  <Input
                    placeholder="Referencia bancaria de Pago Móvil..."
                    value={changeBsReference}
                    onChange={e => onChangeBsReference(e.target.value)}
                    className="text-xs"
                  />
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Manejo de excedente o propina */}
      {unreturnedSurplusUsdCents > 1 && (
        <Card variant="surface" className="p-4 text-left space-y-2">
          <span className="text-xs font-bold text-warning uppercase">
            Excedente sin devolver (${(unreturnedSurplusUsdCents / 100).toFixed(2)})
          </span>
          <div className="flex gap-2">
            <Button
              variant={overpaymentDisposition === 'tip_in' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => onChangeOverpaymentDisposition('tip_in')}
            >
              Registrar como Propina
            </Button>
            <Button
              variant={overpaymentDisposition === 'adjustment' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => onChangeOverpaymentDisposition('adjustment')}
            >
              Ajuste de Caja
            </Button>
          </div>
        </Card>
      )}

      {/* Alerta de supervisor PIN ante alerta de fraude */}
      {supervisorPinRequired && (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl space-y-2 text-left">
          <span className="text-xs font-bold text-danger">Se requiere PIN de supervisor para autorizar:</span>
          <Input
            type="password"
            placeholder="PIN supervisor..."
            value={supervisorPin}
            onChange={e => onChangeSupervisorPin(e.target.value)}
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
  );
};
