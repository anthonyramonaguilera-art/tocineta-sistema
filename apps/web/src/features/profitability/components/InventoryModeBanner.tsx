import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Icon, InfoCallout } from '../../../ui/index.js';
import { apiFetch } from '../../../api/client.js';

interface BusinessSettingsResponse {
  success?: boolean;
  settings?: {
    inventory_operation_mode?: string;
    inventoryOperationMode?: string;
  };
}

/**
 * Aviso de gobernanza: en modo 'free' las ventas no descuentan insumos
 * ni calculan costo de ventas real. Reutiliza la consulta de ajustes
 * que ya alimenta AppLayout/AppSidebar, sin endpoint nuevo.
 */
export const InventoryModeBanner: React.FC = () => {
  const { data } = useQuery<BusinessSettingsResponse>({
    queryKey: ['businessSettings'],
    queryFn: async () => {
      const res = await apiFetch('/api/business-settings');
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 60000
  });

  const inventoryMode =
    data?.settings?.inventory_operation_mode || data?.settings?.inventoryOperationMode;

  if (inventoryMode !== 'free') return null;

  const goToSettings = () => {
    window.location.hash = '#settings';
  };

  return (
    <InfoCallout
      variant="warning"
      title="Inventario en modo libre"
      description="El inventario está en modo libre: las ventas NO descuentan insumos ni calculan costo de ventas real."
      dismissible={false}
    >
      <div className="mt-3">
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={goToSettings}
          className="min-h-[48px] text-xs font-bold"
          leftIcon={<Icon name="Settings" size={16} />}
        >
          Ir a Ajustes para activar el control
        </Button>
      </div>
    </InfoCallout>
  );
};

export default InventoryModeBanner;
