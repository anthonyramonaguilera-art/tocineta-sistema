import React, { useState, useEffect } from 'react';
import { Card, Field, Input, Icon } from '../../ui/index.js';
import { useQuery } from '@tanstack/react-query';

interface Step1CustomerChannelProps {
  customerName: string;
  setCustomerName: (name: string) => void;
  customerNameError: string | null;
  fulfillmentType: 'salon' | 'para_llevar' | 'delivery';
  setFulfillmentType: (type: 'salon' | 'para_llevar' | 'delivery') => void;
  tableNumber: string;
  setTableNumber: (table: string) => void;
  deliverySede: string;
  setDeliverySede: (sede: string) => void;
  customerPhone: string;
  setCustomerPhone: (phone: string) => void;
  deliveryAddress: string;
  setDeliveryAddress: (address: string) => void;
  deliveryReference: string;
  setDeliveryReference: (ref: string) => void;
  deliveryTierCents: number;
  setDeliveryTierCents: (tier: number) => void;
  motorizadoId: string;
  setMotorizadoId: (id: string) => void;
}

const TABLES = [
  'Mesa 1', 'Mesa 2', 'Mesa 3', 'Mesa 4', 'Mesa 5', 'Mesa 6',
  'Mesa 7', 'Mesa 8', 'Mesa 9', 'Mesa 10', 'Mesa 11', 'Barra Food Truck'
];

const DELIVERY_TIERS = [
  { cents: 200, label: 'Zona 1 ($2.00)', desc: 'Cercana / Alta Vista' },
  { cents: 300, label: 'Zona 2 ($3.00)', desc: 'Intermedia / Los Olivos' },
  { cents: 400, label: 'Zona 3 ($4.00)', desc: 'Lejana / Unare' },
  { cents: 500, label: 'Zona 4 ($5.00)', desc: 'Periférica / San Félix' }
];

