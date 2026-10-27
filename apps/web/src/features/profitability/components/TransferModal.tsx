import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input, Field, Icon } from '../../../ui/index.js';
import { TransferDishEquivalentMode } from './TransferDishEquivalentMode.js';
import { TransferBatchesModal, type BatchItem } from './TransferBatchesModal.js';
import { DispatchNoteSuccessModal, type DispatchNoteInfo } from './DispatchNoteSuccessModal.js';
import { TransferInTransitTab } from './TransferInTransitTab.js';
import { TransferLooseItemsSection } from './TransferLooseItemsSection.js';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  supplies: Array<{ id: string; name: string; usageUnit: string }>;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  onClose,
  supplies
}) => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'create' | 'in_transit'>('create');
  const [mode, setMode] = useState<'DISH_EQUIVALENT' | 'LOOSE_SUPPLIES' | 'BATCH'>('LOOSE_SUPPLIES');
  const [fromLoc, setFromLoc] = useState('loc_los_olivos');
  const [toLoc, setToLoc] = useState('loc_alta_vista');
  const [items, setItems] = useState<Array<{ supplyId: string; name: string; unit: string; quantity: number }>>([]);
  const [dishEquivalents, setDishEquivalents] = useState<Array<{ productId: string; quantity: number }> | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [requireTransit, setRequireTransit] = useState(false);

  // Forzar con PIN
  const [forceWithPin, setForceWithPin] = useState(false);
  const [forceReason, setForceReason] = useState('');
  const [supervisorPin, setSupervisorPin] = useState('');

  // Modales auxiliares
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [createdNote, setCreatedNote] = useState<DispatchNoteInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Consultar envíos en tránsito
  const { data: inTransitData, refetch: refetchInTransit } = useQuery<{
    success: boolean;
    transfers: any[];
  }>({
    queryKey: ['fase4InTransitTransfers'],
    queryFn: async () => {
      const res = await fetch('/api/fase4/transfers?status=EN_TRANSITO');
      return res.json();
    },
    enabled: isOpen && activeTab === 'in_transit'
  });

  const inTransitList = inTransitData?.transfers || [];

  const handleApplyDishSupplies = (
    calcSupplies: Array<{ supplyId: string; name: string; unit: string; quantity: number }>,
    dishes: Array<{ productId: string; quantity: number }>
  ) => {
    setItems(calcSupplies);
    setDishEquivalents(dishes);
    setMode('DISH_EQUIVALENT');
  };

  const handleApplyBatch = (batch: BatchItem) => {
    const mapped = batch.items.map(it => {
      const s = supplies.find(sup => sup.id === it.supplyId);
      return {
        supplyId: it.supplyId,
        name: s?.name || it.supplyId,
        unit: s?.usageUnit || 'und',
        quantity: it.quantity
      };
    });
    setItems(mapped);
    setBatchId(batch.id);
    setMode('BATCH');
    if (batch.fromLocationId) setFromLoc(batch.fromLocationId);
    if (batch.toLocationId) setToLoc(batch.toLocationId);
  };

  const handleConfirmTransfer = async () => {
    setErrorMsg(null);
    if (items.length === 0) {
      setErrorMsg('Debe agregar al menos un insumo al despacho');
      return;
    }
    if (fromLoc === toLoc) {
      setErrorMsg('La sede origen y destino deben ser diferentes');
      return;
    }

    try {
      const res = await fetch('/api/fase4/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromLocationId: fromLoc,
          toLocationId: toLoc,
          mode,
          items: items.map(i => ({ supplyId: i.supplyId, quantity: i.quantity })),
          dishEquivalents,
          batchId,
          notes,
          requireTransit,
          forceWithPin,
          forceReason,
          supervisorPin
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.insufficientItems) {
          setErrorMsg(data.error);
          setForceWithPin(true);
          return;
        }
        throw new Error(data.error || 'Error al crear la transferencia');
      }

      queryClient.invalidateQueries({ queryKey: ['fase3Supplies'] });
      queryClient.invalidateQueries({ queryKey: ['fase4OwnerDashboard'] });
      setCreatedNote(data.transfer);
      setItems([]);
      setDishEquivalents(null);
      setNotes('');
      setForceWithPin(false);
      setForceReason('');
      setSupervisorPin('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Error de red');
    }
  };

  const handleReceiveInTransit = async (transferId: string) => {
    try {
      const res = await fetch(`/api/fase4/transfers/${transferId}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        refetchInTransit();
        queryClient.invalidateQueries({ queryKey: ['fase3Supplies'] });
        queryClient.invalidateQueries({ queryKey: ['fase4OwnerDashboard'] });
      }
    } catch {}
  };

  if (!isOpen) return null;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Asistente de Envíos entre Sedes" maxWidth="xl">
        <div className="space-y-4">
          {/* Selector de Pestañas: Crear Despacho vs Envíos en Tránsito */}
          <div className="flex border-b border-border pb-2 gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className={`min-h-[40px] px-4 text-xs font-bold rounded-xl transition-all ${
                activeTab === 'create'
                  ? 'bg-primary text-primary-contrast shadow-sm'
                  : 'bg-surface-alt text-ink-muted hover:text-ink'
              }`}
            >
              Nuevo Despacho
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('in_transit')}
              className={`min-h-[40px] px-4 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === 'in_transit'
                  ? 'bg-primary text-primary-contrast shadow-sm'
                  : 'bg-surface-alt text-ink-muted hover:text-ink'
              }`}
            >
              <Icon name="Truck" size={14} />
              <span>Envíos en Tránsito ({inTransitList.length})</span>
            </button>
          </div>

          {activeTab === 'create' ? (
            <div className="space-y-4">
              {errorMsg && (
                <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold">
                  {errorMsg}
                </div>
              )}

              {/* Origen y Destino */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Sede Origen (Descuenta Stock)" required>
                  <select
                    value={fromLoc}
                    onChange={(e) => setFromLoc(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
                  >
                    <option value="loc_los_olivos">Sede A: Los Olivos (Taller)</option>
                    <option value="loc_alta_vista">Sede B: Alta Vista (Food Truck)</option>
                  </select>
                </Field>
                <Field label="Sede Destino (Suma Stock)" required>
                  <select
                    value={toLoc}
                    onChange={(e) => setToLoc(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
                  >
                    <option value="loc_alta_vista">Sede B: Alta Vista (Food Truck)</option>
                    <option value="loc_los_olivos">Sede A: Los Olivos (Taller)</option>
                  </select>
                </Field>
              </div>

              {/* 3 Modos de Envío */}
              <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
                <button
                  type="button"
                  onClick={() => setMode('LOOSE_SUPPLIES')}
                  className={`min-h-[38px] px-3 rounded-xl text-xs font-bold border transition-all ${
                    mode === 'LOOSE_SUPPLIES'
                      ? 'bg-ink text-surface border-ink'
                      : 'bg-surface border-border text-ink hover:bg-surface-alt'
                  }`}
                >
                  (1) Insumos Sueltos
                </button>
                <button
                  type="button"
                  onClick={() => setMode('DISH_EQUIVALENT')}
                  className={`min-h-[38px] px-3 rounded-xl text-xs font-bold border transition-all ${
                    mode === 'DISH_EQUIVALENT'
                      ? 'bg-ink text-surface border-ink'
                      : 'bg-surface border-border text-ink hover:bg-surface-alt'
                  }`}
                >
                  (2) Por Platos (Hamburguesas + Perros)
                </button>
                <button
                  type="button"
                  onClick={() => setIsBatchModalOpen(true)}
                  className="min-h-[38px] px-3 rounded-xl text-xs font-bold border border-primary bg-primary/10 text-primary hover:bg-primary/20 transition-all flex items-center gap-1.5"
                >
                  <Icon name="Layers" size={14} />
                  <span>(3) Lotes Preconfigurados</span>
                </button>
              </div>

              {/* Modo: Por Platos */}
              {mode === 'DISH_EQUIVALENT' && (
                <TransferDishEquivalentMode
                  fromLocationId={fromLoc}
                  onApplySupplies={handleApplyDishSupplies}
                />
              )}

              {/* Insumos Sueltos y Lista de Insumos */}
              <TransferLooseItemsSection
                supplies={supplies}
                items={items}
                onAddItem={(newItem) => {
                  setItems(prev => {
                    const idx = prev.findIndex(i => i.supplyId === newItem.supplyId);
                    if (idx >= 0) {
                      const copy = [...prev];
                      copy[idx].quantity += newItem.quantity;
                      return copy;
                    }
                    return [...prev, newItem];
                  });
                }}
                onRemoveItem={(idx) => setItems(prev => prev.filter((_, i) => i !== idx))}
                onClearAll={() => setItems([])}
              />

              {/* Opciones Adicionales */}
              <div className="space-y-3 pt-2 border-t border-border">
                <Field label="Observaciones o Guía de Traslado">
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Ej: Traslado para surtir turno de fin de semana"
                  />
                </Field>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="chk_transit"
                    checked={requireTransit}
                    onChange={(e) => setRequireTransit(e.target.checked)}
                    className="w-4 h-4 rounded text-primary border-border"
                  />
                  <label htmlFor="chk_transit" className="text-xs font-bold text-ink cursor-pointer select-none">
                    Envío en tránsito (requiere confirmación de recepción en sede destino)
                  </label>
                </div>

                {/* Forzar con PIN de Supervisor */}
                {forceWithPin && (
                  <div className="p-4 rounded-2xl bg-warning/10 border border-warning/40 space-y-3">
                    <div className="flex items-center gap-2 text-warning text-xs font-black uppercase tracking-wider">
                      <Icon name="AlertTriangle" size={16} />
                      <span>Autorización de Despacho con Stock Insuficiente</span>
                    </div>
                    <Field label="Motivo Obligatorio para Forzar" required>
                      <Input
                        value={forceReason}
                        onChange={(e) => setForceReason(e.target.value)}
                        placeholder="Ej: Insumos recién recibidos de proveedor aún sin asentar en compra"
                      />
                    </Field>
                    <Field label="PIN de Supervisor / Admin" required>
                      <Input
                        type="password"
                        maxLength={6}
                        value={supervisorPin}
                        onChange={(e) => setSupervisorPin(e.target.value)}
                        placeholder="PIN Autorizador"
                      />
                    </Field>
                  </div>
                )}
              </div>

              {/* Botón Confirmar */}
              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <Button variant="ghost" size="md" onClick={onClose}>
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  disabled={items.length === 0}
                  onClick={handleConfirmTransfer}
                >
                  <Icon name="CheckCircle" size={16} />
                  <span>Confirmar y Crear Nota de Despacho</span>
                </Button>
              </div>
            </div>
          ) : (
            /* Pestaña: Envíos en Tránsito */
            <TransferInTransitTab
              inTransitList={inTransitList}
              onReceive={handleReceiveInTransit}
            />
          )}
        </div>
      </Modal>

      {/* Modal de Lotes Preconfigurados */}
      <TransferBatchesModal
        isOpen={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        supplies={supplies}
        onSelectBatch={handleApplyBatch}
      />

      {/* Modal de Éxito con Nota de Despacho */}
      <DispatchNoteSuccessModal
        isOpen={Boolean(createdNote)}
        onClose={() => setCreatedNote(null)}
        note={createdNote}
      />
    </>
  );
};
