import { Card, Icon } from '../../ui/index.js';

interface CashFlowTabProps {
  cashFlowData: any;
  isLoading?: boolean;
}

export const CashFlowTab: React.FC<CashFlowTabProps> = ({ cashFlowData, isLoading }) => {
  if (isLoading || !cashFlowData) {
    return (
      <div className="p-12 text-center text-xs font-bold text-ink-muted animate-pulse">
        Calculando Flujo de Caja y Conciliación de Medios de Pago...
      </div>
    );
  }

  const { summary, byMethod, byLocation } = cashFlowData;

  return (
    <div className="space-y-6">
      {/* 1. Tarjetas de Resumen General */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 bg-surface rounded-2xl border border-border shadow-xs">
          <span className="text-[10px] font-bold text-ink-muted uppercase tracking-wider block">
            Total Entradas
          </span>
          <div className="text-2xl font-black text-success tracking-tight">
            +${(summary.totalInflowsUsdCents / 100).toFixed(2)}
          </div>
          <span className="text-[11px] text-ink-muted">
            Ventas (${(summary.salesInflowsUsdCents / 100).toFixed(2)}) + Cobros ($
            {(summary.receivableInflowsUsdCents / 100).toFixed(2)})
          </span>
        </div>

        <div className="p-4 bg-surface rounded-2xl border border-border shadow-xs">
          <span className="text-[10px] font-bold text-ink-muted uppercase tracking-wider block">
            Total Salidas
          </span>
          <div className="text-2xl font-black text-danger tracking-tight">
            -${(summary.totalOutflowsUsdCents / 100).toFixed(2)}
          </div>
          <span className="text-[11px] text-ink-muted">
            Gastos (${(summary.expensesOutflowsUsdCents / 100).toFixed(2)}) + Proveedores ($
            {(summary.payableOutflowsUsdCents / 100).toFixed(2)})
          </span>
        </div>

        <div className="p-4 bg-surface rounded-2xl border border-border shadow-xs">
          <span className="text-[10px] font-bold text-ink-muted uppercase tracking-wider block">
            Flujo Neto de Caja
          </span>
          <div
            className={`text-2xl font-black tracking-tight ${
              summary.netCashFlowUsdCents >= 0 ? 'text-success' : 'text-danger'
            }`}
          >
            {summary.netCashFlowUsdCents >= 0 ? '+' : ''}$
            {(summary.netCashFlowUsdCents / 100).toFixed(2)}
          </div>
          <span className="text-[11px] text-ink-muted">Entradas − Salidas de caja</span>
        </div>
      </div>

      {/* 2. Conciliación por Método de Pago */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-black text-ink uppercase tracking-wider">
            Conciliación por Método de Pago
          </h4>
          <Icon name="Layers" size={16} className="text-ink-muted" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-border text-[10px] font-black uppercase text-ink-muted">
                <th className="py-2">Método</th>
                <th className="py-2 text-right">Entradas ($)</th>
                <th className="py-2 text-right">Salidas ($)</th>
                <th className="py-2 text-right">Saldo Neto ($)</th>
                <th className="py-2 text-right">Tx Entradas</th>
                <th className="py-2 text-right">Tx Salidas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {byMethod.map((item: any) => (
                <tr key={item.method} className="hover:bg-surface-alt/50 transition-colors">
                  <td className="py-3 font-bold text-ink">
                    {item.method.replace('_', ' ')}
                  </td>
                  <td className="py-3 text-right font-black text-success">
                    +${(item.inflowsUsdCents / 100).toFixed(2)}
                  </td>
                  <td className="py-3 text-right font-black text-danger">
                    -${(item.outflowsUsdCents / 100).toFixed(2)}
                  </td>
                  <td
                    className={`py-3 text-right font-black ${
                      item.netBalanceUsdCents >= 0 ? 'text-ink' : 'text-danger'
                    }`}
                  >
                    ${(item.netBalanceUsdCents / 100).toFixed(2)}
                  </td>
                  <td className="py-3 text-right text-ink-muted">{item.inflowTransactionsCount}</td>
                  <td className="py-3 text-right text-ink-muted">{item.outflowTransactionsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 3. Conciliación por Sede */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-black text-ink uppercase tracking-wider">
            Flujo de Caja por Sede
          </h4>
          <Icon name="MapPin" size={16} className="text-ink-muted" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {byLocation.map((loc: any) => (
            <div
              key={loc.locationId}
              className="p-3 bg-surface-alt rounded-xl border border-border flex items-center justify-between text-xs"
            >
              <div>
                <span className="font-bold text-ink block">{loc.locationName}</span>
                <span className="text-[11px] text-ink-muted">
                  +${(loc.inflowsUsdCents / 100).toFixed(2)} / -${(loc.outflowsUsdCents / 100).toFixed(2)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-ink-muted uppercase block">Balance Neto</span>
                <span
                  className={`text-base font-black ${
                    loc.netBalanceUsdCents >= 0 ? 'text-success' : 'text-danger'
                  }`}
                >
                  ${(loc.netBalanceUsdCents / 100).toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
