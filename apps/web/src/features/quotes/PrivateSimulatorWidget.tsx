import React from 'react';
import { Badge, Money, Icon } from '../../ui/index.js';

interface PrivateSimulatorWidgetProps {
  subtotalFoodCents: number;
  itemCount: number;
  discountPercent: number;
  onDiscountChange: (val: number) => void;
  extrasTotalCents: number;
  totalPriceCents: number;
  approxFoodCostCents: number;
  extrasCostCents: number;
  totalCostCents: number;
  estimatedProfitCents: number;
  marginPercent: number;
}

export const PrivateSimulatorWidget: React.FC<PrivateSimulatorWidgetProps> = ({
  subtotalFoodCents,
  itemCount,
  discountPercent,
  onDiscountChange,
  extrasTotalCents,
  totalPriceCents,
  approxFoodCostCents,
  extrasCostCents,
  totalCostCents,
  estimatedProfitCents,
  marginPercent
}) => {
  return (
    <div className="bg-gradient-to-b from-surface to-surface-alt p-4 rounded-2xl border-2 border-primary/30 shadow-md space-y-3">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center gap-1.5">
          <Icon name="Lock" size={14} className="text-primary" />
          <h4 className="text-xs font-black text-ink uppercase tracking-wider">Simulador Privado de Utilidad</h4>
        </div>
        <Badge variant="primary">{marginPercent}% Margen</Badge>
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex justify-between text-ink-muted">
          <span>Subtotal Alimentos ({itemCount} platos):</span>
          <span className="font-bold text-ink"><Money cents={subtotalFoodCents} /></span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-ink-muted">Descuento Volumen:</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="0"
              max="50"
              value={discountPercent}
              onChange={(e) => onDiscountChange(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-14 rounded-lg border border-border bg-surface px-1.5 py-0.5 text-center text-xs font-bold text-ink"
            />
            <span className="font-bold text-danger">-%</span>
          </div>
        </div>

        <div className="flex justify-between text-ink-muted">
          <span>Costos Extras Cobrados:</span>
          <span className="font-bold text-ink"><Money cents={extrasTotalCents} /></span>
        </div>

        <div className="pt-2 border-t border-border flex justify-between font-black text-sm text-ink">
          <span>PRECIO VENTA AL CLIENTE:</span>
          <span className="text-primary"><Money cents={totalPriceCents} /></span>
        </div>

        {/* Costos Internos Privados */}
        <div className="pt-2 border-t border-dashed border-border space-y-1 text-[11px] text-ink-muted">
          <div className="flex justify-between">
            <span>Costo Insumos Estimado:</span>
            <span><Money cents={approxFoodCostCents} /></span>
          </div>
          <div className="flex justify-between">
            <span>Costo Extras / Personal:</span>
            <span><Money cents={extrasCostCents} /></span>
          </div>
          <div className="flex justify-between font-bold text-ink">
            <span>Costo Total Estimado:</span>
            <span className="text-danger"><Money cents={totalCostCents} /></span>
          </div>
        </div>

        {/* Ganancia Neta */}
        <div className="p-3 rounded-xl bg-success/10 border border-success/30 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-black text-success uppercase tracking-wider block">Utilidad Neta Estimada</span>
            <span className="text-lg font-black text-success"><Money cents={estimatedProfitCents} /></span>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-ink-muted block">Retorno</span>
            <span className="text-xs font-black text-ink">{marginPercent}%</span>
          </div>
        </div>
      </div>

      <div className="text-[10px] text-ink-muted italic">
        * Este simulador de costos y utilidad es estrictamente confidencial. El cliente recibirá solo el precio de venta final.
      </div>
    </div>
  );
};
