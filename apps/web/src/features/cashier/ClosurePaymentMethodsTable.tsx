import React from 'react';
import { Card } from '../../ui/index.js';
import { getPaymentMethodHumanLabel } from './payment-labels.js';

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
              <span className="col-span-6">Método</span>
              <span className="col-span-3 text-center">Pagos</span>
              <span className="col-span-3 text-right">Monto ($)</span>
            </div>
            {byMethod.map((m, idx) => (
              <div key={idx} className="grid grid-cols-12 items-center text-xs py-1.5 border-b border-border/40 last:border-0">
                <span className="col-span-6 text-ink font-medium">{m.label || getPaymentMethodHumanLabel(m.method)}</span>
                <span className="col-span-3 text-center text-ink-muted font-mono">{m.count}</span>
                <span className="col-span-3 text-right font-mono font-bold text-ink">${((m.totalUsdCents || 0) / 100).toFixed(2)}</span>
              </div>
            ))}
            <div className="grid grid-cols-12 items-center text-xs pt-2 border-t border-border font-bold">
              <span className="col-span-6 text-ink uppercase">Total Cobrado</span>
              <span className="col-span-3 text-center text-ink font-mono">{totalCount}</span>
              <span className="col-span-3 text-right font-mono font-black text-primary">${(totalByMethodUsdCents / 100).toFixed(2)}</span>
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
