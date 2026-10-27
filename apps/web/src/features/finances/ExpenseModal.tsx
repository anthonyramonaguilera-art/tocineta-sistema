import React, { useState } from 'react';
import { Modal, Button, Input, Select, Field, Icon } from '../../ui/index.js';

interface CategoryOption {
  id: string;
  name: string;
}

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: CategoryOption[];
  onAddCategory: (name: string) => Promise<CategoryOption>;
  currentLocationId: string;
  onSaveExpense: (data: any) => Promise<void>;
  userId: string;
}

const PAYMENT_METHODS = [
  { value: 'EFECTIVO_USD', label: 'Efectivo USD ($)' },
  { value: 'PAGO_MOVIL', label: 'Pago Móvil (Bs)' },
  { value: 'TRANSFERENCIA_BS', label: 'Transferencia Bancaria (Bs)' },
  { value: 'ZELLE', label: 'Zelle (USD)' },
  { value: 'PUNTO_VENTA', label: 'Punto de Venta / Tarjeta (Bs)' },
  { value: 'EFECTIVO_BS', label: 'Efectivo Bolívares (Bs)' },
  { value: 'BINANCE', label: 'Binance Pay / USDT' }
];

const RECURRING_INTERVALS = [
  { value: 'SEMANAL', label: 'Semanal' },
  { value: 'QUINCENAL', label: 'Quincenal' },
  { value: 'MENSUAL', label: 'Mensual' }
];

export const ExpenseModal: React.FC<ExpenseModalProps> = ({
  isOpen,
  onClose,
  categories,
  onAddCategory,
  currentLocationId,
  onSaveExpense,
  userId
}) => {
  const [amountStr, setAmountStr] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(categories[0]?.name || 'VARIOS');
  const [newCatName, setNewCatName] = useState('');
  const [isAddingNewCat, setIsAddingNewCat] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('EFECTIVO_USD');
  const [description, setDescription] = useState('');
  const [receiptPhotoPath, setReceiptPhotoPath] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringInterval, setRecurringInterval] = useState('MENSUAL');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCreateNewCategory = async () => {
    if (!newCatName.trim()) return;
    try {
      const created = await onAddCategory(newCatName.trim());
      setSelectedCategory(created.name);
      setNewCatName('');
      setIsAddingNewCat(false);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al crear categoría');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountVal = parseFloat(amountStr.replace(',', '.'));
    if (isNaN(amountVal) || amountVal <= 0) {
      setErrorMsg('Ingrese un monto válido mayor a 0');
      return;
    }

    if (!description.trim()) {
      setErrorMsg('Ingrese una descripción clara del gasto');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const amountUsdCents = Math.round(amountVal * 100);
      await onSaveExpense({
        locationId: currentLocationId,
        category: selectedCategory,
        amountUsdCents,
        paymentMethod,
        description: description.trim(),
        receiptPhotoPath: receiptPhotoPath.trim() || undefined,
        isRecurring,
        recurringInterval: isRecurring ? recurringInterval : undefined,
        notes: notes.trim() || undefined,
        authorizedByUserId: userId
      });

      // Limpiar formulario y cerrar
      setAmountStr('');
      setDescription('');
      setReceiptPhotoPath('');
      setNotes('');
      setIsRecurring(false);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al registrar el gasto');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Registrar Gasto Rápido" maxWidth="md">
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
            Monto del Gasto (USD $)
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

        {/* Categoría Configurable */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-bold text-ink-muted uppercase tracking-wider">
              Categoría
            </label>
            <button
              type="button"
              onClick={() => setIsAddingNewCat(!isAddingNewCat)}
              className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
            >
              <Icon name={isAddingNewCat ? 'X' : 'Plus'} size={14} />
              <span>{isAddingNewCat ? 'Cancelar' : 'Nueva Categoría'}</span>
            </button>
          </div>

          {isAddingNewCat ? (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Nombre de la nueva categoría"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
              />
              <Button type="button" variant="primary" onClick={handleCreateNewCategory}>
                Añadir
              </Button>
            </div>
          ) : (
            <Select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              options={categories.map((c) => ({ value: c.name, label: c.name }))}
            />
          )}
        </div>

        {/* Método de Pago */}
        <Field label="Método de Pago">
          <Select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            options={PAYMENT_METHODS}
          />
        </Field>

        {/* Descripción */}
        <Field label="Descripción del Gasto">
          <Input
            placeholder="Ej. Compra de 5 bolsas de hielo para la barra"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </Field>

        {/* Comprobante Opcional */}
        <Field label="Foto de Comprobante / N° Factura (Opcional)">
          <Input
            placeholder="URL o referencia de factura física"
            value={receiptPhotoPath}
            onChange={(e) => setReceiptPhotoPath(e.target.value)}
          />
        </Field>

        {/* Recurrencia */}
        <div className="p-3 bg-surface-alt rounded-xl border border-border space-y-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
              className="w-4 h-4 rounded text-primary border-border focus:ring-primary"
            />
            <span className="text-xs font-bold text-ink">¿Es un gasto recurrente? (Alquiler, Nómina, etc.)</span>
          </label>

          {isRecurring && (
            <div>
              <label className="block text-[11px] font-bold text-ink-muted uppercase mb-1">
                Frecuencia de Recurrencia
              </label>
              <Select
                value={recurringInterval}
                onChange={(e) => setRecurringInterval(e.target.value)}
                options={RECURRING_INTERVALS}
              />
            </div>
          )}
        </div>

        {/* Botones de Acción Guiada */}
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
            Registrar Gasto
          </Button>
        </div>
      </form>
    </Modal>
  );
};
