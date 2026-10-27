import React, { useState } from 'react';
import { Card, Button, Select, Badge, Icon, EmptyState } from '../../ui/index.js';

interface MonthlyClosureItem {
  id: string;
  year: number;
  month: number;
  locationId: string;
  locationName?: string;
  totalSalesUsdCents: number;
  totalCogsUsdCents: number;
  totalWasteUsdCents: number;
  totalExpensesUsdCents: number;
  netProfitUsdCents: number;
  closedByName?: string;
  closedAtMs: number;
  notes: string | null;
}

interface MonthlyClosureTabProps {
  closures: MonthlyClosureItem[];
  onCreateClosure: (year: number, month: number, notes?: string) => Promise<void>;
  onExportExcel: (year: number, month: number) => void;
  onExportPdf: (year: number, month: number) => void;
  isLoading?: boolean;
}

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export const MonthlyClosureTab: React.FC<MonthlyClosureTabProps> = ({
  closures,
  onCreateClosure,
  onExportExcel,
  onExportPdf,
  isLoading
}) => {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const [selectedYear, setSelectedYear] = useState(currentYear.toString());
  const [selectedMonth, setSelectedMonth] = useState(currentMonth.toString());
  const [closureNotes, setClosureNotes] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCreate = async () => {
    const yr = parseInt(selectedYear, 10);
    const mo = parseInt(selectedMonth, 10);
    if (confirm(`¿Generar cierre mensual oficial para ${MONTH_NAMES[mo - 1]} ${yr}? Esta acción registrará una instantánea contable inmutable.`)) {
      setIsCreating(true);
      setErrorMsg(null);
      try {
        await onCreateClosure(yr, mo, closureNotes.trim() || undefined);
        setClosureNotes('');
      } catch (err: any) {
        setErrorMsg(err?.message || 'Error al generar el cierre mensual');
      } finally {
        setIsCreating(false);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Panel de Generación de Cierre */}
      <Card className="p-5 space-y-4 bg-surface border-border">
        <div>
          <h4 className="text-sm font-black text-ink uppercase tracking-wider">
            Generar Cierre Mensual Inmutable
          </h4>
          <p className="text-xs text-ink-muted">
            Calcula y congela la rentabilidad, ventas, CMV y gastos del mes en una instantánea auditable.
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl flex items-center gap-2 text-danger text-xs font-semibold">
            <Icon name="AlertCircle" size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-bold text-ink-muted uppercase mb-1">Año</label>
            <Select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              options={[
                { value: (currentYear - 1).toString(), label: (currentYear - 1).toString() },
                { value: currentYear.toString(), label: currentYear.toString() },
                { value: (currentYear + 1).toString(), label: (currentYear + 1).toString() }
              ]}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-muted uppercase mb-1">Mes</label>
            <Select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              options={MONTH_NAMES.map((name, idx) => ({
                value: (idx + 1).toString(),
                label: name
              }))}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-muted uppercase mb-1">
              Notas / Observaciones
            </label>
            <input
              type="text"
              placeholder="Ej. Cierre final aprobado por gerencia"
              value={closureNotes}
              onChange={(e) => setClosureNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-surface border border-border rounded-xl focus:border-primary outline-hidden min-h-[42px]"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            variant="primary"
            onClick={handleCreate}
            loading={isCreating}
            className="min-h-[48px] px-6 text-sm font-bold"
          >
            <Icon name="Lock" size={16} className="mr-2" />
            Generar Cierre de {MONTH_NAMES[parseInt(selectedMonth, 10) - 1]}
          </Button>
        </div>
      </Card>

      {/* 2. Historial de Cierres Mensuales */}
      <div>
        <h4 className="text-xs font-black text-ink uppercase tracking-wider mb-3">
          Historial de Cierres Registrados
        </h4>

        {isLoading ? (
          <div className="p-8 text-center text-xs font-bold text-ink-muted animate-pulse">
            Cargando cierres históricos...
          </div>
        ) : closures.length === 0 ? (
          <EmptyState
            title="No hay cierres mensuales registrados"
            description="Usa el formulario superior para generar el cierre contable del mes vencido."
          />
        ) : (
          <div className="space-y-3">
            {closures.map((c) => (
              <Card key={c.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-black text-ink">
                      {MONTH_NAMES[c.month - 1]} {c.year}
                    </span>
                    <Badge variant="success" className="text-[9px]">
                      CERRADO
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
                    <span>Ventas: ${(c.totalSalesUsdCents / 100).toFixed(2)}</span>
                    <span>CMV: ${(c.totalCogsUsdCents / 100).toFixed(2)}</span>
                    <span>Mermas: ${(c.totalWasteUsdCents / 100).toFixed(2)}</span>
                    <span>Gastos: ${(c.totalExpensesUsdCents / 100).toFixed(2)}</span>
                  </div>
                  {c.notes && <p className="text-[11px] text-ink-muted italic">{c.notes}</p>}
                </div>

                <div className="flex items-center gap-4 justify-between sm:justify-end">
                  <div className="text-right">
                    <span className="text-[10px] text-ink-muted uppercase block font-bold">
                      Utilidad Neta
                    </span>
                    <span className="text-xl font-black text-success">
                      ${(c.netProfitUsdCents / 100).toFixed(2)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onExportExcel(c.year, c.month)}
                      className="p-2.5 rounded-xl border border-border hover:bg-surface-alt text-xs font-bold text-ink transition-colors"
                      title="Exportar cierre a Excel"
                    >
                      <Icon name="FileSpreadsheet" size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onExportPdf(c.year, c.month)}
                      className="p-2.5 rounded-xl border border-border hover:bg-surface-alt text-xs font-bold text-ink transition-colors"
                      title="Exportar cierre a PDF"
                    >
                      <Icon name="FileText" size={16} />
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
