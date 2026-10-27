import React, { useState } from 'react';
import { Card, Button, Input, Select, Badge, Icon, EmptyState } from '../../ui/index.js';

export interface ExpenseItem {
  id: string;
  locationId: string;
  locationName?: string;
  category: string;
  amountUsdCents: number;
  amountBsCents: number;
  paymentMethod: string;
  description: string;
  authorizedByName?: string;
  receiptPhotoPath: string | null;
  isRecurring: number;
  recurringInterval: string | null;
  notes: string | null;
  createdAtMs: number;
}

interface ExpensesTabProps {
  expenses: ExpenseItem[];
  onOpenNewExpense: () => void;
  onDeleteExpense?: (id: string) => Promise<void>;
  isLoading?: boolean;
}

export const ExpensesTab: React.FC<ExpensesTabProps> = ({
  expenses,
  onOpenNewExpense,
  onDeleteExpense,
  isLoading
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMethod, setSelectedMethod] = useState('ALL');

  const filteredExpenses = expenses.filter((e) => {
    const matchesSearch =
      e.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (e.notes && e.notes.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesMethod = selectedMethod === 'ALL' || e.paymentMethod === selectedMethod;
    return matchesSearch && matchesMethod;
  });

  const totalUsdCents = filteredExpenses.reduce((acc, e) => acc + e.amountUsdCents, 0);

  return (
    <div className="space-y-4">
      {/* Barra Superior estilo Treinta */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-surface rounded-2xl border border-border shadow-xs">
        <div>
          <span className="text-xs font-bold text-ink-muted uppercase tracking-wider block">
            Total Gastos Filtrados
          </span>
          <div className="text-3xl font-black text-danger tracking-tight">
            ${(totalUsdCents / 100).toFixed(2)}
          </div>
          <span className="text-[11px] text-ink-muted">
            {filteredExpenses.length} {filteredExpenses.length === 1 ? 'registro' : 'registros'}
          </span>
        </div>

        <Button
          variant="primary"
          onClick={onOpenNewExpense}
          className="min-h-[50px] px-6 text-sm font-bold shadow-sm"
        >
          <Icon name="PlusCircle" size={18} className="mr-2" />
          Registrar Gasto
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder="Buscar por descripción, categoría o notas..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-56">
          <Select
            value={selectedMethod}
            onChange={(e) => setSelectedMethod(e.target.value)}
            options={[
              { value: 'ALL', label: 'Todos los métodos' },
              { value: 'EFECTIVO_USD', label: 'Efectivo USD ($)' },
              { value: 'PAGO_MOVIL', label: 'Pago Móvil (Bs)' },
              { value: 'TRANSFERENCIA_BS', label: 'Transferencia (Bs)' },
              { value: 'ZELLE', label: 'Zelle (USD)' },
              { value: 'PUNTO_VENTA', label: 'Punto de Venta (Bs)' },
              { value: 'EFECTIVO_BS', label: 'Efectivo Bs' }
            ]}
          />
        </div>
      </div>

      {/* Lista de Gastos */}
      {isLoading ? (
        <div className="p-8 text-center text-xs font-bold text-ink-muted animate-pulse">
          Cargando gastos...
        </div>
      ) : filteredExpenses.length === 0 ? (
        <EmptyState
          title="No hay gastos registrados"
          description="Usa el botón de Registrar Gasto para ingresar costos operativos de la sede."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredExpenses.map((exp) => (
            <Card key={exp.id} className="p-4 flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Badge variant="neutral" className="text-[10px] font-black uppercase mb-1">
                      {exp.category}
                    </Badge>
                    <h4 className="font-bold text-sm text-ink leading-tight">{exp.description}</h4>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-lg font-black text-danger">
                      -${(exp.amountUsdCents / 100).toFixed(2)}
                    </span>
                    {exp.amountBsCents > 0 && (
                      <span className="block text-[11px] text-ink-muted">
                        Bs. {(exp.amountBsCents / 100).toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>

                {exp.notes && (
                  <p className="text-xs text-ink-muted bg-surface-alt p-2 rounded-lg italic">
                    {exp.notes}
                  </p>
                )}
              </div>

              <div className="pt-3 mt-3 border-t border-border flex items-center justify-between text-[11px] text-ink-muted">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{exp.paymentMethod.replace('_', ' ')}</span>
                  {exp.isRecurring === 1 && (
                    <Badge variant="neutral" className="text-[9px]">
                      {exp.recurringInterval || 'RECURRENTE'}
                    </Badge>
                  )}
                  {exp.receiptPhotoPath && (
                    <Badge variant="success" className="text-[9px]">
                      COMPROBANTE
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span>{new Date(exp.createdAtMs).toLocaleDateString('es-VE')}</span>
                  {onDeleteExpense && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('¿Eliminar este gasto operativo?')) {
                          onDeleteExpense(exp.id);
                        }
                      }}
                      className="text-ink-muted hover:text-danger p-1 rounded-md"
                      title="Eliminar gasto"
                    >
                      <Icon name="Trash2" size={14} />
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
