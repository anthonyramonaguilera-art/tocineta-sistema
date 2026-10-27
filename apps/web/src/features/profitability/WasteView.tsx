import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Button, Icon, Badge } from '../../ui/index.js';
import { WasteRegisterModal } from './components/WasteRegisterModal.js';
import { StockCountModal } from './components/StockCountModal.js';

interface WasteLogEntry {
  id: string;
  location_id: string;
  location_name?: string;
  supply_id?: string;
  product_id?: string;
  item_name?: string;
  quantity: number;
  unit: string;
  unit_cost_usd_cents: number;
  total_loss_usd_cents: number;
  reason: string;
  notes?: string;
  reported_by?: string;
  created_at_ms: number;
}

interface WasteViewProps {
  activeLocationId: string;
  onSelectLocation: (locId: string) => void;
}

export const WasteView: React.FC<WasteViewProps> = ({
  activeLocationId,
  onSelectLocation
}) => {
  const [isWasteModalOpen, setIsWasteModalOpen] = useState(false);
  const [isStockCountModalOpen, setIsStockCountModalOpen] = useState(false);

  const { data: wasteData, isLoading } = useQuery<{ success: boolean; wasteLogs: WasteLogEntry[] }>({
    queryKey: ['fase3Waste', activeLocationId],
    queryFn: async () => {
      const res = await fetch(`/api/fase3/waste?locationId=${activeLocationId}`);
      return res.json();
    }
  });

  const { data: suppliesData } = useQuery<{ success: boolean; supplies: any[] }>({
    queryKey: ['fase3Supplies', activeLocationId],
    queryFn: async () => {
      const res = await fetch(`/api/fase3/supplies?locationId=${activeLocationId}`);
      return res.json();
    }
  });

  const { data: recipesData } = useQuery<{ success: boolean; recipes: any[] }>({
    queryKey: ['fase3Recipes'],
    queryFn: async () => {
      const res = await fetch('/api/fase3/recipes');
      return res.json();
    }
  });

  const wasteLogs = wasteData?.wasteLogs || [];
  const supplies = suppliesData?.supplies || [];
  const products = (recipesData?.recipes || []).map((r) => ({
    id: r.productId,
    name: r.productName,
    priceUsdCents: r.priceUsdCents
  }));

  const totalLossUsdCents = wasteLogs.reduce((acc, l) => acc + (l.total_loss_usd_cents || 0), 0);

  return (
    <div className="space-y-4">
      {/* Barra de Acciones y Filtro de Sede */}
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
            onClick={() => setIsStockCountModalOpen(true)}
            className="flex-1 sm:flex-none"
            leftIcon={<Icon name="ClipboardList" size={16} />}
          >
            Conteo Físico
          </Button>
          <Button
            variant="danger"
            onClick={() => setIsWasteModalOpen(true)}
            className="flex-1 sm:flex-none"
            leftIcon={<Icon name="Trash2" size={16} />}
          >
            Registrar Merma
          </Button>
        </div>
      </div>

      {/* Tarjetas de Resumen Financiero de Pérdida */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card className="p-4 bg-danger/5 border-danger/20 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-ink-muted uppercase block">
              Pérdida Total por Mermas
            </span>
            <span className="text-2xl font-black text-danger font-mono">
              ${(totalLossUsdCents / 100).toFixed(2)} USD
            </span>
            <span className="text-[10px] text-ink-muted block mt-0.5">
              Impacta directamente el P&L restando de la utilidad neta.
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-danger/10 flex items-center justify-center text-danger">
            <Icon name="TrendingDown" size={24} />
          </div>
        </Card>

        <Card className="p-4 bg-surface flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-ink-muted uppercase block">
              Eventos Registrados
            </span>
            <span className="text-2xl font-black text-ink font-mono">
              {wasteLogs.length}
            </span>
            <span className="text-[10px] text-ink-muted block mt-0.5">
              Auditoría estricta de desperdicios operativos por sede.
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-surface-alt flex items-center justify-center text-ink">
            <Icon name="AlertTriangle" size={24} />
          </div>
        </Card>
      </div>

      {/* Listado Histórico de Mermas */}
      {isLoading ? (
        <div className="text-center py-12 text-xs font-bold text-ink-muted">
          Cargando registros de mermas...
        </div>
      ) : wasteLogs.length === 0 ? (
        <Card className="text-center py-12">
          <Icon name="CheckCircle" size={36} className="mx-auto text-success mb-2" />
          <h3 className="text-sm font-bold text-ink">Cero mermas registradas</h3>
          <p className="text-xs text-ink-muted mt-1">
            No se han reportado desperdicios en el periodo para esta sede.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {wasteLogs.map((log) => {
            const lossUsd = (log.total_loss_usd_cents / 100).toFixed(2);
            const dateStr = new Date(log.created_at_ms).toLocaleString('es-VE');

            return (
              <Card
                key={log.id}
                className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:border-danger/40 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h5 className="text-xs font-bold text-ink">{log.item_name || 'Ítem'}</h5>
                    <Badge variant="danger">{log.reason.replace(/_/g, ' ')}</Badge>
                  </div>
                  <div className="text-[11px] text-ink-muted flex flex-wrap gap-2">
                    <span>
                      Cant: <strong>{log.quantity} {log.unit}</strong>
                    </span>
                    <span>·</span>
                    <span>Sede: {log.location_name || log.location_id}</span>
                    <span>·</span>
                    <span>{dateStr}</span>
                    {log.reported_by && <span>· Por: {log.reported_by}</span>}
                  </div>
                  {log.notes && (
                    <p className="text-[11px] text-ink italic mt-0.5">{log.notes}</p>
                  )}
                </div>

                <div className="text-right sm:text-right pt-1 sm:pt-0 border-t sm:border-t-0 border-border/50">
                  <span className="text-[10px] text-ink-muted block uppercase">Pérdida</span>
                  <strong className="text-sm font-mono text-danger">-${lossUsd} USD</strong>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modales Modulares */}
      <WasteRegisterModal
        isOpen={isWasteModalOpen}
        onClose={() => setIsWasteModalOpen(false)}
        activeLocationId={activeLocationId}
        supplies={supplies}
        products={products}
      />

      <StockCountModal
        isOpen={isStockCountModalOpen}
        onClose={() => setIsStockCountModalOpen(false)}
        activeLocationId={activeLocationId}
        supplies={supplies}
      />
    </div>
  );
};

export default WasteView;
