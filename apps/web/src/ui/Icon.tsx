import React from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import * as LucideIcons from 'lucide-react';

export interface IconProps extends Omit<LucideProps, 'name'> {
  icon?: LucideIcon;
  name?: string;
  size?: number | string;
  className?: string;
  label?: string;
}

export const Icon: React.FC<IconProps> = ({
  icon,
  name,
  size = 20,
  className = '',
  label,
  ...props
}) => {
  const IconComponent: LucideIcon =
    icon || (name ? (LucideIcons as any)[name] : null) || LucideIcons.HelpCircle;

  return (
    <IconComponent
      size={size}
      aria-label={label}
      aria-hidden={!label}
      className={`shrink-0 ${className}`.trim()}
      {...props}
    />
  );
};

export default Icon;
