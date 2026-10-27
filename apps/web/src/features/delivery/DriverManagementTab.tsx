import React, { useState } from 'react';
import { Button, Input, Field, Badge, Icon } from '../../ui/index.js';

export interface DriverItem {
  id: string;
  name: string;
  phone: string;
  locationId?: string;
  isActive: boolean;
}

interface DriverManagementTabProps {
  drivers: DriverItem[];
  token: string | null;
  onRefresh: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export const DriverManagementTab: React.FC<DriverManagementTabProps> = ({
  drivers,
  token,
  onRefresh,
  onSuccess,
  onError
}) => {
  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [newDriverLocation, setNewDriverLocation] = useState('loc_alta_vista');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreateDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDriverName.trim() || !newDriverPhone.trim()) return;

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/delivery/drivers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          name: newDriverName.trim(),
          phone: newDriverPhone.trim(),
          locationId: newDriverLocation
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'No se pudo registrar el repartidor');
      }

      onSuccess(`Repartidor "${newDriverName}" registrado con éxito en la sede seleccionada.`);
      setNewDriverName('');
      setNewDriverPhone('');
      onRefresh();
    } catch (err: any) {
      onError(err.message || 'Error al registrar repartidor');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleDriverStatus = async (driverId: string, currentStatus: boolean) => {
    try {
      const res = await fetch(`/api/delivery/drivers/${driverId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ isActive: !currentStatus })
      });
      if (!res.ok) throw new Error('Error al actualizar estado');
      onSuccess(`Estado del repartidor actualizado.`);
      onRefresh();
    } catch (err: any) {
      onError(err.message || 'No se pudo actualizar');
    }
  };

  return (
    <div className="space-y-5">
      {/* Formulario de Registro */}
      <form onSubmit={handleCreateDriver} className="p-4 rounded-2xl bg-surface-alt border border-border space-y-3">
        <h4 className="text-xs font-black text-ink uppercase tracking-wider flex items-center gap-1.5">
          <Icon name="PlusCircle" size={14} className="text-primary" />
          <span>Registrar Nuevo Repartidor por Sede</span>
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Nombre Completo" required>
            <Input
              type="text"
              placeholder="Ej: Repartidor Zona A"
              value={newDriverName}
              onChange={(e) => setNewDriverName(e.target.value)}
              required
            />
          </Field>
          <Field label="Teléfono WhatsApp" required>
            <Input
              type="tel"
              placeholder="0414-0000000"
              value={newDriverPhone}
              onChange={(e) => setNewDriverPhone(e.target.value)}
              required
            />
          </Field>
          <Field label="Sede Asignada" required>
            <select
              value={newDriverLocation}
              onChange={(e) => setNewDriverLocation(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
            >
              <option value="loc_alta_vista">Sede B: Alta Vista</option>
              <option value="loc_los_olivos">Sede A: Los Olivos</option>
            </select>
          </Field>
        </div>
        <div className="flex justify-end pt-1">
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={isSubmitting || !newDriverName.trim() || !newDriverPhone.trim()}
          >
            {isSubmitting ? 'Guardando...' : 'Registrar Repartidor'}
          </Button>
        </div>
      </form>

      {/* Lista de Repartidores */}
      <div className="space-y-2">
        <h4 className="text-xs font-black text-ink uppercase tracking-wider">
          Flota de Repartidores Registrados ({drivers.length})
        </h4>
        {drivers.length === 0 ? (
          <div className="p-6 text-center text-xs text-ink-muted bg-surface-alt rounded-2xl border border-border">
            No hay repartidores registrados en el sistema.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {drivers.map((drv) => (
              <div
                key={drv.id}
                className="p-3 rounded-2xl bg-surface border border-border flex items-center justify-between shadow-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-black text-xs text-ink">{drv.name}</span>
                    <Badge variant={drv.isActive ? 'success' : 'neutral'} size="sm">
                      {drv.isActive ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-ink-muted mt-0.5">
                    {drv.phone} · Sede: {drv.locationId === 'loc_los_olivos' ? 'Los Olivos' : 'Alta Vista'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleDriverStatus(drv.id, drv.isActive)}
                  className="px-2.5 py-1.5 rounded-xl text-xs font-bold border border-border bg-surface-alt hover:bg-surface text-ink transition-colors"
                >
                  {drv.isActive ? 'Desactivar' : 'Reactivar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
