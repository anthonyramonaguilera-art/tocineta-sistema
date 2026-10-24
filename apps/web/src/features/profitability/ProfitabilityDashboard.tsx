import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Layers,
  AlertTriangle,
  CheckCircle,
  Activity,
  Sliders,
  Plus,
  Printer,
  ShoppingBag,
  ArrowDownRight,
  Users,
  Briefcase,
  Download,
  Share2
} from 'lucide-react';
import { PedagogicalGuideBanner } from '../../components/PedagogicalGuideBanner.js';

export const ProfitabilityDashboard: React.FC = () => {
  const queryClient = useQueryClient();

  // Subpestañas del Dashboard Ejecutivo estilo Treinta + Valery
  const [activeSubTab, setActiveSubTab] = useState<
    'net-profit' | 'purchases' | 'recipes' | 'mermas' | 'receivables' | 'payroll' | 'settings'
  >(() => {
    try {
      const saved = localStorage.getItem('tocineta_profit_subtab');
      if (saved) return saved as any;
    } catch {}
    return 'net-profit';
  });

  // Escuchar eventos de navegación desde el Drawer RePOS / Treinta
  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail) {
        if (e.detail === 'inventory') setActiveSubTab('purchases');
        else if (e.detail === 'expenses') setActiveSubTab('mermas');
        else if (e.detail === 'receivables') setActiveSubTab('receivables');
        else if (e.detail === 'purchases') setActiveSubTab('purchases');
        else if (e.detail === 'mermas') setActiveSubTab('mermas');
        else if (e.detail === 'payroll') setActiveSubTab('payroll');
        else setActiveSubTab(e.detail);
      }
    };
    window.addEventListener('switch-profitability-subtab', handler);
    return () => window.removeEventListener('switch-profitability-subtab', handler);
  }, []);

  // Modales
  const [isOutputModalOpen, setIsOutputModalOpen] = useState(false);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [isPayrollModalOpen, setIsPayrollModalOpen] = useState(false);
  const [isPayReceivableModalOpen, setIsPayReceivableModalOpen] = useState(false);
  const [ticketModalText, setTicketModalText] = useState<string | null>(null);

  // Formulario Salida / Merma / Consumo Interno
  const [outputReason, setOutputReason] = useState<'MERMA_SOCIOS' | 'CENA_EMPLEADOS' | 'GASTO_GAS_INSUMO'>('MERMA_SOCIOS');
  const [outputSupplyId, setOutputSupplyId] = useState('');
  const [outputPartnerId, setOutputPartnerId] = useState('');
  const [outputQuantity, setOutputQuantity] = useState('1');
  const [outputNotes, setOutputNotes] = useState('');

  // Formulario Compra
  const [purchaseSupplierId, setPurchaseSupplierId] = useState('');
  const [purchaseInvoiceNumber, setPurchaseInvoiceNumber] = useState('');
  const [purchasePaymentCondition, setPurchasePaymentCondition] = useState<'CONTADO' | 'CREDITO'>('CONTADO');
  const [purchaseItems, setPurchaseItems] = useState<Array<{ supplyId: string; quantity: number; unitCostUsdCents: number }>>([
    { supplyId: 'sup_pan_artesanal', quantity: 30, unitCostUsdCents: 45 }
  ]);
  const [purchaseNotes, setPurchaseNotes] = useState('');

  // Formulario Nómina
  const [payrollStaffName, setPayrollStaffName] = useState('Personal de Turno');
  const [payrollPaymentType, setPayrollPaymentType] = useState<'SUELDO_TURNO' | 'QUINCENA' | 'BONO' | 'ADELANTO_VALE'>('SUELDO_TURNO');
  const [payrollAmountUsd, setPayrollAmountUsd] = useState('15.00');
  const [payrollPaymentMethod, setPayrollPaymentMethod] = useState('EFECTIVO_USD');
  const [payrollNotes, setPayrollNotes] = useState('');

  // Formulario Cobro / Abono Cliente
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [payAmountUsd, setPayAmountUsd] = useState('');
  const [payNotes, setPayNotes] = useState('');

  // Generador Cotización
  const [quoteClientName, setQuoteClientName] = useState('Cliente Corporativo / Evento');
  const [quoteBurgerCount, setQuoteBurgerCount] = useState(15);
  const [quoteDogCount, setQuoteDogCount] = useState(15);

  // 1. Query Configuración de Interruptores
  const { data: settingsData } = useQuery<{
    profitabilityProEnabled: boolean;
    fiscalModuleEnabled: boolean;
    fiscalPriceMode?: 'INCLUSIVE' | 'EXCLUSIVE';
    igtfEnabled?: boolean;
    igtfRateBps?: number;
    igtfAppliesTo?: 'CASH_USD' | 'ALL_USD' | 'NONE';
  }>({
    queryKey: ['profitabilitySettings'],
    queryFn: async () => {
      const res = await fetch('/api/profitability/settings');
      return res.json();
    }
  });

  // 2. Query Balance Ejecutivo Treinta + Valery
  const { data: executiveData, refetch: refetchExecutive } = useQuery<{
    totalSalesUsdCents: number;
    totalSalesBsCents: number;
    costOfGoodsSoldUsdCents: number;
    grossProfitUsdCents: number;
    operatingExpensesUsdCents: number;
    netProfitUsdCents: number;
    netProfitBsCents: number;
    netMarginPercent: number;
    foodCostPercent: number;
    bcvRateFormatted: string;
    bcvRateLabel: string;
    summary: {
      totalPurchasesUsdCents: number;
      totalPayrollUsdCents: number;
      totalGasUsdCents: number;
      totalCenaEmpleadosUsdCents: number;
      totalReceivablesUsdCents: number;
      totalOwedToSuppliersUsdCents: number;
    };
  }>({
    queryKey: ['executiveBalance'],
    queryFn: async () => {
      const res = await fetch('/api/profitability/executive-balance');
      return res.json();
    },
    refetchInterval: 10000
  });

  // 3. Query Insumos / Materia Prima
  const { data: suppliesData, refetch: refetchSupplies } = useQuery<{ supplies: any[] }>({
    queryKey: ['profitabilitySupplies'],
    queryFn: async () => {
      const res = await fetch('/api/profitability/supplies');
      return res.json();
    }
  });

  // 4. Query Proveedores
  const { data: suppliersData, refetch: refetchSuppliers } = useQuery<{ suppliers: any[] }>({
    queryKey: ['profitabilitySuppliers'],
    queryFn: async () => {
      const res = await fetch('/api/profitability/suppliers');
      return res.json();
    }
  });

  // 5. Query Clientes & Socios
  const { data: customersData, refetch: refetchCustomers } = useQuery<{ customers: any[] }>({
    queryKey: ['profitabilityCustomers'],
    queryFn: async () => {
      const res = await fetch('/api/profitability/customers');
      return res.json();
    }
  });

  // 6. Query Compras
  const { data: purchasesData, refetch: refetchPurchases } = useQuery<{ purchases: any[] }>({
    queryKey: ['profitabilityPurchases'],
    queryFn: async () => {
      const res = await fetch('/api/profitability/purchases');
      return res.json();
    }
  });

  // 7. Query Nómina
  const { data: payrollData, refetch: refetchPayroll } = useQuery<{ payments: any[] }>({
    queryKey: ['profitabilityPayroll'],
    queryFn: async () => {
      const res = await fetch('/api/profitability/payroll');
      return res.json();
    }
  });

  // 8. Query Movimientos (Kardex)
  const { data: movementsData, refetch: refetchMovements } = useQuery<{ movements: any[] }>({
    queryKey: ['profitabilityMovements'],
    queryFn: async () => {
      const res = await fetch('/api/profitability/movements');
      return res.json();
    }
  });

  // 9. Query Recetas Estandarizadas
  const { data: recipesData } = useQuery<{ recipes: any[] }>({
    queryKey: ['profitabilityRecipes'],
    queryFn: async () => {
      const res = await fetch('/api/profitability/recipes');
      return res.json();
    }
  });

  // Mutación: Registrar Salida / Merma / Consumo Interno
  const outputMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/profitability/inventory-output', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.json();
    },
    onSuccess: (data) => {
      setIsOutputModalOpen(false);
      refetchExecutive();
      refetchSupplies();
      refetchCustomers();
      refetchMovements();
      if (data.ticketText) {
        setTicketModalText(data.ticketText);
      }
    }
  });

  // Mutación: Registrar Compra
  const purchaseMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/profitability/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.json();
    },
    onSuccess: () => {
      setIsPurchaseModalOpen(false);
      refetchExecutive();
      refetchPurchases();
      refetchSupplies();
      refetchSuppliers();
      refetchMovements();
    }
  });

  // Mutación: Registrar Pago Nómina
  const payrollMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/profitability/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.json();
    },
    onSuccess: () => {
      setIsPayrollModalOpen(false);
      refetchExecutive();
      refetchPayroll();
    }
  });

  // Mutación: Abonar Cuenta por Cobrar
  const payReceivableMutation = useMutation({
    mutationFn: async ({ customerId, amountUsdCents, notes }: any) => {
      const res = await fetch(`/api/profitability/customers/${customerId}/pay-receivable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountUsdCents, notes })
      });
      return res.json();
    },
    onSuccess: () => {
      setIsPayReceivableModalOpen(false);
      refetchExecutive();
      refetchCustomers();
    }
  });

  // Mutación: Actualizar Configuración Fiscal
  const updateSettingsMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/profitability/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profitabilitySettings'] });
    }
  });

  const handleDownloadReport = () => {
    if (!executiveData) return;
    const lines = [
      '====================================================',
      '        TOCINETA SONRIE - REPORTE DE GESTION        ',
      '              Food Truck Puerto Ordaz               ',
      '====================================================',
      `Fecha: ${new Date().toLocaleString()}`,
      `Tasa Oficial: ${executiveData.bcvRateLabel} (${executiveData.bcvRateFormatted} Bs/$)`,
      '----------------------------------------------------',
      `Ventas Totales: $${(executiveData.totalSalesUsdCents / 100).toFixed(2)} (${(executiveData.totalSalesBsCents / 100).toFixed(2)} Bs)`,
      `Costo de Mercancia Vendida (COGS): $${(executiveData.costOfGoodsSoldUsdCents / 100).toFixed(2)} (${executiveData.foodCostPercent}%)`,
      `Ganancia Bruta: $${(executiveData.grossProfitUsdCents / 100).toFixed(2)}`,
      `Gastos Operativos (Caja Chica, Gas, Compras, Nomina): $${(executiveData.operatingExpensesUsdCents / 100).toFixed(2)}`,
      '----------------------------------------------------',
      `UTILIDAD NETA LIBRE: $${(executiveData.netProfitUsdCents / 100).toFixed(2)} (${(executiveData.netProfitBsCents / 100).toFixed(2)} Bs)`,
      `Margen Neto: ${executiveData.netMarginPercent}%`,
      '----------------------------------------------------',
      `Total Compras Realizadas: $${(executiveData.summary.totalPurchasesUsdCents / 100).toFixed(2)}`,
      `Total Nomina y Personal: $${(executiveData.summary.totalPayrollUsdCents / 100).toFixed(2)}`,
      `Total Gas e Insumos Operativos: $${(executiveData.summary.totalGasUsdCents / 100).toFixed(2)}`,
      `Total Cena para Empleados: $${(executiveData.summary.totalCenaEmpleadosUsdCents / 100).toFixed(2)}`,
      `Total Por Cobrar (Clientes y Socios): $${(executiveData.summary.totalReceivablesUsdCents / 100).toFixed(2)}`,
      `Total Por Pagar a Proveedores: $${(executiveData.summary.totalOwedToSuppliersUsdCents / 100).toFixed(2)}`,
      '===================================================='
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Reporte_TocinetaSonrie_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isFiscalEnabled = settingsData?.fiscalModuleEnabled ?? false;

  return (
    <div className="space-y-6">
      {/* Guía Pedagógica */}
      <PedagogicalGuideBanner
        title="Balance Ejecutivo & Rentabilidad Real (Treinta + Valery)"
        description="Control integral de costos de recetas, compras de materia prima, mermas con reposición de socios, nómina y cuentas por cobrar."
        storageKey="banner_profitability"
      />

      {/* TARJETA SUPERIOR DE BALANCE EJECUTIVO (ESTILO TREINTA + VALERY) */}
      <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-3xl p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          {/* Métricas Principales */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">
                BALANCE EJECUTIVO TREINTA & VALERY
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-neutral-800 text-slate-600 dark:text-slate-300 font-mono">
                {executiveData?.bcvRateLabel || 'BCV Día Siguiente'}: {executiveData?.bcvRateFormatted || '40,00'} Bs/$
              </span>
            </div>

            <div className="flex flex-wrap items-baseline gap-3">
              <div className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white font-mono">
                ${((executiveData?.netProfitUsdCents ?? 0) / 100).toFixed(2)}
              </div>
              <div className="text-base sm:text-lg font-bold text-slate-500 dark:text-slate-400 font-mono">
                ≈ {((executiveData?.netProfitBsCents ?? 0) / 100).toFixed(2)} Bs
              </div>
              <span className="px-2.5 py-1 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-black">
                Ganancia Neta Real: {executiveData?.netMarginPercent ?? 0}%
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800">
                <span className="text-[10px] text-slate-500 block uppercase font-bold">↗ Ventas Totales</span>
                <span className="text-sm font-black text-slate-900 dark:text-white font-mono">
                  ${((executiveData?.totalSalesUsdCents ?? 0) / 100).toFixed(2)}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800">
                <span className="text-[10px] text-slate-500 block uppercase font-bold">↙ Egresos & Compras</span>
                <span className="text-sm font-black text-red-500 font-mono">
                  ${((executiveData?.operatingExpensesUsdCents ?? 0) / 100).toFixed(2)}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800">
                <span className="text-[10px] text-slate-500 block uppercase font-bold">Ganancia Bruta</span>
                <span className="text-sm font-black text-blue-600 dark:text-blue-400 font-mono">
                  ${((executiveData?.grossProfitUsdCents ?? 0) / 100).toFixed(2)}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800">
                <span className="text-[10px] text-slate-500 block uppercase font-bold">Food Cost Recetas</span>
                <span className="text-sm font-black text-amber-500 font-mono">
                  {executiveData?.foodCostPercent ?? 0}%
                </span>
              </div>
            </div>
          </div>

          {/* Botones de Acción Inmediata estilo Treinta */}
          <div className="flex flex-wrap lg:flex-col gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                window.location.hash = '#pos';
                window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'pos' }));
              }}
              className="flex-1 lg:flex-none px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              <CheckCircle className="w-4 h-4" />
              <span>✓ Nueva Venta</span>
            </button>

            <button
              type="button"
              onClick={() => setIsOutputModalOpen(true)}
              className="flex-1 lg:flex-none px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              <ArrowDownRight className="w-4 h-4" />
              <span>⊖ Nuevo Gasto / Merma</span>
            </button>

            <button
              type="button"
              onClick={() => setIsPurchaseModalOpen(true)}
              className="flex-1 lg:flex-none px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>🛒 Compra a Proveedor</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadReport}
              className="flex-1 lg:flex-none px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-800 dark:text-white text-xs font-bold flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>📥 Descargar Reportes</span>
            </button>
          </div>
        </div>
      </div>

      {/* 6 PESTAÑAS CLARAS Y VISIBLES ARRIBA (SIN ESCONDER NADA) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => setActiveSubTab('net-profit')}
          className={`px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 cursor-pointer ${
            activeSubTab === 'net-profit'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-neutral-800'
          }`}
        >
          <span>📊</span>
          <span>Balance y Flujo del Día</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('purchases')}
          className={`px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 cursor-pointer ${
            activeSubTab === 'purchases'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-neutral-800'
          }`}
        >
          <span>🥩</span>
          <span>Materia Prima y Compras (50+ Ítems)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('recipes')}
          className={`px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 cursor-pointer ${
            activeSubTab === 'recipes'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-neutral-800'
          }`}
        >
          <span>🍔</span>
          <span>Recetas y Rendimiento</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('mermas')}
          className={`px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 cursor-pointer ${
            activeSubTab === 'mermas'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-neutral-800'
          }`}
        >
          <span>📉</span>
          <span>Mermas & Facturas Socios</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('receivables')}
          className={`px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 cursor-pointer ${
            activeSubTab === 'receivables'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-neutral-800'
          }`}
        >
          <span>🤝</span>
          <span>Clientes & Proveedores (CxC / CxP)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('payroll')}
          className={`px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 cursor-pointer ${
            activeSubTab === 'payroll'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-neutral-800'
          }`}
        >
          <span>💼</span>
          <span>Nómina y Pagos a Personal</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('settings')}
          className={`px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 cursor-pointer ${
            activeSubTab === 'settings'
              ? 'bg-slate-700 text-white shadow-sm'
              : 'bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-neutral-800'
          }`}
        >
          <span>⚙️</span>
          <span>Fiscal & Parámetros</span>
        </button>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* PESTAÑA 1: BALANCE Y FLUJO DEL DÍA                                  */}
      {/* -------------------------------------------------------------------- */}
      {activeSubTab === 'net-profit' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 p-5 rounded-2xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase">Total Por Cobrar</span>
                <span className="text-lg">👤</span>
              </div>
              <div className="text-2xl font-black text-blue-600 dark:text-blue-400 font-mono mt-2">
                ${((executiveData?.summary.totalReceivablesUsdCents ?? 0) / 100).toFixed(2)}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Cuentas pendientes de clientes y socios.</p>
            </div>

            <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 p-5 rounded-2xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase">Total Por Pagar a Proveedores</span>
                <span className="text-lg">🛒</span>
              </div>
              <div className="text-2xl font-black text-amber-500 font-mono mt-2">
                ${((executiveData?.summary.totalOwedToSuppliersUsdCents ?? 0) / 100).toFixed(2)}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Facturas de compras a crédito pendientes.</p>
            </div>

            <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 p-5 rounded-2xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase">Cena Empleados & Gas</span>
                <span className="text-lg">🔥</span>
              </div>
              <div className="text-2xl font-black text-slate-900 dark:text-white font-mono mt-2">
                ${(((executiveData?.summary.totalGasUsdCents ?? 0) + (executiveData?.summary.totalCenaEmpleadosUsdCents ?? 0)) / 100).toFixed(2)}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Costos operativos directos del Food Truck.</p>
            </div>
          </div>

          {/* Historial de Movimientos de Dinero e Inventario */}
          <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-200 dark:border-neutral-800 flex items-center justify-between">
              <h4 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-500" />
                <span>Flujo de Kardex y Movimientos Recientes</span>
              </h4>
              <button
                type="button"
                onClick={() => refetchMovements()}
                className="text-xs text-blue-600 dark:text-blue-400 font-bold hover:underline"
              >
                Actualizar
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-neutral-900 text-slate-500 border-b border-slate-200 dark:border-neutral-800">
                  <tr>
                    <th className="p-3">Fecha</th>
                    <th className="p-3">Tipo Movimiento</th>
                    <th className="p-3">Insumo</th>
                    <th className="p-3">Cantidad</th>
                    <th className="p-3">Costo Total ($)</th>
                    <th className="p-3">Notas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                  {(movementsData?.movements || []).slice(0, 15).map((m: any) => (
                    <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-neutral-800/40">
                      <td className="p-3 text-slate-400 font-mono text-[10px]">
                        {new Date(m.created_at_ms).toLocaleTimeString()}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          m.movement_type === 'COMPRA_ENTRADA' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                          m.movement_type === 'MERMA_SOCIOS' ? 'bg-red-500/20 text-red-600 dark:text-red-400' :
                          'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                        }`}>
                          {m.movement_type}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-slate-800 dark:text-slate-200">{m.supply_id}</td>
                      <td className="p-3 font-mono">{m.quantity_delta}</td>
                      <td className="p-3 font-mono font-bold text-slate-900 dark:text-white">
                        ${(m.total_cost_usd_cents / 100).toFixed(2)}
                      </td>
                      <td className="p-3 text-slate-500 text-[11px]">{m.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* PESTAÑA 2: MATERIA PRIMA Y COMPRAS (50+ ÍTEMS)                      */}
      {/* -------------------------------------------------------------------- */}
      {activeSubTab === 'purchases' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Package className="w-5 h-5 text-blue-500" />
                <span>Inventario y Materia Prima (50+ Ítems Estandarizados)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Control estricto de carnes, tocineta, quesos, pan artesanal, salsas e insumos en gramos y unidades.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsPurchaseModalOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Registrar Compra a Proveedor</span>
            </button>
          </div>

          <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-neutral-900 text-slate-500 border-b border-slate-200 dark:border-neutral-800">
                  <tr>
                    <th className="p-3">Insumo</th>
                    <th className="p-3">Categoría</th>
                    <th className="p-3">Medida</th>
                    <th className="p-3">Costo Actual ($)</th>
                    <th className="p-3">Costo Anterior ($)</th>
                    <th className="p-3">Stock Físico</th>
                    <th className="p-3">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                  {(suppliesData?.supplies || []).map((s: any) => {
                    const isLow = (s.currentStockUnits ?? s.current_stock_units ?? 0) < 15;
                    const prev = (s.previousCostUsdCents ?? s.costUsdCents ?? 0) / 100;
                    const curr = (s.costUsdCents ?? 0) / 100;
                    const diffPct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;

                    return (
                      <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-neutral-800/40">
                        <td className="p-3 font-bold text-slate-900 dark:text-white">{s.name}</td>
                        <td className="p-3 text-slate-500 uppercase text-[10px] font-mono">{s.category}</td>
                        <td className="p-3 font-mono text-slate-600 dark:text-slate-300">{s.unitMeasure || s.unit_measure || 'und'}</td>
                        <td className="p-3 font-mono font-bold text-slate-900 dark:text-white">${curr.toFixed(2)}</td>
                        <td className="p-3 font-mono text-slate-400">
                          ${prev.toFixed(2)}
                          {diffPct > 0.01 && (
                            <span className="ml-1 text-[9px] font-bold text-red-500">⬆️ +{diffPct.toFixed(0)}%</span>
                          )}
                        </td>
                        <td className="p-3 font-mono font-bold text-slate-800 dark:text-slate-200">
                          {s.currentStockUnits ?? s.current_stock_units ?? 0} {s.unitMeasure || 'und'}
                        </td>
                        <td className="p-3">
                          {isLow ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400">
                              ⚠️ Pedir Reposición
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                              ✓ Stock Óptimo
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Historial de Compras Registradas */}
          <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-200 dark:border-neutral-800 flex items-center justify-between">
              <h4 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-blue-500" />
                <span>Historial de Compras de Materia Prima a Proveedores</span>
              </h4>
              <span className="text-[10px] text-slate-400 font-mono">
                {(purchasesData?.purchases || []).length} compras registradas
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-neutral-900 text-slate-500 border-b border-slate-200 dark:border-neutral-800">
                  <tr>
                    <th className="p-3">Fecha</th>
                    <th className="p-3">Factura</th>
                    <th className="p-3">Condición</th>
                    <th className="p-3">Monto USD ($)</th>
                    <th className="p-3">Monto Bs</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3">Notas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                  {(purchasesData?.purchases || []).map((p: any) => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-neutral-800/40">
                      <td className="p-3 font-mono text-[10px] text-slate-400">
                        {new Date(p.created_at_ms).toLocaleDateString()} {new Date(p.created_at_ms).toLocaleTimeString()}
                      </td>
                      <td className="p-3 font-mono font-bold text-slate-900 dark:text-white">{p.invoice_number || p.id}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          p.payment_condition === 'CREDITO' ? 'bg-amber-500/20 text-amber-500' : 'bg-emerald-500/20 text-emerald-500'
                        }`}>
                          {p.payment_condition}
                        </span>
                      </td>
                      <td className="p-3 font-mono font-bold text-slate-900 dark:text-white">
                        ${(p.total_usd_cents / 100).toFixed(2)}
                      </td>
                      <td className="p-3 font-mono text-slate-500">
                        {(p.total_bs_cents / 100).toFixed(2)} Bs
                      </td>
                      <td className="p-3 font-mono text-emerald-500 font-bold text-[10px]">{p.status}</td>
                      <td className="p-3 text-slate-400 text-[11px]">{p.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* PESTAÑA 3: RECETAS ESTANDARIZADAS Y RENDIMIENTO                      */}
      {/* -------------------------------------------------------------------- */}
      {activeSubTab === 'recipes' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-2xl p-5 shadow-sm">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-500" />
              <span>Escandallos y Gramaje Exacto de Recetas</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Cálculo de costo financiero exacto por plato con rendimiento proyectado según el stock de carnes y panes.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(recipesData?.recipes || []).map((r: any) => (
              <div key={r.productId} className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">{r.productName}</h4>
                  <span className="text-[10px] font-mono font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded">
                    Rinde {r.possibleDishesWithCurrentStock} platos
                  </span>
                </div>
                <div className="text-xs space-y-1 text-slate-500">
                  <div className="flex justify-between">
                    <span>Costo de Receta:</span>
                    <strong className="text-slate-900 dark:text-white font-mono">${(r.recipeCostUsdCents / 100).toFixed(2)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Insumos utilizados:</span>
                    <span>{r.ingredientsCount} materias primas</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* PESTAÑA 4: MERMAS, CENA DE EMPLEADOS Y FACTURAS DE REPOSICIÓN A SOCIOS */}
      {/* -------------------------------------------------------------------- */}
      {activeSubTab === 'mermas' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <span>Control de Mermas, Reposición a Socios y Consumos del Personal</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Cada comida quemada o error en cocina genera una Factura de Reposición asignada a los socios.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsOutputModalOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Registrar Merma / Cena Empleados</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20 space-y-1">
              <span className="text-[11px] font-bold text-red-600 dark:text-red-400 uppercase">Mermas Facturadas a Socios</span>
              <div className="text-2xl font-black text-red-600 dark:text-red-400 font-mono">
                ${((executiveData?.summary.totalReceivablesUsdCents ?? 0) / 100).toFixed(2)}
              </div>
              <p className="text-[10px] text-slate-500">Monto total a reponer por los socios del food truck.</p>
            </div>

            <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-1">
              <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase">Cena para Empleados</span>
              <div className="text-2xl font-black text-amber-600 dark:text-amber-400 font-mono">
                ${((executiveData?.summary.totalCenaEmpleadosUsdCents ?? 0) / 100).toFixed(2)}
              </div>
              <p className="text-[10px] text-slate-500">Descontado del stock y registrado en el rubro contable de personal.</p>
            </div>

            <div className="p-4 rounded-2xl bg-blue-500/5 border border-blue-500/20 space-y-1">
              <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase">Gas Operativo</span>
              <div className="text-2xl font-black text-blue-600 dark:text-blue-400 font-mono">
                ${((executiveData?.summary.totalGasUsdCents ?? 0) / 100).toFixed(2)}
              </div>
              <p className="text-[10px] text-slate-500">Salidas de bombonas y combustible de cocina.</p>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* PESTAÑA 5: CLIENTES, PROVEEDORES Y CUENTAS POR COBRAR / PAGAR       */}
      {/* -------------------------------------------------------------------- */}
      {activeSubTab === 'receivables' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Clientes y Socios (Cuentas por Cobrar) */}
            <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h4 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-500" />
                  <span>Control de "Lo que me deben" (Clientes y Socios)</span>
                </h4>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-neutral-800 max-h-80 overflow-y-auto">
                {(customersData?.customers || []).map((c: any) => (
                  <div key={c.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <span>{c.name}</span>
                        {c.is_partner === 1 && (
                          <span className="px-1.5 py-0.2 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded text-[9px] font-black">
                            SOCIO
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">{c.phone || c.identification || 'Sin teléfono'}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-black text-red-500">
                        ${(c.balance_receivable_usd_cents / 100).toFixed(2)}
                      </div>
                      {c.balance_receivable_usd_cents > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCustomerId(c.id);
                            setPayAmountUsd((c.balance_receivable_usd_cents / 100).toFixed(2));
                            setIsPayReceivableModalOpen(true);
                          }}
                          className="mt-1 px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold cursor-pointer"
                        >
                          Abonar Pago
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Proveedores (Cuentas por Pagar) */}
            <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h4 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-amber-500" />
                  <span>Control de "Lo que debo a Proveedores"</span>
                </h4>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-neutral-800 max-h-80 overflow-y-auto">
                {(suppliersData?.suppliers || []).map((s: any) => (
                  <div key={s.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{s.name}</div>
                      <div className="text-[10px] text-slate-400 uppercase font-mono">{s.category || 'Materia Prima'}</div>
                    </div>
                    <div className="text-right font-mono">
                      <span className="text-[10px] text-slate-400 block uppercase">Saldo Adeudado:</span>
                      <span className="font-black text-amber-500">
                        ${(s.balance_owed_usd_cents / 100).toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Generador Rápido de Cotizaciones PDF / WhatsApp */}
          <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-2xl p-5 space-y-4 shadow-sm">
            <h4 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <Share2 className="w-4 h-4 text-emerald-500" />
              <span>Generador Rápido de Cotizaciones para Eventos y Empresas (WhatsApp / PDF)</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Nombre del Cliente / Empresa:</label>
                <input
                  type="text"
                  value={quoteClientName}
                  onChange={e => setQuoteClientName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-bold"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Cantidad Hamburguesas Especiales:</label>
                <input
                  type="number"
                  min="0"
                  value={quoteBurgerCount}
                  onChange={e => setQuoteBurgerCount(Number(e.target.value))}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Cantidad Hot Dogs Especiales:</label>
                <input
                  type="number"
                  min="0"
                  value={quoteDogCount}
                  onChange={e => setQuoteDogCount(Number(e.target.value))}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {(() => {
              const totalQuoteUsd = (quoteBurgerCount * 5.0) + (quoteDogCount * 2.5);
              const bcvRate = parseFloat(executiveData?.bcvRateFormatted?.replace(',', '.') || '40.0');
              const totalQuoteBs = totalQuoteUsd * bcvRate;

              const whatsappMessage = `*COTIZACIÓN OFICIAL - TOCINETA SONRÍE*%0ACliente: ${quoteClientName}%0A🍔 ${quoteBurgerCount}x Hamburguesas Especiales: $${(quoteBurgerCount * 5).toFixed(2)}%0A🌭 ${quoteDogCount}x Hot Dogs Especiales: $${(quoteDogCount * 2.5).toFixed(2)}%0A------------------------%0A*TOTAL: $${totalQuoteUsd.toFixed(2)} (${totalQuoteBs.toFixed(2)} Bs)*%0ATasa BCV Oficial: ${bcvRate.toFixed(2)} Bs/$%0AIncluye barra de salsas y empaque hermético.`;

              return (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-neutral-800">
                  <div className="text-xs">
                    <span className="text-slate-500">Monto Total de la Cotización: </span>
                    <strong className="text-emerald-600 dark:text-emerald-400 font-mono text-sm">
                      ${totalQuoteUsd.toFixed(2)} ({totalQuoteBs.toFixed(2)} Bs)
                    </strong>
                  </div>
                  <a
                    href={`https://wa.me/?text=${whatsappMessage}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm"
                  >
                    <span>💬 Enviar Cotización por WhatsApp</span>
                  </a>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* PESTAÑA 6: NÓMINA Y PAGOS A EMPLEADOS                                 */}
      {/* -------------------------------------------------------------------- */}
      {activeSubTab === 'payroll' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-blue-500" />
                <span>Gestión de Nómina y Pagos al Personal del Food Truck</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Registro de pagos de turno, quincenas, bonos de puntualidad y adelantos/vales de caja.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsPayrollModalOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Registrar Pago a Personal</span>
            </button>
          </div>

          <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-neutral-900 text-slate-500 border-b border-slate-200 dark:border-neutral-800">
                  <tr>
                    <th className="p-3">Fecha</th>
                    <th className="p-3">Empleado</th>
                    <th className="p-3">Tipo Pago</th>
                    <th className="p-3">Monto USD</th>
                    <th className="p-3">Monto Bs</th>
                    <th className="p-3">Método</th>
                    <th className="p-3">Notas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                  {(payrollData?.payments || []).map((p: any) => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-neutral-800/40">
                      <td className="p-3 font-mono text-[10px] text-slate-400">
                        {new Date(p.created_at_ms).toLocaleDateString()} {new Date(p.created_at_ms).toLocaleTimeString()}
                      </td>
                      <td className="p-3 font-bold text-slate-900 dark:text-white">{p.staff_name}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400">
                          {p.payment_type}
                        </span>
                      </td>
                      <td className="p-3 font-mono font-black text-slate-900 dark:text-white">
                        ${(p.amount_usd_cents / 100).toFixed(2)}
                      </td>
                      <td className="p-3 font-mono text-slate-500">
                        {(p.amount_bs_cents / 100).toFixed(2)} Bs
                      </td>
                      <td className="p-3 font-mono text-[10px] text-slate-500">{p.payment_method}</td>
                      <td className="p-3 text-slate-400 text-[11px]">{p.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* PESTAÑA 7: CONFIGURACIÓN Y PARÁMETROS FISCALES                      */}
      {/* -------------------------------------------------------------------- */}
      {activeSubTab === 'settings' && (
        <div className="space-y-4 max-w-3xl">
          <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-2xl p-6 shadow-sm space-y-4">
            <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <Sliders className="w-4 h-4 text-blue-500" />
              <span>Configuración Fiscal y Parámetros Contables</span>
            </h3>

            {/* Toggle Módulo Fiscal Informativo */}
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-xl">
              <div>
                <span className="font-bold text-slate-900 dark:text-white text-xs block">Módulo Fiscal Informativo</span>
                <span className="text-[11px] text-slate-500">
                  Imprime el desglose informativo de IVA (16%) en la Nota de Entrega y Cierre Z.
                </span>
              </div>
              <button
                type="button"
                onClick={() => updateSettingsMutation.mutate({ fiscalModuleEnabled: !isFiscalEnabled })}
                className={`px-3 py-1.5 rounded-xl font-black text-xs uppercase transition cursor-pointer ${
                  isFiscalEnabled ? 'bg-emerald-600 text-white' : 'bg-slate-300 dark:bg-neutral-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {isFiscalEnabled ? 'Activo' : 'Inactivo'}
              </button>
            </div>

            {/* Modalidad de Precio Fiscal */}
            {isFiscalEnabled && (
              <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-xl">
                <div>
                  <span className="font-bold text-slate-900 dark:text-white text-xs block">Modalidad de Precios de Carta</span>
                  <span className="text-[11px] text-slate-500">
                    {settingsData?.fiscalPriceMode === 'EXCLUSIVE'
                      ? 'EXCLUSIVE: El IVA se adiciona sobre el precio de comida.'
                      : 'INCLUSIVE: Los precios de la carta ya contienen el 16% de IVA.'}
                  </span>
                </div>
                <select
                  value={settingsData?.fiscalPriceMode || 'INCLUSIVE'}
                  onChange={e => updateSettingsMutation.mutate({ fiscalPriceMode: e.target.value as any })}
                  className="bg-white dark:bg-neutral-800 border border-slate-300 dark:border-neutral-700 rounded-lg px-2.5 py-1 text-xs text-slate-900 dark:text-white font-bold outline-none"
                >
                  <option value="INCLUSIVE">Precios con IVA incluido (INCLUSIVE)</option>
                  <option value="EXCLUSIVE">Precios sin IVA (EXCLUSIVE)</option>
                </select>
              </div>
            )}

            {/* Toggle IGTF (3% Divisas) */}
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-xl">
              <div>
                <span className="font-bold text-slate-900 dark:text-white text-xs block">Módulo IGTF (3.00% Divisas)</span>
                <span className="text-[11px] text-slate-500">
                  Aplica alícuota legal del 3% (300 bps) sobre pagos en divisas según confirmación contable.
                </span>
              </div>
              <button
                type="button"
                onClick={() => updateSettingsMutation.mutate({ igtfEnabled: !settingsData?.igtfEnabled })}
                className={`px-3 py-1.5 rounded-xl font-black text-xs uppercase transition cursor-pointer ${
                  settingsData?.igtfEnabled ? 'bg-emerald-600 text-white' : 'bg-slate-300 dark:bg-neutral-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {settingsData?.igtfEnabled ? 'Activo' : 'Inactivo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* MODAL 1: REGISTRAR SALIDA / MERMA / CONSUMO INTERNO                  */}
      {/* -------------------------------------------------------------------- */}
      {isOutputModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-3xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-neutral-800">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <span>📉</span>
                <span>Registrar Salida / Merma / Consumo Interno</span>
              </h3>
              <button onClick={() => setIsOutputModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                ✕
              </button>
            </div>

            <div className="space-y-3.5 my-4">
              <div>
                <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Motivo de Salida:</label>
                <select
                  value={outputReason}
                  onChange={e => setOutputReason(e.target.value as any)}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-bold"
                >
                  <option value="MERMA_SOCIOS">📉 Merma con Factura de Reposición a Socios</option>
                  <option value="CENA_EMPLEADOS">🍔 Cena para Empleados</option>
                  <option value="GASTO_GAS_INSUMO">🔥 Gas / Insumo Operativo</option>
                </select>
              </div>

              {outputReason === 'MERMA_SOCIOS' && (
                <div>
                  <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Socio Responsable:</label>
                  <select
                    value={outputPartnerId}
                    onChange={e => setOutputPartnerId(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="">Seleccione socio...</option>
                    {(customersData?.customers || [])
                      .filter((c: any) => c.is_partner === 1)
                      .map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.phone || 'Socio'})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Insumo o Plato:</label>
                <select
                  value={outputSupplyId}
                  onChange={e => setOutputSupplyId(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white"
                >
                  <option value="">Seleccione insumo...</option>
                  {(suppliesData?.supplies || []).map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.unitMeasure || 'und'}) - ${(s.costUsdCents / 100).toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Cantidad:</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={outputQuantity}
                  onChange={e => setOutputQuantity(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Observaciones / Motivo:</label>
                <input
                  type="text"
                  placeholder="ej. Pan quemado en plancha / cena turno nocturno"
                  value={outputNotes}
                  onChange={e => setOutputNotes(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                outputMutation.mutate({
                  movementType: outputReason,
                  supplyId: outputSupplyId || 'sup_pan_artesanal',
                  quantity: parseFloat(outputQuantity || '1'),
                  partnerCustomerId: outputPartnerId || undefined,
                  notes: outputNotes
                });
              }}
              disabled={outputMutation.isPending}
              className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer shadow-sm"
            >
              {outputMutation.isPending ? 'Registrando...' : 'Confirmar Salida / Factura'}
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* MODAL 2: REGISTRAR COMPRA A PROVEEDOR                                */}
      {/* -------------------------------------------------------------------- */}
      {isPurchaseModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-neutral-800">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <span>🛒</span>
                <span>Registrar Compra de Materia Prima a Proveedor</span>
              </h3>
              <button onClick={() => setIsPurchaseModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                ✕
              </button>
            </div>

            <div className="space-y-3.5 my-4">
              <div>
                <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Proveedor:</label>
                <select
                  value={purchaseSupplierId}
                  onChange={e => setPurchaseSupplierId(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white"
                >
                  <option value="">Seleccione proveedor...</option>
                  {(suppliersData?.suppliers || []).map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.category})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Nº Factura / Nota:</label>
                  <input
                    type="text"
                    placeholder="FAC-00123"
                    value={purchaseInvoiceNumber}
                    onChange={e => setPurchaseInvoiceNumber(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Condición de Pago:</label>
                  <select
                    value={purchasePaymentCondition}
                    onChange={e => setPurchasePaymentCondition(e.target.value as any)}
                    className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-bold"
                  >
                    <option value="CONTADO">Contado (Pagada)</option>
                    <option value="CREDITO">Crédito (Cuenta por Pagar)</option>
                  </select>
                </div>
              </div>

              {/* Ítems de la compra */}
              <div className="border border-slate-200 dark:border-neutral-800 rounded-xl p-3 space-y-2">
                <span className="text-[11px] font-bold text-slate-500 block uppercase">Ítem comprado:</span>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={purchaseItems[0]?.supplyId || ''}
                    onChange={e => setPurchaseItems([{ ...purchaseItems[0], supplyId: e.target.value }])}
                    className="col-span-1 bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-lg px-2 py-1 text-xs text-slate-900 dark:text-white"
                  >
                    {(suppliesData?.supplies || []).map((s: any) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    placeholder="Cant"
                    value={purchaseItems[0]?.quantity || ''}
                    onChange={e => setPurchaseItems([{ ...purchaseItems[0], quantity: parseFloat(e.target.value || '0') }])}
                    className="bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-lg px-2 py-1 text-xs font-mono"
                  />
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Costo Cents USD"
                    value={(purchaseItems[0]?.unitCostUsdCents || 0) / 100}
                    onChange={e => setPurchaseItems([{ ...purchaseItems[0], unitCostUsdCents: Math.round(parseFloat(e.target.value || '0') * 100) }])}
                    className="bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-lg px-2 py-1 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Notas:</label>
                <input
                  type="text"
                  placeholder="Detalles de entrega / recibo"
                  value={purchaseNotes}
                  onChange={e => setPurchaseNotes(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                purchaseMutation.mutate({
                  supplierId: purchaseSupplierId || undefined,
                  invoiceNumber: purchaseInvoiceNumber || 'COMPRA-' + Date.now().toString().slice(-4),
                  paymentCondition: purchasePaymentCondition,
                  items: purchaseItems,
                  notes: purchaseNotes
                });
              }}
              disabled={purchaseMutation.isPending}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer shadow-sm"
            >
              {purchaseMutation.isPending ? 'Registrando Compra...' : 'Confirmar Compra'}
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* MODAL 3: REGISTRAR PAGO A PERSONAL (NÓMINA)                          */}
      {/* -------------------------------------------------------------------- */}
      {isPayrollModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-3xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-neutral-800">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <span>💼</span>
                <span>Registrar Pago a Personal (Nómina)</span>
              </h3>
              <button onClick={() => setIsPayrollModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                ✕
              </button>
            </div>

            <div className="space-y-3.5 my-4">
              <div>
                <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Nombre del Trabajador:</label>
                <input
                  type="text"
                  value={payrollStaffName}
                  onChange={e => setPayrollStaffName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-bold"
                />
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Tipo de Pago:</label>
                <select
                  value={payrollPaymentType}
                  onChange={e => setPayrollPaymentType(e.target.value as any)}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-bold"
                >
                  <option value="SUELDO_TURNO">Sueldo por Turno / Noche</option>
                  <option value="QUINCENA">Pago de Quincena</option>
                  <option value="BONO">Bono de Puntualidad / Ventas</option>
                  <option value="ADELANTO_VALE">Adelanto / Vale de Caja</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Monto en USD ($):</label>
                <input
                  type="number"
                  step="0.01"
                  value={payrollAmountUsd}
                  onChange={e => setPayrollAmountUsd(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Método de Pago:</label>
                <select
                  value={payrollPaymentMethod}
                  onChange={e => setPayrollPaymentMethod(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white"
                >
                  <option value="EFECTIVO_USD">Efectivo USD</option>
                  <option value="PAGO_MOVIL">Pago Móvil (Bs)</option>
                  <option value="TRANSFERENCIA">Transferencia Bancaria</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Notas / Motivo:</label>
                <input
                  type="text"
                  placeholder="ej. Turno completo viernes noche"
                  value={payrollNotes}
                  onChange={e => setPayrollNotes(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                payrollMutation.mutate({
                  userId: 'user_staff',
                  staffName: payrollStaffName,
                  paymentType: payrollPaymentType,
                  amountUsdCents: Math.round(parseFloat(payrollAmountUsd || '0') * 100),
                  paymentMethod: payrollPaymentMethod,
                  notes: payrollNotes
                });
              }}
              disabled={payrollMutation.isPending}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer shadow-sm"
            >
              {payrollMutation.isPending ? 'Guardando Pago...' : 'Confirmar Pago de Nómina'}
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* MODAL 4: ABONAR CUENTA POR COBRAR                                   */}
      {/* -------------------------------------------------------------------- */}
      {isPayReceivableModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-neutral-800">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Abonar a Cuenta por Cobrar</h3>
              <button onClick={() => setIsPayReceivableModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                ✕
              </button>
            </div>

            <div className="space-y-3 my-4">
              <div>
                <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Monto a Abonar ($ USD):</label>
                <input
                  type="number"
                  step="0.01"
                  value={payAmountUsd}
                  onChange={e => setPayAmountUsd(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 uppercase font-bold block mb-1">Notas / Referencia:</label>
                <input
                  type="text"
                  placeholder="ej. Pago en efectivo / Zelle"
                  value={payNotes}
                  onChange={e => setPayNotes(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                payReceivableMutation.mutate({
                  customerId: selectedCustomerId,
                  amountUsdCents: Math.round(parseFloat(payAmountUsd || '0') * 100),
                  notes: payNotes
                });
              }}
              disabled={payReceivableMutation.isPending}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer shadow-sm"
            >
              {payReceivableMutation.isPending ? 'Guardando Abono...' : 'Registrar Abono'}
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* MODAL 5: TICKET DE REPOSICIÓN IMPRIMIBLE EN 58MM                     */}
      {/* -------------------------------------------------------------------- */}
      {ticketModalText && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#121620] border border-slate-200 dark:border-neutral-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-neutral-800">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Printer className="w-4 h-4 text-blue-500" />
                <span>Comprobante de Reposición (58mm)</span>
              </h3>
              <button onClick={() => setTicketModalText(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                ✕
              </button>
            </div>

            <pre className="p-3 bg-slate-100 dark:bg-neutral-900 rounded-xl text-[11px] font-mono leading-tight whitespace-pre-wrap text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-neutral-800">
              {ticketModalText}
            </pre>

            <button
              type="button"
              onClick={() => {
                window.print();
              }}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <Printer className="w-4 h-4" />
              <span>🖨️ Imprimir Factura de Reposición (58mm)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