export const Step1CustomerChannel: React.FC<Step1CustomerChannelProps> = ({
  customerName,
  setCustomerName,
  customerNameError,
  fulfillmentType,
  setFulfillmentType,
  tableNumber,
  setTableNumber,
  deliverySede,
  setDeliverySede,
  customerPhone,
  setCustomerPhone,
  deliveryAddress,
  setDeliveryAddress,
  deliveryReference,
  setDeliveryReference,
  deliveryTierCents,
  setDeliveryTierCents,
  motorizadoId,
  setMotorizadoId
}) => {
  // Consultar clientes previos para autocompletado
  const { data: customersData } = useQuery<{ customers: Array<{ name: string; phone?: string; address?: string }> }>({
    queryKey: ['posCustomers'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/profitability/customers');
        if (res.ok) return res.json();
      } catch {}
      return { customers: [] };
    },
    staleTime: 60000
  });

  // Consultar mesas ocupadas en órdenes activas
  const { data: activeOrdersData } = useQuery<{ orders: Array<{ table_number: string; payment_status: string; fulfillment_status: string }> }>({
    queryKey: ['posActiveOrders'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/orders?status=pendiente');
        if (res.ok) return res.json();
      } catch {}
      return { orders: [] };
    },
    refetchInterval: 10000
  });

  // Consultar repartidores / motorizados disponibles
  const { data: staffData } = useQuery<{ staff: Array<{ id: string; name: string; role: string }> }>({
    queryKey: ['posStaffRiders'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/staff');
        if (res.ok) return res.json();
      } catch {}
      return { staff: [] };
    },
    staleTime: 60000
  });

  const occupiedTables = new Set(
    (activeOrdersData?.orders || [])
      .filter((o) => o.payment_status !== 'pagado' || o.fulfillment_status !== 'entregado')
      .map((o) => o.table_number)
  );

  const [filteredSuggestions, setFilteredSuggestions] = useState<Array<{ name: string; phone?: string; address?: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    const query = customerName.trim().toLowerCase();
    if (query.length >= 2 && customersData?.customers) {
      const matches = customersData.customers.filter((c) =>
        c.name.toLowerCase().includes(query)
      ).slice(0, 5);
      setFilteredSuggestions(matches);
    } else {
      setFilteredSuggestions([]);
    }
  }, [customerName, customersData]);

  const handleSelectCustomer = (c: { name: string; phone?: string; address?: string }) => {
    setCustomerName(c.name);
    if (c.phone) setCustomerPhone(c.phone);
    if (c.address) setDeliveryAddress(c.address);
    setShowSuggestions(false);
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* 1. Nombre y Apellido del Cliente (Obligatorio) */}
      <Card variant="surface" className="p-4 sm:p-5 border-2 border-border space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-black text-ink uppercase tracking-tight flex items-center gap-1.5">
            <span>Cliente</span>
            <span className="text-danger">*</span>
          </label>
          <span className="text-xs text-ink-muted">Obligatorio (mínimo 3 letras)</span>
        </div>

        <div className="relative">
          <Input
            value={customerName}
            onChange={(e) => {
              setCustomerName(e.target.value);
              setShowSuggestions(true);
            }}
            placeholder="Nombre y Apellido del cliente"
            leftIcon={<Icon name="User" size={18} />}
            error={Boolean(customerNameError)}
            autoFocus
          />

          {/* Sugerencias de Autocompletado */}
          {showSuggestions && filteredSuggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-xl z-20 overflow-hidden">
              {filteredSuggestions.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelectCustomer(c)}
                  className="w-full text-left p-3 text-xs hover:bg-surface-alt border-b border-border last:border-0 flex items-center justify-between transition-colors"
                >
                  <span className="font-bold text-ink">{c.name}</span>
                  {c.phone && <span className="text-ink-muted font-mono">{c.phone}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {customerNameError && (
          <p className="text-xs font-bold text-danger flex items-center gap-1 mt-1">
            <Icon name="AlertCircle" size={14} />
            {customerNameError}
          </p>
        )}
      </Card>

      {/* 2. Tres Tarjetas Grandes de Canal de Atención */}
      <div>
        <label className="text-xs font-black text-ink-muted uppercase tracking-wider block mb-3 px-1">
          Canal de Atención
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Comer Aquí */}
          <button
            type="button"
            onClick={() => setFulfillmentType('salon')}
            className={`p-4 rounded-2xl border-2 flex flex-col items-center justify-center gap-2 min-h-[110px] transition-all cursor-pointer ${
              fulfillmentType === 'salon'
                ? 'bg-primary/20 border-primary text-ink shadow-md scale-[1.02]'
                : 'bg-surface border-border text-ink-muted hover:border-border/80 hover:text-ink'
            }`}
          >
            <Icon name="Utensils" size={26} className={fulfillmentType === 'salon' ? 'text-ink' : 'text-ink-muted'} />
            <span className="font-black text-sm text-ink">Comer aquí</span>
            <span className="text-[11px] text-ink-muted">Servicio en mesa o barra</span>
          </button>

          {/* Para Llevar */}
          <button
            type="button"
            onClick={() => setFulfillmentType('para_llevar')}
            className={`p-4 rounded-2xl border-2 flex flex-col items-center justify-center gap-2 min-h-[110px] transition-all cursor-pointer ${
              fulfillmentType === 'para_llevar'
                ? 'bg-primary/20 border-primary text-ink shadow-md scale-[1.02]'
                : 'bg-surface border-border text-ink-muted hover:border-border/80 hover:text-ink'
            }`}
          >
            <Icon name="ShoppingBag" size={26} className={fulfillmentType === 'para_llevar' ? 'text-ink' : 'text-ink-muted'} />
            <span className="font-black text-sm text-ink">Para llevar</span>
            <span className="text-[11px] text-ink-muted">Retiro por mostrador</span>
          </button>

          {/* Delivery */}
          <button
            type="button"
            onClick={() => setFulfillmentType('delivery')}
            className={`p-4 rounded-2xl border-2 flex flex-col items-center justify-center gap-2 min-h-[110px] transition-all cursor-pointer ${
              fulfillmentType === 'delivery'
                ? 'bg-primary/20 border-primary text-ink shadow-md scale-[1.02]'
                : 'bg-surface border-border text-ink-muted hover:border-border/80 hover:text-ink'
            }`}
          >
            <Icon name="Bike" size={26} className={fulfillmentType === 'delivery' ? 'text-ink' : 'text-ink-muted'} />
            <span className="font-black text-sm text-ink">Delivery</span>
            <span className="text-[11px] text-ink-muted">Envío a domicilio</span>
          </button>
        </div>
      </div>

      {/* 3. Panel contextual según canal seleccionado */}

      {/* Caso A: Comer aquí -> Mapa Táctil de Mesas */}
      {fulfillmentType === 'salon' && (
        <Card variant="alt" className="p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-ink uppercase tracking-wider">
              Seleccionar Mesa o Ubicación
            </h3>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1 text-ink-muted">
                <span className="w-2.5 h-2.5 rounded-full bg-surface border border-border" />
                Libre
              </span>
              <span className="flex items-center gap-1 text-ink-muted">
                <span className="w-2.5 h-2.5 rounded-full bg-danger/80" />
                Ocupada
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {TABLES.map((t) => {
              const isSelected = tableNumber === t;
              const isOccupied = occupiedTables.has(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTableNumber(t)}
                  className={`min-h-[48px] p-2.5 rounded-xl border text-xs font-black transition-all flex flex-col items-center justify-center relative cursor-pointer ${
                    isSelected
                      ? 'bg-primary text-primary-ink border-primary shadow-sm scale-102'
                      : isOccupied
                      ? 'bg-danger/10 text-danger border-danger/30 hover:bg-danger/20'
                      : 'bg-surface text-ink border-border hover:bg-surface-alt'
                  }`}
                >
                  <span>{t}</span>
                  {isOccupied && !isSelected && (
                    <span className="text-[9px] font-bold opacity-80 uppercase">Ocupada</span>
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Caso B: Delivery -> Formulario de Envío */}
      {fulfillmentType === 'delivery' && (
        <Card variant="alt" className="p-4 sm:p-5 space-y-4">
          <h3 className="text-xs font-black text-ink uppercase tracking-wider">
            Detalles de Entrega a Domicilio
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Teléfono del Cliente" required>
              <Input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Ej: 04141234567"
                leftIcon={<Icon name="Phone" size={16} />}
              />
            </Field>

            <Field label="Sede de Despacho">
              <select
                value={deliverySede}
                onChange={(e) => setDeliverySede(e.target.value)}
                className="w-full min-h-[48px] px-3 rounded-xl bg-surface border border-border text-xs font-bold text-ink outline-none"
              >
                <option value="Sede B: Alta Vista">Sede B: Alta Vista (Principal)</option>
                <option value="Sede A: Los Olivos">Sede A: Los Olivos</option>
              </select>
            </Field>
          </div>

          <Field label="Dirección Exacta de Entrega" required>
            <Input
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="Calle, carrera, casa o edificio / piso"
              leftIcon={<Icon name="MapPin" size={16} />}
            />
          </Field>

          <Field label="Punto de Referencia">
            <Input
              value={deliveryReference}
              onChange={(e) => setDeliveryReference(e.target.value)}
              placeholder="Ej: Frente al colegio, portón negro..."
            />
          </Field>

          {/* Tarifa de Zona */}
          <div>
            <label className="text-xs font-bold text-ink-muted uppercase block mb-1.5">
              Tarifa de Delivery (Zona)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DELIVERY_TIERS.map((tier) => (
                <button
                  key={tier.cents}
                  type="button"
                  onClick={() => setDeliveryTierCents(tier.cents)}
                  className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                    deliveryTierCents === tier.cents
                      ? 'bg-primary text-primary-ink border-primary font-black shadow-sm'
                      : 'bg-surface text-ink border-border hover:bg-surface-alt font-medium'
                  }`}
                >
                  <div className="text-xs font-bold">{tier.label}</div>
                  <div className="text-[10px] text-ink-muted">{tier.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Repartidor / Motorizado Asignado */}
          <Field label="Repartidor Asignado">
            <select
              value={motorizadoId}
              onChange={(e) => setMotorizadoId(e.target.value)}
              className="w-full min-h-[48px] px-3 rounded-xl bg-surface border border-border text-xs font-bold text-ink outline-none"
            >
              <option value="">Sin asignar / Pendiente</option>
              {(staffData?.staff || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.role.toUpperCase()})
                </option>
              ))}
            </select>
          </Field>
        </Card>
      )}
    </div>
  );
};

export default Step1CustomerChannel;
