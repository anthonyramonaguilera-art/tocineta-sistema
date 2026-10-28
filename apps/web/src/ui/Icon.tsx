import React from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { ICONS, type IconName } from './icons.js';

export type { IconName };

export interface IconProps extends Omit<LucideProps, 'name'> {
  name?: IconName;
  icon?: LucideIcon;
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
  const IconComponent: LucideIcon | undefined = icon || (name ? ICONS[name] : undefined);

  if (!IconComponent) {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
      throw new Error(`[Icon] Ícono no registrado en ICONS: "${name}"`);
    }
    // En producción dibuja un contenedor neutro sin texto
    return (
      <span
        aria-hidden="true"
        className={`inline-block shrink-0 bg-ink-muted/20 rounded ${className}`.trim()}
        style={{ width: size, height: size }}
      />
    );
  }

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
