import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input, Field } from '../../../ui/index.js';

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
  const [fromLoc, setFromLoc] = useState('loc_alta_vista');
  const [toLoc, setToLoc] = useState('loc_los_olivos');
  const [supplyId, setSupplyId] = useState('');
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const transferMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/fase3/inventory/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromLocationId: fromLoc,
          toLocationId: toLoc,
          supplyId,
          quantity: parseFloat(qty),
          notes
        })
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['fase3Supplies'] });
        onClose();
        setQty('');
        setNotes('');
        setErrorMsg(null);
      } else {
        setErrorMsg(data.error || 'Error al transferir insumos');
      }
    },
    onError: () => {
      setErrorMsg('Error de red al registrar la transferencia');
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!supplyId) {
      setErrorMsg('Selecciona un insumo');
      return;
    }
    if (fromLoc === toLoc) {
      setErrorMsg('La sede origen y destino deben ser distintas');
      return;
    }
    const parsedQty = parseFloat(qty);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      setErrorMsg('Ingresa una cantidad válida mayor a cero');
      return;
    }
    transferMutation.mutate();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Transferir Insumos entre Sedes">
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Sede Origen" required>
            <select
              value={fromLoc}
              onChange={(e) => setFromLoc(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
            >
              <option value="loc_alta_vista">Sede B: Alta Vista</option>
              <option value="loc_los_olivos">Sede A: Los Olivos</option>
            </select>
          </Field>

          <Field label="Sede Destino" required>
            <select
              value={toLoc}
              onChange={(e) => setToLoc(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
            >
              <option value="loc_los_olivos">Sede A: Los Olivos</option>
              <option value="loc_alta_vista">Sede B: Alta Vista</option>
            </select>
          </Field>
        </div>

        <Field label="Insumo a Transferir" required>
          <select
            value={supplyId}
            onChange={(e) => setSupplyId(e.target.value)}
            className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
          >
            <option value="">-- Selecciona un Insumo --</option>
            {supplies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.usageUnit})
              </option>
            ))}
          </select>
        </Field>

        <Field label="Cantidad a Transferir (en unidad de uso)" required>
          <Input
            type="number"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="Ej: 50"
            required
          />
        </Field>

        <Field label="Notas o Guía de Traslado">
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: Traslado para surtir turno noche"
          />
        </Field>

        <div className="flex gap-2 pt-2">
          <Button variant="ghost" className="flex-1" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            type="submit"
            loading={transferMutation.isPending}
          >
            Confirmar Traslado
          </Button>
        </div>
      </form>
    </Modal>
  );
};
