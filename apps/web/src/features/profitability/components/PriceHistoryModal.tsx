import React from 'react';
import { Modal, Button, Icon } from '../../../ui/index.js';

interface PriceHistoryEntry {
  id: string;
  product_id: string;
  product_name?: string;
  old_price_usd_cents: number;
  new_price_usd_cents: number;
  reason: string;
  changed_by?: string;
  changed_at_ms: number;
}

interface PriceHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: PriceHistoryEntry[];
}

export const PriceHistoryModal: React.FC<PriceHistoryModalProps> = ({
  isOpen,
  onClose,
  history
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Historial Inmutable de Cambios de Precio" maxWidth="lg">
      <div className="space-y-3">
        <p className="text-xs text-ink-muted">
          Registro de auditoría. Ningún precio de venta cambia sin confirmación previa del administrador.
        </p>

        {history.length === 0 ? (
          <div className="text-center py-8 text-xs font-bold text-ink-muted">
            No hay modificaciones de precios registradas.
          </div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto space-y-2 pr-1">
            {history.map((h) => {
              const oldPrice = (h.old_price_usd_cents / 100).toFixed(2);
              const newPrice = (h.new_price_usd_cents / 100).toFixed(2);
              const dateStr = new Date(h.changed_at_ms).toLocaleString('es-VE');

              return (
                <div
                  key={h.id}
                  className="p-3 rounded-xl bg-surface border border-border flex items-center justify-between text-xs"
                >
                  <div className="space-y-0.5">
                    <span className="font-bold text-ink block">{h.product_name || h.product_id}</span>
                    <span className="text-[10px] text-ink-muted block">{dateStr} · Por: {h.changed_by || 'Admin'}</span>
                    <span className="text-[11px] text-ink-muted block italic">{h.reason}</span>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 font-mono">
                      <span className="text-ink-muted line-through">${oldPrice}</span>
                      <Icon name="ArrowRight" size={14} className="text-primary" />
                      <strong className="text-primary">${newPrice}</strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="pt-2">
          <Button variant="ghost" fullWidth onClick={onClose}>
            Cerrar Historial
          </Button>
        </div>
      </div>
    </Modal>
  );
};
