import React, { useState, useEffect } from 'react';
import { Modal } from '../../ui/Modal.js';
import { Button } from '../../ui/Button.js';
import { Icon, type IconName } from '../../ui/Icon.js';
import type { StaffUser } from './types.js';

interface PermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffUser: StaffUser | null;
  onSave: (userId: string, permissions: string[]) => Promise<void>;
}

const AVAILABLE_PERMISSIONS: Array<{ key: string; label: string; iconName: IconName; desc: string }> = [
  {
    key: 'CASHIER_PAY',
    label: 'Cobrar en Caja',
    iconName: 'CreditCard',
    desc: 'Permite registrar pagos, dar vuelto y cerrar cuentas'
  },
  {
    key: 'VOID_OR_REFUND',
    label: 'Anular Órdenes',
    iconName: 'RotateCcw',
    desc: 'Permite anular pedidos o solicitar reembolsos'
  },
  {
    key: 'EDIT_MENU',
    label: 'Editar Carta y Precios',
    iconName: 'BookOpen',
    desc: 'Permite modificar disponibilidad y precios de productos'
  },
  {
    key: 'VIEW_COSTS',
    label: 'Ver Costos de Insumos',
    iconName: 'Coins',
    desc: 'Permite ver costos unitarios y desglose de recetas'
  },
  {
    key: 'VIEW_PROFITABILITY',
    label: 'Ver Ganancias y Utilidad',
    iconName: 'TrendingUp',
    desc: 'Permite ver márgenes comerciales y estado de resultados'
  },
  {
    key: 'POS_TAKE_ORDERS',
    label: 'Tomar Pedidos (POS)',
    iconName: 'Utensils',
    desc: 'Permite abrir órdenes y despachar a cocina'
  }
];

export const PermissionsModal: React.FC<PermissionsModalProps> = ({
  isOpen,
  onClose,
  staffUser,
  onSave
}) => {
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (staffUser) {
      setSelectedPerms(staffUser.permissions || []);
    }
  }, [staffUser]);

  if (!staffUser) return null;

  const togglePermission = (permKey: string) => {
    if (selectedPerms.includes(permKey)) {
      setSelectedPerms(selectedPerms.filter((p) => p !== permKey));
    } else {
      setSelectedPerms([...selectedPerms, permKey]);
    }
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await onSave(staffUser.id, selectedPerms);
      onClose();
    } catch {
      // Manejado en padre
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Permisos: ${staffUser.name}`}
      description="Configura los accesos granulares individuales para este trabajador"
      maxWidth="md"
    >
      <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        {AVAILABLE_PERMISSIONS.map((p) => {
          const isChecked = selectedPerms.includes(p.key);
          return (
            <div
              key={p.key}
              onClick={() => togglePermission(p.key)}
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer select-none ${
                isChecked
                  ? 'bg-primary/5 border-primary text-ink shadow-sm'
                  : 'bg-surface border-border text-ink-muted hover:bg-surface-alt'
              }`}
            >
              <div
                className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border ${
                  isChecked
                    ? 'bg-primary border-primary text-primary-ink'
                    : 'bg-surface border-border'
                }`}
              >
                {isChecked && <Icon name="Check" size={14} className="stroke-[3]" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Icon name={p.iconName} size={16} className={isChecked ? 'text-primary' : 'text-ink-muted'} />
                  <span className="font-bold text-sm text-ink">{p.label}</span>
                </div>
                <p className="text-xs text-ink-muted mt-0.5">{p.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 justify-end pt-4 border-t border-border mt-4">
        <Button variant="secondary" onClick={onClose} disabled={isSaving}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={handleSave} loading={isSaving}>
          Guardar Permisos
        </Button>
      </div>
    </Modal>
  );
};
