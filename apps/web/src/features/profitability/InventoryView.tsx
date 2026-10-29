import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Button, Input, Icon, Badge } from '../../ui/index.js';
import { TransferModal } from './components/TransferModal.js';
import { NewSupplyModal } from './components/NewSupplyModal.js';
import { ProductionModal } from './components/ProductionModal.js';

interface SupplyItemData {
  id: string;
  name: string;
  unit: string;
  purchaseUnit: string;
  usageUnit: string;
  conversionFactor: number;
  category: string;
  minStock: number;
  costPerUnitUsdCents: number;
  weightedAvgCostUsdCents: number;
  lastCostUsdCents: number;
  currentStockQty: number;
  stockByLocation: {
    loc_alta_vista: number;
    loc_los_olivos: number;
  };
}

interface InventoryViewProps {
  activeLocationId: string;
  onSelectLocation: (locId: string) => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  activeLocationId,
  onSelectLocation
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isProductionModalOpen, setIsProductionModalOpen] = useState(false);

  const { data: suppliesData, isLoading } = useQuery<{ success: boolean; supplies: SupplyItemData[] }>({
    queryKey: ['fase3Supplies', activeLocationId],
    queryFn: async () => {
      const res = await fetch(`/api/fase3/supplies?locationId=${activeLocationId}`);
      return res.json();
    }
  });

  const supplies = suppliesData?.supplies || [];

  const filteredSupplies = supplies.filter((s) => {
    const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || s.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = Array.from(new Set(supplies.map((s) => s.category || 'general')));

  return (
    <div className="space-y-4">
      {/* Barra Superior con Selector de Sede y Acciones */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-surface p-3.5 rounded-2xl border border-border">
        <div className="flex items-center gap-2">
          <Icon name="MapPin" size={18} className="text-primary shrink-0" />
          <span className="text-xs font-bold text-ink-muted">Sede:</span>
          <div className="flex bg-surface-alt p-0.5 rounded-xl border border-border">
            <button
              type="button"
              onClick={() => onSelectLocation('loc_alta_vista')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeLocationId === 'loc_alta_vista'
                  ? 'bg-primary text-primary-ink shadow-sm'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Alta Vista
            </button>
            <button
              type="button"
              onClick={() => onSelectLocation('loc_los_olivos')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeLocationId === 'loc_los_olivos'
                  ? 'bg-primary text-primary-ink shadow-sm'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Los Olivos
            </button>
            <button
              type="button"
              onClick={() => onSelectLocation('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeLocationId === 'ALL'
                  ? 'bg-primary text-primary-ink shadow-sm'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Consolidado
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => setIsProductionModalOpen(true)}
            className="flex-1 sm:flex-none"
            leftIcon={<Icon name="ChefHat" size={16} />}
          >
            Producción
          </Button>
          <Button
            variant="ghost"
            onClick={() => setIsTransferModalOpen(true)}
            className="flex-1 sm:flex-none"
            leftIcon={<Icon name="ArrowRightLeft" size={16} />}
          >
            Transferir
          </Button>
          <Button
            variant="primary"
            onClick={() => setIsCreateModalOpen(true)}
            className="flex-1 sm:flex-none"
            leftIcon={<Icon name="Plus" size={16} />}
          >
            Nuevo Insumo
          </Button>
        </div>
      </div>

      {/* Buscador y Filtros */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar insumo por nombre..."
            leftIcon={<Icon name="Search" size={16} />}
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              selectedCategory === 'all'
                ? 'bg-ink text-surface'
                : 'bg-surface border border-border text-ink hover:bg-surface-alt'
            }`}
          >
            Todos ({supplies.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-2 rounded-xl text-xs font-bold capitalize whitespace-nowrap transition-all ${
                selectedCategory === cat
                  ? 'bg-ink text-surface'
                  : 'bg-surface border border-border text-ink hover:bg-surface-alt'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Listado de Insumos */}
      {isLoading ? (
        <div className="text-center py-12 text-xs font-bold text-ink-muted">
          Cargando inventario de insumos...
        </div>
      ) : filteredSupplies.length === 0 ? (
        <Card className="text-center py-12">
          <Icon name="Package" size={36} className="mx-auto text-ink-muted mb-2" />
          <h3 className="text-sm font-bold text-ink">No se encontraron insumos</h3>
          <p className="text-xs text-ink-muted mt-1">
            {searchTerm ? 'Prueba con otro término de búsqueda' : 'Registra tu primer insumo para empezar.'}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredSupplies.map((supply) => {
            const isNegative = supply.currentStockQty < 0;
            const isLowStock = !isNegative && supply.currentStockQty <= supply.minStock;
            const wacUsd = (supply.weightedAvgCostUsdCents / 100).toFixed(2);
            const lastUsd = (supply.lastCostUsdCents / 100).toFixed(2);

            return (
              <Card key={supply.id} className="p-3.5 space-y-3 relative hover:border-primary/50 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-ink leading-tight">{supply.name}</h4>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                      {supply.category || 'General'}
                    </span>
                  </div>
                  {isNegative ? (
                    <Badge variant="danger" className="badge-danger" data-testid="negative-stock-alert">
                      Stock negativo: se vendió o gastó más de lo registrado
                    </Badge>
                  ) : (
                    <Badge variant={isLowStock ? 'danger' : 'neutral'}>
                      {isLowStock ? 'Stock Bajo' : 'Normal'}
                    </Badge>
                  )}
                </div>

                {/* Métricas de Stock */}
                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-surface-alt text-center">
                  <div>
                    <span className="text-[10px] font-bold text-ink-muted block uppercase">Stock Sede</span>
                    <span className={`text-base font-black ${isNegative || isLowStock ? 'text-danger' : 'text-ink'}`}>
                      {supply.currentStockQty.toLocaleString()} <span className="text-xs font-normal">{supply.usageUnit}</span>
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-ink-muted block uppercase">Mínimo Alerta</span>
                    <span className="text-base font-black text-ink-muted">
                      {supply.minStock} <span className="text-xs font-normal">{supply.usageUnit}</span>
                    </span>
                  </div>
                </div>

                {/* Desglose por Sedes */}
                <div className="flex justify-between items-center text-xs px-1 border-t border-border/50 pt-2 text-ink-muted">
                  <span>Alta Vista: <strong className="text-ink">{supply.stockByLocation.loc_alta_vista} {supply.usageUnit}</strong></span>
                  <span>Los Olivos: <strong className="text-ink">{supply.stockByLocation.loc_los_olivos} {supply.usageUnit}</strong></span>
                </div>

                {/* Costos Ponderados y Conversión */}
                <div className="text-[11px] bg-surface p-2 rounded-lg border border-border/60 flex items-center justify-between text-ink-muted">
                  <span>Ponderado: <strong className="text-ink">${wacUsd}</strong></span>
                  <span>Último: <strong className="text-ink">${lastUsd}</strong></span>
                  <span>1 {supply.purchaseUnit} = {supply.conversionFactor} {supply.usageUnit}</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modales Modulares */}
      <TransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        supplies={supplies}
      />

      <NewSupplyModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />

      <ProductionModal
        isOpen={isProductionModalOpen}
        onClose={() => setIsProductionModalOpen(false)}
      />
    </div>
  );
};

export default InventoryView;
