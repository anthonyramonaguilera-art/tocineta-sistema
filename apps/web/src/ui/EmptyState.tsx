import React from 'react';
import { Icon, type IconName } from './Icon.js';

export interface EmptyStateProps {
  icon?: IconName | React.ReactElement;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = ''
}) => {
  const renderIcon = (iconProp?: IconName | React.ReactElement) => {
    if (!iconProp) return null;
    if (typeof iconProp === 'string') {
      return <Icon name={iconProp} size={32} />;
    }
    return iconProp;
  };

  const renderedIcon = renderIcon(icon);

  return (
    <div className={`flex flex-col items-center justify-center text-center p-8 rounded-xl bg-surface-alt border border-border border-dashed ${className}`.trim()}>
      {renderedIcon && (
        <div className="w-14 h-14 rounded-full bg-surface border border-border flex items-center justify-center text-ink-muted mb-3.5 shadow-sm">
          {renderedIcon}
        </div>
      )}
      <h3 className="text-base font-bold text-ink mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-ink-muted max-w-sm mb-4">{description}</p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
};

export default EmptyState;
