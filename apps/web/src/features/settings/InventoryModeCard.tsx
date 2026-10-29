import React from 'react';
import { Card, Icon } from '../../ui/index.js';

interface InventoryModeCardProps {
  inventoryMode: string;
  onChangeMode: (mode: string) => void;
  trackingSinceMs?: number | null;
}

export const InventoryModeCard: React.FC<InventoryModeCardProps> = ({
  inventoryMode,
  onChangeMode,
  trackingSinceMs
}) => {
  return (
    <Card variant="surface" className="p-5 border border-border space-y-4">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <Icon name="Package" size={18} className="text-primary" />
        <h3 className="font-extrabold text-sm text-ink uppercase tracking-wide">
          Modo de Operación de Inventario
        </h3>
      </div>

      <p className="text-xs text-ink-muted">
        Elige cómo opera el sistema al facturar pedidos en caja o cocina.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Opción 1: Facturación Libre */}
        <div
          onClick={() => onChangeMode('free')}
          className={`cursor-pointer p-4 rounded-2xl border transition-all flex flex-col justify-between ${
            inventoryMode === 'free'
              ? 'border-primary bg-primary/5 shadow-xs'
              : 'border-border bg-surface hover:border-primary/50'
          }`}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-xl ${inventoryMode === 'free' ? 'bg-primary text-surface font-black' : 'bg-surface-alt text-ink'}`}>
                  <Icon name="Package" size={18} />
                </div>
                <span className="font-black text-xs text-ink uppercase tracking-tight">
                  Facturación Libre
                </span>
              </div>
              {inventoryMode === 'free' && (
                <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-extrabold">
                  ACTIVO
                </span>
              )}
            </div>
            <p className="text-[11px] text-ink-muted leading-relaxed">
              Sin control de stock ni recetas obligatorias. Vende de forma rápida y flexible sin bloqueos ni requerimiento de insumos configurados.
            </p>
          </div>
        </div>

        {/* Opción 2: Control de Inventario y Recetas */}
        <div
          onClick={() => onChangeMode('tracked')}
          className={`cursor-pointer p-4 rounded-2xl border transition-all flex flex-col justify-between ${
            inventoryMode === 'tracked'
              ? 'border-primary bg-primary/5 shadow-xs'
              : 'border-border bg-surface hover:border-primary/50'
          }`}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-xl ${inventoryMode === 'tracked' ? 'bg-primary text-surface font-black' : 'bg-surface-alt text-ink'}`}>
                  <Icon name="Boxes" size={18} />
                </div>
                <span className="font-black text-xs text-ink uppercase tracking-tight">
                  Control de Inventario y Recetas
                </span>
              </div>
              {inventoryMode === 'tracked' && (
                <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-extrabold">
                  ACTIVO
                </span>
              )}
            </div>
            <p className="text-[11px] text-ink-muted leading-relaxed">
              Control estricto de almacén, recetas por producto, deducción automática al cobrar o autorizar, y cálculo de CMV y márgenes reales.
            </p>
            {inventoryMode === 'tracked' && trackingSinceMs && (
              <div className="text-[10px] text-ink-muted font-mono pt-1">
                Monitoreo activo desde: {new Date(trackingSinceMs).toLocaleString()}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};
