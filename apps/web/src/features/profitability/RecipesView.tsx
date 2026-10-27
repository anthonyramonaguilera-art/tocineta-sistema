import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Button, Input, Icon, Badge } from '../../ui/index.js';
import { RecipeEditorModal } from './components/RecipeEditorModal.js';
import { SubRecipeEditorModal } from './components/SubRecipeEditorModal.js';

interface RecipeSummary {
  productId: string;
  productName: string;
  station: string;
  category?: string;
  currentPriceUsdCents?: number;
  priceUsdCents?: number;
  recipeMode: 'UNITS' | 'GRAMMAGE' | 'FINISHED_PRODUCT';
  targetMarginBps: number;
  items?: any[];
  ingredients?: any[];
  modifiers?: any[];
  calculatedCostUsdCents?: number;
  currentCostUsdCents?: number;
  currentMarginBps?: number;
  marginBps?: number;
  suggestedPriceUsdCents: number;
}

export const RecipesView: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStation, setSelectedStation] = useState<string>('all');
  const [activeRecipe, setActiveRecipe] = useState<RecipeSummary | null>(null);
  const [isSubRecipeModalOpen, setIsSubRecipeModalOpen] = useState(false);

  const { data: recipesData, isLoading } = useQuery<{ success: boolean; recipes: RecipeSummary[] }>({
    queryKey: ['fase3Recipes'],
    queryFn: async () => {
      const res = await fetch('/api/fase3/recipes');
      return res.json();
    }
  });

  const { data: suppliesData } = useQuery<{ success: boolean; supplies: any[] }>({
    queryKey: ['fase3Supplies', 'ALL'],
    queryFn: async () => {
      const res = await fetch('/api/fase3/supplies?locationId=ALL');
      return res.json();
    }
  });

  const { data: subRecipesData } = useQuery<{ success: boolean; subRecipes: any[] }>({
    queryKey: ['fase3SubRecipes'],
    queryFn: async () => {
      const res = await fetch('/api/fase3/sub-recipes');
      return res.json();
    }
  });

  const recipes = recipesData?.recipes || [];
  const supplies = suppliesData?.supplies || [];
  const subRecipes = subRecipesData?.subRecipes || [];

  const filtered = recipes.filter((r) => {
    const matchesSearch = r.productName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStation = selectedStation === 'all' || r.station === selectedStation;
    return matchesSearch && matchesStation;
  });

  const stations = Array.from(new Set(recipes.map((r) => r.station).filter(Boolean)));

  return (
    <div className="space-y-4">
      {/* Barra de Herramientas */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-surface p-3.5 rounded-2xl border border-border">
        <div className="flex items-center gap-2">
          <Icon name="Utensils" size={20} className="text-primary shrink-0" />
          <div>
            <h3 className="text-xs font-bold text-ink uppercase tracking-wider">
              Recetas, Sub-Recetas y Escandallos en Vivo
            </h3>
            <p className="text-[11px] text-ink-muted">
              Tres modos: Por Unidades, Por Gramaje con Merma y Plato Terminado.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => setIsSubRecipeModalOpen(true)}
            className="flex-1 sm:flex-none"
            leftIcon={<Icon name="Layers" size={16} />}
          >
            Sub-Recetas ({subRecipes.length})
          </Button>
        </div>
      </div>

      {/* Buscador y Filtro por Estación */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar plato o bebida..."
            leftIcon={<Icon name="Search" size={16} />}
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setSelectedStation('all')}
            className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              selectedStation === 'all'
                ? 'bg-ink text-surface'
                : 'bg-surface border border-border text-ink hover:bg-surface-alt'
            }`}
          >
            Todas ({recipes.length})
          </button>
          {stations.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setSelectedStation(st)}
              className={`px-3 py-2 rounded-xl text-xs font-bold uppercase whitespace-nowrap transition-all ${
                selectedStation === st
                  ? 'bg-ink text-surface'
                  : 'bg-surface border border-border text-ink hover:bg-surface-alt'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Listado de Platos */}
      {isLoading ? (
        <div className="text-center py-12 text-xs font-bold text-ink-muted">
          Cargando recetas y escandallos...
        </div>
      ) : filtered.length === 0 ? (
        <Card className="text-center py-12">
          <Icon name="BookOpen" size={36} className="mx-auto text-ink-muted mb-2" />
          <h3 className="text-sm font-bold text-ink">No se encontraron productos</h3>
          <p className="text-xs text-ink-muted mt-1">Verifica tus filtros de búsqueda.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((r) => {
            const currentPrice = r.currentPriceUsdCents ?? r.priceUsdCents ?? 0;
            const currentCost = r.calculatedCostUsdCents ?? r.currentCostUsdCents ?? 0;
            const currentMargin = r.currentMarginBps ?? r.marginBps ?? 0;
            const itemsList = r.items || r.ingredients || [];

            const priceUsd = (currentPrice / 100).toFixed(2);
            const costUsd = (currentCost / 100).toFixed(2);
            const suggestedUsd = (r.suggestedPriceUsdCents / 100).toFixed(2);
            const margin = (currentMargin / 100).toFixed(1);
            const targetMargin = (r.targetMarginBps / 100).toFixed(0);
            const isHealthyMargin = currentMargin >= r.targetMarginBps;

            return (
              <Card
                key={r.productId}
                className="p-3.5 space-y-3 hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => setActiveRecipe(r)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-ink leading-tight">{r.productName}</h4>
                    <span className="text-[10px] text-ink-muted uppercase">
                      {r.station} {r.category ? `· ${r.category}` : ''}
                    </span>
                  </div>
                  <Badge variant={isHealthyMargin ? 'neutral' : 'warning'}>
                    {r.recipeMode}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 p-2 rounded-xl bg-surface-alt text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-ink-muted block uppercase">Costo Receta</span>
                    <strong className="text-ink text-sm">${costUsd}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-ink-muted block uppercase">Precio Venta</span>
                    <strong className="text-primary text-sm">${priceUsd}</strong>
                  </div>
                </div>

                <div className="flex justify-between items-center text-xs px-1">
                  <span className="text-ink-muted">
                    Margen: <strong className={isHealthyMargin ? 'text-success' : 'text-danger'}>{margin}%</strong>{' '}
                    (Obj: {targetMargin}%)
                  </span>
                  <span className="text-ink-muted">
                    Sugerido: <strong className="text-ink">${suggestedUsd}</strong>
                  </span>
                </div>

                <div className="flex justify-between items-center text-[11px] text-ink-muted border-t border-border/50 pt-2">
                  <span>{itemsList.length} componentes</span>
                  <span className="text-primary font-bold">Editar Ficha →</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal de Edición de Receta */}
      {activeRecipe && (
        <RecipeEditorModal
          isOpen={!!activeRecipe}
          onClose={() => setActiveRecipe(null)}
          recipe={activeRecipe}
          supplies={supplies}
          subRecipes={subRecipes}
        />
      )}

      {/* Modal de Sub-Recetas */}
      <SubRecipeEditorModal
        isOpen={isSubRecipeModalOpen}
        onClose={() => setIsSubRecipeModalOpen(false)}
        supplies={supplies}
      />
    </div>
  );
};

export default RecipesView;
