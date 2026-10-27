import React, { useState } from 'react';
import { Card, Button, Money, Icon } from '../../ui/index.js';
import { useMenuProducts, useCreateQuote } from './useQuotesData.js';
import { PrivateSimulatorWidget } from './PrivateSimulatorWidget.js';
import type { CreateQuotePayload } from './types.js';

interface QuoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ItemRow {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceUsdCents: number;
}

interface ExtraRow {
  concept: string;
  category: 'LOGISTICA' | 'PERSONAL' | 'DESCARTABLES' | 'OTROS';
  priceUsd: number;
  costUsd: number;
}

export const QuoteModal: React.FC<QuoteModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { data: products = [] } = useMenuProducts();
  const createQuoteMutation = useCreateQuote();

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [guestCount, setGuestCount] = useState(20);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [notes, setNotes] = useState('');

  const [items, setItems] = useState<ItemRow[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedQuantity, setSelectedQuantity] = useState(10);

  const [extras, setExtras] = useState<ExtraRow[]>([
    { concept: 'Traslado y Logística Móvil', category: 'LOGISTICA', priceUsd: 30, costUsd: 15 },
    { concept: 'Personal Adicional de Cocina (2 personas)', category: 'PERSONAL', priceUsd: 40, costUsd: 30 }
  ]);

  if (!isOpen) return null;

  const handleAddItem = () => {
    if (!selectedProductId) return;
    const prod = products.find((p) => p.id === selectedProductId);
    if (!prod) return;

    const existingIndex = items.findIndex((it) => it.productId === selectedProductId);
    if (existingIndex >= 0) {
      const copy = [...items];
      copy[existingIndex].quantity += selectedQuantity;
      setItems(copy);
    } else {
      setItems([
        ...items,
        {
          productId: prod.id,
          productName: prod.name,
          quantity: selectedQuantity,
          unitPriceUsdCents: prod.price_usd_cents || 500
        }
      ]);
    }
    setSelectedProductId('');
    setSelectedQuantity(10);
  };

  const handleRemoveItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  const handleAddExtra = () => {
    setExtras([...extras, { concept: 'Descartables y Empaques Premium', category: 'DESCARTABLES', priceUsd: 20, costUsd: 10 }]);
  };

  const handleRemoveExtra = (idx: number) => {
    setExtras(extras.filter((_, i) => i !== idx));
  };

  // Cálculos para el simulador privado
  const subtotalFoodCents = items.reduce((acc, it) => acc + it.quantity * it.unitPriceUsdCents, 0);
  const discountCents = discountPercent > 0 ? Math.round((subtotalFoodCents * discountPercent) / 100) : 0;
  const extrasTotalCents = extras.reduce((acc, ex) => acc + Math.round(ex.priceUsd * 100), 0);
  const totalPriceCents = Math.max(0, subtotalFoodCents - discountCents) + extrasTotalCents;

  const approxFoodCostCents = Math.round(subtotalFoodCents * 0.38);
  const extrasCostCents = extras.reduce((acc, ex) => acc + Math.round(ex.costUsd * 100), 0);
  const totalCostCents = approxFoodCostCents + extrasCostCents;
  const estimatedProfitCents = totalPriceCents - totalCostCents;
  const marginPercent = totalPriceCents > 0 ? Math.round((estimatedProfitCents / totalPriceCents) * 100) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) {
      alert('Por favor indica el nombre del cliente');
      return;
    }
    if (items.length === 0) {
      alert('Debes agregar al menos un plato a la cotización');
      return;
    }

    const payload: CreateQuotePayload = {
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      eventDateMs: eventDate ? new Date(eventDate).getTime() : undefined,
      eventLocation: eventLocation.trim() || undefined,
      guestCount,
      discountPercent,
      items: items.map((it) => ({
        productId: it.productId,
        productName: it.productName,
        quantity: it.quantity,
        unitPriceUsdCents: it.unitPriceUsdCents
      })),
      extras: extras.map((ex) => ({
        concept: ex.concept,
        category: ex.category,
        priceUsdCents: Math.round(ex.priceUsd * 100),
        costUsdCents: Math.round(ex.costUsd * 100)
      })),
      notes: notes.trim() || undefined
    };

    try {
      await createQuoteMutation.mutateAsync(payload);
      onSuccess();
      onClose();
    } catch (err: any) {
      alert(err.message || 'Error al guardar cotización');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-ink/40 backdrop-blur-xs select-none animate-in fade-in duration-200">
      <Card variant="surface" className="w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl border-2 border-border">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <Icon name="FilePlus" size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-ink">Nueva Cotización de Evento</h3>
              <p className="text-xs text-ink-muted">Conectada a la carta oficial y recetas reales.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-alt flex items-center justify-center text-ink-muted hover:text-ink">
            <Icon name="X" size={16} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Columna Izquierda: Datos y Platos (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              <div className="bg-surface-alt/40 p-3.5 rounded-2xl border border-border space-y-3">
                <h4 className="text-xs font-black text-ink uppercase tracking-wider flex items-center gap-1.5">
                  <Icon name="User" size={14} className="text-primary" /> Datos del Cliente y Fecha
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  <div>
                    <label className="block text-[11px] font-bold text-ink-muted mb-1">Nombre / Empresa *</label>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Ej. Cumpleaños Valeria / Grupo Empresarial"
                      className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-ink-muted mb-1">WhatsApp Cliente</label>
                    <input
                      type="text"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="04121234567"
                      className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-ink-muted mb-1">Fecha del Evento</label>
                    <input
                      type="date"
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-ink-muted mb-1">Invitados</label>
                    <input
                      type="number"
                      min="1"
                      value={guestCount}
                      onChange={(e) => setGuestCount(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-bold"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-ink-muted mb-1">Ubicación / Sede</label>
                    <input
                      type="text"
                      value={eventLocation}
                      onChange={(e) => setEventLocation(e.target.value)}
                      placeholder="Club Náutico / Salón Privado"
                      className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary"
                    />
                  </div>
                </div>
              </div>

              {/* Selector de Platos */}
              <div className="bg-surface-alt/40 p-3.5 rounded-2xl border border-border space-y-3">
                <h4 className="text-xs font-black text-ink uppercase tracking-wider flex items-center gap-1.5">
                  <Icon name="Utensils" size={14} className="text-primary" /> Platos de la Carta
                </h4>
                <div className="flex gap-2">
                  <select
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    className="flex-1 min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-bold"
                  >
                    <option value="">-- Seleccionar Plato de la Carta --</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (${((p.price_usd_cents || 0) / 100).toFixed(2)})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={selectedQuantity}
                    onChange={(e) => setSelectedQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-20 min-h-[44px] rounded-xl border border-border bg-surface px-2 text-center text-xs text-ink font-extrabold outline-none"
                  />
                  <Button type="button" variant="primary" size="sm" onClick={handleAddItem} className="min-h-[44px] px-3">
                    <Icon name="Plus" size={16} />
                  </Button>
                </div>

                {items.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {items.map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 rounded-xl bg-surface border border-border text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-primary">{it.quantity}x</span>
                          <span className="font-bold text-ink">{it.productName}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-extrabold text-ink"><Money cents={it.quantity * it.unitPriceUsdCents} /></span>
                          <button type="button" onClick={() => handleRemoveItem(idx)} className="text-danger hover:text-danger/80">
                            <Icon name="Trash2" size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Servicios Extras */}
              <div className="bg-surface-alt/40 p-3.5 rounded-2xl border border-border space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black text-ink uppercase tracking-wider flex items-center gap-1.5">
                    <Icon name="Truck" size={14} className="text-primary" /> Costos Extras
                  </h4>
                  <button type="button" onClick={handleAddExtra} className="text-[11px] font-bold text-primary hover:underline flex items-center gap-1">
                    <Icon name="Plus" size={12} /> Agregar Extra
                  </button>
                </div>
                <div className="space-y-2">
                  {extras.map((ex, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center p-2 rounded-xl bg-surface border border-border text-xs">
                      <input
                        type="text"
                        value={ex.concept}
                        onChange={(e) => {
                          const copy = [...extras];
                          copy[idx].concept = e.target.value;
                          setExtras(copy);
                        }}
                        className="col-span-6 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink font-medium"
                      />
                      <div className="col-span-3">
                        <input
                          type="number"
                          placeholder="Precio USD"
                          value={ex.priceUsd}
                          onChange={(e) => {
                            const copy = [...extras];
                            copy[idx].priceUsd = parseFloat(e.target.value) || 0;
                            setExtras(copy);
                          }}
                          className="w-full rounded-lg border border-border bg-surface px-2 py-1 text-xs text-right font-bold text-ink"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          placeholder="Costo"
                          value={ex.costUsd}
                          onChange={(e) => {
                            const copy = [...extras];
                            copy[idx].costUsd = parseFloat(e.target.value) || 0;
                            setExtras(copy);
                          }}
                          className="w-full rounded-lg border border-border bg-surface-alt px-2 py-1 text-xs text-right text-ink-muted"
                        />
                      </div>
                      <button type="button" onClick={() => handleRemoveExtra(idx)} className="col-span-1 text-danger flex justify-center">
                        <Icon name="Trash2" size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Columna Derecha: SIMULADOR PRIVADO DE UTILIDAD (5 cols) */}
            <div className="lg:col-span-5 space-y-4">
              <PrivateSimulatorWidget
                subtotalFoodCents={subtotalFoodCents}
                itemCount={items.reduce((s, it) => s + it.quantity, 0)}
                discountPercent={discountPercent}
                onDiscountChange={setDiscountPercent}
                extrasTotalCents={extrasTotalCents}
                totalPriceCents={totalPriceCents}
                approxFoodCostCents={approxFoodCostCents}
                extrasCostCents={extrasCostCents}
                totalCostCents={totalCostCents}
                estimatedProfitCents={estimatedProfitCents}
                marginPercent={marginPercent}
              />

              <div>
                <label className="block text-[11px] font-bold text-ink-muted mb-1">Notas Comerciales</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Incluye montaje de mesa, estación de salsas, etc."
                  className="w-full rounded-xl border border-border bg-surface p-2 text-xs text-ink outline-none focus:border-primary resize-none"
                />
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-border flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" size="md" onClick={onClose} className="min-h-[48px]">
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={createQuoteMutation.isPending}
              className="min-h-[48px] px-6 font-black"
              leftIcon={<Icon name="Check" size={18} />}
            >
              {createQuoteMutation.isPending ? 'Guardando...' : 'Crear Cotización'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
