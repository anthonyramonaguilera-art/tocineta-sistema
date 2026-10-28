import React from 'react';
import { Icon, type IconName } from './Icon.js';

export type BadgeVariant = 'primary' | 'success' | 'danger' | 'warning' | 'neutral' | 'brand';

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  icon?: IconName | React.ReactElement;
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  children,
  icon,
  size = 'md',
  className = ''
}) => {
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-xs px-2.5 py-1'
  };

  const variantClasses: Record<BadgeVariant, string> = {
    primary: 'bg-primary text-primary-ink font-bold border border-transparent',
    success: 'bg-success-subtle text-success font-bold border border-success/30',
    danger: 'bg-danger-subtle text-danger font-bold border border-danger/30',
    warning: 'bg-warning-subtle text-warning font-bold border border-warning/30',
    neutral: 'bg-surface-alt text-ink-muted font-semibold border border-border',
    brand: 'bg-brand-red text-brand-red-ink font-bold border border-transparent'
  };

  const renderIcon = (iconProp?: IconName | React.ReactElement) => {
    if (!iconProp) return null;
    if (typeof iconProp === 'string') {
      return <Icon name={iconProp} size={size === 'sm' ? 12 : 14} />;
    }
    return iconProp;
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full select-none ${sizeClasses[size]} ${variantClasses[variant]} ${className}`.trim()}
    >
      {renderIcon(icon)}
      <span>{children}</span>
    </span>
  );
};

export default Badge;
