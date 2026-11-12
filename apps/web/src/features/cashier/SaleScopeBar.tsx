import React from 'react';
import { Button, Input } from '../../ui/index.js';
import { formatSaleDateTime, formatAgeHours } from './sale-format.js';

export type SalesScope = 'jornada' | 'turn' | 'date';

interface SaleScopeBarProps {
  scope: SalesScope;
  onScopeChange: (s: SalesScope) => void;
  date: string;
  onDateChange: (d: string) => void;
  jornada: { openedAtMs: number; ageMs: number } | null;
}

export const SaleScopeBar: React.FC<SaleScopeBarProps> = ({ scope, onScopeChange, date, onDateChange, jornada }) => {
  const horas = jornada ? formatAgeHours(jornada.ageMs) : 0;
  return (
    <div className="space-y-2 mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={scope === 'jornada' ? 'primary' : 'secondary'} onClick={() => onScopeChange('jornada')}>Esta jornada</Button>
        <Button variant={scope === 'turn' ? 'primary' : 'secondary'} onClick={() => onScopeChange('turn')}>Mi turno</Button>
        <Button variant={scope === 'date' ? 'primary' : 'secondary'} onClick={() => onScopeChange('date')}>Por fecha</Button>
        {scope === 'date' && (
          <div className="w-44">
            <Input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
          </div>
        )}
      </div>
      {scope === 'jornada' && jornada && (
        <p className="text-xs text-ink-muted">Jornada abierta desde {formatSaleDateTime(jornada.openedAtMs)}</p>
      )}
      {jornada && horas >= 16 && (
        <div className="bg-warning/10 border border-warning/30 text-warning rounded-xl p-3 text-xs font-bold">
          Esta jornada lleva {horas} horas abierta. Si el dia ya termino, ve a "Cierre de caja" y ejecuta el Cierre Z para empezar limpio.
        </div>
      )}
    </div>
  );
};
