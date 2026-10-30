import React from 'react';
import { Card } from '../../ui/index.js';
import { getPaymentMethodHumanLabel } from './payment-labels.js';
import { getPaymentMethodNativeCurrency } from '@tocineta/shared';

interface ClosurePaymentMethodsTableProps {
  byMethod: Array<{
    method: string;
    label?: string;
    count: number;
    totalUsdCents: number;
    totalBsCents?: number;
  }>;
  receivablesUsdCents?: number;
}

export const ClosurePaymentMethodsTable: React.FC<ClosurePaymentMethodsTableProps> = ({
  byMethod,
  receivablesUsdCents
}) => {
  const totalByMethodUsdCents = byMethod?.reduce((acc, m) => acc + (m.totalUsdCents || 0), 0) || 0;
  const totalCount = byMethod?.reduce((acc, m) => acc + (m.count || 0), 0) || 0;

  return (
    <div className="space-y-3">
      <Card variant="surface" className="p-4 space-y-3 border-border">
        <span className="text-xs font-bold uppercase tracking-wider text-ink-muted block">Por método de pago</span>
        {byMethod && byMethod.length > 0 ? (
          <div className="space-y-2">
            <div className="grid grid-cols-12 text-[10px] font-bold uppercase tracking-wider text-ink-muted pb-1 border-b border-border">
              <span className="col-span-4">Método</span>
              <span className="col-span-2 text-center">Pagos</span>
              <span className="col-span-3 text-right">Monto</span>
              <span className="col-span-3 text-right">Equiv USD</span>
            </div>
            {byMethod.map((m, idx) => {
              const native = getPaymentMethodNativeCurrency(m.method);
              const usdStr = `$${((m.totalUsdCents || 0) / 100).toFixed(2)}`;
              const bsAmount = m.totalBsCents ? m.totalBsCents / 100 : 0;
              const bsStr = `Bs. ${bsAmount.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

              let montoDisplay = usdStr;
              let equivDisplay = '-';

              if (native === 'BS') {
                montoDisplay = bsStr;
                equivDisplay = usdStr;
              } else if (native === 'BOTH') {
                montoDisplay = `${bsStr} / ${usdStr}`;
                equivDisplay = usdStr;
              } else {
                montoDisplay = usdStr;
                equivDisplay = usdStr;
              }

              return (
                <div key={idx} className="grid grid-cols-12 items-center text-xs py-1.5 border-b border-border/40 last:border-0">
                  <span className="col-span-4 text-ink font-medium">{m.label || getPaymentMethodHumanLabel(m.method)}</span>
                  <span className="col-span-2 text-center text-ink-muted font-mono">{m.count}</span>
                  <span className="col-span-3 text-right font-mono font-bold text-ink truncate" title={montoDisplay}>{montoDisplay}</span>
                  <span className="col-span-3 text-right font-mono text-ink-muted">{equivDisplay}</span>
                </div>
              );
            })}
            <div className="grid grid-cols-12 items-center text-xs pt-2 border-t border-border font-bold">
              <span className="col-span-4 text-ink uppercase">Total Cobrado</span>
              <span className="col-span-2 text-center text-ink font-mono">{totalCount}</span>
              <span className="col-span-6 text-right font-mono font-black text-primary">${(totalByMethodUsdCents / 100).toFixed(2)}</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-ink-muted py-2">No hay transacciones registradas aún en este turno.</p>
        )}
      </Card>

      {receivablesUsdCents && receivablesUsdCents > 0 ? (
        <Card variant="surface" className="p-4 space-y-1 border-border bg-surface-alt">
          <div className="flex justify-between items-center text-xs">
            <span className="text-ink font-medium">Ventas a crédito (por cobrar)</span>
            <span className="font-mono font-bold text-ink">${(receivablesUsdCents / 100).toFixed(2)}</span>
          </div>
        </Card>
      ) : null}
    </div>
  );
};
