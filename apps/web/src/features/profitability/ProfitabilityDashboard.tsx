import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp,
  DollarSign,
  Package,
  Layers,
  PieChart,
  AlertTriangle,
  CheckCircle,
  Save,
  FileText,
  Star,
  Activity,
  Award,
  Sliders,
  Percent,
  Calculator
} from 'lucide-react';
import { PedagogicalGuideBanner } from '../../components/PedagogicalGuideBanner.js';

export const ProfitabilityDashboard: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeSubTab, setActiveSubTab] = useState<'net-profit' | 'menu-engineering' | 'costing' | 'inventory' | 'settings'>('net-profit');

  // Estado local para bulk update de insumos
  const [editedCosts, setEditedCosts] = useState<Record<string, number>>({});
  // Estado local para conteo físico de inventario
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, number>>({});
  // Estado para nuevo gasto operativo
  const [expenseCategory, setExpenseCategory] = useState<'HIELO' | 'VERDURAS' | 'GAS' | 'TRANSPORTE' | 'MANTENIMIENTO' | 'VARIOS'>('HIELO');
  const [expenseAmountUsd, setExpenseAmountUsd] = useState('');
  const [expenseDescription, setExpenseDescription] = useState('');

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

  // 2. Query Utilidad Neta Real
  const { data: netProfitData, isLoading: isLoadingNetProfit } = useQuery<{
    report: any;
  }>({
    queryKey: ['jornadaNetProfit'],
    queryFn: async () => {
      const res = await fetch('/api/profitability/net-profit');
      return res.json();
    },
    enabled: settingsData?.profitabilityProEnabled ?? true
  });

  // 3. Query Ingeniería de Menú
  const { data: menuEngData, isLoading: isLoadingMenuEng } = useQuery<{
    report: any;
  }>({
    queryKey: ['menuEngineeringReport'],
    queryFn: async () => {
      const res = await fetch('/api/profitability/menu-engineering');
      return res.json();
    },
    enabled: settingsData?.profitabilityProEnabled ?? true
  });

  // 4. Query Insumos y Alertas
  const { data: suppliesData } = useQuery<{
    supplies: any[];
  }>({
    queryKey: ['profitabilitySupplies'],
    queryFn: async () => {
      const res = await fetch('/api/profitability/supplies');
      return res.json();
    },
    enabled: settingsData?.profitabilityProEnabled ?? true
  });

  // 5. Query Inventario Crítico
  const { data: criticalInvData } = useQuery<{
    criticalSupplies: any[];
  }>({
    queryKey: ['criticalInventory'],
    queryFn: async () => {
      const res = await fetch('/api/profitability/inventory/critical');
      return res.json();
    },
    enabled: settingsData?.profitabilityProEnabled ?? true
  });

  // Mutación para actualizar interruptores
  const updateSettingsMutation = useMutation({
    mutationFn: async (payload: {
      profitabilityProEnabled?: boolean;
      fiscalModuleEnabled?: boolean;
      fiscalPriceMode?: 'INCLUSIVE' | 'EXCLUSIVE';
      igtfEnabled?: boolean;
      igtfRateBps?: number;
      igtfAppliesTo?: 'CASH_USD' | 'ALL_USD' | 'NONE';
    }) => {
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

  // Mutación para bulk update de costos
  const bulkUpdateCostsMutation = useMutation({
    mutationFn: async (items: Array<{ id: string; costPerUnitUsdCents: number }>) => {
      const res = await fetch('/api/profitability/supplies/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profitabilitySupplies'] });
      setEditedCosts({});
      alert('Costos de insumos actualizados e historial registrado exitosamente');
    }
  });

  // Mutación para registrar gasto operativo
  const addExpenseMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/profitability/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jornadaNetProfit'] });
      setExpenseAmountUsd('');
      setExpenseDescription('');
      alert('Gasto operativo registrado exitosamente en caja chica');
    }
  });

  // Mutación para conciliar inventario físico
  const reconcileInvMutation = useMutation({
    mutationFn: async (counts: Array<{ supplyItemId: string; physicalQty: number }>) => {
      const res = await fetch('/api/profitability/inventory/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ physicalCounts: counts })
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['criticalInventory'] });
      setPhysicalCounts({});
      alert(`Conciliación guardada. Varianza total: $${(data.totalVarianceUsdCents / 100).toFixed(2)}`);
    }
  });

  const isProEnabled = settingsData?.profitabilityProEnabled ?? false;
  const isFiscalEnabled = settingsData?.fiscalModuleEnabled ?? false;

  return (
    <div className="space-y-6">
      {/* Guía Pedagógica sin jerga */}
      <PedagogicalGuideBanner
        title="Guía de Ganancias e Inventario"
        description="Aquí puedes ver la utilidad real de cada turno deduciendo costos de ingredientes, registrar gastos de caja chica (hielo, gas, transporte) y controlar las existencias de insumos críticos."
        storageKey="tocineta_guide_profitability"
      />

      {/* Cabecera del Módulo */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-tocineta-card border border-tocineta-border p-5 rounded-2xl shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
              <span>MÓDULO DE RENTABILIDAD PROFESIONAL</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                isProEnabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-zinc-800 text-zinc-400'
              }`}>
                {isProEnabled ? 'Niveles 1-4 Activos' : 'Modo Minimalista'}
              </span>
            </h1>
            <p className="text-xs text-tocineta-muted mt-0.5">
              Costeo dinámico, Inventario crítico con ahorro sin pan, Utilidad neta real y Matriz de Kasavana & Smith.
            </p>
          </div>
        </div>

        {/* Sub-pestañas de Navegación Ejecutiva */}
        {isProEnabled && (
          <div className="flex flex-wrap items-center gap-1.5 bg-tocineta-bg p-1.5 rounded-xl border border-tocineta-border/80">
            <button
              onClick={() => setActiveSubTab('net-profit')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeSubTab === 'net-profit' ? 'bg-tocineta-yellow text-black shadow' : 'text-tocineta-muted hover:text-white'
              }`}
            >
              <DollarSign className="w-3.5 h-3.5" />
              <span>Utilidad Neta</span>
            </button>
            <button
              onClick={() => setActiveSubTab('menu-engineering')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeSubTab === 'menu-engineering' ? 'bg-tocineta-yellow text-black shadow' : 'text-tocineta-muted hover:text-white'
              }`}
            >
              <PieChart className="w-3.5 h-3.5" />
              <span>Ingeniería de Menú</span>
            </button>
            <button
              onClick={() => setActiveSubTab('costing')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeSubTab === 'costing' ? 'bg-tocineta-yellow text-black shadow' : 'text-tocineta-muted hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Costeo & Insumos</span>
            </button>
            <button
              onClick={() => setActiveSubTab('inventory')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeSubTab === 'inventory' ? 'bg-tocineta-yellow text-black shadow' : 'text-tocineta-muted hover:text-white'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>Inventario Crítico</span>
            </button>
            <button
              onClick={() => setActiveSubTab('settings')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeSubTab === 'settings' ? 'bg-tocineta-yellow text-black shadow' : 'text-tocineta-muted hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Configuración</span>
            </button>
          </div>
        )}
      </div>

      {/* Si el Interruptor Maestro está apagado: Mostrar mensaje informativo y opción de activación */}
      {!isProEnabled && (
        <div className="bg-tocineta-card border border-tocineta-border p-8 rounded-2xl text-center max-w-xl mx-auto space-y-4 shadow-xl">
          <div className="w-14 h-14 mx-auto rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Sliders className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-black text-white uppercase tracking-tight">
            Módulo de Rentabilidad Pro en Espera
          </h2>
          <p className="text-xs text-tocineta-muted leading-relaxed">
            El sistema está operando en <strong>Modo Minimalista</strong>. Los costos de recetas, Barra Libre (15¢) y cupones de cortesía (35¢) se siguen registrando silenciosamente en segundo plano en cada venta.
          </p>
          <div className="pt-2">
            <button
              onClick={() => updateSettingsMutation.mutate({ profitabilityProEnabled: true })}
              disabled={updateSettingsMutation.isPending}
              className="px-5 py-2.5 bg-tocineta-yellow hover:bg-tocineta-yellow-hover text-black font-black text-xs uppercase rounded-xl transition shadow-lg"
            >
              {updateSettingsMutation.isPending ? 'Activando...' : 'Activar Pestañas de Rentabilidad Pro'}
            </button>
          </div>
        </div>
      )}

      {/* PESTAÑA 1: UTILIDAD NETA REAL (NIVEL 3) */}
      {isProEnabled && activeSubTab === 'net-profit' && (
        <div className="space-y-6">
          {isLoadingNetProfit ? (
            <div className="text-center py-12 text-tocineta-muted text-xs">Calculando Utilidad Neta Real de la Jornada...</div>
          ) : netProfitData?.report ? (
            <>
              {/* Tarjetas Principales de Métricas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-tocineta-card border border-tocineta-border p-4 rounded-xl">
                  <span className="text-[11px] font-bold text-tocineta-muted uppercase tracking-wider">Ventas Netas Comida</span>
                  <div className="text-2xl font-black text-white mt-1">
                    ${(netProfitData.report.netFoodSalesUsdCents / 100).toFixed(2)}
                  </div>
                  <span className="text-[10px] text-zinc-400">Excluye Delivery Modo A</span>
                </div>

                <div className="bg-tocineta-card border border-tocineta-border p-4 rounded-xl">
                  <span className="text-[11px] font-bold text-tocineta-muted uppercase tracking-wider">Food Cost Real</span>
                  <div className="text-2xl font-black text-amber-400 mt-1">
                    ${(netProfitData.report.totalFoodCostUsdCents / 100).toFixed(2)}
                  </div>
                  <span className="text-[10px] text-amber-400/80">{netProfitData.report.foodCostPercentage}% de las ventas</span>
                </div>

                <div className="bg-tocineta-card border border-tocineta-border p-4 rounded-xl">
                  <span className="text-[11px] font-bold text-tocineta-muted uppercase tracking-wider">Gastos Caja Chica</span>
                  <div className="text-2xl font-black text-red-400 mt-1">
                    ${(netProfitData.report.operatingExpensesUsdCents / 100).toFixed(2)}
                  </div>
                  <span className="text-[10px] text-zinc-400">Hielo, gas, transporte, mermas</span>
                </div>

                <div className="bg-tocineta-card border border-emerald-500/40 bg-emerald-500/5 p-4 rounded-xl">
                  <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Utilidad Neta Real</span>
                  <div className="text-2xl font-black text-emerald-400 mt-1">
                    ${(netProfitData.report.netProfitUsdCents / 100).toFixed(2)}
                  </div>
                  <span className="text-[10px] text-emerald-400/90 font-bold">Margen: {netProfitData.report.netMarginPercentage}%</span>
                </div>
              </div>

              {/* Desglose Detallado de la Fórmula */}
              <div className="bg-tocineta-card border border-tocineta-border p-5 rounded-2xl">
                <h3 className="text-sm font-black text-white uppercase tracking-tight mb-3 flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-tocineta-yellow" />
                  <span>Desglose Estricto de la Fórmula de Utilidad Neta</span>
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-zinc-800">
                    <span className="text-zinc-300">(+) Ventas Netas de Comida:</span>
                    <span className="font-bold text-white">${(netProfitData.report.netFoodSalesUsdCents / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800 text-amber-400">
                    <span>(-) Costo Insumos Recetas Base:</span>
                    <span>-${(netProfitData.report.baseFoodCostUsdCents / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800 text-amber-400">
                    <span>(-) Costo Extras Pagados:</span>
                    <span>-${(netProfitData.report.extraIngredientsCostUsdCents / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800 text-amber-400">
                    <span>(-) Costo Barra Libre (15¢ c/u):</span>
                    <span>-${(netProfitData.report.barraLibreCostUsdCents / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800 text-purple-400">
                    <span>(-) Obsequios Cupones / Marketing (35¢ c/u):</span>
                    <span>-${(netProfitData.report.couponCourtesiesUsdCents / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800 text-red-400">
                    <span>(-) Mermas de Alimentos Registradas:</span>
                    <span>-${(netProfitData.report.registeredFoodLossesUsdCents / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800 text-blue-400">
                    <span>(-) Comisión Bancaria Ubii (0.75%):</span>
                    <span>-${(netProfitData.report.ubiiFeeUsdCents / 100).toFixed(2)} (Bs. ${(netProfitData.report.ubiiFeeBsCents / 100).toFixed(2)})</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800 text-orange-400">
                    <span>(-) Gastos de Turno (Caja Chica):</span>
                    <span>-${(netProfitData.report.operatingExpensesUsdCents / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between pt-2 text-sm font-black text-emerald-400">
                    <span>(=) UTILIDAD NETA REAL:</span>
                    <span>${(netProfitData.report.netProfitUsdCents / 100).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Registro de Gasto Rápido de Caja Chica */}
              <div className="bg-tocineta-card border border-tocineta-border p-5 rounded-2xl">
                <h3 className="text-sm font-black text-white uppercase tracking-tight mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-tocineta-yellow" />
                  <span>Registrar Gasto del Turno (Caja Chica)</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <select
                    value={expenseCategory}
                    onChange={(e: any) => setExpenseCategory(e.target.value)}
                    className="bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white"
                  >
                    <option value="HIELO">Hielo</option>
                    <option value="VERDURAS">Verduras</option>
                    <option value="GAS">Gas</option>
                    <option value="TRANSPORTE">Transporte</option>
                    <option value="MANTENIMIENTO">Mantenimiento</option>
                    <option value="VARIOS">Varios</option>
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Monto USD (ej. 5.00)"
                    value={expenseAmountUsd}
                    onChange={(e) => setExpenseAmountUsd(e.target.value)}
                    className="bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white"
                  />
                  <input
                    type="text"
                    placeholder="Descripción (ej. 2 bolsas de hielo)"
                    value={expenseDescription}
                    onChange={(e) => setExpenseDescription(e.target.value)}
                    className="bg-tocineta-bg border border-tocineta-border rounded-xl px-3 py-2 text-xs text-white sm:col-span-2"
                  />
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => {
                      const amountCents = Math.round(parseFloat(expenseAmountUsd || '0') * 100);
                      if (amountCents <= 0 || !expenseDescription.trim()) {
                        alert('Ingrese un monto válido y una descripción');
                        return;
                      }
                      addExpenseMutation.mutate({
                        category: expenseCategory,
                        amountUsdCents: amountCents,
                        description: expenseDescription
                      });
                    }}
                    disabled={addExpenseMutation.isPending}
                    className="px-4 py-2 bg-tocineta-yellow hover:bg-tocineta-yellow-hover text-black font-black text-xs uppercase rounded-xl transition"
                  >
                    {addExpenseMutation.isPending ? 'Guardando...' : 'Guardar Gasto en Caja Chica'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-tocineta-muted text-xs">No hay datos de jornada disponible.</div>
          )}
        </div>
      )}

      {/* PESTAÑA 2: INGENIERÍA DE MENÚ KASAVANA & SMITH (NIVEL 4) */}
      {isProEnabled && activeSubTab === 'menu-engineering' && (
        <div className="space-y-6">
          {isLoadingMenuEng ? (
            <div className="text-center py-12 text-tocineta-muted text-xs">Cargando matriz de Kasavana & Smith...</div>
          ) : menuEngData?.report ? (
            <>
              {/* Aviso Estadístico */}
              {menuEngData.report.hasStatisticalWarning && (
                <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-xs font-bold text-amber-400 block uppercase">Aviso Estadístico</span>
                    <span className="text-xs text-zinc-300">{menuEngData.report.statisticalWarningMessage}</span>
                  </div>
                </div>
              )}

              {/* Resumen Superior: Costo Primo y Punto de Equilibrio */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-tocineta-card border border-tocineta-border p-4 rounded-xl">
                  <span className="text-[11px] font-bold text-tocineta-muted uppercase tracking-wider">Costo Primo (Prime Cost)</span>
                  <div className="text-xl font-black text-white mt-1">
                    ${(menuEngData.report.primeCost.primeCostUsdCents / 100).toFixed(2)}
                  </div>
                  <span className="text-[10px] text-tocineta-yellow font-bold">
                    {menuEngData.report.primeCost.primeCostPercentage}% sobre ventas (Meta: 55-65%)
                  </span>
                </div>

                <div className="bg-tocineta-card border border-tocineta-border p-4 rounded-xl">
                  <span className="text-[11px] font-bold text-tocineta-muted uppercase tracking-wider">Punto de Equilibrio</span>
                  <div className="text-xl font-black text-white mt-1">
                    ${(menuEngData.report.breakEven.breakEvenSalesUsdCents / 100).toFixed(2)}
                  </div>
                  <span className="text-[10px] text-zinc-400">Ventas mínimas para no perder</span>
                </div>

                <div className="bg-tocineta-card border border-tocineta-border p-4 rounded-xl">
                  <span className="text-[11px] font-bold text-tocineta-muted uppercase tracking-wider">Margen Contribución Promedio</span>
                  <div className="text-xl font-black text-emerald-400 mt-1">
                    ${(menuEngData.report.categories.reduce((acc: number, c: any) => acc + c.totalMarginUsdCents, 0) / 100).toFixed(2)}
                  </div>
                  <span className="text-[10px] text-zinc-400">Ganancia bruta total generada</span>
                </div>
              </div>

              {/* Matriz Visual de los 4 Cuadrantes por Categoría */}
              {menuEngData.report.categories.map((cat: any) => (
                <div key={cat.categoryId} className="bg-tocineta-card border border-tocineta-border p-5 rounded-2xl space-y-4">
                  <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
                    <div>
                      <h3 className="text-sm font-black text-white uppercase tracking-tight">{cat.categoryName}</h3>
                      <span className="text-[11px] text-tocineta-muted">
                        {cat.totalUnitsSold} platos vendidos • Umbral Pop: {(cat.popularityThreshold * 100).toFixed(1)}% • Margen Prom: ${(cat.weightedAverageMarginUsdCents / 100).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {cat.sampleStatus === 'DATOS_INSUFICIENTES' ? (
                    <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400" />
                      <span>
                        📊 Matriz preliminar. Faltan {cat.missingDays ?? 14} días de operación o {cat.missingUnits ?? 30} unidades para resultado definitivo.
                      </span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* ESTRELLAS ⭐ */}
                      <div className="bg-emerald-500/5 border border-emerald-500/30 p-3.5 rounded-xl space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-black text-emerald-400 uppercase tracking-tight">
                          <Star className="w-4 h-4 fill-emerald-400" />
                          <span>Estrellas (Alta Pop / Alto Margen)</span>
                        </div>
                        <div className="space-y-1.5">
                          {cat.dishes.filter((d: any) => d.quadrant === 'ESTRELLA').map((d: any) => (
                            <div key={d.productId} className="flex justify-between text-xs bg-tocineta-bg p-2 rounded-lg">
                              <span className="font-bold text-white">{d.productName} ({d.unitsSold}u)</span>
                              <span className="text-emerald-400 font-bold">+${(d.unitContributionMarginUsdCents / 100).toFixed(2)}/u</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* CABALLOS DE BATALLA 🐴 */}
                      <div className="bg-blue-500/5 border border-blue-500/30 p-3.5 rounded-xl space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-black text-blue-400 uppercase tracking-tight">
                          <Award className="w-4 h-4" />
                          <span>Caballos de Batalla (Alta Pop / Bajo Margen)</span>
                        </div>
                        <div className="space-y-1.5">
                          {cat.dishes.filter((d: any) => d.quadrant === 'CABALLO_DE_BATALLA').map((d: any) => (
                            <div key={d.productId} className="flex justify-between text-xs bg-tocineta-bg p-2 rounded-lg">
                              <span className="font-bold text-white">{d.productName} ({d.unitsSold}u)</span>
                              <span className="text-blue-400 font-bold">+${(d.unitContributionMarginUsdCents / 100).toFixed(2)}/u</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* PUZZLES 🧩 */}
                      <div className="bg-amber-500/5 border border-amber-500/30 p-3.5 rounded-xl space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-black text-amber-400 uppercase tracking-tight">
                          <Activity className="w-4 h-4" />
                          <span>Puzzles (Baja Pop / Alto Margen)</span>
                        </div>
                        <div className="space-y-1.5">
                          {cat.dishes.filter((d: any) => d.quadrant === 'PUZZLE').map((d: any) => (
                            <div key={d.productId} className="flex justify-between text-xs bg-tocineta-bg p-2 rounded-lg">
                              <span className="font-bold text-white">{d.productName} ({d.unitsSold}u)</span>
                              <span className="text-amber-400 font-bold">+${(d.unitContributionMarginUsdCents / 100).toFixed(2)}/u</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* PERROS 🐕 */}
                      <div className="bg-red-500/5 border border-red-500/30 p-3.5 rounded-xl space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-black text-red-400 uppercase tracking-tight">
                          <AlertTriangle className="w-4 h-4" />
                          <span>Perros (Baja Pop / Bajo Margen)</span>
                        </div>
                        <div className="space-y-1.5">
                          {cat.dishes.filter((d: any) => d.quadrant === 'PERRO').map((d: any) => (
                            <div key={d.productId} className="flex justify-between text-xs bg-tocineta-bg p-2 rounded-lg">
                              <span className="font-bold text-white">{d.productName} ({d.unitsSold}u)</span>
                              <span className="text-red-400 font-bold">+${(d.unitContributionMarginUsdCents / 100).toFixed(2)}/u</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Análisis ABC de Insumos */}
              <div className="bg-tocineta-card border border-tocineta-border p-5 rounded-2xl space-y-3">
                <h3 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                  <Percent className="w-4 h-4 text-tocineta-yellow" />
                  <span>Análisis ABC de Insumos y Materia Prima</span>
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-tocineta-bg text-tocineta-muted uppercase text-[10px]">
                      <tr>
                        <th className="p-2.5">Clase</th>
                        <th className="p-2.5">Insumo</th>
                        <th className="p-2.5 text-right">Consumo</th>
                        <th className="p-2.5 text-right">Costo Unit.</th>
                        <th className="p-2.5 text-right">Valor Total</th>
                        <th className="p-2.5 text-right">% Acumulado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {menuEngData.report.abcSupplies.slice(0, 10).map((s: any) => (
                        <tr key={s.supplyId} className="hover:bg-zinc-800/40">
                          <td className="p-2.5">
                            <span className={`px-2 py-0.5 rounded font-black text-[10px] ${
                              s.classification === 'A' ? 'bg-red-500/20 text-red-400 border border-red-500/40' :
                              s.classification === 'B' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' :
                              'bg-zinc-700 text-zinc-300'
                            }`}>
                              Clase {s.classification}
                            </span>
                          </td>
                          <td className="p-2.5 font-bold text-white">{s.supplyName}</td>
                          <td className="p-2.5 text-right">{s.unitsConsumed} {s.unit}</td>
                          <td className="p-2.5 text-right">${(s.unitCostUsdCents / 100).toFixed(2)}</td>
                          <td className="p-2.5 text-right font-bold text-white">${(s.totalValueUsdCents / 100).toFixed(2)}</td>
                          <td className="p-2.5 text-right text-zinc-400">{s.cumulativePercentage}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-tocineta-muted text-xs">No hay datos suficientes para el análisis de menú.</div>
          )}
        </div>
      )}

      {/* PESTAÑA 3: COSTEO & INSUMOS (NIVEL 1) */}
      {isProEnabled && activeSubTab === 'costing' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-tocineta-card border border-tocineta-border p-4 rounded-xl">
            <div>
              <h3 className="text-sm font-black text-white uppercase">Gestor y Asistente Rápido de Costos</h3>
              <p className="text-xs text-tocineta-muted">
                Los insumos con más de 30 días sin actualizar muestran alerta automática.
              </p>
            </div>
            {Object.keys(editedCosts).length > 0 && (
              <button
                onClick={() => {
                  const updates = Object.entries(editedCosts).map(([id, costPerUnitUsdCents]) => ({
                    id,
                    costPerUnitUsdCents
                  }));
                  bulkUpdateCostsMutation.mutate(updates);
                }}
                disabled={bulkUpdateCostsMutation.isPending}
                className="px-4 py-2 bg-tocineta-yellow hover:bg-tocineta-yellow-hover text-black font-black text-xs uppercase rounded-xl transition flex items-center gap-1.5 shadow-lg"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Guardar {Object.keys(editedCosts).length} Costo(s)</span>
              </button>
            )}
          </div>

          <div className="bg-tocineta-card border border-tocineta-border rounded-xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-tocineta-bg text-tocineta-muted uppercase text-[10px]">
                <tr>
                  <th className="p-3">Insumo</th>
                  <th className="p-3">Unidad</th>
                  <th className="p-3">Stock Actual</th>
                  <th className="p-3">Costo Actual</th>
                  <th className="p-3">Nuevo Costo ($)</th>
                  <th className="p-3">Estado Antigüedad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {suppliesData?.supplies?.map((sup: any) => (
                  <tr key={sup.id} className="hover:bg-zinc-800/40">
                    <td className="p-3 font-bold text-white">{sup.name}</td>
                    <td className="p-3 text-zinc-400">{sup.unit}</td>
                    <td className="p-3">{sup.currentStockQty}</td>
                    <td className="p-3 text-amber-400 font-bold">${(sup.costPerUnitUsdCents / 100).toFixed(2)}</td>
                    <td className="p-3">
                      <input
                        type="number"
                        step="0.01"
                        placeholder={(sup.costPerUnitUsdCents / 100).toFixed(2)}
                        value={editedCosts[sup.id] !== undefined ? (editedCosts[sup.id] / 100).toFixed(2) : ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val)) {
                            setEditedCosts({ ...editedCosts, [sup.id]: Math.round(val * 100) });
                          } else {
                            const copy = { ...editedCosts };
                            delete copy[sup.id];
                            setEditedCosts(copy);
                          }
                        }}
                        className="w-24 bg-tocineta-bg border border-zinc-700 rounded-lg px-2 py-1 text-xs text-white"
                      />
                    </td>
                    <td className="p-3">
                      {sup.isStaleCost ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center gap-1 w-fit">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Desactualizado ({sup.daysSinceLastUpdate}d)</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-1 w-fit">
                          <CheckCircle className="w-3 h-3" />
                          <span>Al día ({sup.daysSinceLastUpdate}d)</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PESTAÑA 4: INVENTARIO CRÍTICO (NIVEL 2) */}
      {isProEnabled && activeSubTab === 'inventory' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-tocineta-card border border-tocineta-border p-4 rounded-xl">
            <div>
              <h3 className="text-sm font-black text-white uppercase">Control de los 8 Insumos Críticos de Alta Rotación</h3>
              <p className="text-xs text-tocineta-muted">
                Deducción de consumo teórico automatizada. Si se pidió <em>Sin Pan / Envuelta en Lechuga</em>, no descuenta pan brioche.
              </p>
            </div>
            {Object.keys(physicalCounts).length > 0 && (
              <button
                onClick={() => {
                  const counts = Object.entries(physicalCounts).map(([supplyItemId, physicalQty]) => ({
                    supplyItemId,
                    physicalQty
                  }));
                  reconcileInvMutation.mutate(counts);
                }}
                disabled={reconcileInvMutation.isPending}
                className="px-4 py-2 bg-tocineta-yellow hover:bg-tocineta-yellow-hover text-black font-black text-xs uppercase rounded-xl transition flex items-center gap-1.5 shadow-lg"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Conciliar Cierre ({Object.keys(physicalCounts).length} Insumos)</span>
              </button>
            )}
          </div>

          <div className="bg-tocineta-card border border-tocineta-border rounded-xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-tocineta-bg text-tocineta-muted uppercase text-[10px]">
                <tr>
                  <th className="p-3">Insumo Crítico</th>
                  <th className="p-3">Unidad</th>
                  <th className="p-3 text-right">Consumo Teórico</th>
                  <th className="p-3 text-right">Stock Inicial</th>
                  <th className="p-3 text-right">Stock Teórico Esperado</th>
                  <th className="p-3">Conteo Físico Real</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {criticalInvData?.criticalSupplies?.map((sup: any) => {
                  const theoreticalConsumption = sup.theoreticalConsumptionQty || 0;
                  const theoreticalExpected = sup.currentStockQty - theoreticalConsumption;

                  return (
                    <tr key={sup.id} className="hover:bg-zinc-800/40">
                      <td className="p-3 font-bold text-white">{sup.name}</td>
                      <td className="p-3 text-zinc-400">{sup.unit}</td>
                      <td className="p-3 text-right text-amber-400 font-bold">-{theoreticalConsumption}</td>
                      <td className="p-3 text-right">{sup.currentStockQty}</td>
                      <td className="p-3 text-right font-bold text-white">{theoreticalExpected}</td>
                      <td className="p-3">
                        <input
                          type="number"
                          placeholder={String(theoreticalExpected)}
                          value={physicalCounts[sup.id] ?? ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) {
                              setPhysicalCounts({ ...physicalCounts, [sup.id]: val });
                            } else {
                              const copy = { ...physicalCounts };
                              delete copy[sup.id];
                              setPhysicalCounts(copy);
                            }
                          }}
                          className="w-24 bg-tocineta-bg border border-zinc-700 rounded-lg px-2 py-1 text-xs text-white"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PESTAÑA 5: CONFIGURACIÓN & MÓDULO FISCAL */}
      {isProEnabled && activeSubTab === 'settings' && (
        <div className="bg-tocineta-card border border-tocineta-border p-6 rounded-2xl space-y-6 max-w-2xl">
          <h3 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
            <Sliders className="w-4 h-4 text-tocineta-yellow" />
            <span>Configuración de Módulos Avanzados</span>
          </h3>

          <div className="space-y-4">
            {/* Toggle Rentabilidad Pro */}
            <div className="flex items-center justify-between p-4 bg-tocineta-bg border border-tocineta-border rounded-xl">
              <div>
                <span className="font-bold text-white text-xs block">Interruptor Maestro de Rentabilidad Pro</span>
                <span className="text-[11px] text-tocineta-muted">
                  Habilita el costeo dinámico, mermas, varianza de inventario e Ingeniería de Menú.
                </span>
              </div>
              <button
                onClick={() => updateSettingsMutation.mutate({ profitabilityProEnabled: !isProEnabled })}
                className={`px-3 py-1.5 rounded-xl font-black text-xs uppercase transition ${
                  isProEnabled ? 'bg-emerald-500 text-black' : 'bg-zinc-700 text-zinc-300'
                }`}
              >
                {isProEnabled ? 'Activo' : 'Inactivo'}
              </button>
            </div>

            {/* Toggle Módulo Fiscal Informativo */}
            <div className="flex items-center justify-between p-4 bg-tocineta-bg border border-tocineta-border rounded-xl">
              <div>
                <span className="font-bold text-white text-xs block">Módulo Fiscal Informativo Opcional</span>
                <span className="text-[11px] text-tocineta-muted">
                  Imprime el desglose informativo de IVA (16%) en la Nota de Entrega y Cierre Z.
                </span>
              </div>
              <button
                onClick={() => updateSettingsMutation.mutate({ fiscalModuleEnabled: !isFiscalEnabled })}
                className={`px-3 py-1.5 rounded-xl font-black text-xs uppercase transition ${
                  isFiscalEnabled ? 'bg-emerald-500 text-black' : 'bg-zinc-700 text-zinc-300'
                }`}
              >
                {isFiscalEnabled ? 'Activo' : 'Inactivo'}
              </button>
            </div>

            {/* Modalidad de Precio Fiscal */}
            {isFiscalEnabled && (
              <div className="flex items-center justify-between p-4 bg-tocineta-bg border border-tocineta-border rounded-xl">
                <div>
                  <span className="font-bold text-white text-xs block">Modalidad de Precios de Carta</span>
                  <span className="text-[11px] text-tocineta-muted">
                    {settingsData?.fiscalPriceMode === 'EXCLUSIVE'
                      ? 'EXCLUSIVE: El IVA se adiciona sobre el precio de comida.'
                      : 'INCLUSIVE: Los precios de la carta ya contienen el 16% de IVA.'}
                  </span>
                </div>
                <select
                  value={settingsData?.fiscalPriceMode || 'INCLUSIVE'}
                  onChange={e => updateSettingsMutation.mutate({ fiscalPriceMode: e.target.value as any })}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs text-white font-bold outline-none"
                >
                  <option value="INCLUSIVE">Precios con IVA incluido (INCLUSIVE)</option>
                  <option value="EXCLUSIVE">Precios sin IVA (EXCLUSIVE)</option>
                </select>
              </div>
            )}

            {/* Toggle IGTF (3% Divisas) */}
            <div className="flex items-center justify-between p-4 bg-tocineta-bg border border-tocineta-border rounded-xl">
              <div>
                <span className="font-bold text-white text-xs block">Módulo IGTF (3.00% Divisas / Criptoactivos)</span>
                <span className="text-[11px] text-tocineta-muted">
                  Aplica alícuota legal del 3% (300 bps) sobre pagos en divisas según confirmación contable.
                </span>
              </div>
              <button
                onClick={() => updateSettingsMutation.mutate({ igtfEnabled: !settingsData?.igtfEnabled })}
                className={`px-3 py-1.5 rounded-xl font-black text-xs uppercase transition ${
                  settingsData?.igtfEnabled ? 'bg-emerald-500 text-black' : 'bg-zinc-700 text-zinc-300'
                }`}
              >
                {settingsData?.igtfEnabled ? 'Activo' : 'Inactivo'}
              </button>
            </div>

            {/* Ámbito de Aplicación IGTF */}
            {settingsData?.igtfEnabled && (
              <div className="flex items-center justify-between p-4 bg-tocineta-bg border border-tocineta-border rounded-xl">
                <div>
                  <span className="font-bold text-white text-xs block">Aplicación del IGTF</span>
                  <span className="text-[11px] text-tocineta-muted">
                    Selecciona sobre qué medios de pago en divisas se calcula la alícuota del 3%.
                  </span>
                </div>
                <select
                  value={settingsData?.igtfAppliesTo || 'CASH_USD'}
                  onChange={e => updateSettingsMutation.mutate({ igtfAppliesTo: e.target.value as any })}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs text-white font-bold outline-none"
                >
                  <option value="CASH_USD">Solo Efectivo USD (CASH_USD)</option>
                  <option value="ALL_USD">Efectivo USD + Binance USDT (ALL_USD)</option>
                  <option value="NONE">Ninguno (NONE)</option>
                </select>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
