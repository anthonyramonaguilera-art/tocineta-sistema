import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input, Select, Field, Icon, Badge } from '../../../ui/index.js';
import { apiFetch } from '../../../api/client.js';

export interface QuickProductSupplyItem {
  id: string;
  name: string;
  category?: string;
  costPerUnitUsdCents?: number;
  weightedAvgCostUsdCents?: number;
  usageUnit?: string;
}

export interface QuickProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (created: any) => void;
  initialSupply?: QuickProductSupplyItem | null;
}

interface ItemRow {
  supplyId: string;
  quantity: string;
}

export const QuickProductModal: React.FC<QuickProductModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialSupply
}) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [station, setStation] = useState<'hot_dogs' | 'hamburguesas' | 'caja_bebidas'>('hot_dogs');
  const [recipeMode, setRecipeMode] = useState<'UNITS' | 'GRAMMAGE' | 'FINISHED_PRODUCT'>('UNITS');
  const [priceUsd, setPriceUsd] = useState('');
  const [items, setItems] = useState<ItemRow[]>([{ supplyId: '', quantity: '1' }]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: posData } = useQuery<{ success: boolean; categories: any[] }>({
    queryKey: ['posMenu'],
    queryFn: async () => (await apiFetch('/api/menu/pos')).json(),
    enabled: isOpen
  });

  const { data: suppliesData } = useQuery<{ success: boolean; supplies: any[] }>({
    queryKey: ['fase3Supplies', 'ALL'],
    queryFn: async () => (await apiFetch('/api/fase3/supplies?locationId=ALL')).json(),
    enabled: isOpen
  });

  const categories = useMemo(() => posData?.categories || [], [posData]);
  const suppliesList = useMemo(() => suppliesData?.supplies || [], [suppliesData]);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    if (initialSupply) {
      setName(initialSupply.name || '');
      const isDrink = initialSupply.category === 'bebidas' || initialSupply.name.toLowerCase().includes('refresco');
      const targetStation = isDrink ? 'caja_bebidas' : 'hot_dogs';
      setStation(targetStation);
      const matchedCat = categories.find((c) =>
        isDrink ? c.id === 'cat_bebidas' || c.station === 'caja_bebidas' : c.station === targetStation
      );
      setCategoryId(matchedCat?.id || categories[0]?.id || '');
      setRecipeMode('UNITS');
      setItems([{ supplyId: initialSupply.id, quantity: '1' }]);
      const cost = initialSupply.weightedAvgCostUsdCents || initialSupply.costPerUnitUsdCents || 0;
      const suggested = cost > 0 ? Math.ceil(cost / 0.35) : 0;
      setPriceUsd(suggested > 0 ? (suggested / 100).toFixed(2) : '');
    } else {
      setName('');
      setCategoryId(categories[0]?.id || '');
      setStation('hot_dogs');
      setRecipeMode('UNITS');
      setItems([{ supplyId: suppliesList[0]?.id || '', quantity: '1' }]);
      setPriceUsd('');
    }
  }, [isOpen, initialSupply, categories, suppliesList]);

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    setCategoryId(selectedId);
    const cat = categories.find((c) => c.id === selectedId);
    if (cat && ['hot_dogs', 'hamburguesas', 'caja_bebidas'].includes(cat.station)) {
      setStation(cat.station);
    }
  };

  const calculatedCostCents = useMemo(() => {
    let total = 0;
    for (const row of items) {
      if (!row.supplyId) continue;
      const s = suppliesList.find((sup) => sup.id === row.supplyId);
      const unitCost = s?.weightedAvgCostUsdCents || s?.costPerUnitUsdCents || 0;
      const qty = parseFloat(row.quantity) || 0;
      total += Math.round(qty * unitCost);
    }
    return total;
  }, [items, suppliesList]);

  const suggestedPriceCents = useMemo(() => {
    if (calculatedCostCents <= 0) return 0;
    return Math.ceil(calculatedCostCents / 0.35);
  }, [calculatedCostCents]);

  const priceCents = useMemo(() => {
    const p = parseFloat(priceUsd || '0');
    return isNaN(p) ? 0 : Math.round(p * 100);
  }, [priceUsd]);

  const currentMarginPercent = useMemo(() => {
    if (priceCents <= 0) return 0;
    return Math.round(((priceCents - calculatedCostCents) / priceCents) * 100);
  }, [priceCents, calculatedCostCents]);

  const isHealthyMargin = currentMarginPercent >= 65;

  const quickCreateMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Ingresa el nombre del producto');
      if (!categoryId) throw new Error('Selecciona una categoría');
      if (items.length === 0) throw new Error('Agrega al menos un insumo');
      for (const it of items) {
        if (!it.supplyId) throw new Error('Todos los insumos deben estar seleccionados');
        const qty = parseFloat(it.quantity);
        if (isNaN(qty) || qty <= 0) throw new Error('La cantidad de cada insumo debe ser mayor a 0');
      }

      const payload = {
        name: name.trim(),
        categoryId,
        station,
        recipeMode,
        priceUsdCents: priceCents > 0 ? priceCents : suggestedPriceCents,
        items: items.map((it) => ({
          supplyId: it.supplyId,
          quantity: parseFloat(it.quantity) || 1
        }))
      };

      const res = await apiFetch('/api/profitability/products/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al crear el producto con receta');
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['fase3Recipes'] });
      queryClient.invalidateQueries({ queryKey: ['posMenu'] });
      queryClient.invalidateQueries({ queryKey: ['fase3Supplies'] });
      onSuccess?.(data);
      onClose();
    },
    onError: (err: any) => setErrorMsg(err.message || 'Error al crear el producto')
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialSupply ? 'Vender Insumo como Producto de Carta' : 'Crear Producto de Venta con Receta'}
      description="Crea en una sola acción el plato en carta y su receta técnica con cálculo de costo y margen en vivo."
      maxWidth="lg"
      footer={
        <div className="flex justify-end gap-2 w-full">
          <Button variant="ghost" onClick={onClose} disabled={quickCreateMutation.isPending} className="min-h-[48px]">
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => quickCreateMutation.mutate()}
            disabled={quickCreateMutation.isPending || !name.trim() || !categoryId}
            className="min-h-[48px]"
            leftIcon={<Icon name="Check" size={18} />}
          >
            {quickCreateMutation.isPending ? 'Creando...' : 'Crear Producto y Receta'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {errorMsg && (
          <div className="p-3 bg-surface-alt border border-border rounded-xl text-xs text-danger font-medium flex items-center gap-2">
            <Icon name="AlertTriangle" size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        <Field label="Nombre del Plato o Producto en Carta" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Jalapeños Dog 2, Malta Fría, etc." />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Categoría" required>
            <Select value={categoryId} onChange={handleCategoryChange}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>

          <Field label="Estación de Cocina" required>
            <Select value={station} onChange={(e) => setStation(e.target.value as any)}>
              <option value="hot_dogs">Hot Dogs</option>
              <option value="hamburguesas">Hamburguesas</option>
              <option value="caja_bebidas">Caja / Bebidas</option>
            </Select>
          </Field>

          <Field label="Modo de Receta">
            <Select value={recipeMode} onChange={(e) => setRecipeMode(e.target.value as any)}>
              <option value="UNITS">Por Unidades</option>
              <option value="GRAMMAGE">Por Gramaje</option>
              <option value="FINISHED_PRODUCT">Plato Terminado</option>
            </Select>
          </Field>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-ink uppercase tracking-wider">Componentes de la Receta</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setItems((prev) => [...prev, { supplyId: suppliesList[0]?.id || '', quantity: '1' }])}
              leftIcon={<Icon name="Plus" size={14} />}
              className="min-h-[48px] text-xs font-bold"
            >
              Agregar insumo
            </Button>
          </div>

          <div className="space-y-2">
            {items.map((row, idx) => {
              const selectedSup = suppliesList.find((s) => s.id === row.supplyId);
              const uCost = selectedSup?.weightedAvgCostUsdCents || selectedSup?.costPerUnitUsdCents || 0;
              const q = parseFloat(row.quantity) || 0;
              const subtotal = (q * uCost) / 100;

              return (
                <div key={idx} className="flex items-center gap-2 p-2.5 rounded-xl bg-surface-alt border border-border">
                  <div className="flex-1">
                    <Field label="Insumo">
                      <Select
                        value={row.supplyId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, supplyId: val } : item)));
                        }}
                      >
                        {suppliesList.map((sup) => (
                          <option key={sup.id} value={sup.id}>
                            {sup.name} ({sup.usageUnit || 'unid'}) - ${((sup.weightedAvgCostUsdCents || sup.costPerUnitUsdCents || 0) / 100).toFixed(2)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>

                  <div className="w-24">
                    <Field label="Cantidad">
                      <Input
                        type="number"
                        min="0.01"
                        step="any"
                        value={row.quantity}
                        onChange={(e) => {
                          const val = e.target.value;
                          setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, quantity: val } : item)));
                        }}
                      />
                    </Field>
                  </div>

                  <div className="text-right shrink-0 pt-4 px-1 min-w-[70px]">
                    <span className="text-[10px] text-ink-muted block uppercase">Subtotal</span>
                    <strong className="text-xs font-mono text-ink">${subtotal.toFixed(2)}</strong>
                  </div>

                  {items.length > 1 && (
                    <div className="pt-4 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="min-h-[48px] text-danger"
                      >
                        <Icon name="Trash2" size={16} />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-surface-alt border border-border space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-ink uppercase tracking-wider">Análisis Financiero en Vivo</span>
            <Badge variant={isHealthyMargin ? 'neutral' : 'warning'}>Margen: {currentMarginPercent}% (Obj: 65%)</Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div className="p-2 rounded-xl bg-surface border border-border">
              <span className="text-[10px] text-ink-muted block uppercase">Costo Receta</span>
              <strong className="text-sm font-mono text-ink">${(calculatedCostCents / 100).toFixed(2)}</strong>
            </div>

            <div className="p-2 rounded-xl bg-surface border border-border">
              <span className="text-[10px] text-ink-muted block uppercase">Sugerido (65%)</span>
              <strong className="text-sm font-mono text-primary">${(suggestedPriceCents / 100).toFixed(2)}</strong>
            </div>

            <div className="col-span-2 p-2 rounded-xl bg-surface border border-border flex items-center justify-between gap-2">
              <div className="text-left">
                <span className="text-[10px] text-ink-muted block uppercase">Precio de Venta</span>
                <span className="text-xs text-ink-muted">En carta POS</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => suggestedPriceCents > 0 && setPriceUsd((suggestedPriceCents / 100).toFixed(2))}
                disabled={suggestedPriceCents <= 0}
                className="min-h-[48px] text-xs font-bold"
              >
                Usar sugerido
              </Button>
            </div>
          </div>

          <Field label="Precio de Venta Definitivo ($ USD)" required>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              value={priceUsd}
              onChange={(e) => setPriceUsd(e.target.value)}
              placeholder={(suggestedPriceCents / 100).toFixed(2)}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
};
