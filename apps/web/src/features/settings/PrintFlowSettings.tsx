import React from 'react';
import { Card, Button } from '../../ui/index.js';
import type { BusinessSettings } from './types.js';

interface PrintFlowSettingsProps {
  settings?: BusinessSettings;
  isUniquePrinting: boolean;
  onUpdatePrintMode: (mode: 'one' | 'two') => void;
  onUpdateSettings: (payload: Record<string, any>) => void;
}

export const PrintFlowSettings: React.FC<PrintFlowSettingsProps> = ({
  settings,
  isUniquePrinting,
  onUpdatePrintMode,
  onUpdateSettings
}) => {
  const printMode = settings?.print_mode || 'one';
  const printDeliveryNote = settings?.print_delivery_note ?? 1;
  const printFlow = settings?.print_flow || 'manual';

  return (
    <Card variant="alt" className="p-4 space-y-4 border border-border">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-ink">Modo de Impresión y Flujo</h4>
          <p className="text-xs text-ink-muted">Configura si usas una o dos impresoras y el flujo de papel.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={printMode === 'one' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => onUpdatePrintMode('one')}
          >
            Una impresora (Caja)
          </Button>
          <Button
            variant={printMode === 'two' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => onUpdatePrintMode('two')}
          >
            Dos impresoras (Caja + Cocina)
          </Button>
        </div>
      </div>

      <div className="pt-2 border-t border-border/60 flex items-center justify-between">
        <div>
          <span className="text-xs font-bold text-ink block">Imprimir nota de entrega</span>
          <span className="text-[11px] text-ink-muted">Generar ticket de venta/caja al cobrar órdenes</span>
        </div>
        <Button
          variant={printDeliveryNote === 1 ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => onUpdateSettings({ print_delivery_note: printDeliveryNote === 1 ? 0 : 1 })}
        >
          {printDeliveryNote === 1 ? 'Activado' : 'Desactivado'}
        </Button>
      </div>

      {isUniquePrinting && (
        <div className="pt-2 border-t border-border/60 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-ink block">Flujo en una impresora</span>
            <span className="text-[11px] text-ink-muted">Manual por papel (espera confirmación) o Automático</span>
          </div>
          <div className="flex gap-2">
            <Button
              variant={printFlow === 'manual' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => onUpdateSettings({ print_flow: 'manual' })}
            >
              Manual por papel
            </Button>
            <Button
              variant={printFlow === 'auto' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => onUpdateSettings({ print_flow: 'auto' })}
            >
              Automático
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};
