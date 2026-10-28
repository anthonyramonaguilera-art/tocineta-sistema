import React from 'react';
import { Icon, type IconName } from './Icon.js';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonIconProp = IconName | React.ReactElement;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  isLoading?: boolean;
  loading?: boolean;
  iconStart?: ButtonIconProp;
  leftIcon?: ButtonIconProp;
  iconEnd?: ButtonIconProp;
  rightIcon?: ButtonIconProp;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  isLoading = false,
  loading = false,
  iconStart,
  leftIcon,
  iconEnd,
  rightIcon,
  children,
  className = '',
  disabled,
  ...props
}, ref) => {
  const isSpinning = isLoading || loading;

  const iconSizeMap: Record<ButtonSize, number> = {
    sm: 14,
    md: 18,
    lg: 20
  };

  const renderIcon = (iconProp?: ButtonIconProp) => {
    if (!iconProp) return null;
    if (typeof iconProp === 'string') {
      return <Icon name={iconProp} size={iconSizeMap[size]} />;
    }
    return iconProp;
  };

  const start = renderIcon(iconStart || leftIcon);
  const end = renderIcon(iconEnd || rightIcon);

  const baseClasses = 'inline-flex items-center justify-center gap-2 rounded-xl transition-all select-none text-center cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]';

  const sizeClasses: Record<ButtonSize, string> = {
    sm: 'min-h-[40px] px-3 py-1.5 text-xs font-bold',
    md: 'min-h-[48px] px-4 py-2.5 text-sm font-bold',
    lg: 'min-h-[54px] px-6 py-3.5 text-base font-black'
  };

  const variantClasses: Record<ButtonVariant, string> = {
    primary: 'bg-primary text-primary-ink hover:bg-primary-hover active:opacity-90 border border-primary shadow-sm font-black',
    secondary: 'bg-surface-alt text-ink hover:bg-surface border border-border font-bold',
    danger: 'bg-danger text-danger-ink hover:opacity-90 active:opacity-80 border border-transparent font-bold shadow-sm',
    ghost: 'bg-transparent text-ink hover:bg-surface-alt active:bg-surface-alt border border-transparent font-medium'
  };

  const widthClass = fullWidth ? 'w-full' : '';

  return (
    <button
      ref={ref}
      disabled={disabled || isSpinning}
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${widthClass} ${className}`.trim()}
      {...props}
    >
      {isSpinning ? (
        <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        start
      )}
      {children && <span>{children}</span>}
      {!isSpinning && end}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;
