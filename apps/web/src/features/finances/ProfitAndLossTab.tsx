import { Card, Badge, Icon } from '../../ui/index.js';

interface ProfitAndLossTabProps {
  pnlData: any;
  isLoading?: boolean;
}

export const ProfitAndLossTab: React.FC<ProfitAndLossTabProps> = ({ pnlData, isLoading }) => {
  if (isLoading || !pnlData) {
    return (
      <div className="p-12 text-center text-xs font-bold text-ink-muted animate-pulse">
        Calculando Estado de Resultados y Rentabilidad Real...
      </div>
    );
  }

  const { summary, breakdown } = pnlData;

  return (
    <div className="space-y-6">
      {/* 1. Tarjeta Principal de Utilidad Real */}
      <div className="p-6 bg-surface rounded-3xl border border-border shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="text-xs font-black text-ink-muted uppercase tracking-wider block">
              Estado de Resultados (P&L)
            </span>
            <div className={`text-4xl font-black tracking-tight ${summary.netProfitUsdCents < 0 ? 'text-danger' : 'text-ink'}`}>
              ${(summary.netProfitUsdCents / 100).toFixed(2)}
            </div>
            <span className={`text-xs font-bold ${summary.netProfitMarginPercentage < 0 || summary.netProfitUsdCents < 0 ? 'text-danger' : 'text-ink-muted'}`}>
              Margen Neto: {summary.netProfitMarginPercentage}%
            </span>
          </div>

          <div className="p-3 bg-surface-alt rounded-2xl border border-border flex items-center gap-4 text-xs font-semibold">
            <div>
              <span className="text-ink-muted block text-[10px] uppercase">Pedidos</span>
              <span className="font-black text-ink">{summary.totalOrders}</span>
            </div>
            <div className="w-px h-8 bg-border" />
            <div>
              <span className="text-ink-muted block text-[10px] uppercase">Ticket Promedio</span>
              <span className="font-black text-ink">
                ${(summary.averageTicketUsdCents / 100).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Cascada de Resultados: Ventas - Costo - Mermas - Gastos */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border">
          <div className="p-3 bg-surface-alt rounded-xl">
            <span className="text-[10px] font-bold text-ink-muted uppercase block">
              1. Ventas Netas
            </span>
            <span className="text-lg font-black text-ink">
              ${(summary.netFoodSalesUsdCents / 100).toFixed(2)}
            </span>
            <span className="text-[10px] text-ink-muted block">Comida facturada</span>
          </div>

          <div className="p-3 bg-surface-alt rounded-xl">
            <span className="text-[10px] font-bold text-ink-muted uppercase block">
              2. Costo de Ventas
            </span>
            {summary.cogsConfigured === false ? (
              <span className="text-xs font-black text-ink-muted block mt-1">
                Sin recetas configuradas
              </span>
            ) : (
              <span className="text-lg font-black text-danger">
                -${(summary.costOfGoodsSoldUsdCents / 100).toFixed(2)}
              </span>
            )}
            <span className="text-[10px] text-ink-muted block">
              {summary.cogsConfigured === false ? 'Modo sin recetas' : `Food Cost (${summary.foodCostPercentage}%)`}
            </span>
          </div>

          <div className="p-3 bg-surface-alt rounded-xl">
            <span className="text-[10px] font-bold text-ink-muted uppercase block">
              3. Mermas Registradas
            </span>
            <span className="text-lg font-black text-danger">
              -${(summary.wasteLossUsdCents / 100).toFixed(2)}
            </span>
            <span className="text-[10px] text-ink-muted block">Desperdicios y pérdidas</span>
          </div>

          <div className="p-3 bg-surface-alt rounded-xl">
            <span className="text-[10px] font-bold text-ink-muted uppercase block">
              4. Gastos de Caja
            </span>
            <span className="text-lg font-black text-danger">
              -${(summary.operatingExpensesUsdCents / 100).toFixed(2)}
            </span>
            <span className="text-[10px] text-ink-muted block">Gastos operativos</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-ink-muted italic">
          <Icon name="ShieldCheck" size={14} className="text-success shrink-0" />
          <span>
            Cada venta conserva la tasa inmutable de su día. Sin doble conteo: las compras a proveedores
            se capitalizan en inventario y solo el consumo real de recetas computa a costo.
          </span>
        </div>
      </div>

      {/* 2. Desgloses en Cuadrícula */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Ventas por Método de Pago */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black text-ink uppercase tracking-wider">
              Ventas por Método de Pago
            </h4>
            <Icon name="Wallet" size={16} className="text-ink-muted" />
          </div>
          <div className="space-y-2">
            {breakdown.byMethod.map((m: any) => (
              <div key={m.method} className="flex items-center justify-between text-xs">
                <span className="font-semibold text-ink">{m.method.replace('_', ' ')}</span>
                <div className="text-right">
                  <span className="font-black text-ink">${(m.totalUsdCents / 100).toFixed(2)}</span>
                  <span className="text-[10px] text-ink-muted ml-2 font-bold">{m.percentage}%</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Ventas por Categoría */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black text-ink uppercase tracking-wider">
              Ventas por Categoría de Carta
            </h4>
            <Icon name="Utensils" size={16} className="text-ink-muted" />
          </div>
          <div className="space-y-2">
            {breakdown.byCategory.map((c: any) => (
              <div key={c.categoryId} className="flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-ink block">{c.categoryName}</span>
                  <span className="text-[10px] text-ink-muted">{c.unitsSold} uds vendidas</span>
                </div>
                <div className="text-right">
                  <span className="font-black text-ink">${(c.totalUsdCents / 100).toFixed(2)}</span>
                  <span className="text-[10px] text-ink-muted ml-2 font-bold">{c.percentage}%</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Ranking de Productos Top */}
        <Card className="p-4 space-y-3 md:col-span-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black text-ink uppercase tracking-wider">
              Ranking de Productos Más Vendidos
            </h4>
            <Icon name="Trophy" size={16} className="text-warning" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-border text-[10px] font-black uppercase text-ink-muted">
                  <th className="py-2">#</th>
                  <th className="py-2">Producto</th>
                  <th className="py-2 text-right">Uds Vendidas</th>
                  <th className="py-2 text-right">Venta Total ($)</th>
                  <th className="py-2 text-right">Costo Receta ($)</th>
                  <th className="py-2 text-right">Margen Bruto ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {breakdown.topProducts.map((p: any, idx: number) => (
                  <tr key={p.productId} className="hover:bg-surface-alt/50 transition-colors">
                    <td className="py-2.5 font-bold text-ink-muted">{idx + 1}</td>
                    <td className="py-2.5 font-black text-ink">{p.productName}</td>
                    <td className="py-2.5 text-right font-bold text-ink">{p.unitsSold}</td>
                    <td className="py-2.5 text-right font-black text-ink">
                      ${(p.totalSalesUsdCents / 100).toFixed(2)}
                    </td>
                    <td className="py-2.5 text-right text-danger font-semibold">
                      ${(p.recipeCostUsdCents / 100).toFixed(2)}
                    </td>
                    <td className="py-2.5 text-right font-black text-success">
                      ${(p.marginUsdCents / 100).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Matriz Kasavana & Smith (Ingeniería de Menú) */}
        {breakdown.kasavanaMatrix && (
          <Card className="p-4 space-y-3 md:col-span-2 bg-surface">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-black text-ink uppercase tracking-wider">
                  Matriz Kasavana & Smith (Popularidad vs. Margen)
                </h4>
                <p className="text-[11px] text-ink-muted">
                  Clasificación de platos del menú para optimización de rentabilidad.
                </p>
              </div>
              <Badge variant="neutral" className="text-[10px] font-black uppercase">
                {breakdown.kasavanaMatrix.sampleStatus}
              </Badge>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
              <div className="p-3 bg-success/10 border border-success/30 rounded-xl">
                <span className="text-[10px] font-black text-success uppercase block">
                  Estrellas
                </span>
                <span className="text-[11px] text-ink-muted">Alta Popularidad + Alto Margen</span>
              </div>
              <div className="p-3 bg-primary/10 border border-primary/30 rounded-xl">
                <span className="text-[10px] font-black text-primary uppercase block">
                  Caballos de Batalla
                </span>
                <span className="text-[11px] text-ink-muted">Alta Popularidad + Bajo Margen</span>
              </div>
              <div className="p-3 bg-warning/10 border border-warning/30 rounded-xl">
                <span className="text-[10px] font-black text-warning uppercase block">
                  Puzzles (Rompecabezas)
                </span>
                <span className="text-[11px] text-ink-muted">Baja Popularidad + Alto Margen</span>
              </div>
              <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl">
                <span className="text-[10px] font-black text-danger uppercase block">
                  Perros
                </span>
                <span className="text-[11px] text-ink-muted">Baja Popularidad + Bajo Margen</span>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};
