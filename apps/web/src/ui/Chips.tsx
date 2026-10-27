import React from 'react';

export interface ChipItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
}

export interface ChipsProps {
  items?: ChipItem[];
  options?: ChipItem[];
  selectedId?: string;
  value?: string;
  selectedIds?: string[];
  onChange?: (id: string) => void;
  onSelect?: (id: string) => void;
  onToggle?: (id: string) => void;
  className?: string;
}

export const Chips: React.FC<ChipsProps> = ({
  items,
  options,
  selectedId,
  value,
  selectedIds,
  onChange,
  onSelect,
  onToggle,
  className = ''
}) => {
  const chipList = items || options || [];
  const currentSelectedId = selectedId || value;

  return (
    <div className={`overflow-x-auto scrollbar-none py-1.5 ${className}`.trim()}>
      <div className="flex items-center gap-2 min-w-max px-0.5">
        {chipList.map((item) => {
          const isSelected = selectedIds
            ? selectedIds.includes(item.id)
            : item.id === currentSelectedId;

          const handleClick = () => {
            if (onToggle) onToggle(item.id);
            else if (onSelect) onSelect(item.id);
            else if (onChange) onChange(item.id);
          };

          return (
            <button
              key={item.id}
              type="button"
              onClick={handleClick}
              className={`flex items-center gap-1.5 min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition-all select-none cursor-pointer border ${
                isSelected
                  ? 'bg-primary text-primary-ink border-primary font-bold shadow-sm'
                  : 'bg-surface text-ink border-border hover:bg-surface-alt active:bg-surface-alt'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge !== undefined && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    isSelected ? 'bg-primary-ink text-surface' : 'bg-surface-alt border border-border text-ink-muted'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default Chips;
