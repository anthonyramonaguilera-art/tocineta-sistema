import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input, Badge } from '../../../ui/index.js';

interface StockCountModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeLocationId: string;
  supplies: any[];
}

export const StockCountModal: React.FC<StockCountModalProps> = ({
  isOpen,
  onClose,
  activeLocationId,
  supplies
}) => {
  const queryClient = useQueryClient();
  const [selectedLocation, setSelectedLocation] = useState(
    activeLocationId === 'ALL' ? 'loc_alta_vista' : activeLocationId
  );
  const [countsMap, setCountsMap] = useState<Record<string, string>>({});
  const [reasonsMap, setReasonsMap] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const countMutation = useMutation({
    mutationFn: async () => {
      const payloadCounts = Object.entries(countsMap)
        .filter(([_, val]) => val !== '' && !isNaN(parseFloat(val)))
        .map(([supplyId, val]) => ({
          supplyId,
          physicalCount: parseFloat(val),
          adjustmentReason: reasonsMap[supplyId] || 'Ajuste de Conteo Físico Periódico'
        }));

      if (payloadCounts.length === 0) {
        throw new Error('Ingresa al menos un conteo físico para conciliar');
      }

      const res = await fetch('/api/fase3/stock-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: selectedLocation,
          counts: payloadCounts
        })
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['fase3Supplies'] });
        queryClient.invalidateQueries({ queryKey: ['fase3Waste'] });
        onClose();
        setCountsMap({});
        setReasonsMap({});
        setErrorMsg(null);
      } else {
        setErrorMsg(data.error || 'Error al guardar conteo');
      }
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Error de red al guardar conteo');
    }
  });

  const getTheoreticalStock = (s: any) => {
    if (selectedLocation === 'loc_los_olivos') {
      return s.stockByLocation?.loc_los_olivos || 0;
    }
    return s.stockByLocation?.loc_alta_vista || 0;
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Conteo Físico y Conciliación de Stock" maxWidth="lg">
      <div className="space-y-4">
        {errorMsg && (
          <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold">
            {errorMsg}
          </div>
        )}

        <div className="flex justify-between items-center bg-surface-alt p-3 rounded-xl border border-border">
          <div>
            <span className="text-xs font-bold text-ink block">Sede para Conciliación:</span>
            <span className="text-[11px] text-ink-muted">
              Compara el conteo físico en anaquel contra el stock teórico del sistema.
            </span>
          </div>
          <select
            value={selectedLocation}
            onChange={(e) => {
              setSelectedLocation(e.target.value);
              setCountsMap({});
            }}
            className="h-10 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold"
          >
            <option value="loc_alta_vista">Sede B: Alta Vista</option>
            <option value="loc_los_olivos">Sede A: Los Olivos</option>
          </select>
        </div>

        {/* Tabla de Conteo */}
        <div className="max-h-[50vh] overflow-y-auto space-y-2 pr-1">
          {supplies.map((s) => {
            const theoretical = getTheoreticalStock(s);
            const inputVal = countsMap[s.id] ?? '';
            const physical = inputVal === '' ? null : parseFloat(inputVal);
            const difference = physical !== null && !isNaN(physical) ? physical - theoretical : null;

            return (
              <div
                key={s.id}
                className="p-3 rounded-xl bg-surface border border-border space-y-2 text-xs"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <h5 className="font-bold text-ink">{s.name}</h5>
                    <span className="text-[10px] text-ink-muted uppercase">
                      Teórico: <strong>{theoretical} {s.usageUnit}</strong>
                    </span>
                  </div>

                  <div className="w-32">
                    <Input
                      type="number"
                      step="any"
                      placeholder={`Físico (${s.usageUnit})`}
                      value={inputVal}
                      onChange={(e) =>
                        setCountsMap((prev) => ({ ...prev, [s.id]: e.target.value }))
                      }
                    />
                  </div>
                </div>

                {difference !== null && difference !== 0 && (
                  <div className="flex items-center justify-between gap-2 bg-surface-alt p-2 rounded-lg border border-border">
                    <div className="flex items-center gap-1.5">
                      <Badge variant={difference < 0 ? 'danger' : 'neutral'}>
                        {difference < 0 ? `Faltante: ${difference}` : `Sobrante: +${difference}`} {s.usageUnit}
                      </Badge>
                    </div>

                    <div className="flex-1">
                      <input
                        type="text"
                        placeholder="Motivo del descuadre (ej: merma no registrada)"
                        value={reasonsMap[s.id] || ''}
                        onChange={(e) =>
                          setReasonsMap((prev) => ({ ...prev, [s.id]: e.target.value }))
                        }
                        className="w-full h-8 px-2 rounded-lg bg-surface border border-border text-xs text-ink placeholder:text-ink-muted"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 pt-2 border-t border-border">
          <Button variant="ghost" className="flex-1" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            type="button"
            loading={countMutation.isPending}
            onClick={() => countMutation.mutate()}
          >
            Aplicar Ajuste de Stock
          </Button>
        </div>
      </div>
    </Modal>
  );
};
