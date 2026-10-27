import React from 'react';
import { Badge, Button, Icon } from '../../../ui/index.js';

interface TransferInTransitTabProps {
  inTransitList: any[];
  onReceive: (transferId: string) => void;
}

export const TransferInTransitTab: React.FC<TransferInTransitTabProps> = ({
  inTransitList,
  onReceive
}) => {
  if (inTransitList.length === 0) {
    return (
      <div className="p-8 text-center bg-surface-alt rounded-2xl border border-border text-xs text-ink-muted">
        <Icon name="Truck" size={28} className="mx-auto text-ink-muted mb-2 opacity-50" />
        No hay envíos en tránsito pendientes de recepción.
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
      {inTransitList.map(trf => (
        <div
          key={trf.id}
          className="p-4 rounded-2xl bg-surface border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
        >
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="warning" size="md">{trf.dispatch_note_code}</Badge>
              <span className="font-bold text-xs text-ink flex items-center gap-1">
                <span>{trf.from_location_id}</span>
                <Icon name="ArrowRight" size={12} className="text-ink-muted" />
                <span>{trf.to_location_id}</span>
              </span>
            </div>
            <p className="text-xs text-ink-muted mt-1">
              {trf.items?.length || 0} insumos despachados · Nota: {trf.notes || 'Sin nota'}
            </p>
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={() => onReceive(trf.id)}
          >
            Confirmar Recepción
          </Button>
        </div>
      ))}
    </div>
  );
};
