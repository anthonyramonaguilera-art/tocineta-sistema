import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.js';
import { Button, Icon, Select } from '../../ui/index.js';
import { useFinancesQueries } from './useFinancesQueries.js';
import { OwnerNumbersConfigModal } from './OwnerNumbersConfigModal.js';
import { ExpenseModal } from './ExpenseModal.js';
import { ExpensesTab } from './ExpensesTab.js';
import { ReceivableModal } from './ReceivableModal.js';
import { ReceivablePaymentModal } from './ReceivablePaymentModal.js';
import { CustomerStatementModal } from './CustomerStatementModal.js';
import { ReceivablesTab, type ReceivableItem } from './ReceivablesTab.js';
import { PayablePaymentModal } from './PayablePaymentModal.js';
import { PayablesTab, type PayableItem } from './PayablesTab.js';
import { ProfitAndLossTab } from './ProfitAndLossTab.js';
import { CashFlowTab } from './CashFlowTab.js';
import { MonthlyClosureTab } from './MonthlyClosureTab.js';

export type FinanceSubTab = 'expenses' | 'receivables' | 'payables' | 'pnl' | 'cashflow' | 'closures';

export const FinancesDashboardView: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<FinanceSubTab>('pnl');
  const [selectedLocation, setSelectedLocation] = useState<string>('loc_alta_vista');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('30d');

  // Modales
  const [isNumbersConfigOpen, setIsNumbersConfigOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isReceivableModalOpen, setIsReceivableModalOpen] = useState(false);
  const [selectedReceivableForPayment, setSelectedReceivableForPayment] = useState<ReceivableItem | null>(null);
  const [selectedCustomerForStatement, setSelectedCustomerForStatement] = useState<string | null>(null);
  const [selectedPayableForPayment, setSelectedPayableForPayment] = useState<PayableItem | null>(null);

  // Calcular rango de fechas normalizado a inicio del día (evita re-render y query-loops)
  const startDateMs = React.useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const startOfTodayMs = d.getTime();
    if (selectedPeriod === 'today') {
      return startOfTodayMs;
    }
    if (selectedPeriod === '7d') {
      return startOfTodayMs - 7 * 24 * 3600_000;
    }
    return startOfTodayMs - 30 * 24 * 3600_000;
  }, [selectedPeriod]);

  const {
    numbersData,
    categoriesData,
    expensesData,
    loadingExpenses,
    customersData,
    receivablesData,
    loadingReceivables,
    payablesData,
    loadingPayables,
    pnlData,
    loadingPnl,
    cashFlowData,
    loadingCashFlow,
    closuresData,
    loadingClosures,
    statementData,
    saveExpenseMutation,
    saveReceivableMutation,
    saveReceivablePaymentMutation,
    savePayablePaymentMutation,
    createClosureMutation
  } = useFinancesQueries(selectedLocation, startDateMs, selectedCustomerForStatement, user?.id || 'usr_admin');

  const handleSendWhatsApp = async (receivableId: string) => {
    try {
      const res = await fetch(`/api/finances/receivables/${receivableId}/whatsapp`);
      const json = await res.json();
      if (json.data?.url) {
        window.open(json.data.url, '_blank');
      }
    } catch {}
  };

  const handleExport = (type: 'excel' | 'pdf') => {
    window.open(`/api/finances/export/${type}?locationId=${selectedLocation}&startDateMs=${startDateMs}`, '_blank');
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      {/* 1. Encabezado de Finanzas & Controles */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-black text-xl tracking-tight text-ink uppercase">
              Finanzas TOCINETA
            </span>
          </div>
          <p className="text-xs text-ink-muted">
            Panel financiero integral: ventas, gastos, cobranza, pagos a proveedores y rentabilidad neta real.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Selector de Sede */}
          <div className="w-36">
            <Select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              options={[
                { value: 'loc_alta_vista', label: 'Alta Vista' },
                { value: 'loc_los_olivos', label: 'Los Olivos' }
              ]}
            />
          </div>

          {/* Selector de Período */}
          <div className="w-32">
            <Select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              options={[
                { value: 'today', label: 'Hoy' },
                { value: '7d', label: '7 Días' },
                { value: '30d', label: '30 Días' }
              ]}
            />
          </div>

          {/* Exportar */}
          <Button variant="ghost" onClick={() => handleExport('excel')} className="text-xs font-bold">
            <Icon name="FileSpreadsheet" size={16} className="mr-1" />
            Excel
          </Button>
          <Button variant="ghost" onClick={() => handleExport('pdf')} className="text-xs font-bold">
            <Icon name="FileText" size={16} className="mr-1" />
            PDF
          </Button>
        </div>
      </div>

      {/* 2. Cinco Números de la Dueña */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-black uppercase text-ink-muted tracking-wider">
            Inicio de la Dueña — Números de Hoy
          </span>
          <button
            type="button"
            onClick={() => setIsNumbersConfigOpen(true)}
            className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
          >
            <Icon name="Sliders" size={14} />
            <span>Configurar Números</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {numbersData?.metrics?.map((m: any) => (
            <div
              key={m.key}
              className="p-4 bg-surface rounded-2xl border border-border shadow-xs hover:border-primary/40 transition-colors"
            >
              <span className="text-[10px] font-bold text-ink-muted uppercase block truncate mb-1">
                {m.label}
              </span>
              <div className="text-2xl font-black text-ink tracking-tight truncate">
                {m.formattedValue}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Acciones Rápidas (1 Toque) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Button
          variant="primary"
          onClick={() => setIsExpenseModalOpen(true)}
          className="min-h-[54px] text-sm font-bold shadow-xs justify-start px-4"
        >
          <Icon name="MinusCircle" size={20} className="mr-3 text-primary-contrast/90" />
          <div className="text-left">
            <span className="block leading-tight">Registrar Gasto</span>
            <span className="text-[10px] opacity-80 font-normal">Caja chica o compra menor</span>
          </div>
        </Button>

        <Button
          variant="secondary"
          onClick={() => setIsReceivableModalOpen(true)}
          className="min-h-[54px] text-sm font-bold shadow-xs justify-start px-4"
        >
          <Icon name="PlusCircle" size={20} className="mr-3" />
          <div className="text-left">
            <span className="block leading-tight">Nuevo Crédito / Fiado</span>
            <span className="text-[10px] text-ink-muted font-normal">Clientes, socios o eventos</span>
          </div>
        </Button>

        <Button
          variant="secondary"
          onClick={() => setActiveTab('payables')}
          className="min-h-[54px] text-sm font-bold shadow-xs justify-start px-4"
        >
          <Icon name="ArrowUpRight" size={20} className="mr-3 text-danger" />
          <div className="text-left">
            <span className="block leading-tight">Pagar a Proveedor</span>
            <span className="text-[10px] text-ink-muted font-normal">Facturas con vencimiento</span>
          </div>
        </Button>
      </div>

      {/* 4. Sub-Pestañas de Navegación */}
      <div className="border-b border-border flex items-center gap-1 overflow-x-auto pb-1">
        {([
          { key: 'pnl', label: 'Utilidad (P&L)', icon: 'TrendingUp' },
          { key: 'cashflow', label: 'Flujo de Caja', icon: 'Layers' },
          { key: 'expenses', label: 'Gastos', icon: 'Receipt' },
          { key: 'receivables', label: 'Por Cobrar', icon: 'UserCheck' },
          { key: 'payables', label: 'Por Pagar', icon: 'Truck' },
          { key: 'closures', label: 'Cierre Mensual', icon: 'Lock' }
        ] as const).map((tab) => (
          <button
            key={tab.key}
            type="button"
            data-subtab={tab.key}
            onClick={() => setActiveTab(tab.key as FinanceSubTab)}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-tight flex items-center gap-2 transition-all whitespace-nowrap min-h-[44px] ${
              activeTab === tab.key
                ? 'bg-ink text-surface shadow-xs'
                : 'text-ink-muted hover:text-ink hover:bg-surface'
            }`}
          >
            <Icon name={tab.icon} size={15} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 5. Contenido de la Sub-Pestaña Activa */}
      <div>
        {activeTab === 'pnl' && <ProfitAndLossTab pnlData={pnlData} isLoading={loadingPnl} />}
        {activeTab === 'cashflow' && <CashFlowTab cashFlowData={cashFlowData} isLoading={loadingCashFlow} />}
        {activeTab === 'expenses' && (
          <ExpensesTab
            expenses={expensesData}
            onOpenNewExpense={() => setIsExpenseModalOpen(true)}
            isLoading={loadingExpenses}
          />
        )}
        {activeTab === 'receivables' && (
          <ReceivablesTab
            receivables={receivablesData}
            onOpenNewReceivable={() => setIsReceivableModalOpen(true)}
            onOpenPayment={(r) => setSelectedReceivableForPayment(r)}
            onOpenStatement={(cId) => setSelectedCustomerForStatement(cId)}
            onSendWhatsApp={handleSendWhatsApp}
            isLoading={loadingReceivables}
          />
        )}
        {activeTab === 'payables' && (
          <PayablesTab
            payables={payablesData}
            onOpenPayment={(p) => setSelectedPayableForPayment(p)}
            isLoading={loadingPayables}
          />
        )}
        {activeTab === 'closures' && (
          <MonthlyClosureTab
            closures={closuresData}
            onCreateClosure={(yr, mo, notes) => createClosureMutation.mutateAsync({ year: yr, month: mo, notes })}
            onExportExcel={(_yr, _mo) => handleExport('excel')}
            onExportPdf={(_yr, _mo) => handleExport('pdf')}
            isLoading={loadingClosures}
          />
        )}
      </div>

      {/* Modales */}
      <OwnerNumbersConfigModal
        isOpen={isNumbersConfigOpen}
        onClose={() => setIsNumbersConfigOpen(false)}
        currentKeys={numbersData?.configuredKeys || []}
        onSave={async (keys) => {
          await fetch('/api/finances/owner-numbers/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keys })
          });
          queryClient.invalidateQueries({ queryKey: ['finances', 'owner-numbers'] });
        }}
      />

      <ExpenseModal
        isOpen={isExpenseModalOpen}
        onClose={() => setIsExpenseModalOpen(false)}
        categories={categoriesData || []}
        onAddCategory={async (name) => {
          const res = await fetch('/api/finances/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
          });
          const json = await res.json();
          queryClient.invalidateQueries({ queryKey: ['finances', 'categories'] });
          return json.data;
        }}
        currentLocationId={selectedLocation}
        onSaveExpense={async (data) => {
          await saveExpenseMutation.mutateAsync(data);
        }}
        userId={user?.id || 'usr_admin'}
      />

      <ReceivableModal
        isOpen={isReceivableModalOpen}
        onClose={() => setIsReceivableModalOpen(false)}
        customers={customersData || []}
        currentLocationId={selectedLocation}
        onSaveReceivable={async (data) => {
          await saveReceivableMutation.mutateAsync(data);
        }}
        userId={user?.id || 'usr_admin'}
      />

      <ReceivablePaymentModal
        isOpen={Boolean(selectedReceivableForPayment)}
        onClose={() => setSelectedReceivableForPayment(null)}
        receivable={selectedReceivableForPayment}
        onSavePayment={async (data) => {
          await saveReceivablePaymentMutation.mutateAsync(data);
        }}
        userId={user?.id || 'usr_admin'}
      />

      <CustomerStatementModal
        isOpen={Boolean(selectedCustomerForStatement)}
        onClose={() => setSelectedCustomerForStatement(null)}
        statement={statementData}
        onSendWhatsApp={(acc) => handleSendWhatsApp(acc.id)}
      />

      <PayablePaymentModal
        isOpen={Boolean(selectedPayableForPayment)}
        onClose={() => setSelectedPayableForPayment(null)}
        payable={selectedPayableForPayment}
        onSavePayment={async (data) => {
          await savePayablePaymentMutation.mutateAsync(data);
        }}
        userId={user?.id || 'usr_admin'}
      />
    </div>
  );
};
