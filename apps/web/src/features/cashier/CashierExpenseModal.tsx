import React, { useState, useEffect } from 'react';
import { Modal, Field, Input, Select, Button, Icon, Card } from '../../ui/index.js';
import { apiFetch } from '../../api/client.js';

interface SessionExpense {
  id: string;
  category: string;
  amountUsdCents: number;
  amountBsCents: number;
  paymentMethod: string;
  description: string;
  createdAtMs: number;
}

interface CashierExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExpenseCreated: () => void;
}

export const CashierExpenseModal: React.FC<CashierExpenseModalProps> = ({
  isOpen,
  onClose,
  onExpenseCreated
}) => {
  const [expenseCategory, setExpenseCategory] = useState('hielo_pan_insumos');
  const [expenseAmountUsd, setExpenseAmountUsd] = useState('');
  const [expenseDesc, setExpenseDesc] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [sessionExpenses, setSessionExpenses] = useState<SessionExpense[]>([]);
  const [isLoadingExpenses, setIsLoadingExpenses] = useState(false);

  const loadSessionExpenses = async () => {
    setIsLoadingExpenses(true);
    try {
      const res = await apiFetch('/api/cash-expenses');
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.expenses)) {
        setSessionExpenses(data.expenses);
      }
    } catch {
      // Ignorar fallo no critico de listado previo
    } finally {
      setIsLoadingExpenses(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setIsDuplicate(false);
      loadSessionExpenses();
    }
  }, [isOpen]);

  const handleSave = async (confirmDuplicate = false) => {
    setIsSaving(true);
    setErrorMessage(null);

    const amountCents = Math.round(parseFloat(expenseAmountUsd || '0') * 100);
    if (amountCents <= 0) {
      setErrorMessage('Ingresa un monto valido mayor a 0');
      setIsSaving(false);
      return;
    }

    try {
      const res = await apiFetch('/api/cash-expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountUsdCents: amountCents,
          category: expenseCategory,
          description: expenseDesc.trim() || 'Gasto operativo de caja chica',
          confirmDuplicate
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.code === 'DUPLICATE_EXPENSE' || res.status === 409) {
          setIsDuplicate(true);
        }
        throw new Error(data.error || 'Error al registrar salida de caja');
      }

      setExpenseAmountUsd('');
      setExpenseDesc('');
      setIsDuplicate(false);
      onExpenseCreated();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al registrar salida de caja');
    } finally {
      setIsSaving(false);
    }
  };

  const getCategoryLabel = (cat: string) => {
    switch (cat.toLowerCase()) {
      case 'hielo_pan_insumos': return 'Hielo / Insumos';
      case 'servilletas_bolsas': return 'Empaques / Bolsas';
      case 'transporte_emergencia': return 'Transporte';
      default: return cat;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Salida de Caja Chica"
    >
      <div className="space-y-4">
        {errorMessage && (
          <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Icon name="AlertTriangle" className="w-4 h-4 shrink-0 text-danger" />
              <span>{errorMessage}</span>
            </div>
            {isDuplicate && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => handleSave(true)}
                loading={isSaving}
                className="mt-1 w-full"
                leftIcon="Check"
              >
                Registrar de todos modos
              </Button>
            )}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); handleSave(false); }} className="space-y-4">
          <Field label="Categoria del gasto" required>
            <Select
              value={expenseCategory}
              onChange={e => { setExpenseCategory(e.target.value); setIsDuplicate(false); }}
              options={[
                { value: 'hielo_pan_insumos', label: 'Hielo / Pan / Insumos urgentes' },
                { value: 'servilletas_bolsas', label: 'Empaques / Servilletas / Bolsas' },
                { value: 'transporte_emergencia', label: 'Transporte / Logistica de emergencia' },
                { value: 'otros_menores', label: 'Otros gastos menores' }
              ]}
            />
          </Field>

          <Field label="Monto en Dolares ($)" required>
            <Input
              type="number"
              step="0.01"
              min="0.10"
              value={expenseAmountUsd}
              onChange={e => { setExpenseAmountUsd(e.target.value); setIsDuplicate(false); }}
              placeholder="0.00"
              className="font-mono text-lg font-bold"
            />
          </Field>

          <Field label="Descripcion / Concepto">
            <Input
              value={expenseDesc}
              onChange={e => { setExpenseDesc(e.target.value); setIsDuplicate(false); }}
              placeholder="Ej. 2 bolsas de hielo compradas en la esquina..."
            />
          </Field>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" size="md" onClick={onClose} disabled={isSaving}>
              Cancelar
            </Button>
            <Button variant="primary" size="md" type="submit" loading={isSaving} leftIcon="Check">
              Registrar Gasto
            </Button>
          </div>
        </form>

        {/* Historial de salidas en la sesion actual */}
        <div className="pt-2 border-t border-border">
          <span className="text-xs font-bold text-ink uppercase tracking-wider block mb-2">
            Salidas en este turno ({sessionExpenses.length})
          </span>
          {isLoadingExpenses ? (
            <p className="text-xs text-ink-muted">Cargando salidas de la sesion...</p>
          ) : sessionExpenses.length === 0 ? (
            <p className="text-xs text-ink-muted">No se han registrado salidas en esta sesion.</p>
          ) : (
            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
              {sessionExpenses.map(exp => (
                <Card key={exp.id} variant="surface" className="p-2.5 flex justify-between items-center text-xs border-border">
                  <div className="space-y-0.5">
                    <span className="font-bold text-ink block">{exp.description}</span>
                    <span className="text-ink-muted text-[10px] uppercase font-mono">
                      {getCategoryLabel(exp.category)} • {new Date(exp.createdAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <span className="font-mono font-black text-danger text-sm">
                    -${(exp.amountUsdCents / 100).toFixed(2)}
                  </span>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
