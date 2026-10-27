import React from 'react';
import { Delete, Check } from 'lucide-react';

export interface NumberPadProps {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  onClear?: () => void;
  maxLength?: number;
  allowDecimal?: boolean;
  enterLabel?: string;
  className?: string;
}

export const NumberPad: React.FC<NumberPadProps> = ({
  value,
  onChange,
  onEnter,
  onClear,
  maxLength = 10,
  allowDecimal = true,
  enterLabel,
  className = ''
}) => {
  const handleDigit = (digit: string) => {
    if (value.length >= maxLength) return;
    if (digit === '.' && (value.includes('.') || !allowDecimal)) return;
    onChange(value + digit);
  };

  const handleBackspace = () => {
    if (value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [allowDecimal ? '.' : 'C', '0', 'DEL']
  ];

  return (
    <div className={`grid grid-cols-3 gap-2 w-full max-w-sm select-none ${className}`.trim()}>
      {keys.flat().map((k, idx) => {
        if (k === 'DEL') {
          return (
            <button
              key="del"
              type="button"
              onClick={handleBackspace}
              className="min-h-[54px] rounded-xl bg-surface-alt hover:bg-surface-hover active:bg-surface-active text-ink border border-border flex items-center justify-center font-bold text-lg transition-colors cursor-pointer"
              aria-label="Borrar último dígito"
            >
              <Delete className="w-6 h-6 text-ink-muted" />
            </button>
          );
        }

        if (k === 'C') {
          return (
            <button
              key="clear"
              type="button"
              onClick={() => {
                if (onClear) onClear();
                else onChange('');
              }}
              className="min-h-[54px] rounded-xl bg-surface-alt hover:bg-surface-hover active:bg-surface-active text-ink border border-border flex items-center justify-center font-bold text-lg transition-colors cursor-pointer text-danger"
              aria-label="Limpiar entrada"
            >
              C
            </button>
          );
        }

        return (
          <button
            key={`${k}-${idx}`}
            type="button"
            onClick={() => handleDigit(k)}
            className="min-h-[54px] rounded-xl bg-surface hover:bg-surface-hover active:bg-surface-active text-ink border border-border flex items-center justify-center font-extrabold text-2xl transition-colors cursor-pointer shadow-sm"
          >
            {k}
          </button>
        );
      })}

      {onEnter && (
        <button
          type="button"
          onClick={onEnter}
          className="col-span-3 min-h-[52px] rounded-xl bg-primary hover:bg-primary-hover active:opacity-90 text-primary-ink font-black text-lg flex items-center justify-center gap-2 border border-transparent transition-colors cursor-pointer shadow-md mt-1"
        >
          <Check className="w-5 h-5" />
          <span>{enterLabel || 'Confirmar'}</span>
        </button>
      )}
    </div>
  );
};
