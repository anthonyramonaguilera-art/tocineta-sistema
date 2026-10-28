import React from 'react';
import { Icon, type IconName } from './Icon.js';

export type InputIconProp = IconName | React.ReactElement;

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
  error?: boolean;
  iconStart?: InputIconProp;
  leftIcon?: InputIconProp;
  iconEnd?: InputIconProp;
  rightIcon?: InputIconProp;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({
  hasError = false,
  error = false,
  iconStart,
  leftIcon,
  iconEnd,
  rightIcon,
  className = '',
  disabled,
  ...props
}, ref) => {
  const isError = hasError || error;

  const renderIcon = (iconProp?: InputIconProp) => {
    if (!iconProp) return null;
    if (typeof iconProp === 'string') {
      return <Icon name={iconProp} size={18} />;
    }
    return iconProp;
  };

  const start = renderIcon(iconStart || leftIcon);
  const end = renderIcon(iconEnd || rightIcon);

  const baseClasses = 'w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border text-sm text-ink bg-surface placeholder:text-ink-muted transition-colors disabled:bg-surface-alt disabled:cursor-not-allowed outline-none font-medium';

  const stateClasses = isError
    ? 'border-danger focus:ring-2 focus:ring-danger/20'
    : 'border-border focus:border-primary focus:ring-2 focus:ring-primary/20';

  if (!start && !end) {
    return (
      <input
        ref={ref}
        disabled={disabled}
        className={`${baseClasses} ${stateClasses} ${className}`.trim()}
        {...props}
      />
    );
  }

  return (
    <div className="relative flex items-center w-full">
      {start && (
        <div className="absolute left-3.5 flex items-center pointer-events-none text-ink-muted">
          {start}
        </div>
      )}
      <input
        ref={ref}
        disabled={disabled}
        className={`${baseClasses} ${stateClasses} ${start ? 'pl-11' : ''} ${end ? 'pr-11' : ''} ${className}`.trim()}
        {...props}
      />
      {end && (
        <div className="absolute right-3.5 flex items-center text-ink-muted">
          {end}
        </div>
      )}
    </div>
  );
});

Input.displayName = 'Input';

export default Input;
