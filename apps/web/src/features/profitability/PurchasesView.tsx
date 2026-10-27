import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Icon, Badge } from '../../ui/index.js';
import { CostVariationModal, type RecipeImpact } from './components/CostVariationModal.js';
import { NewPurchaseModal } from './components/NewPurchaseModal.js';
import { PriceHistoryModal } from './components/PriceHistoryModal.js';

interface PurchaseRecord {
  id: string;
  location_id: string;
  location_name?: string;
  supplier_name?: string;
  invoice_number?: string;
  payment_condition: string;
  status: string;
  total_usd_cents: number;
  created_at_ms: number;
}

interface PurchasesViewProps {
  activeLocationId: string;
}

export const PurchasesView: React.FC<PurchasesViewProps> = ({ activeLocationId }) => {
  const queryClient = useQueryClient();
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [isPriceImpactModalOpen, setIsPriceImpactModalOpen] = useState(false);
  const [isPriceHistoryModalOpen, setIsPriceHistoryModalOpen] = useState(false);

  // Alerta de Variación de Costo
  const [affectedRecipes, setAffectedRecipes] = useState<RecipeImpact[]>([]);
  const [priceAdjustments, setPriceAdjustments] = useState<Record<string, number>>({});

  const { data: purchasesData, isLoading } = useQuery<{ success: boolean; purchases: PurchaseRecord[] }>({
    queryKey: ['fase3Purchases', activeLocationId],
    queryFn: async () => {
      const res = await fetch(`/api/fase3/purchases?locationId=${activeLocationId}`);
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

  const { data: historyData } = useQuery<{ success: boolean; history: any[] }>({
    queryKey: ['fase3PriceHistory'],
    queryFn: async () => {
      const res = await fetch('/api/fase3/price-history');
      return res.json();
    },
    enabled: isPriceHistoryModalOpen
  });

  const adjustMutation = useMutation({
    mutationFn: async () => {
      const adjustments = Object.entries(priceAdjustments).map(([productId, newPriceCents]) => ({
        productId,
        newPriceUsdCents: newPriceCents
      }));

      const res = await fetch('/api/fase3/purchases/adjust-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustments })
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['fase3Recipes'] });
        queryClient.invalidateQueries({ queryKey: ['posMenu'] });
        setIsPriceImpactModalOpen(false);
        setAffectedRecipes([]);
        setPriceAdjustments({});
      } else {
        alert(data.error || 'Error al ajustar precios');
      }
    }
  });

  const handlePurchaseCompleted = (impacts: RecipeImpact[]) => {
    setAffectedRecipes(impacts);
    const initialMap: Record<string, number> = {};
    impacts.forEach((r) => {
      initialMap[r.productId] = r.suggestedPriceUsdCents;
    });
    setPriceAdjustments(initialMap);
    setIsPriceImpactModalOpen(true);
  };

  const purchases = purchasesData?.purchases || [];

  return (
    <div className="space-y-4">
      {/* Barra de Acciones de Compras */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-surface p-3.5 rounded-2xl border border-border">
        <div className="flex items-center gap-2">
          <Icon name="Truck" size={20} className="text-primary shrink-0" />
          <div>
            <h3 className="text-xs font-bold text-ink uppercase tracking-wider">
              Asistente de Compras y Costeo Ponderado
            </h3>
            <p className="text-[11px] text-ink-muted">
              Ingresa compras en unidad de empaque; actualiza el costo ponderado automáticamente.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => setIsPriceHistoryModalOpen(true)}
            className="flex-1 sm:flex-none"
            leftIcon={<Icon name="History" size={16} />}
          >
            Historial Precios
          </Button>
          <Button
            variant="primary"
            onClick={() => setIsPurchaseModalOpen(true)}
            className="flex-1 sm:flex-none"
            leftIcon={<Icon name="Plus" size={16} />}
          >
            Registrar Factura
          </Button>
        </div>
      </div>

      {/* Listado de Facturas Recientes */}
      {isLoading ? (
        <div className="text-center py-12 text-xs font-bold text-ink-muted">
          Cargando compras y recepciones...
        </div>
      ) : purchases.length === 0 ? (
        <Card className="text-center py-12">
          <Icon name="ShoppingBag" size={36} className="mx-auto text-ink-muted mb-2" />
          <h3 className="text-sm font-bold text-ink">No hay facturas registradas</h3>
          <p className="text-xs text-ink-muted mt-1">
            Usa el botón "Registrar Factura" para cargar la primera compra de insumos.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {purchases.map((p) => {
            const totalUsd = (p.total_usd_cents / 100).toFixed(2);
            const dateStr = new Date(p.created_at_ms).toLocaleDateString('es-VE');

            return (
              <Card key={p.id} className="p-3.5 space-y-2.5 hover:border-primary/50 transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-ink leading-tight">
                      {p.supplier_name || 'Proveedor General'}
                    </h4>
                    <span className="text-[10px] text-ink-muted uppercase">
                      Fact: {p.invoice_number || 'S/N'} · {dateStr}
                    </span>
                  </div>
                  <Badge variant={p.payment_condition === 'CREDITO' ? 'warning' : 'neutral'}>
                    {p.payment_condition}
                  </Badge>
                </div>

                <div className="flex justify-between items-center text-xs p-2 rounded-xl bg-surface-alt font-mono">
                  <span className="text-ink-muted">Monto Factura:</span>
                  <strong className="text-sm text-primary">${totalUsd} USD</strong>
                </div>

                <div className="text-[11px] text-ink-muted flex justify-between items-center px-1">
                  <span>Sede: {p.location_name || p.location_id}</span>
                  <span className="capitalize text-success font-bold flex items-center gap-1">
                    <Icon name="Check" size={12} />
                    Recibido
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modales Modulares */}
      <NewPurchaseModal
        isOpen={isPurchaseModalOpen}
        onClose={() => setIsPurchaseModalOpen(false)}
        supplies={suppliesData?.supplies || []}
        onPurchaseComplete={handlePurchaseCompleted}
      />

      <CostVariationModal
        isOpen={isPriceImpactModalOpen}
        onClose={() => setIsPriceImpactModalOpen(false)}
        affectedRecipes={affectedRecipes}
        priceAdjustments={priceAdjustments}
        onPriceChange={(prodId, cents) => {
          setPriceAdjustments((prev) => ({ ...prev, [prodId]: cents }));
        }}
        onKeepPrices={() => {
          setIsPriceImpactModalOpen(false);
          setAffectedRecipes([]);
        }}
        onConfirmAdjustments={() => adjustMutation.mutate()}
        isAdjusting={adjustMutation.isPending}
      />

      <PriceHistoryModal
        isOpen={isPriceHistoryModalOpen}
        onClose={() => setIsPriceHistoryModalOpen(false)}
        history={historyData?.history || []}
      />
    </div>
  );
};

export default PurchasesView;
