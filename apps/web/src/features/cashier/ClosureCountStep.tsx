import React from 'react';
import { Field, Input, Badge, Icon } from '../../ui/index.js';

export interface ClosureMethodItem {
  method: string;
  label: string;
  currency: 'USD' | 'BS';
}

export const CLOSURE_METHODS: ClosureMethodItem[] = [
  { method: 'EFECTIVO_USD', label: 'Efectivo USD', currency: 'USD' },
  { method: 'EFECTIVO_BS', label: 'Efectivo Bs', currency: 'BS' },
  { method: 'PAGO_MOVIL', label: 'Pago Móvil', currency: 'BS' },
  { method: 'PUNTO_DE_VENTA', label: 'Punto de Venta', currency: 'BS' },
  { method: 'UBII', label: 'Punto Ubii', currency: 'BS' },
  { method: 'TRANSFERENCIA', label: 'Transferencia', currency: 'BS' },
  { method: 'ZELLE', label: 'Zelle', currency: 'USD' },
  { method: 'BINANCE', label: 'Binance Pay', currency: 'USD' },
  { method: 'OTROS', label: 'Otros Métodos', currency: 'USD' }
];

export interface ClosureCountStepProps {
  methodValues: Record<string, string>;
  onMethodChange: (method: string, value: string) => void;
  confirmEmpty: boolean;
  onConfirmEmptyChange: (confirmed: boolean) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  closingPin: string;
  onClosingPinChange: (pin: string) => void;
  recountMessage?: string | null;
  errorMessage?: string | null;
}

export const ClosureCountStep: React.FC<ClosureCountStepProps> = ({
  methodValues,
  onMethodChange,
  confirmEmpty,
  onConfirmEmptyChange,
  notes,
  onNotesChange,
  closingPin,
  onClosingPinChange,
  recountMessage,
  errorMessage
}) => {
  return (
    <div className="space-y-4">
      {errorMessage && (
        <div
          role="alert"
          className="p-3 bg-danger-subtle text-danger border border-danger/30 rounded-lg text-sm flex items-center gap-2"
        >
          <Icon name="AlertTriangle" className="w-5 h-5 shrink-0 text-danger" />
          <span>{errorMessage}</span>
        </div>
      )}

      {recountMessage && (
        <div
          role="alert"
          className="p-3 bg-warning-subtle text-warning border border-warning/30 rounded-lg text-sm flex items-center gap-2"
        >
          <Icon name="AlertTriangle" className="w-5 h-5 shrink-0 text-warning" />
          <div className="space-y-0.5">
            <span className="font-black block uppercase text-xs">Segunda Verificación Requerida (Regla Anti-Tanteo)</span>
            <span>{recountMessage}</span>
          </div>
        </div>
      )}

      <div className="p-3 bg-surface-alt rounded-xl border border-border text-xs text-ink-muted flex items-center gap-2">
        <Icon name="Lock" className="w-4 h-4 text-warning shrink-0" />
        <span>
          <strong>Arqueo Ciego D12:</strong> Registra el monto total físico de cada método. Las cifras esperadas no se muestran hasta completar el cierre.
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CLOSURE_METHODS.map((m) => (
          <div
            key={m.method}
            className="p-3 bg-surface-alt rounded-xl border border-border flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink">{m.label}</span>
              <Badge variant={m.currency === 'USD' ? 'primary' : 'neutral'} size="sm">
                {m.currency === 'USD' ? 'USD ($)' : 'Bs'}
              </Badge>
            </div>
            <Input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder="0.00"
              value={methodValues[m.method] || ''}
              onChange={(e) => onMethodChange(m.method, e.target.value)}
              className="font-mono text-base font-bold min-h-[48px]"
            />
          </div>
        ))}
      </div>

      <label className="flex items-start gap-3 p-3 bg-surface rounded-xl border border-border cursor-pointer select-none hover:bg-surface-alt transition-colors">
        <input
          type="checkbox"
          checked={confirmEmpty}
          onChange={(e) => onConfirmEmptyChange(e.target.checked)}
          className="w-5 h-5 mt-0.5 rounded border-border text-primary cursor-pointer shrink-0"
        />
        <div className="flex flex-col">
          <span className="text-sm font-bold text-ink">Confirmo turno sin movimientos</span>
          <span className="text-xs text-ink-muted">
            Marca esta casilla para autorizar el cierre con todos los valores en cero si no hubo actividad durante el turno.
          </span>
        </div>
      </label>

      <Field label="Observaciones del Cierre">
        <Input
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Detalles sobre billetes deteriorados, vueltos pendientes, etc."
        />
      </Field>

      <Field label="PIN de Autorización (opcional)" hint="PIN de cajera, supervisor o administrador si se requiere autorización">
        <Input
          type="password"
          maxLength={6}
          value={closingPin}
          onChange={(e) => onClosingPinChange(e.target.value)}
          placeholder="Ingresa PIN..."
          className="font-mono text-center tracking-widest text-lg font-bold"
        />
      </Field>
    </div>
  );
};
