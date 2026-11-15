import React from 'react';
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
      {/* 1. Tarjeta Principal de Estado de Resultados (P&L) en Orden Estándar */}
      <div className="p-6 bg-surface rounded-3xl border border-border shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black text-ink-muted uppercase tracking-wider block">
              Estado de Resultados (P&L)
            </span>
            <h3 className="text-lg font-black text-ink tracking-tight">
              Rentabilidad Operativa del Período
            </h3>
          </div>

          <div className="p-3 bg-surface-alt rounded-2xl border border-border flex items-center gap-4 text-xs font-semibold self-start sm:self-auto">
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

        {/* Cascada en orden: 1) Ventas netas, 2) Costo de ventas, 3) Mermas, 4) Gastos operativos, 5) Utilidad neta real */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2">
          {/* 1. Ventas netas */}
          <div className="p-4 bg-surface-alt rounded-2xl border border-border flex flex-col justify-between space-y-2">
            <div>
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-[10px] font-black text-ink-muted uppercase tracking-wider">
                  1. Ventas Netas
                </span>
                <Icon name="TrendingUp" size={14} className="text-success" />
              </div>
              <div className="text-2xl font-black text-ink">
                ${(summary.netFoodSalesUsdCents / 100).toFixed(2)}
              </div>
            </div>
            <span className="text-[11px] text-ink-muted block">
              Comida facturada
            </span>
          </div>

          {/* 2. Costo de ventas */}
          <div className="p-4 bg-surface-alt rounded-2xl border border-border flex flex-col justify-between space-y-2">
            <div>
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-[10px] font-black text-ink-muted uppercase tracking-wider">
                  2. Costo de Ventas
                </span>
                <Icon name="ChefHat" size={14} className="text-ink-muted" />
              </div>
              {summary.cogsConfigured === false ? (
                <div className="p-2 bg-warning/10 border border-warning/30 rounded-xl my-1">
                  <div className="flex items-start gap-1.5 text-warning text-xs font-bold leading-snug">
                    <Icon name="AlertTriangle" size={14} className="shrink-0 mt-0.5" />
                    <span>Faltan recetas: el costo de ventas no es confiable</span>
                  </div>
                </div>
              ) : (
                <div className="text-2xl font-black text-danger">
                  -${(summary.costOfGoodsSoldUsdCents / 100).toFixed(2)}
                </div>
              )}
            </div>
            <span className="text-[11px] text-ink-muted block">
              {summary.cogsConfigured === false
                ? 'Insumos por recetas vendidas'
                : `Insumos consumidos (${summary.foodCostPercentage}% food cost)`}
            </span>
          </div>

          {/* 3. Mermas de inventario */}
          <div className="p-4 bg-surface-alt rounded-2xl border border-border flex flex-col justify-between space-y-2">
            <div>
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-[10px] font-black text-ink-muted uppercase tracking-wider">
                  3. Mermas de Inventario
                </span>
                <Icon name="Trash2" size={14} className="text-danger" />
              </div>
              <div className="text-2xl font-black text-danger">
                -${(summary.wasteLossUsdCents / 100).toFixed(2)}
              </div>
            </div>
            <span className="text-[11px] text-ink-muted block">
              Desperdicios y pérdidas
            </span>
          </div>

          {/* 4. Gastos operativos */}
          <div className="p-4 bg-surface-alt rounded-2xl border border-border flex flex-col justify-between space-y-2">
            <div>
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-[10px] font-black text-ink-muted uppercase tracking-wider">
                  4. Gastos Operativos
                </span>
                <Icon name="Receipt" size={14} className="text-danger" />
              </div>
              <div className="text-2xl font-black text-danger">
                -${(summary.operatingExpensesUsdCents / 100).toFixed(2)}
              </div>
            </div>
            <span className="text-[11px] text-ink-muted block">
              Gastos de operación de caja
            </span>
          </div>

          {/* 5. Utilidad neta real */}
          <div className="p-4 bg-surface-alt rounded-2xl border border-border flex flex-col justify-between space-y-2">
            <div>
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-[10px] font-black text-ink-muted uppercase tracking-wider">
                  5. Utilidad Neta Real
                </span>
                <Icon
                  name={summary.netProfitUsdCents < 0 ? 'TrendingDown' : 'CircleDollarSign'}
                  size={14}
                  className={summary.netProfitUsdCents < 0 ? 'text-danger' : 'text-success'}
                />
              </div>
              <div
                className={`text-2xl font-black tracking-tight ${
                  summary.netProfitUsdCents < 0 ? 'text-danger' : 'text-ink'
                }`}
              >
                {summary.netProfitUsdCents < 0 ? '-' : ''}$
                {(Math.abs(summary.netProfitUsdCents) / 100).toFixed(2)}
              </div>
            </div>
            <span
              className={`text-[11px] font-bold block ${
                summary.netProfitMarginPercentage < 0 || summary.netProfitUsdCents < 0
                  ? 'text-danger'
                  : 'text-success'
              }`}
            >
              Margen Neto: {summary.netProfitMarginPercentage}%
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-border text-[11px] text-ink-muted italic">
          <Icon name="ShieldCheck" size={14} className="text-success shrink-0" />
          <span>
            Cada venta conserva la tasa inmutable de su día. Sin doble conteo: las compras a proveedores
            se capitalizan en inventario y solo el consumo real de recetas computa a costo.
          </span>
        </div>
      </div>

      {/* 2. Bloque Aparte: Compras de Inventario del Período (No se resta de la utilidad) */}
      <div className="p-6 bg-surface rounded-3xl border border-border shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-3 bg-surface-alt rounded-2xl border border-border text-ink">
              <Icon name="ShoppingCart" size={22} />
            </div>
            <div>
              <span className="text-[10px] font-black text-ink-muted uppercase tracking-wider block">
                Movimientos de Abastecimiento
              </span>
              <h4 className="text-base font-black text-ink">
                Compras de inventario del período
              </h4>
              <p className="text-xs text-ink-muted">
                Total de compras registradas a proveedores en el rango seleccionado
              </p>
            </div>
          </div>

          <div className="text-left sm:text-right">
            <span className="text-3xl font-black text-ink block">
              ${((summary.purchasesUsdCents || 0) / 100).toFixed(2)}
            </span>
            <span className="text-[10px] font-bold text-ink-muted uppercase">
              Total facturado en compras
            </span>
          </div>
        </div>

        <div className="p-3.5 bg-surface-alt rounded-2xl border border-border flex items-start gap-3 text-xs">
          <Icon name="Info" size={16} className="text-primary shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-black text-ink block">
              Nota: no se resta de la utilidad
            </span>
            <p className="text-[11px] text-ink-muted leading-relaxed">
              Las compras de inventario capitalizan el almacén y no son un gasto directo del período.
              La utilidad operativa real únicamente descuenta el consumo real de insumos por las recetas
              efectivamente vendidas (Costo de Ventas / COGS).
            </p>
          </div>
        </div>
      </div>

      {/* 3. Desgloses en Cuadrícula */}
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

        {/* Ranking de Productos Top (con contenedor de scroll propio para no desbordar en móvil) */}
        <Card className="p-4 space-y-3 md:col-span-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black text-ink uppercase tracking-wider">
              Ranking de Productos Más Vendidos
            </h4>
            <Icon name="Trophy" size={16} className="text-warning" />
          </div>
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[540px] text-xs text-left">
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
