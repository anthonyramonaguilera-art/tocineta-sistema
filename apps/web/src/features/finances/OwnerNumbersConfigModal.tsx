import React, { useState } from 'react';
import { Modal, Button, Icon } from '../../ui/index.js';

interface MetricOption {
  key: string;
  label: string;
  description: string;
}

const AVAILABLE_METRICS: MetricOption[] = [
  { key: 'sales_today', label: 'Ventas de Hoy', description: 'Total facturado en comida neta hoy' },
  { key: 'profit_today', label: 'Utilidad Estimada Hoy', description: 'Ventas − Costo recetas − Mermas − Gastos' },
  { key: 'cash_today', label: 'Efectivo en Caja Hoy', description: 'Efectivo USD y Bs neto cobrado hoy' },
  { key: 'receivable_total', label: 'Total por Cobrar', description: 'Saldo pendiente de clientes a crédito' },
  { key: 'payable_total', label: 'Total por Pagar', description: 'Saldo pendiente a proveedores' },
  { key: 'avg_ticket_today', label: 'Ticket Promedio Hoy', description: 'Venta promedio por pedido hoy' },
  { key: 'orders_today', label: 'Órdenes de Hoy', description: 'Cantidad total de pedidos atendidos hoy' },
  { key: 'waste_today', label: 'Mermas de Hoy', description: 'Pérdidas registradas por merma hoy' },
  { key: 'expenses_today', label: 'Gastos de Hoy', description: 'Gastos operativos pagados hoy' }
];

interface OwnerNumbersConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentKeys: string[];
  onSave: (keys: string[]) => Promise<void>;
}

export const OwnerNumbersConfigModal: React.FC<OwnerNumbersConfigModalProps> = ({
  isOpen,
  onClose,
  currentKeys,
  onSave
}) => {
  const [selectedKeys, setSelectedKeys] = useState<string[]>(currentKeys);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const toggleMetric = (key: string) => {
    setErrorMsg(null);
    if (selectedKeys.includes(key)) {
      if (selectedKeys.length <= 1) {
        setErrorMsg('Debe mantener al menos una métrica seleccionada');
        return;
      }
      setSelectedKeys(selectedKeys.filter(k => k !== key));
    } else {
      if (selectedKeys.length >= 5) {
        setErrorMsg('Puede seleccionar un máximo de 5 números para el panel');
        return;
      }
      setSelectedKeys([...selectedKeys, key]);
    }
  };

  const handleSave = async () => {
    if (selectedKeys.length !== 5) {
      setErrorMsg('Debe seleccionar exactamente 5 números para la pantalla principal');
      return;
    }
    setIsSaving(true);
    setErrorMsg(null);
    try {
      await onSave(selectedKeys);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al guardar la configuración');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Configurar 5 Números de la Dueña"
      maxWidth="md"
    >
      <div className="space-y-4">
        <p className="text-xs text-ink-muted">
          Seleccione exactamente 5 métricas que desea ver destacadas en la parte superior del módulo de finanzas:
        </p>

        {errorMsg && (
          <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl flex items-center gap-2 text-danger text-xs font-semibold">
            <Icon name="AlertCircle" size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 max-h-[50vh] overflow-y-auto pr-1">
          {AVAILABLE_METRICS.map((m) => {
            const isSelected = selectedKeys.includes(m.key);
            const badgeIndex = isSelected ? selectedKeys.indexOf(m.key) + 1 : null;

            return (
              <button
                key={m.key}
                type="button"
                onClick={() => toggleMetric(m.key)}
                className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all min-h-[52px] ${
                  isSelected
                    ? 'border-primary bg-primary/10 text-ink shadow-xs'
                    : 'border-border bg-surface hover:bg-surface-alt text-ink'
                }`}
              >
                <div className="flex-1 pr-3">
                  <div className="font-bold text-xs uppercase tracking-tight">{m.label}</div>
                  <div className="text-[11px] text-ink-muted">{m.description}</div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {isSelected ? (
                    <span className="w-7 h-7 rounded-full bg-primary text-primary-contrast flex items-center justify-center font-black text-xs">
                      {badgeIndex}
                    </span>
                  ) : (
                    <span className="w-7 h-7 rounded-full border border-border flex items-center justify-center text-ink-muted">
                      <Icon name="Plus" size={14} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="pt-2 border-t border-border flex items-center justify-between">
          <span className="text-xs font-bold text-ink-muted">
            Seleccionadas: {selectedKeys.length} / 5
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={isSaving}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={isSaving}
              disabled={selectedKeys.length !== 5 || isSaving}
            >
              Guardar Selección
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
