import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'surface' | 'alt' | 'interactive';
  selected?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(({
  variant = 'surface',
  selected = false,
  padding = 'md',
  className = '',
  children,
  ...props
}, ref) => {
  const baseClasses = 'rounded-xl transition-all border';

  const paddingClasses = {
    none: 'p-0',
    sm: 'p-2.5',
    md: 'p-4',
    lg: 'p-6'
  };

  const variantClasses = {
    surface: 'bg-surface text-ink border-border shadow-sm',
    alt: 'bg-surface-alt text-ink border-border',
    interactive: selected
      ? 'bg-surface-alt text-ink border-primary ring-2 ring-primary shadow-md cursor-pointer'
      : 'bg-surface text-ink border-border hover:border-primary-hover hover:bg-surface-hover active:bg-surface-active cursor-pointer shadow-sm'
  };

  return (
    <div
      ref={ref}
      className={`${baseClasses} ${paddingClasses[padding]} ${variantClasses[variant]} ${className}`.trim()}
      {...props}
    >
      {children}
    </div>
  );
});

Card.displayName = 'Card';
