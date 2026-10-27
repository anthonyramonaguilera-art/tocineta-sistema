import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, Icon } from '../../../ui/index.js';

export interface CalculatedSupply {
  supplyId: string;
  name: string;
  unit: string;
  quantityRequired: number;
  currentStockOrigin: number;
  unitCostUsdCents: number;
  totalCostUsdCents: number;
  isSufficient: boolean;
}

interface TransferDishEquivalentModeProps {
  fromLocationId: string;
  onApplySupplies: (supplies: Array<{ supplyId: string; name: string; unit: string; quantity: number }>, dishEquivalents: Array<{ productId: string; quantity: number }>) => void;
}

export const TransferDishEquivalentMode: React.FC<TransferDishEquivalentModeProps> = ({
  fromLocationId,
  onApplySupplies
}) => {
  const [selectedDishes, setSelectedDishes] = useState<Array<{ productId: string; quantity: number }>>([
    { productId: 'prod_smash_clasica', quantity: 30 },
    { productId: 'prod_street_dog', quantity: 50 }
  ]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculatedSupplies, setCalculatedSupplies] = useState<CalculatedSupply[] | null>(null);

  // Consultar carta de productos para selector
  const { data: menuData } = useQuery<{
    products: Array<{ id: string; name: string; categoryId: string; isCombo: boolean }>;
  }>({
    queryKey: ['fase4MenuProducts'],
    queryFn: async () => {
      const res = await fetch('/api/menu/pos');
      const json = await res.json();
      const allProds = (json.categories || []).flatMap((c: any) => c.products || []);
      return { products: allProds };
    },
    staleTime: 30000
  });

  const products = menuData?.products || [];

  React.useEffect(() => {
    if (products.length > 0 && selectedDishes[0]?.productId === 'prod_smash_clasica') {
      const burger = products.find(p => p.name.toLowerCase().includes('americana') || p.name.toLowerCase().includes('grill') || p.name.toLowerCase().includes('hamburguesa')) || products[0];
      const dog = products.find(p => p.name.toLowerCase().includes('street') || p.name.toLowerCase().includes('dog') || p.name.toLowerCase().includes('perro')) || products[1] || products[0];
      setSelectedDishes([
        { productId: burger.id, quantity: 30 },
        { productId: dog.id, quantity: 50 }
      ]);
    }
  }, [products]);

  const handleDishChange = (index: number, field: 'productId' | 'quantity', value: any) => {
    setSelectedDishes(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: field === 'quantity' ? Math.max(1, parseInt(value, 10) || 0) : value };
      return copy;
    });
    setCalculatedSupplies(null);
  };

  const handleAddDish = () => {
    const firstProd = products[0]?.id || 'prod_smash_clasica';
    setSelectedDishes(prev => [...prev, { productId: firstProd, quantity: 10 }]);
    setCalculatedSupplies(null);
  };

  const handleRemoveDish = (index: number) => {
    setSelectedDishes(prev => prev.filter((_, i) => i !== index));
    setCalculatedSupplies(null);
  };

  const handleCalculate = async () => {
    if (selectedDishes.length === 0) return;
    setIsCalculating(true);
    try {
      const res = await fetch('/api/fase4/transfers/calculate-dish-equivalents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromLocationId,
          dishes: selectedDishes.map(d => {
            const p = products.find(prod => prod.id === d.productId);
            return {
              productId: d.productId,
              productName: p?.name || d.productId,
              quantity: d.quantity
            };
          })
        })
      });
      const data = await res.json();
      if (data.success) {
        setCalculatedSupplies(data.supplies || []);
      }
    } catch {
      // Ignorar error de red puntual
    } finally {
      setIsCalculating(false);
    }
  };

  const handleSupplyQtyEdit = (index: number, newQty: number) => {
    if (!calculatedSupplies) return;
    setCalculatedSupplies(prev => {
      if (!prev) return prev;
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        quantityRequired: newQty,
        isSufficient: copy[index].currentStockOrigin >= newQty
      };
      return copy;
    });
  };

  const handleConfirmAndLoad = () => {
    if (!calculatedSupplies || calculatedSupplies.length === 0) return;
    onApplySupplies(
      calculatedSupplies.map(s => ({
        supplyId: s.supplyId,
        name: s.name,
        unit: s.unit,
        quantity: s.quantityRequired
      })),
      selectedDishes
    );
  };

  return (
    <div className="space-y-4 p-3 rounded-2xl bg-surface-alt border border-border">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-black text-ink uppercase tracking-wider flex items-center gap-1.5">
            <Icon name="Calculator" size={14} className="text-primary" />
            <span>Equivalente de Platos a Insumos</span>
          </h4>
          <p className="text-[11px] text-ink-muted">
            Indica cuántos platos terminados necesitas preparar en destino para calcular materias primas automáticamente.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleAddDish}>
          + Agregar Plato
        </Button>
      </div>

      {/* Lista de platos a convertir */}
      <div className="space-y-2">
        {selectedDishes.map((dish, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className="flex-1">
              <select
                value={dish.productId}
                onChange={(e) => handleDishChange(idx, 'productId', e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold"
              >
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <Input
                type="number"
                min="1"
                value={dish.quantity}
                onChange={(e) => handleDishChange(idx, 'quantity', e.target.value)}
                placeholder="Cant."
              />
            </div>
            {selectedDishes.length > 1 && (
              <button
                type="button"
                onClick={() => handleRemoveDish(idx)}
                className="w-8 h-8 rounded-lg text-danger hover:bg-danger/10 flex items-center justify-center font-bold"
                aria-label="Eliminar plato"
              >
                <Icon name="X" size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-start">
        <Button
          variant="secondary"
          size="sm"
          disabled={isCalculating || selectedDishes.length === 0}
          onClick={handleCalculate}
        >
          {isCalculating ? 'Calculando Recetas...' : 'Calcular Insumos Requeridos'}
        </Button>
      </div>

      {/* Tabla de insumos calculados editable */}
      {calculatedSupplies && (
        <div className="space-y-3 pt-2 border-t border-border">
          <div className="text-xs font-black text-ink uppercase tracking-wider flex items-center justify-between">
            <span>Insumos Necesarios Según Receta ({calculatedSupplies.length}):</span>
            <span className="text-[10px] text-ink-muted font-normal">Editable antes de cargar</span>
          </div>

          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {calculatedSupplies.map((s, idx) => (
              <div
                key={s.supplyId}
                className={`p-2 rounded-xl border flex items-center justify-between text-xs ${
                  s.isSufficient ? 'bg-surface border-border' : 'bg-warning/10 border-warning/30 text-ink'
                }`}
              >
                <div className="flex-1">
                  <div className="font-bold text-ink">{s.name}</div>
                  <div className="text-[10px] text-ink-muted">
                    Disp. en Origen: {s.currentStockOrigin} {s.unit}
                    {!s.isSufficient && (
                      <span className="text-danger font-bold ml-1">
                        (Faltan {(s.quantityRequired - s.currentStockOrigin).toFixed(1)} {s.unit})
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="any"
                    value={s.quantityRequired}
                    onChange={(e) => handleSupplyQtyEdit(idx, parseFloat(e.target.value) || 0)}
                    className="w-20 h-8 px-2 text-right rounded-lg bg-surface border border-border text-ink font-bold text-xs"
                  />
                  <span className="text-[11px] text-ink-muted w-8">{s.unit}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-2">
            <Button variant="primary" size="md" onClick={handleConfirmAndLoad}>
              Cargar Insumos al Despacho
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
