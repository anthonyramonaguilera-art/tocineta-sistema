import React, { useState, useEffect } from 'react';
import { Card, Field, Input, Icon } from '../../ui/index.js';
import { useQuery } from '@tanstack/react-query';
import { formatTableLabel } from '../../lib/format.js';

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
  askTableOnOrder?: boolean;
  canPay?: boolean;
  onQuickPay?: () => void;
}

const TABLES = [
  'Barra / Sin mesa',
  'Mesa 1', 'Mesa 2', 'Mesa 3', 'Mesa 4', 'Mesa 5', 'Mesa 6',
  'Mesa 7', 'Mesa 8', 'Mesa 9', 'Mesa 10', 'Mesa 11'
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
  setMotorizadoId,
  askTableOnOrder = false,
  canPay = false,
  onQuickPay
}) => {
  // Consultar clientes previos para autocompletado
  const { data: customersData } = useQuery<{ customers: Array<{ name: string; phone?: string; address?: string }> }>({
    queryKey: ['posCustomers'],
    queryFn: async () => {
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

  // Consultar repartidores disponibles
  const { data: staffData } = useQuery<{ staff: Array<{ id: string; name: string; role: string }> }>({
    queryKey: ['posStaffRiders'],
    queryFn: async () => {
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
      const matches = customersData.customers
        .filter((c) => c.name.toLowerCase().includes(query))
        .slice(0, 5);
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
    <div className="space-y-3 max-w-2xl mx-auto">
      {/* Barra de Acceso Rápido / Cobro Directo para Cajera */}
      {canPay && onQuickPay && (
        <div className="flex items-center justify-between bg-surface-alt px-3 py-2 rounded-xl border border-border">
          <span className="text-xs font-bold text-ink-muted">Caja y Cobro Directo</span>
          <button
            type="button"
            onClick={onQuickPay}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-ink text-xs font-black min-h-[44px] cursor-pointer hover:brightness-95 transition-all shadow-xs"
          >
            <Icon name="DollarSign" size={16} />
            <span>Cobrar</span>
          </button>
        </div>
      )}

      {/* 1. Nombre del Cliente */}
      <Card variant="surface" className="p-3 sm:p-4 border border-border space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-black text-ink uppercase tracking-tight flex items-center gap-1">
            <span>Cliente</span>
            <span className="text-danger">*</span>
          </label>
          <span className="text-[11px] text-ink-muted">Mínimo 3 letras</span>
        </div>

        <div className="relative">
          <Input
            value={customerName}
            onChange={(e) => {
              setCustomerName(e.target.value);
              setShowSuggestions(true);
            }}
            placeholder="Nombre y Apellido"
            leftIcon={<Icon name="User" size={16} />}
            error={Boolean(customerNameError)}
            autoFocus
          />

          {showSuggestions && filteredSuggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-xl z-20 overflow-hidden">
              {filteredSuggestions.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelectCustomer(c)}
                  className="w-full text-left p-2.5 text-xs hover:bg-surface-alt border-b border-border last:border-0 flex items-center justify-between transition-colors cursor-pointer"
                >
                  <span className="font-bold text-ink">{c.name}</span>
                  {c.phone && <span className="text-ink-muted font-mono">{c.phone}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {customerNameError && (
          <p className="text-xs font-bold text-danger flex items-center gap-1">
            <Icon name="AlertCircle" size={14} />
            {customerNameError}
          </p>
        )}
      </Card>

      {/* 2. Canal de Atención: Una sola fila de 3 chips */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-black text-ink-muted uppercase tracking-wider block px-0.5">
          Canal de Atención
        </label>
        <div className="grid grid-cols-3 gap-2">
          {/* Comer aquí */}
          <button
            type="button"
            onClick={() => {
              setFulfillmentType('salon');
              if (askTableOnOrder && !tableNumber) {
                setTableNumber('Barra / Sin mesa');
              }
            }}
            className={`min-h-[48px] px-2 py-2 rounded-xl border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              fulfillmentType === 'salon'
                ? 'bg-primary text-primary-ink border-primary font-black shadow-xs'
                : 'bg-surface text-ink border-border hover:bg-surface-alt font-bold'
            }`}
          >
            <Icon name="Utensils" size={16} />
            <span className="text-xs leading-none">Comer aquí</span>
          </button>

          {/* Para Llevar */}
          <button
            type="button"
            onClick={() => setFulfillmentType('para_llevar')}
            className={`min-h-[48px] px-2 py-2 rounded-xl border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              fulfillmentType === 'para_llevar'
                ? 'bg-primary text-primary-ink border-primary font-black shadow-xs'
                : 'bg-surface text-ink border-border hover:bg-surface-alt font-bold'
            }`}
          >
            <Icon name="ShoppingBag" size={16} />
            <span className="text-xs leading-none">Para Llevar</span>
          </button>

          {/* Delivery */}
          <button
            type="button"
            onClick={() => setFulfillmentType('delivery')}
            className={`min-h-[48px] px-2 py-2 rounded-xl border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              fulfillmentType === 'delivery'
                ? 'bg-primary text-primary-ink border-primary font-black shadow-xs'
                : 'bg-surface text-ink border-border hover:bg-surface-alt font-bold'
            }`}
          >
            <Icon name="Bike" size={16} />
            <span className="text-xs leading-none">Delivery</span>
          </button>
        </div>
      </div>

      {/* 3. Panel contextual */}

      {/* Caso A: Comer aquí -> Selector de Mesa SOLO si ask_table_on_order está ACTIVO */}
      {fulfillmentType === 'salon' && askTableOnOrder && (
        <Card variant="alt" className="p-3 sm:p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-ink uppercase tracking-wider">
              Mesa o Barra
            </h3>
            <span className="text-[11px] text-ink-muted">Primera opción: Barra</span>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {TABLES.map((t) => {
              const isSelected = tableNumber === t;
              const isOccupied = occupiedTables.has(t);
              const label = formatTableLabel(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTableNumber(t)}
                  className={`min-h-[48px] p-2 rounded-xl border text-xs font-black transition-all flex flex-col items-center justify-center relative cursor-pointer ${
                    isSelected
                      ? 'bg-primary text-primary-ink border-primary shadow-xs'
                      : isOccupied
                      ? 'bg-danger-subtle text-danger border-danger/40 hover:bg-danger-subtle/80'
                      : 'bg-surface text-ink border-border hover:bg-surface-alt'
                  }`}
                >
                  <span className="truncate max-w-full text-center">{label}</span>
                  {isOccupied && !isSelected && (
                    <span className="text-[9px] font-black uppercase text-danger">Ocupada</span>
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Caso B: Delivery -> Formulario de Envío */}
      {fulfillmentType === 'delivery' && (
        <Card variant="alt" className="p-3 sm:p-4 space-y-3">
          <h3 className="text-xs font-black text-ink uppercase tracking-wider">
            Detalles de Envío
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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

          <Field label="Dirección Exacta" required>
            <Input
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="Calle, casa, edificio, piso"
              leftIcon={<Icon name="MapPin" size={16} />}
            />
          </Field>

          <Field label="Punto de Referencia">
            <Input
              value={deliveryReference}
              onChange={(e) => setDeliveryReference(e.target.value)}
              placeholder="Ej: Portón negro, frente a plaza..."
            />
          </Field>

          <div>
            <label className="text-[11px] font-bold text-ink-muted uppercase block mb-1">
              Tarifa de Delivery
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DELIVERY_TIERS.map((tier) => (
                <button
                  key={tier.cents}
                  type="button"
                  onClick={() => setDeliveryTierCents(tier.cents)}
                  className={`p-2 rounded-xl border text-center transition-all cursor-pointer min-h-[48px] flex flex-col items-center justify-center ${
                    deliveryTierCents === tier.cents
                      ? 'bg-primary text-primary-ink border-primary font-black shadow-xs'
                      : 'bg-surface text-ink border-border hover:bg-surface-alt font-medium'
                  }`}
                >
                  <div className="text-xs font-bold">{tier.label}</div>
                  <div className="text-[10px] text-ink-muted">{tier.desc}</div>
                </button>
              ))}
            </div>
          </div>

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
