import React, { useState } from 'react';
import { Button } from '../../ui/Button.js';
import { Input } from '../../ui/Input.js';
import { Card } from '../../ui/Card.js';
import { Badge } from '../../ui/Badge.js';
import { Icon } from '../../ui/Icon.js';
import type { StaffUser, TipPool } from './types.js';

interface TipPoolSectionProps {
  tipPool?: TipPool;
  staffList: StaffUser[];
  onAddTip: (usdCents: number, bsCents: number) => Promise<void>;
  onClosePool: (splitMode: 'EQUAL' | 'HOURS', participants: { userId: string; hoursWorked?: number }[]) => Promise<void>;
  onRefresh: () => void;
}

export const TipPoolSection: React.FC<TipPoolSectionProps> = ({
  tipPool,
  staffList,
  onAddTip,
  onClosePool,
  onRefresh
}) => {
  const waitstaff = staffList.filter((s) => s.role === 'mesonero' && s.isActive !== false);

  const [addUsd, setAddUsd] = useState('');
  const [addBs, setAddBs] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const [splitMode, setSplitMode] = useState<'EQUAL' | 'HOURS'>('EQUAL');
  const [selectedWaiters, setSelectedWaiters] = useState<string[]>([]);
  const [hoursMap, setHoursMap] = useState<Record<string, string>>({});
  const [isClosing, setIsClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const toggleWaiter = (id: string) => {
    if (selectedWaiters.includes(id)) {
      setSelectedWaiters(selectedWaiters.filter((w) => w !== id));
    } else {
      setSelectedWaiters([...selectedWaiters, id]);
      if (!hoursMap[id]) {
        setHoursMap((prev) => ({ ...prev, [id]: '6.0' }));
      }
    }
  };

  const handleAddTip = async (e: React.FormEvent) => {
    e.preventDefault();
    const usdCents = Math.round((parseFloat(addUsd) || 0) * 100);
    const bsCents = Math.round((parseFloat(addBs) || 0) * 100);
    if (usdCents <= 0 && bsCents <= 0) return;

    try {
      setIsAdding(true);
      await onAddTip(usdCents, bsCents);
      setAddUsd('');
      setAddBs('');
      onRefresh();
    } finally {
      setIsAdding(false);
    }
  };

  const handleClose = async () => {
    setError(null);
    if (selectedWaiters.length === 0) {
      setError('Debes seleccionar al menos un mesero del turno');
      return;
    }

    const participants = selectedWaiters.map((id) => ({
      userId: id,
      hoursWorked: splitMode === 'HOURS' ? parseFloat(hoursMap[id]) || 1.0 : 1.0
    }));

    try {
      setIsClosing(true);
      await onClosePool(splitMode, participants);
      setSuccess('¡Pool cerrado y distribuido exitosamente!');
      setSelectedWaiters([]);
      onRefresh();
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Error al cerrar pool');
    } finally {
      setIsClosing(false);
    }
  };

  // Cálculo en vivo del reparto
  const totalUsdCents = tipPool?.totalCollectedUsdCents || 0;
  const totalBsCents = tipPool?.totalCollectedBsCents || 0;

  let totalWeight = 0;
  selectedWaiters.forEach((id) => {
    const w = splitMode === 'HOURS' ? parseFloat(hoursMap[id]) || 1.0 : 1.0;
    totalWeight += w;
  });
  if (totalWeight <= 0) totalWeight = 1;

  return (
    <div className="space-y-6">
      {/* Tarjeta de Saldo del Pool */}
      <Card className="p-5 border-primary/20 bg-primary/5">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-ink-muted uppercase">Pool de Propinas del Turno</span>
              <Badge variant={tipPool?.status === 'OPEN' ? 'success' : 'neutral'}>
                {tipPool?.status === 'OPEN' ? 'ABIERTO' : 'CERRADO'}
              </Badge>
            </div>
            <div className="flex items-baseline gap-3 mt-1">
              <span className="text-3xl font-black text-ink">${(totalUsdCents / 100).toFixed(2)} USD</span>
              <span className="text-lg font-bold text-ink-muted">/ Bs. {(totalBsCents / 100).toFixed(2)}</span>
            </div>
          </div>

          {/* Formulario rápido para agregar propina al pool */}
          <form onSubmit={handleAddTip} className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="$ USD"
              value={addUsd}
              onChange={(e) => setAddUsd(e.target.value)}
              className="w-24 text-sm"
            />
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="Bs."
              value={addBs}
              onChange={(e) => setAddBs(e.target.value)}
              className="w-28 text-sm"
            />
            <Button type="submit" variant="primary" size="sm" loading={isAdding}>
              + Sumar
            </Button>
          </form>
        </div>
      </Card>

      {/* Cierre y Reparto entre Meseros */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-3 border-b border-border">
          <div>
            <h3 className="font-black text-base text-ink">Cierre y Reparto del Turno</h3>
            <p className="text-xs text-ink-muted">Configura el método de reparto entre los meseros presentes</p>
          </div>

          <div className="flex rounded-xl bg-surface-alt p-1 border border-border">
            <button
              type="button"
              onClick={() => setSplitMode('EQUAL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                splitMode === 'EQUAL' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              Reparto Igual
            </button>
            <button
              type="button"
              onClick={() => setSplitMode('HOURS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                splitMode === 'HOURS' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              Por Horas Trabajadas
            </button>
          </div>
        </div>

        {error && <div className="p-3 bg-danger/10 text-danger text-xs font-bold rounded-xl">{error}</div>}
        {success && <div className="p-3 bg-success/10 text-success text-xs font-bold rounded-xl">{success}</div>}

        {/* Lista de Meseros para Seleccionar */}
        <div className="space-y-2">
          <p className="text-xs font-bold text-ink-muted uppercase">Selecciona los meseros del turno:</p>

          {waitstaff.length === 0 ? (
            <p className="text-xs text-ink-muted italic">No hay meseros activos registrados.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {waitstaff.map((w) => {
                const isSelected = selectedWaiters.includes(w.id);
                const weight = splitMode === 'HOURS' ? parseFloat(hoursMap[w.id] || '1.0') || 1.0 : 1.0;
                const shareFraction = isSelected ? weight / totalWeight : 0;
                const estUsd = Math.round(totalUsdCents * shareFraction);

                return (
                  <div
                    key={w.id}
                    className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                      isSelected ? 'bg-primary/5 border-primary text-ink' : 'bg-surface border-border text-ink-muted'
                    }`}
                  >
                    <div
                      onClick={() => toggleWaiter(w.id)}
                      className="flex items-center gap-2 cursor-pointer select-none flex-1"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="w-4 h-4 accent-primary cursor-pointer"
                      />
                      <div>
                        <p className="text-sm font-bold text-ink">{w.name}</p>
                        <p className="text-xs text-ink-muted">@{w.username || 'mesero'}</p>
                      </div>
                    </div>

                    {isSelected && (
                      <div className="flex items-center gap-2">
                        {splitMode === 'HOURS' && (
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              step="0.5"
                              min="0.5"
                              value={hoursMap[w.id] || '6.0'}
                              onChange={(e) => setHoursMap({ ...hoursMap, [w.id]: e.target.value })}
                              className="w-16 text-xs text-center p-1"
                            />
                            <span className="text-[10px] text-ink-muted">hrs</span>
                          </div>
                        )}
                        <Badge variant="primary" className="font-bold text-xs">
                          ${(estUsd / 100).toFixed(2)}
                        </Badge>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-3 border-t border-border">
          <Button
            variant="primary"
            onClick={handleClose}
            loading={isClosing}
            disabled={selectedWaiters.length === 0 || totalUsdCents <= 0}
            leftIcon={<Icon name="CheckCheck" size={18} />}
          >
            Cerrar Pool y Repartir (${(totalUsdCents / 100).toFixed(2)})
          </Button>
        </div>
      </Card>
    </div>
  );
};
