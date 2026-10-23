import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.js';
import { Truck } from 'lucide-react';

interface DriverSettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TripInfo {
  orderId: string;
  orderNumber: number;
  deliveryFeeCents: number;
  foodCashCents: number;
  status: string;
  address: string;
}

interface DriverPreview {
  driverId: string;
  driverName: string;
  driverPhone: string;
  tripsCount: number;
  totalDeliveryFeesEarnedCents: number;
  totalFoodCashCollectedCents: number;
  netBalanceUsdCents: number;
  actionRequired: 'DRIVER_PAYS_CASHIER' | 'CASHIER_PAYS_DRIVER' | 'SETTLED_ZERO';
  trips: TripInfo[];
}

export const DriverSettlementModal: React.FC<DriverSettlementModalProps> = ({
  isOpen,
  onClose
}) => {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'settlement' | 'drivers'>('settlement');
  const [newDriverName, setNewDriverName] = useState<string>('');
  const [newDriverPhone, setNewDriverPhone] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Consultar vista previa de liquidación nocturna
  const { data: previewData, isLoading, refetch } = useQuery<{
    success: boolean;
    jornadaId?: string;
    preview: DriverPreview[];
    message?: string;
  }>({
    queryKey: ['deliverySettlementPreview'],
    queryFn: async () => {
      const res = await fetch('/api/delivery/settlement-preview', {
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
    drivers: Array<{ id: string; name: string; phone: string; isActive: boolean }>;
  }>({
    queryKey: ['deliveryDriversList'],
    queryFn: async () => {
      const res = await fetch('/api/delivery/drivers?all=true', {
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
          jornadaId: previewData?.jornadaId
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al liquidar repartidor');
      }

      setFeedback({
        type: 'success',
        message: `✓ Liquidación completada para ${driverName}. Asiento registrado en MOTORIZADO_FUND.`
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

  // Registrar nuevo motorizado
  const handleCreateDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDriverName.trim() || !newDriverPhone.trim()) return;

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/delivery/drivers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          name: newDriverName.trim(),
          phone: newDriverPhone.trim()
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'No se pudo registrar el motorizado');
      }

      setFeedback({
        type: 'success',
        message: `✓ Repartidor "${newDriverName}" registrado con éxito`
      });
      setNewDriverName('');
      setNewDriverPhone('');
      refetchDrivers();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Error al registrar repartidor'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const previewList = previewData?.preview || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in">
      <div className="bg-tocineta-card border border-tocineta-border rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Cabecera */}
        <div className="p-5 border-b border-tocineta-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Truck className="w-8 h-8 text-amber-400" />
            <div>
              <h3 className="font-black text-base text-white">
                Liquidación de Motorizados y Cuadre de Flota
              </h3>
              <p className="text-xs text-tocineta-muted">
                Cuadre nocturno de tarifas y efectivo cobrado en mano antes del Cierre Z
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-tocineta-bg text-tocineta-muted hover:text-white flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        {/* Pestañas de Navegación */}
        <div className="flex border-b border-tocineta-border bg-tocineta-bg px-5 pt-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('settlement')}
            className={`min-h-[40px] px-4 text-xs font-bold rounded-t-xl transition-all ${
              activeTab === 'settlement'
                ? 'bg-tocineta-card text-tocineta-yellow border-t-2 border-tocineta-yellow'
                : 'text-tocineta-muted hover:text-white'
            }`}
          >
            Liquidación de Turno ({previewList.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('drivers')}
            className={`min-h-[40px] px-4 text-xs font-bold rounded-t-xl transition-all ${
              activeTab === 'drivers'
                ? 'bg-tocineta-card text-tocineta-yellow border-t-2 border-tocineta-yellow'
                : 'text-tocineta-muted hover:text-white'
            }`}
          >
            Gestionar Repartidores
          </button>
        </div>

        {/* Notificación de Estado */}
        {feedback && (
          <div className={`mx-5 mt-4 p-3 rounded-2xl text-xs font-bold flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
              : 'bg-red-500/15 border border-red-500/40 text-red-300'
          }`}>
            <span>{feedback.message}</span>
            <button onClick={() => setFeedback(null)} className="font-bold px-2">✕</button>
          </div>
        )}

        {/* CUERPO DEL MODAL (SCROLLABLE) */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          
          {activeTab === 'settlement' && (
            <>
              {isLoading ? (
                <div className="py-12 text-center text-tocineta-yellow">
                  <span className="text-2xl animate-spin inline-block">⏳</span>
                  <p className="text-xs font-bold mt-2">Cargando viajes y tarifas de la jornada...</p>
                </div>
              ) : previewList.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <span className="text-4xl block opacity-40">🛵</span>
                  <h4 className="text-sm font-bold text-white">No hay entregas pendientes de liquidar</h4>
                  <p className="text-xs text-tocineta-muted max-w-sm mx-auto">
                    Todos los viajes de delivery de esta jornada han sido liquidados o no se asignaron motorizados aún.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {previewList.map(driver => {
                    const feesUsd = (driver.totalDeliveryFeesEarnedCents / 100).toFixed(2);
                    const foodCashUsd = (driver.totalFoodCashCollectedCents / 100).toFixed(2);
                    const netBalanceUsd = (Math.abs(driver.netBalanceUsdCents) / 100).toFixed(2);

                    return (
                      <div
                        key={driver.driverId}
                        className="bg-tocineta-bg border border-tocineta-border rounded-2xl p-4 space-y-3 shadow-md"
                      >
                        {/* Cabecera del Motorizado */}
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="font-black text-sm text-white block">
                              {driver.driverName}
                            </span>
                            <span className="text-xs text-tocineta-muted font-mono">
                              📞 {driver.driverPhone} • {driver.tripsCount} viaje(s) completado(s)
                            </span>
                          </div>

                          {/* Badge de Saldo Neto */}
                          <div className="text-right">
                            {driver.actionRequired === 'DRIVER_PAYS_CASHIER' ? (
                              <span className="inline-block px-3 py-1 rounded-xl text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                Repartidor entrega: ${netBalanceUsd}
                              </span>
                            ) : driver.actionRequired === 'CASHIER_PAYS_DRIVER' ? (
                              <span className="inline-block px-3 py-1 rounded-xl text-xs font-black bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                Caja paga a motorizado: ${netBalanceUsd}
                              </span>
                            ) : (
                              <span className="inline-block px-3 py-1 rounded-xl text-xs font-black bg-blue-500/20 text-blue-300 border border-blue-500/40">
                                Cuadrado: $0.00
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Desglose de Fondos */}
                        <div className="grid grid-cols-2 gap-2 text-xs bg-tocineta-card p-3 rounded-xl border border-tocineta-border">
                          <div>
                            <span className="text-[10px] text-tocineta-muted uppercase tracking-wider block">
                              Tarifas Ganadas (Delivery):
                            </span>
                            <span className="font-mono font-bold text-tocineta-yellow">
                              +${feesUsd}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-tocineta-muted uppercase tracking-wider block">
                              Efectivo Comida en Mano:
                            </span>
                            <span className="font-mono font-bold text-white">
                              ${foodCashUsd}
                            </span>
                          </div>
                        </div>

                        {/* Lista de viajes del turno */}
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-tocineta-muted block">
                            Detalle de Viajes:
                          </span>
                          <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                            {driver.trips.map((t, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between text-[11px] p-1.5 rounded-lg bg-tocineta-card/50"
                              >
                                <span>Orden #{t.orderNumber} - {t.address || 'Delivery'}</span>
                                <div className="space-y-0.5 text-right font-mono">
                                  <span className="text-tocineta-yellow font-bold mr-2">
                                    +${(t.deliveryFeeCents / 100).toFixed(2)}
                                  </span>
                                  {t.foodCashCents > 0 && (
                                    <span className="text-amber-300 text-[10px]">
                                      (Efectivo: ${(t.foodCashCents / 100).toFixed(2)})
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Botón de Acción */}
                        <div className="pt-2 border-t border-tocineta-border flex justify-end">
                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => handleSettleDriver(driver.driverId, driver.driverName)}
                            className="min-h-[44px] px-5 rounded-xl bg-tocineta-yellow text-tocineta-bg font-black text-xs hover:bg-tocineta-yellow-hover active:scale-95 transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
                          >
                            <span>✓ Liquidar Repartidor</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {activeTab === 'drivers' && (
            <div className="space-y-5">
              {/* Formulario para Agregar Nuevo Motorizado */}
              <form onSubmit={handleCreateDriver} className="p-4 bg-tocineta-bg border border-tocineta-border rounded-2xl space-y-3">
                <h4 className="font-black text-xs text-white uppercase tracking-wider">
                  + Registrar Nuevo Repartidor Habitual
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Nombre completo (ej: Juan Gómez)"
                    value={newDriverName}
                    onChange={e => setNewDriverName(e.target.value)}
                    required
                    className="min-h-[44px] bg-tocineta-card border border-tocineta-border rounded-xl px-3 text-xs text-white outline-none focus:border-tocineta-yellow"
                  />
                  <input
                    type="text"
                    placeholder="Teléfono móvil (ej: 0414-1234567)"
                    value={newDriverPhone}
                    onChange={e => setNewDriverPhone(e.target.value)}
                    required
                    className="min-h-[44px] bg-tocineta-card border border-tocineta-border rounded-xl px-3 text-xs text-white outline-none focus:border-tocineta-yellow"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmitting || !newDriverName.trim() || !newDriverPhone.trim()}
                    className="min-h-[42px] px-5 rounded-xl bg-tocineta-yellow text-tocineta-bg font-bold text-xs hover:bg-tocineta-yellow-hover transition-all disabled:opacity-50"
                  >
                    Guardar Repartidor
                  </button>
                </div>
              </form>

              {/* Lista de Motorizados Registrados */}
              <div className="space-y-2">
                <h4 className="font-black text-xs text-white uppercase tracking-wider">
                  Flota de Repartidores Registrados
                </h4>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {(driversData?.drivers || []).map(d => (
                    <div
                      key={d.id}
                      className="p-3 bg-tocineta-bg border border-tocineta-border rounded-xl flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-bold text-white block">{d.name}</span>
                        <span className="text-tocineta-muted font-mono text-[11px]">{d.phone}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        d.isActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                      }`}>
                        {d.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Pie */}
        <div className="p-4 border-t border-tocineta-border bg-tocineta-bg flex items-center justify-between text-xs text-tocineta-muted">
          <span>Modalidad: Pass-through (Fondo Motorizado separado de Ventas)</span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-5 rounded-xl bg-tocineta-card border border-tocineta-border text-white text-xs font-bold hover:border-white transition-all"
          >
            Cerrar
          </button>
        </div>

      </div>
    </div>
  );
};
