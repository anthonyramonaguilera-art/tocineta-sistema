import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input, Field, Icon } from '../../../ui/index.js';

export interface BatchItem {
  id: string;
  name: string;
  description?: string;
  fromLocationId?: string;
  toLocationId?: string;
  items: Array<{ supplyId: string; quantity: number }>;
}

interface TransferBatchesModalProps {
  isOpen: boolean;
  onClose: () => void;
  supplies: Array<{ id: string; name: string; usageUnit: string }>;
  onSelectBatch: (batch: BatchItem) => void;
}

export const TransferBatchesModal: React.FC<TransferBatchesModalProps> = ({
  isOpen,
  onClose,
  supplies,
  onSelectBatch
}) => {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [batchItems, setBatchItems] = useState<Array<{ supplyId: string; quantity: number }>>([
    { supplyId: supplies[0]?.id || 'sup_pan_brioche', quantity: 50 }
  ]);

  const { data: batchesData, isLoading } = useQuery<{ success: boolean; batches: BatchItem[] }>({
    queryKey: ['fase4TransferBatches'],
    queryFn: async () => {
      const res = await fetch('/api/fase4/transfer-batches');
      return res.json();
    },
    enabled: isOpen
  });

  const batches = batchesData?.batches || [];

  const handleAddItem = () => {
    setBatchItems(prev => [...prev, { supplyId: supplies[0]?.id || 'sup_pan_brioche', quantity: 10 }]);
  };

  const handleItemChange = (index: number, field: 'supplyId' | 'quantity', val: any) => {
    setBatchItems(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: field === 'quantity' ? Math.max(1, parseFloat(val) || 0) : val };
      return copy;
    });
  };

  const handleRemoveItem = (index: number) => {
    setBatchItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || batchItems.length === 0) return;

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      items: batchItems
    };

    const url = editingBatchId
      ? `/api/fase4/transfer-batches/${editingBatchId}`
      : '/api/fase4/transfer-batches';
    const method = editingBatchId ? 'PATCH' : 'POST';

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    queryClient.invalidateQueries({ queryKey: ['fase4TransferBatches'] });
    setIsCreating(false);
    setEditingBatchId(null);
    setName('');
    setDescription('');
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/fase4/transfer-batches/${id}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: ['fase4TransferBatches'] });
  };

  const startEdit = (batch: BatchItem) => {
    setEditingBatchId(batch.id);
    setName(batch.name);
    setDescription(batch.description || '');
    setBatchItems(batch.items || []);
    setIsCreating(true);
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Lotes Preconfigurados de Despacho" maxWidth="lg">
      <div className="space-y-4">
        {!isCreating ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink-muted">
                Selecciona un lote guardado para cargar el envío en 1 toque:
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setEditingBatchId(null);
                  setName('');
                  setDescription('');
                  setBatchItems([{ supplyId: supplies[0]?.id || 'sup_pan_brioche', quantity: 50 }]);
                  setIsCreating(true);
                }}
              >
                + Nuevo Lote
              </Button>
            </div>

            {isLoading ? (
              <div className="p-8 text-center text-xs text-ink-muted">Cargando lotes...</div>
            ) : batches.length === 0 ? (
              <div className="p-6 text-center bg-surface-alt rounded-2xl border border-border text-xs text-ink-muted">
                No hay lotes preconfigurados creados aún.
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {batches.map(batch => (
                  <div
                    key={batch.id}
                    className="p-4 rounded-2xl bg-surface border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
                  >
                    <div>
                      <h4 className="font-black text-sm text-ink">{batch.name}</h4>
                      {batch.description && (
                        <p className="text-xs text-ink-muted mt-0.5">{batch.description}</p>
                      )}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {batch.items.map(it => {
                          const s = supplies.find(sup => sup.id === it.supplyId);
                          return (
                            <span
                              key={it.supplyId}
                              className="px-2 py-0.5 rounded-lg bg-surface-alt text-[10px] font-bold text-ink border border-border"
                            >
                              {it.quantity} {s?.usageUnit || 'und'} {s?.name || it.supplyId}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => {
                          onSelectBatch(batch);
                          onClose();
                        }}
                      >
                        Usar en 1 Toque
                      </Button>
                      <button
                        type="button"
                        onClick={() => startEdit(batch)}
                        className="p-2 rounded-xl border border-border text-xs font-bold text-ink hover:bg-surface-alt"
                        title="Editar"
                      >
                        <Icon name="Edit3" size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(batch.id)}
                        className="p-2 rounded-xl border border-border text-xs font-bold text-danger hover:bg-danger/10"
                        title="Eliminar"
                      >
                        <Icon name="Trash2" size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            <h4 className="text-xs font-black text-ink uppercase tracking-wider">
              {editingBatchId ? 'Editar Lote Preconfigurado' : 'Crear Nuevo Lote Preconfigurado'}
            </h4>
            <Field label="Nombre del Lote" required>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ej: Lote Reposición Fin de Semana"
                required
              />
            </Field>
            <Field label="Descripción">
              <Input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Ej: Panes, carnes y salchichas para turno nocturno"
              />
            </Field>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-ink uppercase tracking-wider">Insumos del Lote:</span>
                <Button variant="ghost" size="sm" onClick={handleAddItem}>
                  + Agregar Insumo
                </Button>
              </div>

              {batchItems.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="flex-1">
                    <select
                      value={item.supplyId}
                      onChange={e => handleItemChange(idx, 'supplyId', e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold"
                    >
                      {supplies.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.usageUnit})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-24">
                    <Input
                      type="number"
                      step="any"
                      min="1"
                      value={item.quantity}
                      onChange={e => handleItemChange(idx, 'quantity', e.target.value)}
                      placeholder="Cant."
                    />
                  </div>
                  {batchItems.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(idx)}
                      className="w-8 h-8 rounded-lg text-danger hover:bg-danger/10 flex items-center justify-center font-bold"
                    >
                      <Icon name="X" size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  setIsCreating(false);
                  setEditingBatchId(null);
                }}
              >
                Cancelar
              </Button>
              <Button variant="primary" size="md" type="submit">
                {editingBatchId ? 'Guardar Cambios' : 'Crear Lote'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
