import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input, Field, Icon } from '../../../ui/index.js';

interface ProductionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProductionModal: React.FC<ProductionModalProps> = ({
  isOpen,
  onClose
}) => {
  const queryClient = useQueryClient();
  const [targetType, setTargetType] = useState<'SUB_RECIPE' | 'PRODUCT'>('SUB_RECIPE');
  const [targetId, setTargetId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [locationId, setLocationId] = useState('loc_los_olivos');
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sub-recetas disponibles
  const { data: subData } = useQuery<{ success: boolean; subRecipes: any[] }>({
    queryKey: ['fase3SubRecipes'],
    queryFn: async () => {
      const res = await fetch('/api/fase3/sub-recipes');
      return res.json();
    },
    enabled: isOpen && targetType === 'SUB_RECIPE'
  });

  // Productos disponibles
  const { data: menuData } = useQuery<{ products: any[] }>({
    queryKey: ['fase4MenuProducts'],
    queryFn: async () => {
      const res = await fetch('/api/menu/pos');
      const json = await res.json();
      return { products: json.products || [] };
    },
    enabled: isOpen && targetType === 'PRODUCT'
  });

  const subRecipes = subData?.subRecipes || [];
  const products = menuData?.products || [];

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const qtyNum = parseFloat(quantity);
    if (!targetId || isNaN(qtyNum) || qtyNum <= 0) {
      setErrorMsg('Debe seleccionar la preparación e indicar una cantidad válida mayor a cero');
      return;
    }

    try {
      const res = await fetch('/api/fase4/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          targetType,
          targetId,
          quantityProduced: qtyNum,
          notes
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al asentar la producción');
      }

      setSuccessMsg(`Producción de ${qtyNum} unidades registrada exitosamente en ${locationId === 'loc_los_olivos' ? 'Sede A (Los Olivos)' : 'Sede B (Alta Vista)'}. Materias primas descontadas.`);
      setQuantity('');
      setNotes('');
      queryClient.invalidateQueries({ queryKey: ['fase3Supplies'] });
      queryClient.invalidateQueries({ queryKey: ['fase4OwnerDashboard'] });
    } catch (err: any) {
      setErrorMsg(err.message || 'Error de red al registrar producción');
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Registro de Producción (Taller / Sede A)" maxWidth="md">
      <form onSubmit={handleRegister} className="space-y-4">
        {errorMsg && (
          <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold">
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="p-3 rounded-xl bg-success/10 border border-success/30 text-success text-xs font-bold">
            {successMsg}
          </div>
        )}

        <div className="flex gap-2 p-1 rounded-xl bg-surface-alt border border-border">
          <button
            type="button"
            onClick={() => {
              setTargetType('SUB_RECIPE');
              setTargetId('');
            }}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              targetType === 'SUB_RECIPE'
                ? 'bg-primary text-primary-contrast shadow-sm'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            Sub-receta / Salsa / Preparado
          </button>
          <button
            type="button"
            onClick={() => {
              setTargetType('PRODUCT');
              setTargetId('');
            }}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              targetType === 'PRODUCT'
                ? 'bg-primary text-primary-contrast shadow-sm'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            Plato Terminado / Pre-cocido
          </button>
        </div>

        <Field label="Sede de Producción" required>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
          >
            <option value="loc_los_olivos">Sede A: Los Olivos (Taller Central de Producción)</option>
            <option value="loc_alta_vista">Sede B: Alta Vista (Food Truck)</option>
          </select>
        </Field>

        <Field label={targetType === 'SUB_RECIPE' ? 'Sub-receta a Elaborar' : 'Plato a Elaborar'} required>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-ink text-xs font-bold focus:border-primary"
            required
          >
            <option value="">-- Seleccionar --</option>
            {targetType === 'SUB_RECIPE'
              ? subRecipes.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} (Rinde: {s.yieldQuantity} {s.yieldUnit})
                  </option>
                ))
              : products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
          </select>
        </Field>

        <Field label="Cantidad a Producir" required>
          <Input
            type="number"
            step="any"
            min="0.1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="Ej: 5 (litros / porciones / unidades)"
            required
          />
        </Field>

        <Field label="Notas o Lote de Cocina">
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: Preparación de salsa tártara para abastecer semana"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" size="md" onClick={onClose}>
            Cerrar
          </Button>
          <Button variant="primary" size="md" type="submit">
            <Icon name="CheckCircle" size={16} />
            <span>Asentar Producción</span>
          </Button>
        </div>
      </form>
    </Modal>
  );
};
