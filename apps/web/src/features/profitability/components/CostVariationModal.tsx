import React from 'react';
import { Modal, Button, Input, Icon, Badge } from '../../../ui/index.js';

export interface RecipeImpact {
  productId: string;
  productName: string;
  station: string;
  oldCostUsdCents: number;
  newCostUsdCents: number;
  costDeltaUsdCents: number;
  currentPriceUsdCents: number;
  suggestedPriceUsdCents: number;
  targetMarginBps: number;
  currentMarginBps: number;
  newMarginIfKeptBps: number;
}

interface CostVariationModalProps {
  isOpen: boolean;
  onClose: () => void;
  affectedRecipes: RecipeImpact[];
  priceAdjustments: Record<string, number>;
  onPriceChange: (productId: string, val: number) => void;
  onKeepPrices: () => void;
  onConfirmAdjustments: () => void;
  isAdjusting: boolean;
}

export const CostVariationModal: React.FC<CostVariationModalProps> = ({
  isOpen,
  onClose,
  affectedRecipes,
  priceAdjustments,
  onPriceChange,
  onKeepPrices,
  onConfirmAdjustments,
  isAdjusting
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Alerta: Variación de Costo de Insumos"
      maxWidth="lg"
    >
      <div className="space-y-4">
        <div className="p-3 rounded-xl bg-warning/10 border border-warning/30 flex items-start gap-2.5">
          <Icon name="AlertTriangle" size={20} className="text-warning shrink-0 mt-0.5" />
          <div className="text-xs text-ink space-y-1">
            <p className="font-bold">
              La compra recién ingresada altera el costo ponderado de {affectedRecipes.length} plato(s).
            </p>
            <p className="text-ink-muted">
              Revisa el impacto en los márgenes de ganancia. Los precios de venta al público NUNCA cambiarán sin tu confirmación expresa.
            </p>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto space-y-3 pr-1">
          {affectedRecipes.map((r) => {
            const oldCost = (r.oldCostUsdCents / 100).toFixed(2);
            const newCost = (r.newCostUsdCents / 100).toFixed(2);
            const currentPrice = (r.currentPriceUsdCents / 100).toFixed(2);
            const suggested = (r.suggestedPriceUsdCents / 100).toFixed(2);
            const targetMargin = (r.targetMarginBps / 100).toFixed(0);
            const newMarginIfKept = (r.newMarginIfKeptBps / 100).toFixed(0);

            const adjustedPriceUsd = (
              (priceAdjustments[r.productId] ?? r.suggestedPriceUsdCents) / 100
            ).toFixed(2);

            return (
              <div
                key={r.productId}
                className="p-3 rounded-xl bg-surface border border-border space-y-2.5"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h5 className="text-xs font-bold text-ink">{r.productName}</h5>
                    <span className="text-[10px] text-ink-muted uppercase">
                      Estación: {r.station}
                    </span>
                  </div>
                  <Badge variant={r.newMarginIfKeptBps < r.targetMarginBps ? 'danger' : 'neutral'}>
                    Margen Si Mantienes: {newMarginIfKept}% (Objetivo: {targetMargin}%)
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[11px] p-2 rounded-lg bg-surface-alt">
                  <div>
                    <span className="text-ink-muted block">Costo Anterior:</span>
                    <strong className="text-ink">${oldCost}</strong>
                  </div>
                  <div>
                    <span className="text-ink-muted block">Nuevo Costo:</span>
                    <strong className="text-danger">${newCost}</strong>
                  </div>
                  <div>
                    <span className="text-ink-muted block">Precio Actual:</span>
                    <strong className="text-ink">${currentPrice}</strong>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <div className="flex-1">
                    <label className="text-[10px] font-bold text-ink-muted uppercase block mb-1">
                      Precio Sugerido (${suggested}) / Confirmar Nuevo Precio:
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      value={adjustedPriceUsd}
                      onChange={(e) => {
                        const cents = Math.round(parseFloat(e.target.value || '0') * 100);
                        onPriceChange(r.productId, cents);
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Acciones Obligatorias F3 */}
        <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border">
          <Button
            variant="ghost"
            className="flex-1"
            type="button"
            onClick={onKeepPrices}
            disabled={isAdjusting}
          >
            Mantener Precios de Venta
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            type="button"
            loading={isAdjusting}
            onClick={onConfirmAdjustments}
          >
            Ajustar Precios de Venta
          </Button>
        </div>
      </div>
    </Modal>
  );
};
