import React, { useState } from 'react';
import { Modal, Button, Input, Field, Icon } from '../../ui/index.js';

interface CustomerOption {
  id: string;
  name: string;
  phone?: string | null;
  isPartner?: number;
}

interface ReceivableModalProps {
  isOpen: boolean;
  onClose: () => void;
  customers: CustomerOption[];
  currentLocationId: string;
  onSaveReceivable: (data: any) => Promise<void>;
  userId: string;
}

export const ReceivableModal: React.FC<ReceivableModalProps> = ({
  isOpen,
  onClose,
  customers,
  currentLocationId,
  onSaveReceivable,
  userId
}) => {
  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.id || '');
  const [customerSearch, setCustomerSearch] = useState('');
  const [concept, setConcept] = useState('Consumo a Crédito');
  const [amountStr, setAmountStr] = useState('');
  const [daysUntilDue, setDaysUntilDue] = useState('7'); // Por defecto 7 días
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.phone && c.phone.includes(customerSearch))
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId) {
      setErrorMsg('Debe seleccionar un cliente');
      return;
    }

    const amountVal = parseFloat(amountStr.replace(',', '.'));
    if (isNaN(amountVal) || amountVal <= 0) {
      setErrorMsg('Ingrese un monto válido');
      return;
    }

    if (!concept.trim()) {
      setErrorMsg('Ingrese el concepto del crédito');
      return;
    }

    const days = parseInt(daysUntilDue, 10);
    const dueDateMs = Date.now() + (isNaN(days) ? 7 : days) * 24 * 60 * 60 * 1000;

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      await onSaveReceivable({
        customerId: selectedCustomerId,
        locationId: currentLocationId,
        concept: concept.trim(),
        totalUsdCents: Math.round(amountVal * 100),
        dueDateMs,
        notes: notes.trim() || undefined,
        createdBy: userId
      });

      // Limpiar y cerrar
      setAmountStr('');
      setNotes('');
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al crear la cuenta por cobrar');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nuevo Crédito / Cuenta por Cobrar" maxWidth="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl flex items-center gap-2 text-danger text-xs font-semibold">
            <Icon name="AlertCircle" size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Monto Grande estilo Treinta */}
        <div>
          <label className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-1">
            Monto a Cobrar (USD $)
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-ink-muted">
              $
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0.00"
              autoFocus
              className="w-full pl-9 pr-4 py-3 text-2xl font-black text-ink bg-surface border-2 border-border focus:border-primary rounded-xl outline-hidden transition-all min-h-[54px]"
            />
          </div>
        </div>

        {/* Selección de Cliente */}
        <div>
          <label className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-1">
            Cliente / Socio / Evento
          </label>
          <Input
            placeholder="Filtrar cliente por nombre o teléfono..."
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className="mb-2"
          />
          <div className="max-h-36 overflow-y-auto space-y-1 border border-border rounded-xl p-1 bg-surface-alt">
            {filteredCustomers.length === 0 ? (
              <div className="p-2 text-center text-xs text-ink-muted">No se encontraron clientes</div>
            ) : (
              filteredCustomers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCustomerId(c.id)}
                  className={`w-full text-left p-2 rounded-lg text-xs flex items-center justify-between transition-colors ${
                    selectedCustomerId === c.id
                      ? 'bg-primary text-primary-contrast font-bold'
                      : 'hover:bg-surface text-ink'
                  }`}
                >
                  <span>{c.name} {c.isPartner === 1 && '(Socio)'}</span>
                  <span className="text-[11px] opacity-80">{c.phone || 'Sin tlf'}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Concepto */}
        <Field label="Concepto">
          <Input
            placeholder="Ej. Consumo evento cumpleaños / Consumo fiado"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            required
          />
        </Field>

        {/* Días para vencimiento */}
        <Field label="Plazo de Pago (Días para vencer)">
          <Input
            type="number"
            min="1"
            max="365"
            value={daysUntilDue}
            onChange={(e) => setDaysUntilDue(e.target.value)}
          />
        </Field>

        {/* Notas */}
        <Field label="Notas Adicionales">
          <Input
            placeholder="Condiciones acordadas, etc."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        {/* Botones */}
        <div className="pt-2 border-t border-border flex items-center justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={isSubmitting}
            className="min-h-[48px] px-6 text-sm font-bold"
          >
            Crear Crédito
          </Button>
        </div>
      </form>
    </Modal>
  );
};
