import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Icon, Badge, type IconName } from '../../ui/index.js';
import { InventoryView } from './InventoryView.js';
import { PurchasesView } from './PurchasesView.js';
import { RecipesView } from './RecipesView.js';
import { WasteView } from './WasteView.js';
import { InitialSetupWizard } from './InitialSetupWizard.js';

type ProfitSubTab = 'inventory' | 'purchases' | 'recipes' | 'waste' | 'wizard' | 'net-profit';

export const ProfitabilityDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ProfitSubTab>(() => {
    try {
      const saved = localStorage.getItem('tocineta_profit_subtab');
      if (saved && ['inventory', 'purchases', 'recipes', 'waste', 'wizard', 'net-profit'].includes(saved)) {
        return saved as ProfitSubTab;
      }
    } catch {}
    return 'inventory';
  });

  const [activeLocationId, setActiveLocationId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('tocineta_active_sede');
      if (saved === 'sede_a') return 'loc_los_olivos';
      if (saved === 'sede_b') return 'loc_alta_vista';
      const raw = localStorage.getItem('tocineta_active_location');
      if (raw) return raw;
    } catch {}
    return 'loc_alta_vista';
  });

  const handleSelectLocation = (locId: string) => {
    setActiveLocationId(locId);
    try {
      localStorage.setItem('tocineta_active_location', locId);
      if (locId === 'loc_los_olivos') localStorage.setItem('tocineta_active_sede', 'sede_a');
      else if (locId === 'loc_alta_vista') localStorage.setItem('tocineta_active_sede', 'sede_b');
    } catch {}
  };

  const handleSelectTab = (tab: ProfitSubTab) => {
    setActiveTab(tab);
    try {
      localStorage.setItem('tocineta_profit_subtab', tab);
    } catch {}
  };

  // Escuchar eventos de navegación externa
  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail) {
        if (e.detail === 'inventory') handleSelectTab('inventory');
        else if (e.detail === 'purchases') handleSelectTab('purchases');
        else if (e.detail === 'recipes') handleSelectTab('recipes');
        else if (e.detail === 'mermas' || e.detail === 'expenses') handleSelectTab('waste');
        else if (e.detail === 'wizard') handleSelectTab('wizard');
        else if (e.detail === 'net-profit') handleSelectTab('net-profit');
      }
    };
    window.addEventListener('switch-profitability-subtab', handler);
    return () => window.removeEventListener('switch-profitability-subtab', handler);
  }, []);

  // Consulta de P&L para la subpestaña Net-Profit
  const { data: netProfitData } = useQuery<{
    success: boolean;
    revenueCents?: number;
    cogsCents?: number;
    wasteLossCents?: number;
    grossProfitCents?: number;
    netProfitCents?: number;
  }>({
    queryKey: ['fase3NetProfit', activeLocationId],
    queryFn: async () => {
      const res = await fetch(`/api/profitability/net-profit?locationId=${activeLocationId}`);
      return res.json();
    },
    enabled: activeTab === 'net-profit'
  });

  const TAB_ITEMS: Array<{ id: ProfitSubTab; label: string; icon: IconName }> = [
    { id: 'inventory', label: 'Inventario', icon: 'Package' },
    { id: 'purchases', label: 'Compras', icon: 'Truck' },
    { id: 'recipes', label: 'Recetas & Costos', icon: 'Utensils' },
    { id: 'waste', label: 'Mermas & Conteo', icon: 'Trash2' },
    { id: 'net-profit', label: 'Utilidad Neta', icon: 'TrendingUp' },
    { id: 'wizard', label: 'Configurar Negocio', icon: 'Sparkles' }
  ];

  return (
    <div className="space-y-4">
      {/* Selector de Sub-Módulos FASE 3 */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 bg-surface p-1.5 rounded-2xl border border-border">
        {TAB_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelectTab(item.id)}
              className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-primary text-primary-ink shadow-sm'
                  : 'text-ink-muted hover:text-ink hover:bg-surface-alt'
              }`}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Renderizado de Pantalla Seleccionada (≤ 400 líneas cada una) */}
      {activeTab === 'inventory' && (
        <InventoryView
          activeLocationId={activeLocationId}
          onSelectLocation={handleSelectLocation}
        />
      )}

      {activeTab === 'purchases' && (
        <PurchasesView activeLocationId={activeLocationId} />
      )}

      {activeTab === 'recipes' && (
        <RecipesView />
      )}

      {activeTab === 'waste' && (
        <WasteView
          activeLocationId={activeLocationId}
          onSelectLocation={handleSelectLocation}
        />
      )}

      {activeTab === 'wizard' && (
        <InitialSetupWizard
          activeLocationId={activeLocationId}
          onFinish={() => handleSelectTab('inventory')}
        />
      )}

      {activeTab === 'net-profit' && (
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-ink uppercase tracking-wider">
                  Estado de Resultados P&L Gerencial
                </h3>
                <p className="text-xs text-ink-muted">
                  Ingresos de caja vs CMV (costo de ventas ponderado) y mermas operativas.
                </p>
              </div>
              <Badge variant="brand">Sede: {activeLocationId === 'loc_los_olivos' ? 'Los Olivos' : 'Alta Vista'}</Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="p-3 rounded-xl bg-surface-alt border border-border">
                <span className="text-[10px] text-ink-muted uppercase block font-bold">Ventas Totales</span>
                <span className="text-xl font-black text-ink font-mono">
                  ${((netProfitData?.revenueCents || 0) / 100).toFixed(2)} USD
                </span>
              </div>

              <div className="p-3 rounded-xl bg-surface-alt border border-border">
                <span className="text-[10px] text-ink-muted uppercase block font-bold">Costo Insumos Vendidos</span>
                <span className="text-xl font-black text-ink font-mono">
                  ${((netProfitData?.cogsCents || 0) / 100).toFixed(2)} USD
                </span>
              </div>

              <div className="p-3 rounded-xl bg-surface-alt border border-border">
                <span className="text-[10px] text-ink-muted uppercase block font-bold">Mermas y Desperdicio</span>
                <span className="text-xl font-black text-danger font-mono">
                  -${((netProfitData?.wasteLossCents || 0) / 100).toFixed(2)} USD
                </span>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default ProfitabilityDashboard;
