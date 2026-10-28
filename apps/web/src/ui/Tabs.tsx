import React from 'react';
import { Icon, type IconName } from './Icon.js';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: IconName | React.ReactElement;
}

export interface TabsProps {
  items?: TabItem[];
  tabs?: TabItem[];
  activeId?: string;
  activeTab?: string;
  onChange: (id: string) => void;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  items,
  tabs,
  activeId,
  activeTab,
  onChange,
  className = ''
}) => {
  const tabList = items || tabs || [];
  const currentActiveId = activeId || activeTab || '';

  const renderIcon = (iconProp?: IconName | React.ReactElement) => {
    if (!iconProp) return null;
    if (typeof iconProp === 'string') {
      return <Icon name={iconProp} size={16} />;
    }
    return iconProp;
  };

  return (
    <div className={`overflow-x-auto scrollbar-none border-b border-border ${className}`.trim()}>
      <div className="flex gap-2 min-w-max px-1">
        {tabList.map(item => {
          const isActive = item.id === currentActiveId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={`flex items-center gap-2 py-3 px-3.5 border-b-2 font-bold text-sm transition-all select-none cursor-pointer whitespace-nowrap ${
                isActive
                  ? 'border-primary text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink hover:border-border'
              }`}
            >
              {renderIcon(item.icon)}
              <span>{item.label}</span>
              {typeof item.count === 'number' && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                    isActive
                      ? 'bg-primary text-primary-ink'
                      : 'bg-surface-alt text-ink-muted'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default Tabs;
