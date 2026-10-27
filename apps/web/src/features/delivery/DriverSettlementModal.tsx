import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.js';
import { Modal, Button, Badge, Icon } from '../../ui/index.js';
import { DriverManagementTab, type DriverItem } from './DriverManagementTab.js';

interface DriverSettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TripInfo {
  deliveryId: string;
  orderId: string;
  orderNumber: number;
  customerName?: string | null;
  deliveryFeeUsdCents: number;
  cashCollectedByDriver: boolean;
  foodCashAmountUsdCents: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  createdAtMs: number;
}

interface DriverPreview {
  driverId: string;
  driverName: string;
  driverPhone: string;
  totalTrips: number;
  totalDeliveryFeesUsdCents: number;
  totalFoodCashCollectedUsdCents: number;
  netBalanceUsdCents: number;
  balanceDirection: 'DRIVER_PAYS_CASHIER' | 'CASHIER_PAYS_DRIVER' | 'BALANCED';
  pendingDeliveries: TripInfo[];
}

export const DriverSettlementModal: React.FC<DriverSettlementModalProps> = ({
  isOpen,
  onClose
}) => {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'settlement' | 'drivers'>('settlement');
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Consultar vista previa de liquidación nocturna por sede
  const { data: previewData, isLoading, refetch } = useQuery<{
    success: boolean;
    jornadaId?: string;
    preview: DriverPreview[];
    message?: string;
  }>({
    queryKey: ['deliverySettlementPreview', selectedLocation],
    queryFn: async () => {
      const url = selectedLocation
        ? `/api/delivery/settlement-preview?locationId=${selectedLocation}`
        : '/api/delivery/settlement-preview';
      const res = await fetch(url, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      if (!res.ok) return { success: false, preview: [] };
      return res.json();
    },
    enabled: isOpen,
    staleTime: 5000
  });

  // Consultar lista completa de repartidores
  const { data: driversData, refetch: refetchDrivers } = useQuery<{
    success: boolean;
    drivers: DriverItem[];
  }>({
    queryKey: ['deliveryDriversList', selectedLocation],
    queryFn: async () => {
      const url = selectedLocation
        ? `/api/delivery/drivers?all=true&locationId=${selectedLocation}`
        : '/api/delivery/drivers?all=true';
      const res = await fetch(url, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      if (!res.ok) return { success: false, drivers: [] };
      return res.json();
    },
    enabled: isOpen && activeTab === 'drivers',
    staleTime: 10000
  });

  if (!isOpen) return null;

  // Ejecutar liquidación individual de un motorizado
  const handleSettleDriver = async (driverId: string, driverName: string) => {
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/delivery/settle-driver', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          driverId,
          jornadaId: previewData?.jornadaId,
          locationId: selectedLocation || undefined
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al liquidar repartidor');
      }

      setFeedback({
        type: 'success',
        message: `Liquidación completada para ${driverName}. Asiento registrado en MOTORIZADO_FUND.`
      });

      refetch();
      queryClient.invalidateQueries({ queryKey: ['cashierOrders'] });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Error al procesar liquidación'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const previewList = previewData?.preview || [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Liquidación de Delivery por Sede"
      maxWidth="xl"
    >
      <div className="space-y-4">
        {/* Selector de Pestañas y Filtro de Sede */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('settlement')}
              className={`min-h-[44px] px-4 text-xs font-bold rounded-xl transition-all ${
                activeTab === 'settlement'
                  ? 'bg-primary text-primary-contrast shadow-sm'
                  : 'bg-surface-alt text-ink-muted hover:text-ink'
              }`}
            >
              Liquidación Pendiente ({previewList.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('drivers')}
              className={`min-h-[44px] px-4 text-xs font-bold rounded-xl transition-all ${
                activeTab === 'drivers'
                  ? 'bg-primary text-primary-contrast shadow-sm'
                  : 'bg-surface-alt text-ink-muted hover:text-ink'
              }`}
            >
              Flota de Repartidores
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-ink-muted">Sede:</span>
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="h-10 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
            >
              <option value="">Todas las Sedes</option>
              <option value="loc_alta_vista">Sede B: Alta Vista</option>
              <option value="loc_los_olivos">Sede A: Los Olivos</option>
            </select>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`p-3 rounded-xl text-xs font-bold border ${
              feedback.type === 'success'
                ? 'bg-success/10 border-success/30 text-success'
                : 'bg-danger/10 border-danger/30 text-danger'
            }`}
          >
            {feedback.message}
          </div>
        )}

        {/* Pestaña: Cuadre y Liquidación */}
        {activeTab === 'settlement' && (
          <div className="space-y-3">
            {isLoading ? (
              <div className="p-8 text-center text-xs font-bold text-ink-muted">
                Cargando entregas pendientes...
              </div>
            ) : previewList.length === 0 ? (
              <div className="p-8 text-center bg-surface-alt rounded-2xl border border-border">
                <Icon name="CheckCircle" size={28} className="mx-auto text-success mb-2" />
                <p className="text-xs font-bold text-ink">
                  Todos los repartidores de esta sede están liquidados.
                </p>
                <p className="text-[11px] text-ink-muted mt-1">
                  No hay carreras de delivery pendientes de cuadre en la jornada activa.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                {previewList.map((driver) => {
                  const feeTotal = (driver.totalDeliveryFeesUsdCents / 100).toFixed(2);
                  const cashTotal = (driver.totalFoodCashCollectedUsdCents / 100).toFixed(2);
                  const balanceTotal = (driver.netBalanceUsdCents / 100).toFixed(2);

                  return (
                    <div
                      key={driver.driverId}
                      className="p-4 rounded-2xl bg-surface border border-border shadow-xs space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-black text-sm text-ink">{driver.driverName}</div>
                          <div className="text-[11px] text-ink-muted">{driver.driverPhone} · {driver.totalTrips} viajes</div>
                        </div>
                        <Badge
                          variant={
                            driver.balanceDirection === 'DRIVER_PAYS_CASHIER'
                              ? 'warning'
                              : driver.balanceDirection === 'CASHIER_PAYS_DRIVER'
                              ? 'danger'
                              : 'success'
                          }
                          size="md"
                        >
                          {driver.balanceDirection === 'DRIVER_PAYS_CASHIER'
                            ? `Repartidor entrega $${balanceTotal}`
                            : driver.balanceDirection === 'CASHIER_PAYS_DRIVER'
                            ? `Caja paga $${balanceTotal}`
                            : 'Cuadrado $0.00'}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs p-2.5 rounded-xl bg-surface-alt">
                        <div>
                          <span className="text-ink-muted block text-[10px] uppercase font-bold">Ganancia Tarifas</span>
                          <span className="font-black text-ink">${feeTotal}</span>
                        </div>
                        <div>
                          <span className="text-ink-muted block text-[10px] uppercase font-bold">Efectivo Cobrado en Mano</span>
                          <span className="font-black text-ink">${cashTotal}</span>
                        </div>
                      </div>

                      <div className="flex justify-end pt-1">
                        <Button
                          variant="primary"
                          size="md"
                          disabled={isSubmitting}
                          onClick={() => handleSettleDriver(driver.driverId, driver.driverName)}
                        >
                          {isSubmitting ? 'Procesando...' : 'Liquidar al Repartidor'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Pestaña: Gestión de Repartidores */}
        {activeTab === 'drivers' && (
          <DriverManagementTab
            drivers={driversData?.drivers || []}
            token={token}
            onRefresh={refetchDrivers}
            onSuccess={(msg) => setFeedback({ type: 'success', message: msg })}
            onError={(msg) => setFeedback({ type: 'error', message: msg })}
          />
        )}
      </div>
    </Modal>
  );
};
