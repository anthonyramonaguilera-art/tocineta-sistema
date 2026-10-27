import React, { useState } from 'react';

interface ProductImagePlaceholderProps {
  imageUrl?: string | null;
  name: string;
  station?: string;
  className?: string;
  aspectRatio?: '4/3' | 'square' | 'auto';
}

/**
 * Tarjeta de imagen de producto oficial de TOCINETA (F1)
 * Cumple: Si no hay foto, tarjeta con fondo de marca y nombre del plato en grande (nunca monograma gris).
 * Cero códigos HEX en TSX, solo tokens semánticos.
 */
export const ProductImagePlaceholder: React.FC<ProductImagePlaceholderProps> = ({
  imageUrl,
  name,
  className = 'w-full h-32',
  aspectRatio = '4/3'
}) => {
  const [imageError, setImageError] = useState(false);

  const aspectClass = aspectRatio === '4/3' ? 'aspect-[4/3]' : aspectRatio === 'square' ? 'aspect-square' : '';

  if (imageUrl && !imageError) {
    return (
      <div className={`${className} ${aspectClass} rounded-2xl overflow-hidden bg-surface-alt border border-border relative shadow-inner group select-none`}>
        <img
          src={imageUrl}
          alt={name}
          onError={() => setImageError(true)}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/30 via-transparent to-transparent opacity-20 group-hover:opacity-10 transition-opacity" />
      </div>
    );
  }

  // Fallback con fondo de marca y nombre del plato en grande
  return (
    <div
      className={`${className} ${aspectClass} rounded-2xl overflow-hidden bg-gradient-to-br from-primary/30 via-surface-alt to-brand-orange/25 border-2 border-primary/40 flex flex-col items-center justify-center p-3 relative shadow-inner select-none transition-all group`}
    >
      <div className="absolute top-2 right-2 opacity-20 pointer-events-none">
        <img src="/brand/carita.png" alt="Tocineta" className="w-10 h-10 object-contain" />
      </div>
      <span className="text-sm font-black text-ink text-center line-clamp-2 uppercase tracking-tight px-2 leading-snug drop-shadow-sm">
        {name}
      </span>
      <div className="flex items-center gap-1.5 mt-2">
        <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        <span className="text-[10px] font-black tracking-widest uppercase text-ink-muted">
          TOCINETA
        </span>
      </div>
    </div>
  );
};

export default ProductImagePlaceholder;
