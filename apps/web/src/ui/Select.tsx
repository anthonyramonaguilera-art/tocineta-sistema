import React from 'react';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  hasError?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({
  hasError = false,
  className = '',
  disabled,
  children,
  ...props
}, ref) => {
  const baseClasses = 'w-full min-h-[48px] px-3.5 py-2.5 rounded-lg border text-base text-ink bg-surface transition-colors disabled:bg-surface-alt disabled:cursor-not-allowed outline-none cursor-pointer';

  const stateClasses = hasError
    ? 'border-danger focus:ring-2 focus:ring-danger'
    : 'border-border focus:border-ink focus:ring-2 focus:ring-primary';

  return (
    <div className="relative w-full">
      <select
        ref={ref}
        disabled={disabled}
        className={`${baseClasses} ${stateClasses} pr-10 appearance-none ${className}`.trim()}
        {...props}
      >
        {children}
      </select>
      <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-ink-muted">
        <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20">
          <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
        </svg>
      </div>
    </div>
  );
});

Select.displayName = 'Select';
