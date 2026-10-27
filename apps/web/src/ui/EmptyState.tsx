import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
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
  return (
    <div className={`flex flex-col items-center justify-center text-center p-8 rounded-xl bg-surface-alt border border-border border-dashed ${className}`.trim()}>
      {icon && (
        <div className="w-14 h-14 rounded-full bg-surface border border-border flex items-center justify-center text-ink-muted mb-3.5 shadow-sm">
          {icon}
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
